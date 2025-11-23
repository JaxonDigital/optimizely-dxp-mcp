/**
 * Azure Blob Streamer Module
 * Streams blobs from Azure Storage via HTTPS (no SDK dependency)
 * Part of DXP-110 implementation
 */

import * as https from 'https';
import * as zlib from 'zlib';
import { URL } from 'url';
import OutputLogger from './output-logger';

// Type definitions
interface StreamOptions {
    debug?: boolean;
}

interface StreamStats {
    bytesDownloaded: number;
    linesProcessed: number;
    duration: number;
    throughput: number;
}

interface BlobCountResult {
    count: number;
    estimated: boolean;
    pages: number;
}

interface BlobPageResult {
    blobNames: string[];
    nextMarker: string | null;
}

interface FilterOptions {
    minutesBack?: number;
    startDateTime?: string;
    endDateTime?: string;
    debug?: boolean;  // DXP-189: Enhanced debug logging for date filtering
}

type LineHandler = (line: string) => Promise<void>;

class AzureBlobStreamer {
    /**
     * Stream a blob and process line-by-line
     */
    static async streamBlob(sasUrl: string, lineHandler: LineHandler, options: StreamOptions = {}): Promise<StreamStats> {
        const { debug = false } = options;

        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            let bytesDownloaded = 0;
            let linesProcessed = 0;
            let buffer = '';

            const parsedUrl = new URL(sasUrl);

            const requestOptions = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: 'GET',
                headers: {
                    'Accept-Encoding': 'gzip'
                }
            };

            const req = https.request(requestOptions, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }

                // Handle gzip compression
                const isGzipped = res.headers['content-encoding'] === 'gzip';
                const stream = isGzipped ? res.pipe(zlib.createGunzip()) : res;

                stream.on('data', async (chunk: Buffer) => {
                    bytesDownloaded += chunk.length;
                    buffer += chunk.toString('utf8');

                    // Process complete lines
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                await lineHandler(line);
                                linesProcessed++;
                            } catch (error) {
                                if (debug) {
                                    OutputLogger.debug(`Error processing line: ${(error as Error).message}`);
                                }
                            }
                        }
                    }
                });

                stream.on('end', async () => {
                    // Process final line if exists
                    if (buffer.trim()) {
                        try {
                            await lineHandler(buffer);
                            linesProcessed++;
                        } catch (error) {
                            if (debug) {
                                OutputLogger.debug(`Error processing final line: ${(error as Error).message}`);
                            }
                        }
                    }

                    const duration = Date.now() - startTime;
                    resolve({
                        bytesDownloaded,
                        linesProcessed,
                        duration,
                        throughput: Math.round(bytesDownloaded / (duration / 1000))
                    });
                });

                stream.on('error', reject);
            });

            req.on('error', reject);
            req.end();
        });
    }

    /**
     * Count blobs in a container (quick diagnostic)
     * Fetches only first few pages to estimate size
     */
    static async countBlobs(containerSasUrl: string, maxPages: number = 3): Promise<BlobCountResult> {
        const parsedUrl = new URL(containerSasUrl);
        let count = 0;
        let marker: string | null = null;
        let pageCount = 0;

        OutputLogger.info(`🔢 Counting blobs (max ${maxPages} pages)...`);

        try {
            do {
                pageCount++;
                // DXP-179: Fix double ?? bug - parsedUrl.search already includes leading ?
                let listUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}&restype=container&comp=list`;
                if (marker) {
                    listUrl += `&marker=${encodeURIComponent(marker)}`;
                }

                const { blobNames, nextMarker } = await this._fetchBlobPage(listUrl);
                count += blobNames.length;
                marker = nextMarker;

                OutputLogger.info(`📄 Page ${pageCount}: ${blobNames.length} blobs (total: ${count}, hasMore: ${!!nextMarker})`);

                if (pageCount >= maxPages) {
                    break;
                }
            } while (marker);

            const estimated = marker !== null; // Still has more pages
            OutputLogger.info(`✅ ${estimated ? 'Estimated' : 'Exact'} count: ${count}${estimated ? '+' : ''} blobs across ${pageCount} pages`);

            return { count, estimated, pages: pageCount };
        } catch (error) {
            throw new Error(`Failed to count blobs: ${(error as Error).message}`);
        }
    }

    /**
     * List blobs in a container and get their SAS URLs
     * DXP-117: Added pagination support to handle containers with >5000 blobs
     */
    static async listBlobs(containerSasUrl: string): Promise<string[]> {
        const MAX_PAGES = 20; // Limit to 100K blobs (5000 per page)
        const MAX_PAGES_FOR_SHORT_QUERIES = 5; // For minutesBack < 60, only fetch 25K blobs
        const parsedUrl = new URL(containerSasUrl);
        const allBlobNames: string[] = [];
        let marker: string | null = null;
        let pageCount = 0;

        OutputLogger.info(`📋 Starting blob list operation...`);
        const startTime = Date.now();

        try {
            do {
                pageCount++;
                const pageStartTime = Date.now();
                OutputLogger.info(`📄 Fetching page ${pageCount}...`);

                // Build URL with optional marker for pagination
                // DXP-179: Fix double ?? bug - parsedUrl.search already includes leading ?
                let listUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}&restype=container&comp=list`;
                if (marker) {
                    listUrl += `&marker=${encodeURIComponent(marker)}`;
                }

                // Fetch page of blobs
                const { blobNames, nextMarker } = await this._fetchBlobPage(listUrl);
                const pageDuration = Date.now() - pageStartTime;
                allBlobNames.push(...blobNames);
                marker = nextMarker;

                // DXP-117: Log pagination progress with timing
                OutputLogger.info(`📄 Fetched page ${pageCount}: ${blobNames.length} blobs in ${pageDuration}ms (total: ${allBlobNames.length}, hasMore: ${!!nextMarker})`);

                // Performance safeguard: prevent excessive pagination
                if (pageCount >= MAX_PAGES) {
                    OutputLogger.warn(`⚠️ Hit max page limit (${MAX_PAGES} pages = ${MAX_PAGES * 5000} blobs). Stopping pagination.`);
                    break;
                }

                // Early exit warning for large containers
                if (pageCount >= MAX_PAGES_FOR_SHORT_QUERIES && marker) {
                    OutputLogger.warn(`⚠️ Large container detected (${allBlobNames.length}+ blobs). Consider using longer time ranges for better performance.`);
                }

            } while (marker);

            // Log completion
            const totalDuration = Date.now() - startTime;
            if (pageCount > 1) {
                OutputLogger.info(`✅ Fetched ${allBlobNames.length.toLocaleString()} blobs across ${pageCount} pages in ${totalDuration}ms`);
            } else {
                OutputLogger.info(`✅ Fetched ${allBlobNames.length.toLocaleString()} blobs (single page, no pagination needed) in ${totalDuration}ms`);
            }

            // Generate SAS URLs for all blobs
            OutputLogger.info(`🔗 Generating ${allBlobNames.length} SAS URLs...`);
            const urlStartTime = Date.now();
            const blobUrls = allBlobNames.map(name => {
                // DXP-179: Fix double ?? bug - parsedUrl.search already includes leading ?
                return `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}/${name}${parsedUrl.search}`;
            });
            const urlDuration = Date.now() - urlStartTime;
            OutputLogger.info(`✅ Generated ${blobUrls.length} SAS URLs in ${urlDuration}ms`);

            return blobUrls;

        } catch (error) {
            throw new Error(`Failed to list blobs: ${(error as Error).message}`);
        }
    }

    /**
     * Fetch a single page of blobs from Azure Storage
     * DXP-117: Helper method for pagination support
     * @private
     */
    static _fetchBlobPage(listUrl: string): Promise<BlobPageResult> {
        return new Promise((resolve, reject) => {
            https.get(listUrl, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                        return;
                    }

                    try {
                        // Parse XML response for blob names
                        const blobNames: string[] = [];
                        const nameMatches = data.matchAll(/<Name>([^<]+)<\/Name>/g);
                        for (const match of nameMatches) {
                            blobNames.push(match[1]);
                        }

                        // Extract NextMarker for pagination
                        // Azure returns <NextMarker>value</NextMarker> when more results exist
                        const markerMatch = data.match(/<NextMarker>([^<]*)<\/NextMarker>/);
                        const nextMarker = markerMatch ? markerMatch[1] : null;

                        resolve({ blobNames, nextMarker });
                    } catch (error) {
                        reject(new Error(`Failed to parse blob list XML: ${(error as Error).message}`));
                    }
                });

                res.on('error', reject);
            }).on('error', reject);
        });
    }

    /**
     * Filter blobs by date/time range
     */
    static filterBlobsByDate(blobUrls: string[], options: FilterOptions = {}): string[] {
        const { minutesBack, startDateTime, endDateTime, debug = false } = options;

        // Calculate time range - ALWAYS use UTC for consistency
        let startTime: Date, endTime: Date;

        if (minutesBack) {
            // DXP-114 FIX: Create dates in UTC to match blob timestamps
            const nowUtc = new Date();
            endTime = nowUtc;
            startTime = new Date(nowUtc.getTime() - minutesBack * 60 * 1000);

            // DXP-114 FIX: Log timezone info for debugging
            OutputLogger.info(`⏰ Current time (UTC): ${endTime.toISOString()}`);
            OutputLogger.info(`⏰ Filtering for last ${minutesBack} minutes: ${startTime.toISOString()} to ${endTime.toISOString()}`);
        } else if (startDateTime && endDateTime) {
            startTime = new Date(startDateTime);
            endTime = new Date(endDateTime);
            OutputLogger.info(`⏰ Time range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
        } else {
            // No filtering
            return blobUrls;
        }

        // Extract timestamps from blob names (Azure format: y=YYYY/m=MM/d=DD/h=HH/m=MM)
        // DEBUG: Log blob count and sample
        OutputLogger.info(`📊 Total blobs before filtering: ${blobUrls.length}`);
        if (blobUrls.length > 0) {
            OutputLogger.info(`🔍 Sample blob URL: ${blobUrls[0]}`);

            // Check if container has archived exports mixed with streaming logs
            const hasArchives = blobUrls.some(url => url.includes('.zip') || url.includes('.gz'));
            const archiveCount = blobUrls.filter(url => url.includes('.zip') || url.includes('.gz')).length;
            if (hasArchives) {
                OutputLogger.warn(`⚠️ Found ${archiveCount} archived log exports (.zip/.gz) - these will be excluded from streaming analysis`);
                OutputLogger.info(`   Only processing standard Azure Application Insights streaming logs`);
            }
        }

        return blobUrls.filter(url => {
            // Exclude archived log exports (ZIP/GZ files)
            if (url.includes('.zip') || url.includes('.gz')) {
                OutputLogger.debug(`⏭️  Excluding archived export: ${url}`);
                return false;
            }

            // DXP-114: Parse path segments sequentially to avoid m= ambiguity
            // Split URL path and find segments by prefix
            const pathParts = url.split('/');

            // Try new format first: y=YYYY/m=MM/d=DD/h=HH/m=MM
            const yearPart = pathParts.find(p => p.startsWith('y='));
            const dayPart = pathParts.find(p => p.startsWith('d='));
            const hourPart = pathParts.find(p => p.startsWith('h='));

            // Find BOTH m= parts (month first, then minute)
            const monthIndex = pathParts.findIndex(p => p.startsWith('m='));
            const monthPart = monthIndex >= 0 ? pathParts[monthIndex] : null;

            if (yearPart && monthPart && dayPart && hourPart) {
                const year = yearPart.substring(2);
                const month = monthPart.substring(2);
                const day = dayPart.substring(2);
                const hour = hourPart.substring(2);

                // DXP-114 FIX: Use hour-based overlap filtering
                // Azure blobs contain full hour of logs (PT1H.json), not just specific minute
                // Include blob if its hour overlaps with requested time range
                const blobHourStart = new Date(`${year}-${month}-${day}T${hour}:00:00Z`);
                const blobHourEnd = new Date(`${year}-${month}-${day}T${hour}:59:59Z`);

                // Check if blob's hour overlaps with requested range
                const overlaps = (blobHourEnd >= startTime && blobHourStart <= endTime);

                // DXP-189: Enhanced debug logging for filtering decisions
                if (debug) {
                    if (overlaps) {
                        OutputLogger.debug(`✅ Including blob: ${year}-${month}-${day}T${hour}:XX (overlaps ${startTime.toISOString()} to ${endTime.toISOString()})`);
                    } else {
                        OutputLogger.debug(`❌ Filtered out blob: ${url}`);
                        OutputLogger.debug(`   Blob hour: ${blobHourStart.toISOString()} - ${blobHourEnd.toISOString()}`);
                        OutputLogger.debug(`   Requested: ${startTime.toISOString()} - ${endTime.toISOString()}`);
                        const blobTooOld = blobHourEnd < startTime;
                        const blobTooNew = blobHourStart > endTime;
                        OutputLogger.debug(`   Reason: ${blobTooOld ? 'Blob ends before requested range starts' : blobTooNew ? 'Blob starts after requested range ends' : 'No overlap'}`);
                    }
                }

                return overlaps;
            }

            // Fallback to old format for backwards compatibility: YYYY/MM/DD/HH/
            const match = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})\//);
            if (match) {
                const [, year, month, day, hour] = match;
                const blobHourStart = new Date(`${year}-${month}-${day}T${hour}:00:00Z`);
                const blobHourEnd = new Date(`${year}-${month}-${day}T${hour}:59:59Z`);
                const overlaps = (blobHourEnd >= startTime && blobHourStart <= endTime);

                // DXP-189: Enhanced debug logging for old format
                if (debug) {
                    if (overlaps) {
                        OutputLogger.debug(`✅ Including blob (old format): ${year}-${month}-${day}T${hour}:00`);
                    } else {
                        OutputLogger.debug(`❌ Filtered out blob (old format): ${url}`);
                        OutputLogger.debug(`   Blob hour: ${blobHourStart.toISOString()} - ${blobHourEnd.toISOString()}`);
                        OutputLogger.debug(`   Requested: ${startTime.toISOString()} - ${endTime.toISOString()}`);
                        const blobTooOld = blobHourEnd < startTime;
                        const blobTooNew = blobHourStart > endTime;
                        OutputLogger.debug(`   Reason: ${blobTooOld ? 'Blob ends before requested range starts' : blobTooNew ? 'Blob starts after requested range ends' : 'No overlap'}`);
                    }
                }

                return overlaps;
            }

            // Exclude if can't parse date (likely old format or unexpected naming)
            OutputLogger.debug(`⚠️  Excluding unparseable blob: ${url}`);
            return false;
        });
    }
}

export default AzureBlobStreamer;

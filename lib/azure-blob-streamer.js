/**
 * Azure Blob Streamer Module
 * Streams blobs from Azure Storage via HTTPS (no SDK dependency)
 * Part of DXP-110 implementation
 */

const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');
const OutputLogger = require('./output-logger');

class AzureBlobStreamer {
    /**
     * Stream a blob and process line-by-line
     * @param {string} sasUrl - SAS URL for blob
     * @param {Function} lineHandler - Callback for each line (async)
     * @param {Object} options - Streaming options
     * @returns {Promise<Object>} Statistics about the stream
     */
    static async streamBlob(sasUrl, lineHandler, options = {}) {
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

                stream.on('data', async (chunk) => {
                    bytesDownloaded += chunk.length;
                    buffer += chunk.toString('utf8');

                    // Process complete lines
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep incomplete line in buffer

                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                await lineHandler(line);
                                linesProcessed++;
                            } catch (error) {
                                if (debug) {
                                    OutputLogger.debug(`Error processing line: ${error.message}`);
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
                                OutputLogger.debug(`Error processing final line: ${error.message}`);
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
     * List blobs in a container and get their SAS URLs
     * DXP-117: Added pagination support to handle containers with >5000 blobs
     * @param {string} containerSasUrl - SAS URL for container
     * @returns {Promise<string[]>} Array of blob SAS URLs
     */
    static async listBlobs(containerSasUrl) {
        const MAX_PAGES = 20; // Limit to 100K blobs (5000 per page)
        const parsedUrl = new URL(containerSasUrl);
        const allBlobNames = [];
        let marker = null;
        let pageCount = 0;

        try {
            do {
                pageCount++;

                // Build URL with optional marker for pagination
                let listUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}?${parsedUrl.search}&restype=container&comp=list`;
                if (marker) {
                    listUrl += `&marker=${encodeURIComponent(marker)}`;
                }

                // Fetch page of blobs
                const { blobNames, nextMarker } = await this._fetchBlobPage(listUrl);
                allBlobNames.push(...blobNames);
                marker = nextMarker;

                // DXP-117: Log pagination progress
                OutputLogger.debug(`📄 Fetched page ${pageCount}: ${blobNames.length} blobs (total: ${allBlobNames.length}, hasMore: ${!!nextMarker})`);

                // Performance safeguard: prevent excessive pagination
                if (pageCount >= MAX_PAGES) {
                    OutputLogger.warn(`⚠️ Hit max page limit (${MAX_PAGES} pages = ${MAX_PAGES * 5000} blobs). Stopping pagination.`);
                    break;
                }

            } while (marker);

            // Log completion
            if (pageCount > 1) {
                OutputLogger.info(`✅ Fetched ${allBlobNames.length.toLocaleString()} blobs across ${pageCount} pages`);
            } else {
                OutputLogger.debug(`✅ Fetched ${allBlobNames.length.toLocaleString()} blobs (single page, no pagination needed)`);
            }

            // Generate SAS URLs for all blobs
            const blobUrls = allBlobNames.map(name => {
                return `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.pathname}/${name}?${parsedUrl.search}`;
            });

            return blobUrls;

        } catch (error) {
            throw new Error(`Failed to list blobs: ${error.message}`);
        }
    }

    /**
     * Fetch a single page of blobs from Azure Storage
     * DXP-117: Helper method for pagination support
     * @private
     * @param {string} listUrl - URL with optional marker parameter
     * @returns {Promise<{blobNames: string[], nextMarker: string|null}>}
     */
    static _fetchBlobPage(listUrl) {
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
                        const blobNames = [];
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
                        reject(new Error(`Failed to parse blob list XML: ${error.message}`));
                    }
                });

                res.on('error', reject);
            }).on('error', reject);
        });
    }

    /**
     * Filter blobs by date/time range
     * @param {string[]} blobUrls - Array of blob URLs
     * @param {Object} options - Filter options
     * @returns {string[]} Filtered blob URLs
     */
    static filterBlobsByDate(blobUrls, options = {}) {
        const { minutesBack, startDateTime, endDateTime } = options;

        // Calculate time range - ALWAYS use UTC for consistency
        let startTime, endTime;

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
        }

        return blobUrls.filter(url => {
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
            const minutePart = monthIndex >= 0
                ? pathParts.slice(monthIndex + 1).find(p => p.startsWith('m='))
                : null;

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

                // Debug logging for filtering decisions
                if (overlaps) {
                    OutputLogger.debug(`✅ Including blob: ${year}-${month}-${day}T${hour}:XX (overlaps ${startTime.toISOString()} to ${endTime.toISOString()})`);
                } else {
                    OutputLogger.debug(`⏭️  Skipping blob: ${year}-${month}-${day}T${hour}:XX (outside range)`);
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

                if (overlaps) {
                    OutputLogger.debug(`✅ Including blob (old format): ${year}-${month}-${day}T${hour}:00`);
                } else {
                    OutputLogger.debug(`⏭️  Skipping blob (old format): ${year}-${month}-${day}T${hour}:00`);
                }

                return overlaps;
            }

            // Include if can't parse
            OutputLogger.debug(`⚠️  Including unparseable blob: ${url}`);
            return true;
        });
    }
}

module.exports = AzureBlobStreamer;

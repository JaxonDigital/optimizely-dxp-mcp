/**
 * Database Tools - Unified database backup and export operations  
 * Part of Jaxon Digital Optimizely DXP MCP Server
 * 
 * This module provides a unified interface for all database operations:
 * - backup: Natural language backup with smart defaults and auto-download
 * - backup_status: Check export/backup status with auto-download capability
 * - list_backups: List recent backup history
 * 
 * Replaces the previous separation between DatabaseSimpleTools and DatabaseTools
 */

const ProjectTools = require('./project-tools');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const OutputLogger = require('../output-logger');
const DXPRestClient = require('../dxp-rest-client');
const Config = require('../config');
const CapabilityDetector = require('../capability-detector');
const DownloadConfig = require('../download-config');
const ManifestManager = require('../manifest-manager');

class DatabaseSimpleTools {

    // Static registry for background monitoring processes
    static backgroundMonitors = new Map();

    // Static registry for background downloads
    static backgroundDownloads = new Map();

    /**
     * Download Tracking System
     * Unified system for tracking all background downloads (database, logs, blobs)
     */

    /**
     * Create a new download entry and start tracking
     * @param {string} type - Download type: 'database', 'logs', or 'blob'
     * @param {object} metadata - Additional metadata specific to download type
     * @returns {string} downloadId - Unique download identifier
     */
    static createDownload(type, metadata = {}) {
        const downloadId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const download = {
            downloadId,
            type,
            status: 'pending',
            bytesDownloaded: 0,
            totalBytes: 0,
            percent: 0,
            speed: 0,
            eta: null,
            startTime: Date.now(),
            endTime: null,
            error: null,
            filePath: null,
            metadata: metadata || {}
        };

        this.backgroundDownloads.set(downloadId, download);

        // Persist immediately so it survives server restarts
        this.saveDownloadState(download).catch(err => {
            OutputLogger.error(`Failed to persist download ${downloadId}:`, err.message);
        });

        OutputLogger.info(`📦 Created download tracking: ${downloadId}`);
        return downloadId;
    }

    /**
     * Update download progress
     */
    static updateDownloadProgress(downloadId, progress) {
        const download = this.backgroundDownloads.get(downloadId);
        if (!download) return;

        Object.assign(download, progress);

        // Calculate percent if we have totalBytes
        if (download.totalBytes > 0) {
            download.percent = Math.round((download.bytesDownloaded / download.totalBytes) * 100);
        }
    }

    /**
     * Mark download as complete
     */
    static async completeDownload(downloadId, filePath, fileSize) {
        const download = this.backgroundDownloads.get(downloadId);
        if (!download) return;

        download.status = 'complete';
        download.filePath = filePath;
        download.bytesDownloaded = fileSize || download.bytesDownloaded;
        download.totalBytes = fileSize || download.totalBytes;
        download.percent = 100;
        download.endTime = Date.now();

        // Persist download state to survive server restarts
        await this.saveDownloadState(download);

        OutputLogger.success(`✅ Download complete: ${downloadId} -> ${filePath}`);
    }

    /**
     * Mark download as failed
     */
    static async failDownload(downloadId, error) {
        const download = this.backgroundDownloads.get(downloadId);
        if (!download) return;

        download.status = 'error';
        download.error = error.message || String(error);
        download.endTime = Date.now();

        // Persist failed download state
        await this.saveDownloadState(download).catch(err => {
            OutputLogger.error(`Failed to persist error state for ${downloadId}:`, err.message);
        });

        OutputLogger.error(`❌ Download failed: ${downloadId} - ${download.error}`);
    }

    /**
     * Get download status
     */
    static getDownloadStatus(downloadId) {
        return this.backgroundDownloads.get(downloadId);
    }

    /**
     * Clean up old completed/failed downloads (older than 1 hour)
     */
    static cleanupOldDownloads() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        for (const [downloadId, download] of this.backgroundDownloads.entries()) {
            if ((download.status === 'complete' || download.status === 'error') &&
                download.endTime && download.endTime < oneHourAgo) {
                this.backgroundDownloads.delete(downloadId);
                OutputLogger.info(`🧹 Cleaned up old download: ${downloadId}`);
            }
        }
    }

    /**
     * List all active downloads
     */
    static listActiveDownloads() {
        const active = [];
        for (const [downloadId, download] of this.backgroundDownloads.entries()) {
            // Include pending, in_progress, complete, and error downloads
            // This allows users to check status even after completion
            active.push({
                downloadId,
                type: download.type,
                status: download.status,
                percent: download.percent,
                bytesDownloaded: this.formatBytes(download.bytesDownloaded),
                totalBytes: download.totalBytes ? this.formatBytes(download.totalBytes) : 'Unknown',
                eta: download.eta,
                metadata: download.metadata,
                filePath: download.filePath, // Include file path for completed downloads
                endTime: download.endTime // Include completion time
            });
        }
        return active;
    }

    /**
     * Start background download from URL
     * @param {string} downloadId - Download tracking ID
     * @param {string} url - URL to download from
     * @param {string} filepath - Destination file path
     * @returns {Promise<void>}
     */
    static async startBackgroundDownloadFromUrl(downloadId, url, filepath) {
        const download = this.backgroundDownloads.get(downloadId);
        if (!download) {
            throw new Error(`Download ${downloadId} not found`);
        }

        // Start download asynchronously (don't block)
        setImmediate(async () => {
            try {
                download.status = 'in_progress';
                OutputLogger.info(`📥 Starting background download: ${downloadId}`);

                await this._executeDownloadWithTracking(downloadId, url, filepath);

                // Get the expected size from download tracking (set by downloadFile during network transfer)
                const expectedBytes = download.bytesDownloaded;
                if (!expectedBytes || expectedBytes === 0) {
                    throw new Error(`Download tracking shows zero bytes downloaded - this indicates a download failure`);
                }

                // Wait and verify file with retries - filesystem may take time to flush large files
                const fs = require('fs').promises;
                let stats;
                let attempts = 0;
                const maxAttempts = 20; // Up to 10 seconds total wait (20 attempts * 500ms)

                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    attempts++;

                    try {
                        stats = await fs.stat(filepath);

                        // Check if file size matches expected
                        if (stats.size === 0) {
                            if (attempts >= maxAttempts) {
                                throw new Error(`File exists but is still empty after ${maxAttempts * 500}ms`);
                            }
                            OutputLogger.info(`File exists but empty, waiting... (attempt ${attempts}/${maxAttempts})`);
                            continue;
                        }

                        // Allow 1% discrepancy for filesystem rounding
                        const discrepancy = Math.abs(stats.size - expectedBytes) / expectedBytes * 100;

                        if (stats.size < expectedBytes && discrepancy > 1) {
                            if (attempts >= maxAttempts) {
                                throw new Error(
                                    `File size mismatch after ${maxAttempts * 500}ms: ` +
                                    `expected ${this.formatBytes(expectedBytes)}, got ${this.formatBytes(stats.size)} ` +
                                    `(${Math.round(stats.size / expectedBytes * 100)}% written)`
                                );
                            }
                            OutputLogger.info(
                                `File still flushing: ${this.formatBytes(stats.size)}/${this.formatBytes(expectedBytes)} ` +
                                `(attempt ${attempts}/${maxAttempts})`
                            );
                            continue;
                        }

                        // File size is correct - break out of retry loop
                        OutputLogger.success(
                            `✅ File verified: ${this.formatBytes(stats.size)} written to disk (${attempts} attempts)`
                        );
                        break;

                    } catch (statError) {
                        if (attempts >= maxAttempts) {
                            throw new Error(`File not accessible after ${maxAttempts * 500}ms: ${statError.message}`);
                        }
                        OutputLogger.info(`File not yet accessible, waiting... (attempt ${attempts}/${maxAttempts})`);
                    }
                }

                // Safety check: ensure stats was set (should always be true if we reach here)
                if (!stats) {
                    throw new Error(`Internal error: file verification loop completed without setting stats`);
                }

                // Mark as complete with verified file size
                OutputLogger.info(
                    `Marking download complete: expectedBytes=${this.formatBytes(expectedBytes)}, ` +
                    `verifiedSize=${this.formatBytes(stats.size)}, ` +
                    `match=${Math.abs(stats.size - expectedBytes) <= expectedBytes * 0.01}`
                );
                await this.completeDownload(downloadId, filepath, stats.size);

            } catch (error) {
                await this.failDownload(downloadId, error);
            }
        });
    }

    /**
     * Execute download with progress tracking
     * @private
     */
    static async _executeDownloadWithTracking(downloadId, url, filepath) {
        const download = this.backgroundDownloads.get(downloadId);
        if (!download) {
            throw new Error(`Download ${downloadId} not found`);
        }

        const fs = require('fs');
        const path = require('path');

        // Ensure directory exists
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Use the unified downloadFile method with tracking
        return this.downloadFile(url, filepath, 1800000, downloadId);
    }

    /**
     * Handle check_download_status tool call
     */
    static async handleCheckDownloadStatus(args) {
        const { downloadId, waitBeforeCheck = 0, monitor = false } = args;

        if (!downloadId) {
            return ResponseBuilder.invalidParams('downloadId is required');
        }

        // Implement transparent wait-then-check pattern like database exports and deployments
        if (waitBeforeCheck > 0) {
            const OutputLogger = require('../output-logger');
            const waitSeconds = waitBeforeCheck;
            const waitDisplay = waitSeconds >= 60 ?
                `${Math.floor(waitSeconds / 60)}m ${waitSeconds % 60}s` :
                `${waitSeconds}s`;

            OutputLogger.info(`⏱️ Waiting ${waitDisplay} before checking download status...`);
            await new Promise(resolve => setTimeout(resolve, waitBeforeCheck * 1000));
            OutputLogger.success(`✅ Wait complete. Checking download status now...`);
        }

        const download = this.getDownloadStatus(downloadId);

        if (!download) {
            return ResponseBuilder.error(`Download ${downloadId} not found. It may have been cleaned up (downloads are kept for 1 hour after completion).`);
        }

        // Build status message
        let message = `📥 **Download Status**\n\n`;
        message += `**Download ID**: ${download.downloadId}\n`;
        message += `**Type**: ${download.type}\n`;
        message += `**Status**: ${download.status}\n\n`;

        if (download.status === 'in_progress') {
            message += `**Progress**: ${download.percent}%\n`;
            message += `**Downloaded**: ${this.formatBytes(download.bytesDownloaded)}`;
            if (download.totalBytes > 0) {
                message += ` / ${this.formatBytes(download.totalBytes)}`;
            }
            message += `\n`;

            if (download.speed > 0) {
                message += `**Speed**: ${(download.speed / (1024 * 1024)).toFixed(2)} MB/s\n`;
            }

            if (download.eta) {
                message += `**ETA**: ${download.eta} minute${download.eta !== 1 ? 's' : ''}\n`;
            }

            const elapsedMinutes = Math.floor((Date.now() - download.startTime) / 60000);
            message += `**Elapsed**: ${elapsedMinutes} minute${elapsedMinutes !== 1 ? 's' : ''}\n\n`;

            // Add monitoring instructions if monitor mode enabled
            if (monitor) {
                message += `**🤖 AI: Keep monitoring - call check_download_status again:**\n`;
                message += `\`\`\`\ncheck_download_status downloadId: "${downloadId}" waitBeforeCheck: 30 monitor: true\n\`\`\`\n`;
                message += `Keep calling until status is 'complete'.`;
            } else {
                message += `💡 **Tip**: Check again in a few moments to see progress`;
            }

        } else if (download.status === 'complete') {
            // Verify file actually exists and has the expected size
            const fs = require('fs');
            try {
                const stats = fs.statSync(download.filePath);
                const actualSize = stats.size;
                const expectedSize = download.bytesDownloaded;

                // Validate file has content
                if (actualSize === 0) {
                    const secondsSinceComplete = Math.floor((Date.now() - download.endTime) / 1000);

                    // If just completed (within 20 seconds), file might still be flushing
                    if (secondsSinceComplete < 20) {
                        OutputLogger.warn(
                            `File is empty but download just completed ${secondsSinceComplete}s ago - likely still flushing`
                        );

                        message += `**Status**: Finalizing (file being written to disk)\n`;
                        message += `**Completed**: ${secondsSinceComplete} second${secondsSinceComplete !== 1 ? 's' : ''} ago\n\n`;
                        message += `💡 **Note**: Download completed but file is still being written to disk. This is normal for large files (250MB+). Check again in a moment.`;
                        // DXP-66: Add structured data
                        return ResponseBuilder.successWithStructuredData({
                            downloadId: download.downloadId,
                            type: download.type,
                            status: 'finalizing',
                            filePath: download.filePath,
                            bytesDownloaded: download.bytesDownloaded,
                            totalBytes: download.totalBytes,
                            percent: download.percent
                        }, message);
                    }

                    // File is empty after grace period - this is an error
                    return ResponseBuilder.error(
                        `Download marked as complete but file is empty after ${secondsSinceComplete} seconds: ${download.filePath}. ` +
                        `This may indicate a download failure.`
                    );
                }

                // Allow small discrepancies (within 1%) due to filesystem buffering
                const discrepancyPercent = Math.abs(actualSize - expectedSize) / expectedSize * 100;

                if (actualSize < expectedSize && discrepancyPercent > 1) {
                    // Significant size mismatch - this should NOT happen after our retry verification
                    // But filesystem might still be flushing on some systems
                    const percentWritten = Math.round((actualSize / expectedSize) * 100);
                    const secondsSinceComplete = Math.floor((Date.now() - download.endTime) / 1000);

                    OutputLogger.warn(
                        `Size mismatch in check_download_status: ` +
                        `expected=${this.formatBytes(expectedSize)}, actual=${this.formatBytes(actualSize)}, ` +
                        `discrepancy=${discrepancyPercent.toFixed(1)}%, secondsSinceComplete=${secondsSinceComplete}`
                    );

                    message += `**Status**: Finalizing (${percentWritten}% visible on disk)\n`;
                    message += `**Downloaded**: ${this.formatBytes(actualSize)} / ${this.formatBytes(expectedSize)}\n`;
                    message += `**Time since completion**: ${secondsSinceComplete} second${secondsSinceComplete !== 1 ? 's' : ''}\n\n`;
                    message += `💡 **Note**: Download verified but file still flushing to disk. This can take 10-20 seconds for large files (250MB+). Check again in a moment.`;

                    // DXP-66: Add structured data
                    return ResponseBuilder.successWithStructuredData({
                        downloadId: download.downloadId,
                        type: download.type,
                        status: 'finalizing',
                        filePath: download.filePath,
                        bytesDownloaded: actualSize,
                        totalBytes: expectedSize,
                        percent: percentWritten
                    }, message);
                }

                // File is complete and verified
                message += `**File**: ${download.filePath}\n`;
                message += `**Size**: ${this.formatBytes(actualSize)}\n`;

                const elapsedMinutes = Math.floor((download.endTime - download.startTime) / 60000);
                const elapsedSeconds = Math.floor((download.endTime - download.startTime) / 1000) % 60;
                message += `**Duration**: ${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}\n\n`;
                message += `✅ **Download complete!** File is ready to use.`;

                // Include metadata
                if (download.metadata && Object.keys(download.metadata).length > 0) {
                    message += `\n\n**Details**:\n`;
                    for (const [key, value] of Object.entries(download.metadata)) {
                        message += `• ${key}: ${value}\n`;
                    }
                }

                // DXP-66: Add structured data for complete status
                const durationMs = download.endTime - download.startTime;
                return ResponseBuilder.successWithStructuredData({
                    downloadId: download.downloadId,
                    type: download.type,
                    status: 'complete',
                    filePath: download.filePath,
                    fileSize: actualSize,
                    bytesDownloaded: download.bytesDownloaded,
                    totalBytes: download.totalBytes,
                    percent: 100,
                    durationMs: durationMs,
                    metadata: download.metadata || {}
                }, message);
            } catch (err) {
                // File doesn't exist or can't be accessed
                // Check if download just completed and file is being flushed (20 second grace period)
                // Note: Our background verification waits up to 10 seconds, so this allows 2x buffer
                if (download.endTime && (Date.now() - download.endTime) < 20000) {
                    const secondsAgo = Math.floor((Date.now() - download.endTime) / 1000);

                    OutputLogger.warn(
                        `File not accessible via fs.statSync but download completed ${secondsAgo}s ago. ` +
                        `Error: ${err.message}. This is likely transient filesystem buffering.`
                    );

                    message += `**Status**: Finalizing (file being written to disk)\n`;
                    message += `**Completed**: ${secondsAgo} second${secondsAgo !== 1 ? 's' : ''} ago\n\n`;
                    message += `💡 **Note**: Download completed but filesystem is still flushing buffers. This is normal for large files (250MB+). Check again in a moment.`;
                    // DXP-66: Add structured data
                    return ResponseBuilder.successWithStructuredData({
                        downloadId: download.downloadId,
                        type: download.type,
                        status: 'finalizing',
                        filePath: download.filePath,
                        bytesDownloaded: download.bytesDownloaded,
                        totalBytes: download.totalBytes,
                        percent: download.percent
                    }, message);
                }

                // File still not accessible after grace period - this is likely a real error
                OutputLogger.error(
                    `File not accessible after 20+ seconds. Path: ${download.filePath}, Error: ${err.message}`
                );

                return ResponseBuilder.error(
                    `Download marked as complete but file not accessible after 20 seconds: ${download.filePath}. ` +
                    `This may indicate a filesystem or permissions issue. Error: ${err.message}`
                );
            }

        } else if (download.status === 'error') {
            message += `**Error**: ${download.error}\n\n`;
            message += `❌ **Download failed**. Please try again or check the error message above.`;

        } else if (download.status === 'pending') {
            message += `⏳ **Starting...** Download is being initialized.`;
        }

        // DXP-66: Add structured data for all other statuses
        const structuredData = {
            downloadId: download.downloadId,
            type: download.type,
            status: download.status
        };

        if (download.status === 'in_progress') {
            structuredData.percent = download.percent;
            structuredData.bytesDownloaded = download.bytesDownloaded;
            structuredData.totalBytes = download.totalBytes;
            structuredData.speed = download.speed || 0;
            structuredData.eta = download.eta || null;
            structuredData.elapsedMs = Date.now() - download.startTime;
        } else if (download.status === 'error') {
            structuredData.error = download.error;
        }

        return ResponseBuilder.successWithStructuredData(structuredData, message);
    }

    /**
     * Internal method to handle database export (replaces this.internalExportDatabase)
     */
    static async internalExportDatabase(args) {
        // Validate parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment || !args.databaseName) {
            return ResponseBuilder.invalidParams('Missing required parameters for database export');
        }

        try {
            const { apiKey, apiSecret, projectId, environment, databaseName, retentionHours = 168 } = args;
            
            OutputLogger.info(`Starting database export for ${databaseName} in ${environment}`);

            // DXP-101: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
            let result;
            try {
                result = await DXPRestClient.startDatabaseExport(
                    projectId,
                    apiKey,
                    apiSecret,
                    environment,
                    databaseName,
                    retentionHours,
                    { apiUrl: args.apiUrl } // Support custom API URLs
                );
            } catch (error) {
                // Handle REST API errors
                OutputLogger.error(`❌ Export creation failed: ${error.message}`);

                const errorLower = error.message.toLowerCase();

                // Check if this is a concurrent export error
                if (errorLower.includes('on-going') ||
                    errorLower.includes('ongoing') ||
                    errorLower.includes('already running') ||
                    errorLower.includes('in progress') ||
                    errorLower.includes('another export') ||
                    errorLower.includes('concurrent') ||
                    errorLower.includes('export operation')) {

                    // Return with specific concurrent error flag
                    return {
                        success: false,
                        isError: true,
                        error: 'Another database export is already in progress',
                        content: [{
                            type: 'text',
                            text: `⚠️ **Another Database Export Already Running**\n\n` +
                                 `Only one database export can run at a time per environment.\n\n` +
                                 `**To check the current export:**\n` +
                                 `Use \`db_export_status\` with:\n` +
                                 `• exportId: "latest"\n` +
                                 `• environment: "${environment}"\n\n` +
                                 `**Once complete**, you can start a new export.\n\n` +
                                 `💡 **Tip**: Database exports typically take 5-15 minutes.`
                        }]
                    };
                }

                // Check if this is a database not found error
                if (errorLower.includes('database') &&
                    (errorLower.includes('not found') || errorLower.includes('does not exist') ||
                     errorLower.includes('invalid') || errorLower.includes('cannot find'))) {
                    return {
                        success: false,
                        isError: true,
                        error: 'Database not found',
                        content: [{
                            type: 'text',
                            text: `❌ Database not found\n\n` +
                                 `The specified database may not exist for this environment.\n\n` +
                                 `**Common causes:**\n` +
                                 `• Project only has epicms database (no epicommerce)\n` +
                                 `• Database name typo\n` +
                                 `• Database not provisioned for this environment\n\n` +
                                 `**Error details:** ${errorMsg}`
                        }]
                    };
                }

                return {
                    success: false,
                    error: errorMsg,
                    exportId: null
                };
            }

            // Format the result properly - handle object results
            let resultMessage = 'Database export initiated.\n';
            let extractedExportId = null;

            // DEBUG: Log the actual result to diagnose parsing issues
            console.error('[internalStartDatabaseExport] PowerShell result type:', typeof result);
            console.error('[internalStartDatabaseExport] Result keys:', result ? Object.keys(result) : 'null');
            console.error('[internalStartDatabaseExport] Full result:', JSON.stringify(result, null, 2));

            // CRITICAL: When parseJson:true is used, the parsed object is in result.parsedData
            // The PowerShell command: Start-EpiDatabaseExport | ConvertTo-Json
            // Returns an object with properties like: id, status, databaseName, etc.
            if (result.parsedData && typeof result.parsedData === 'object') {
                console.error('[internalStartDatabaseExport] Found parsedData:', JSON.stringify(result.parsedData, null, 2));

                // Extract export ID from the parsed data object
                // Try common property names: id, exportId, Id, ExportId
                extractedExportId = result.parsedData.id ||
                                   result.parsedData.exportId ||
                                   result.parsedData.Id ||
                                   result.parsedData.ExportId;

                if (extractedExportId) {
                    resultMessage = `Export ID: ${extractedExportId}\n`;
                    if (result.parsedData.status) resultMessage += `Status: ${result.parsedData.status}\n`;
                    if (result.parsedData.databaseName) resultMessage += `Database: ${result.parsedData.databaseName}\n`;
                }
            } else if (result.stdout) {
                // Fallback: try to extract from stdout if parsedData not available
                resultMessage += result.stdout;
                const idMatch = result.stdout.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                if (idMatch) {
                    extractedExportId = idMatch[1];
                }
            } else if (typeof result === 'string') {
                // Fallback: handle string results
                resultMessage += result;
                const idMatch = result.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                if (idMatch) {
                    extractedExportId = idMatch[1];
                }
            } else if (typeof result === 'object' && result !== null) {
                // Fallback: check root level properties (shouldn't happen with parseJson but just in case)
                if (result.id) {
                    extractedExportId = result.id;
                    resultMessage += `Export ID: ${result.id}\n`;
                }
                if (result.status) resultMessage += `Status: ${result.status}\n`;
                if (result.exportId) {
                    extractedExportId = result.exportId;
                    resultMessage += `Export ID: ${result.exportId}\n`;
                }
                if (result.message) resultMessage += result.message;
            }

            // Include the export ID in the message for easier extraction
            if (extractedExportId) {
                resultMessage = `Export ID: ${extractedExportId}\n` + resultMessage;
                return ResponseBuilder.success(resultMessage);
            } else {
                // No export ID means the export likely failed due to concurrent operation
                OutputLogger.warn(`⚠️ No export ID extracted from PowerShell response`);

                // Check if the response indicates a concurrent export
                const responseText = resultMessage.toLowerCase();
                if (responseText.includes('on-going') ||
                    responseText.includes('already') ||
                    responseText.includes('in progress') ||
                    responseText.includes('conflict')) {
                    return {
                        success: false,
                        isError: true,
                        error: 'There is an on-going database export operation',
                        content: [{
                            type: 'text',
                            text: resultMessage
                        }]
                    };
                }

                // Return as error if no export ID found
                return {
                    success: false,
                    isError: true,
                    error: 'Export creation failed - no export ID returned',
                    content: [{
                        type: 'text',
                        text: resultMessage
                    }]
                };
            }
        } catch (error) {
            OutputLogger.error(`Database export error: ${error.message}`);

            // Check if this is a concurrent operation error
            if (error.message && (
                error.message.includes('on-going') ||
                error.message.includes('already running') ||
                error.message.includes('Another operation') ||
                error.message.includes('Operation Already In Progress')
            )) {
                // Return error in a format that handleExportDatabase can detect
                return {
                    isError: true,
                    content: [{
                        type: 'text',
                        text: 'Another operation is currently running. Only one database export can run at a time per project.'
                    }]
                };
            }

            return ResponseBuilder.internalError('Database export failed', error.message);
        }
    }
    
    /**
     * Internal method to check database export status (replaces this.internalCheckExportStatus)
     */
    static async internalCheckExportStatus(args) {
        // Validate parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.exportId) {
            return { isSuccess: false, error: 'Missing required parameters for export status check' };
        }

        try {
            const { apiKey, apiSecret, projectId, exportId, environment, databaseName } = args;

            // DXP-101: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
            const result = await DXPRestClient.getDatabaseExportStatus(
                projectId,
                apiKey,
                apiSecret,
                environment || 'Production',  // Default to Production if not specified
                databaseName || 'epicms',     // Default to epicms if not specified
                exportId,
                { apiUrl: args.apiUrl } // Support custom API URLs
            );

            // Return internal format with isSuccess flag for monitoring code
            return { isSuccess: true, data: result };
        } catch (error) {
            OutputLogger.error(`Export status check error: ${error.message}`);
            return { isSuccess: false, error: error.message };
        }
    }
    
    /**
     * Unified database export with smart defaults and transparent monitoring
     * Primary export tool - supports all export scenarios with intelligent defaults
     * Uses transparent step-by-step monitoring (user sees each status check)
     */
    static async handleExportDatabase(args) {
        try {
            let {
                environment,
                project,
                database,           // DXP-81: Renamed from databaseName
                databaseName,       // Legacy: kept for backwards compatibility
                previewOnly,
                autoDownload,
                downloadPath,
                forceNew,
                useExisting,
                skipConfirmation,
                monitor = false, // Disable automatic monitoring - need to show export ID first
                background,         // DXP-81: Added for download control
                // Legacy db_export parameters for compatibility
                projectName,
                projectId,
                apiKey,
                apiSecret,
                retentionHours
            } = args;

            // DXP-81: Parameter mapping for renamed fields
            const dbName = database || databaseName || 'epicms';

            // SOFT WARNING: If we recently had a concurrent export error and parameters changed
            const lastError = global.__lastExportError || {};
            if (lastError.errorCode === 'CONCURRENT_EXPORT_IN_PROGRESS' &&
                lastError.timestamp && (Date.now() - lastError.timestamp < 30000)) { // Within 30 seconds

                // Check if parameters changed (indicating AI is trying workarounds)
                const paramsChanged = (forceNew && !lastError.forceNew) ||
                                    (skipConfirmation && !lastError.skipConfirmation);

                if (paramsChanged) {
                    OutputLogger.warn(`⚠️ Parameter change detected after concurrent export error - this won't help`);
                    // Don't block, just warn - the concurrent export will fail anyway
                }
            }

            // DEBUG: Log what we received - use info level so it shows in output
            const sessionId = process.env.MCP_SESSION_ID || 'no-session';
            if (forceNew || args.monitor) {
                OutputLogger.info(`🔍 [PARAM CHECK] forceNew=${forceNew}, monitor=${args.monitor}, autoDownload=${autoDownload}`);
            }


            // Check if this is a self-hosted project - they can only download existing backups
            if (args.isSelfHosted || args.connectionString) {
                return ResponseBuilder.invalidParams('Database export is not available for self-hosted projects. Self-hosted projects can only download existing database backups from Azure Storage.');
            }
            
            // Get project configuration - support legacy db_export parameters
            const projectConfig = await this.getProjectConfig(
                project || projectName,
                {
                    ...args,
                    projectId: projectId || args.projectId,
                    apiKey: apiKey || args.apiKey,
                    apiSecret: apiSecret || args.apiSecret
                }
            );

            // Check permissions first to determine available environments
            const PermissionChecker = require('./permission-checker');
            const permissions = await PermissionChecker.getOrCheckPermissionsSafe(projectConfig);
            
            // Smart environment selection
            let targetEnv;
            
            if (!environment) {
                // No environment specified - use smart defaults
                if (permissions.accessible.length === 0) {
                    return ResponseBuilder.error(
                        `❌ No accessible environments found. Please check your API key permissions.`
                    );
                } else if (permissions.accessible.length === 1) {
                    // Single environment configuration - use it automatically
                    targetEnv = permissions.accessible[0];
                    OutputLogger.debug(`Using your configured environment: ${targetEnv}`);
                } else {
                    // Multiple environments - prefer Production for backups
                    targetEnv = permissions.accessible.includes('Production') ? 'Production' : 
                               permissions.accessible.includes('Preproduction') ? 'Preproduction' : 
                               'Integration';
                    OutputLogger.debug(`No environment specified - defaulting to ${targetEnv} for backup`);
                }
            } else {
                // Environment was specified - parse and validate
                targetEnv = this.parseEnvironment(environment);
                
                // Check if user has access to the requested environment
                if (!permissions.accessible.includes(targetEnv)) {
                    let response = `ℹ️ **Access Level Check**\n\n`;
                    response += `You requested to export from **${targetEnv}** environment.\n\n`;
                    response += `**Your access level:** ${permissions.accessible.join(', ')} environment${permissions.accessible.length > 1 ? 's' : ''}\n\n`;
                    
                    if (permissions.accessible.length === 1) {
                        response += `💡 **Tip:** Since you only have access to ${permissions.accessible[0]}, \n`;
                        response += `run the command without specifying an environment to automatically use it:\n`;
                        response += `\`db_export\` (will use ${permissions.accessible[0]})\n`;
                    } else if (permissions.accessible.length > 1) {
                        response += `**Available Options:**\n`;
                        permissions.accessible.forEach(env => {
                            response += `• Export from ${env}: \`db_export environment: "${env}"\`\n`;
                        });
                    }
                    
                    return ResponseBuilder.success(response);
                }
            }

            // Ensure we have a valid project name for path resolution
            const projectNameForPaths = projectConfig.name || 'default-project';

            // Get download path for preview (don't create yet, just for display)
            const resolvedDownloadPath = await DownloadConfig.getDownloadPath(
                'database',
                projectNameForPaths,
                downloadPath,
                targetEnv
            );

            // Smart detection: If this is a real export (not preview) and we recently showed an existing backup,
            // the user likely chose to create a fresh export. Skip the check to avoid showing it twice.
            const isLikelyFreshExportChoice = !previewOnly && !forceNew && !args.monitor;

            // Check for existing local backups (unless explicitly skipping)
            // Skip this check if forceNew is true OR if monitor or autoDownload are set (user has made their choice)
            // IMPORTANT: forceNew=true means user explicitly wants a fresh backup, so skip the check entirely
            if (forceNew) {
                OutputLogger.info(`✅ Skipping existing backup check - forceNew=true, creating fresh export`);
            } else if (isLikelyFreshExportChoice) {
                OutputLogger.info(`📦 Proceeding with fresh export (detected user choice from preview)`);
            }
            if (!skipConfirmation && !forceNew && !previewOnly && !args.monitor && !autoDownload && !isLikelyFreshExportChoice) {
                const existingBackup = await this.checkForExistingBackups(resolvedDownloadPath, projectConfig.name, targetEnv, dbName);
                if (existingBackup) {
                    // Found an existing backup - present it with all options
                    let message = `📂 **Existing Database Backup Found Locally**\n\n`;

                    // Show backup details clearly
                    message += `📁 **You already have this backup on your local machine:**\n`;
                    message += `• File: ${existingBackup.filename}\n`;
                    message += `• Size: ${existingBackup.size}\n`;
                    message += `• Age: ${existingBackup.ageDisplay}`;

                    if (existingBackup.isRecent) {
                        message += ` ✅\n`;
                        message += `• Location: \`${existingBackup.filepath}\`\n\n`;
                        message += `✅ **This backup is recent and ready to use immediately.**\n`;
                        message += `No download needed - the file is already on your machine.\n\n`;
                    } else {
                        message += ` ⚠️\n`;
                        message += `• Location: \`${existingBackup.filepath}\`\n\n`;
                        message += `⚠️ **This backup is ${existingBackup.ageDisplay} old and may be outdated.**\n`;
                        message += `The file is already on your machine, but you may want a fresher backup.\n\n`;
                    }

                    message += `---\n\n`;

                    if (existingBackup.isRecent) {
                        message += `**Options:**\n`;
                        message += `1. **Use the existing local backup** (no action needed - file at path above)\n`;
                        message += `2. **Create a fresh backup** if you need the very latest data\n\n`;
                    } else {
                        message += `**Options:**\n`;
                        message += `1. **Use the existing local backup** despite its age (file at path above)\n`;
                        message += `2. **Create a fresh backup** for more recent data (recommended)\n\n`;
                    }

                    message += `**To create a fresh backup:**\n`;
                    message += `Run \`db_export forceNew: true\`\n`;
                    message += `• Monitoring happens automatically (no need for monitor: true)\n`;
                    message += `• You confirm before downloading\n`;
                    message += `• Do NOT add autoDownload: true (bypasses confirmation)\n\n`;
                    message += `⚠️ **AI ASSISTANT:** User must choose between using existing or creating new.\n`;
                    message += `Do not automatically proceed with forceNew: true unless user explicitly chooses option 2.\n\n`;
                    message += `---\n\n`;
                    message += `**🛑 DECISION REQUIRED: This is a stopping point. Wait for user to choose option 1 or 2.**`;

                    return ResponseBuilder.success(message);
                }
            }

            // Get monitoring preference - respect user's explicit setting
            // Default to true if not specified, but allow user to disable with monitor: false
            const shouldMonitor = args.monitor !== false; // true unless explicitly set to false

            if (!previewOnly && shouldMonitor) {
                OutputLogger.info('📊 Monitoring enabled for this export');
            } else if (!previewOnly && !shouldMonitor) {
                OutputLogger.info('📊 Monitoring disabled (monitor: false set by user)');
            }

            // Respect the autoDownload parameter if provided
            let autoDownloadActual = autoDownload === true;
            if (autoDownloadActual) {
                OutputLogger.info('📥 Auto-download enabled - will download when export completes');
            } else {
                OutputLogger.info('🔄 Standard export - will show file size and download URL when complete (no auto-download)');
            }

            // If not preview mode, we're creating an export
            if (!previewOnly) {
                OutputLogger.info('📦 Starting database export');
                // NOTE: Cannot proactively check for running exports because Get-EpiDatabaseExport requires an export ID
                // We'll have to rely on catching the error when trying to start a new export
            }
            
            // Preview mode - check for existing LOCAL backups only (DXP-81)
            if (previewOnly) {
                OutputLogger.debug(`[DEBUG] Preview mode: Checking for existing LOCAL backups only...`);

                // Check for existing local downloaded backups (NOT in-progress exports)
                const existingBackup = await this.checkForExistingBackups(resolvedDownloadPath, projectConfig.name, targetEnv, dbName);

                // If no existing backup, show ready to export message
                if (!existingBackup) {
                    OutputLogger.info(`📦 No existing backups found.`);

                    // DXP-81: Get capability check information (using CapabilityDetector from top-level require)
                    const capabilityReport = await CapabilityDetector.generateCapabilityReport(resolvedDownloadPath);

                    // Return a simple message that we're ready to export
                    let preview = `📦 **Ready to Export Database**\n\n`;
                    preview += `**Project**: ${projectConfig.name}\n`;
                    preview += `**Environment**: ${targetEnv}\n`;
                    preview += `**Database**: ${dbName}\n`;
                    preview += `**Retention**: ${retentionHours || 168} hours\n`;
                    preview += `**Monitoring**: ${shouldMonitor ? 'Automatic (every 30s)' : 'Manual (use db_export_status)'}\n`;
                    preview += `**Auto-download**: ${autoDownloadActual ? 'YES - will download automatically' : 'NO - manual download required'}\n`;
                    preview += `\n`;

                    // DXP-81: Add capability information
                    preview += `📁 **Download Capabilities**\n`;
                    preview += `• Path: \`${resolvedDownloadPath}\`\n`;
                    preview += `• ${capabilityReport.report}\n\n`;

                    preview += `The export typically takes 5-15 minutes.\n\n`;
                    if (shouldMonitor) {
                        if (autoDownloadActual) {
                            preview += `**AI: Monitor progress automatically. When complete, the file will be downloaded automatically. Show user the file size and local path.**\n`;
                        } else {
                            preview += `**AI: Monitor progress automatically. When complete, you will receive the file size and download URL. Show these to the user and offer to download using db_export_download tool.**\n`;
                        }
                    } else {
                        preview += `**AI: After creating export, provide the export ID. User will manually check status later using db_export_status tool.**\n`;
                    }
                    preview += `\n`;
                    preview += `Would you like me to proceed with creating the database export?`;

                    return ResponseBuilder.success(preview);
                } else {

                // Try to get size estimation from recent exports
                let sizeEstimation = '';
                try {
                    OutputLogger.debug('📊 Checking for recent database exports to estimate size...');

                    // Add timeout to prevent hanging
                    const timeoutPromise = new Promise((resolve) => {
                        setTimeout(() => resolve([]), 5000); // 5 second timeout
                    });

                    // Query PaaS portal for existing exports to get size info
                    const queryPromise = this.queryPaaSExports(projectConfig, targetEnv);
                    const recentExports = await Promise.race([queryPromise, timeoutPromise]) || [];

                    if (recentExports.length === 0) {
                        OutputLogger.debug('No recent exports found (query may have timed out)');
                    } else {
                        OutputLogger.debug(`Found ${recentExports.length} export(s) on PaaS portal`);
                    }
                    const matchingExports = recentExports.filter(exp =>
                        exp.environment === targetEnv &&
                        exp.databaseName === dbName &&
                        exp.completedAt // Only completed exports
                    );

                    if (matchingExports.length > 0) {
                        // Get the most recent completed export
                        const mostRecent = matchingExports[0];
                        const timeAgo = this.getTimeAgo(mostRecent.completedAt);

                        // If we have downloadUrl, try to get the size
                        if (mostRecent.downloadUrl) {
                            try {
                                const fileSize = await this.getRemoteFileSize(mostRecent.downloadUrl);
                                if (fileSize) {
                                    const sizeInGB = fileSize / (1024 * 1024 * 1024);
                                    sizeEstimation = `\n**📊 Size Estimation**: ~${sizeInGB > 1 ? `${sizeInGB.toFixed(2)} GB` : `${(fileSize / (1024 * 1024)).toFixed(2)} MB`} (based on backup from ${timeAgo})`;
                                }
                            } catch (error) {
                                // If remote size check fails, just note we have recent backup info
                                sizeEstimation = `\n**📊 Size Estimation**: Similar to recent backup from ${timeAgo}`;
                            }
                        } else {
                            sizeEstimation = `\n**📊 Size Estimation**: Similar to recent backup from ${timeAgo}`;
                        }
                    } else {
                        // No recent backups - don't show size estimation
                        sizeEstimation = '';
                    }
                } catch (error) {
                    // Error getting backup info - don't show size estimation
                    sizeEstimation = '';
                }

                // Build preview message with existing backup info if available
                let preview = `📦 **Database Export Options**\n\n`;
                preview += `**Project**: ${projectConfig.name}\n`;
                preview += `**Environment**: ${targetEnv}\n`;
                preview += `**Database**: ${dbName}${sizeEstimation}\n\n`;

                // If we found an existing backup, show it as the first option
                if (existingBackup) {
                    preview += `🎯 **Existing Backup Found!**\n`;
                    preview += `• **File:** ${existingBackup.filename}\n`;
                    preview += `• **Size:** ${existingBackup.size}\n`;
                    preview += `• **Age:** ${existingBackup.ageDisplay}`;
                    if (existingBackup.isRecent) {
                        preview += ` ✅ (recent)\n\n`;
                        preview += `**Option 1️⃣ Use Existing Backup** (fastest)\n`;
                        preview += `This backup is recent enough for most purposes.\n`;
                        preview += `Location: \`${existingBackup.filepath}\`\n\n`;
                    } else {
                        preview += ` ⚠️ (might be outdated)\n\n`;
                    }
                    preview += `---\n\n`;
                    preview += `**Option 2️⃣ Create a new export**\n`;
                } else {
                    preview += `**Option 1️⃣ Create a new export**\n`;
                }

                preview += `\`db_export\`\n`;
                preview += `• Creates a fresh backup\n`;
                preview += `• Retention: ${retentionHours || 168} hours (how long export remains available for download)\n`;
                preview += `• Monitoring: ${shouldMonitor ? 'Automatic (every 30s)' : 'Manual (use db_export_status)'}\n`;
                preview += `• Auto-download: ${autoDownloadActual ? 'YES' : 'NO'}\n`;
                preview += `• Typical time: 5-15 minutes\n\n`;

                preview += `📂 **Files saved to:** \`${await DownloadConfig.getDownloadPath('database', projectNameForPaths, downloadPath, targetEnv)}\`\n`;

                if (!existingBackup) {
                    preview += `⏱️ **Estimated time:** 5-15 minutes\n`;
                    preview += `💡 **Note:** Checking for local backups...`;
                } else {
                    preview += `⏱️ **New export time:** 5-15 minutes\n`;
                    preview += `💡 **Note:** Retention time only applies to NEW exports, not existing local backups`;
                }

                preview += `\n\n**What would you like to do?**\n\n`;
                if (existingBackup) {
                    preview += `• Type "1" to use the existing backup (already downloaded)\n`;
                    preview += `• Type "2" to create a fresh export`;
                } else {
                    preview += `• Proceed with creating the export`;
                }

                    return ResponseBuilder.success(preview);
                }
            }
            
            // Show what's about to happen (unless skipConfirmation is true)
            if (!skipConfirmation) {
                OutputLogger.debug(`\n📊 **Starting Database Export**`);
                OutputLogger.debug(`   • **Project:** ${projectConfig.name}`);
                OutputLogger.debug(`   • **Environment:** ${targetEnv}`);
                OutputLogger.debug(`   • **Database:** ${dbName}`);
                OutputLogger.debug(`   • **Download to:** ${resolvedDownloadPath}`);
                OutputLogger.debug(`   • **Auto-download:** ${autoDownloadActual ? 'Yes' : 'No (will ask for confirmation)'}`);
                OutputLogger.debug(`   • **Monitoring:** Will track progress automatically\n`);
            }
            
            // Starting database backup silently to avoid JSON parsing issues
            
            // Execute backup with the traditional tool
            let result = await this.internalExportDatabase({
                projectId: projectConfig.projectId,
                projectName: projectConfig.name,
                environment: targetEnv,
                databaseName: dbName,
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret,
                retentionHours: retentionHours || undefined // Use PowerShell default if not specified
            });

            // Log the result structure to diagnose monitoring issues
            if (result && result.content) {
                OutputLogger.info(`📝 Export response received - checking for export ID...`);
            }

            // DEBUG: Log error details to diagnose concurrent export detection
            if (result.isError && result.content && result.content[0] && result.content[0].text) {
                OutputLogger.info(`🔍 Export error detected: ${result.content[0].text.substring(0, 200)}`);
            }

            // First, try to extract export ID to see if it actually succeeded
            let exportId = null;
            try {
                exportId = this.extractExportId(result);
                if (!exportId && result.content && result.content[0] && result.content[0].text) {
                    // Fallback: Try to extract any UUID from the response
                    const uuidMatch = result.content[0].text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                    if (uuidMatch) {
                        exportId = uuidMatch[1];
                        OutputLogger.info(`✅ Export ID found: ${exportId}`);
                    }
                }
            } catch (e) {
                // Ignore extraction errors
            }

            // If we got an export ID, the export started successfully!
            if (exportId) {
                OutputLogger.info(`✅ Export started successfully with ID: ${exportId}`);
                // Store for status checking later
                if (!global.__latestDatabaseExport) {
                    global.__latestDatabaseExport = {};
                }
                global.__latestDatabaseExport[targetEnv] = {
                    exportId: exportId,
                    timestamp: Date.now(),
                    databaseName: dbName
                };
                // Continue with normal success flow below
            }
            // Only show concurrent export error if we have an error AND no export ID
            else if (result.isError || !result.success) {
                const errorText = result.content?.[0]?.text || result.error || '';
                OutputLogger.info('⚠️ Export creation failed');
                OutputLogger.info(`Error details: ${errorText.substring(0, 200)}`);

                // Check if this is actually a concurrent export error
                const isConcurrentError = errorText.toLowerCase().includes('already running') ||
                                         errorText.toLowerCase().includes('in progress') ||
                                         errorText.toLowerCase().includes('concurrent') ||
                                         errorText.toLowerCase().includes('another export');

                if (isConcurrentError) {
                    // Only show aggressive message for actual concurrent exports
                    let conflictMessage = `⚠️ **Another Export Already Running**\n\n`;
                    conflictMessage += `Only one database export can run at a time per project.\n\n`;
                    conflictMessage += `**What to do:**\n`;
                    conflictMessage += `• Wait 3-5 minutes for the current export to complete\n`;
                    conflictMessage += `• Then try the same command again\n\n`;
                    conflictMessage += `**Note:** This is normal behavior when exports overlap.`;

                    // Store error globally to detect parameter changes on retry
                    global.__lastExportError = {
                        errorCode: 'CONCURRENT_EXPORT_IN_PROGRESS',
                        timestamp: Date.now(),
                        forceNew: forceNew || false,
                        skipConfirmation: skipConfirmation || false
                    };

                    return {
                        success: false,
                        isError: true,
                        errorCode: 'CONCURRENT_EXPORT_IN_PROGRESS',
                        content: [{
                            type: 'text',
                            text: conflictMessage
                        }]
                    };
                } else {
                    // For other errors, show the actual error message
                    let errorMessage = `❌ **Export Creation Failed**\n\n`;
                    errorMessage += `**Error:** ${errorText}\n\n`;
                    errorMessage += `**Possible causes:**\n`;
                    errorMessage += `• Invalid project configuration\n`;
                    errorMessage += `• Authentication issues\n`;
                    errorMessage += `• Network connectivity problems\n`;
                    errorMessage += `• Invalid environment or database name\n\n`;
                    errorMessage += `**Try:**\n`;
                    errorMessage += `• Check project configuration with \`test_connection\`\n`;
                    errorMessage += `• Verify the environment and database names are correct\n`;
                    errorMessage += `• Check if you have permissions for this operation`;

                    return {
                        success: false,
                        isError: true,
                        content: [{
                            type: 'text',
                            text: errorMessage
                        }]
                    };
                }
            }

            // If we reach here with an exportId, the export started successfully
            if (exportId) {
                // Don't duplicate the log message - already logged above at line 622

                // IMPORTANT: Keep the result for message extraction but mark as success
                // We'll override with success response at the end
                
                await this.storeBackupInfo(projectConfig.name, {
                    exportId: exportId,
                    environment: targetEnv,
                    databaseName: dbName,
                    startTime: new Date().toISOString()
                });
                
                // ALWAYS start background monitoring by default (as requested)
                // This ensures monitoring happens regardless of autoDownload setting
                // Use the same project name variable we defined earlier
                const projectNameForPath = projectNameForPaths;

                const validated = await DownloadConfig.getValidatedDownloadPath(
                    'database',
                    projectNameForPath,
                    downloadPath,
                    targetEnv
                );

                let downloadDir = validated.path;

                if (!validated.valid) {
                    // Don't throw - just log the issue and use a fallback path
                    OutputLogger.warn(`⚠️ Download path issue: ${validated.error}`);

                    // Use a safe fallback path
                    const os = require('os');
                    const path = require('path');
                    downloadDir = path.join(os.homedir(), 'Downloads', 'optimizely-exports', projectNameForPath, targetEnv);
                    OutputLogger.info(`📁 Using fallback download location: ${downloadDir}`);
                }

                // Check download capabilities for appropriate messaging
                const capabilityCheck = await CapabilityDetector.checkAutoDownloadCapability(downloadDir, 100 * 1024 * 1024);

                // Store export state for polling-based monitoring (MCP servers don't support true background processes)
                OutputLogger.success(`🚀 Export monitoring configured - use 'check export status' to monitor progress`);
                OutputLogger.debug(`💡 Auto-download will trigger when you check status and export is complete`);

                // Store persistent state
                await this.saveCurrentExportState({
                    exportId,
                    projectConfig: projectConfig.name,
                    projectId: projectConfig.projectId,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    environment: targetEnv,
                    databaseName: dbName,
                    downloadPath: downloadDir,
                    autoDownload: false, // Always false - size preview required
                    monitoring: shouldMonitor, // Store monitoring intent from user preference
                    startTime: new Date().toISOString()
                });

                if (shouldMonitor) {
                    if (autoDownloadActual) {
                        OutputLogger.success(`✅ Export created with auto-download + monitoring enabled!`);
                    } else {
                        OutputLogger.success(`✅ Export created with monitoring enabled!`);
                    }

                    // DISABLED: Background monitoring blocks UI (freezes Claude Desktop)
                    // TODO: Implement proper stateless monitoring in DXP-60
                    // OutputLogger.info(`🔄 Starting background monitoring...`);
                    // this.startBackgroundMonitoring(exportId, projectConfig, targetEnv, dbName, downloadDir);

                    OutputLogger.success(`✅ Export created successfully!`);
                    OutputLogger.info(`📊 To monitor: db_export_status exportId: "${exportId}" environment: "${targetEnv}"`);

                    if (autoDownloadActual) {
                        OutputLogger.info(`💾 To download when ready: db_export_download exportId: "${exportId}" environment: "${targetEnv}"`);
                    }
                }

                // Generate appropriate monitoring message based on capabilities
                const intervalDisplay = 'every 30 seconds'; // Fixed interval - simple and safe
                let monitoringMessage = '';
                if (shouldMonitor) {
                        if (autoDownloadActual) {
                            monitoringMessage = `\n\n📊 **Monitoring Mode**: AI will check status ${intervalDisplay}\n✅ **Auto-Download**: Enabled when complete\n⏰ **Next Check**: In 30 seconds`;
                        } else {
                            monitoringMessage = `\n\n📊 **Monitoring Mode**: AI will check status ${intervalDisplay}\n📋 **When Complete**: Will show file size and download URL (no auto-download)\n⏰ **Next Check**: In 30 seconds`;
                        }
                    } else {
                        monitoringMessage = `\n\n🔄 **Manual Monitoring**: Use \`db_export_status\` to monitor progress\n📊 **Status Checking**: Manual - run status command periodically`;
                    }
                    
                    if (capabilityCheck.canAutoDownload) {
                        monitoringMessage += `\n✅ **Auto-Download**: Will trigger when you check status and export is complete`;
                    } else {
                        monitoringMessage += `\n🔗 **Download URL**: Will be provided when export completes`;
                        if (capabilityCheck.capabilities.client && capabilityCheck.capabilities.client.isClaudeDesktop) {
                            monitoringMessage += `\n💡 **Tip**: Use Claude Code CLI for auto-download: \`claude "export prod db"\``;
                        }
                        if (capabilityCheck.issues.length > 0) {
                            monitoringMessage += `\n⚠️ **Note**: ${capabilityCheck.issues[0]}`;
                        }
                    }
                    
                    // Extract the original message from the result and enhance it
                    let originalMessage = '';
                    if (result && result.result && result.result.content && result.result.content[0] && result.result.content[0].text) {
                        originalMessage = result.result.content[0].text;
                    } else if (result && result.content && result.content[0] && result.content[0].text) {
                        originalMessage = result.content[0].text;
                    } else if (typeof result === 'string') {
                        originalMessage = result;
                    } else if (result && result.message) {
                        originalMessage = result.message;
                    } else if (result && typeof result === 'object' && result !== null) {
                        // DXP-53 Fix: Handle raw object result from internalExportDatabase
                        // Try to extract meaningful data from the export result object
                        originalMessage = 'Database export initiated.\n';
                        if (result.id) originalMessage += `Export ID: ${result.id}\n`;
                        if (result.projectId) originalMessage += `Project: ${result.projectId}\n`;
                        if (result.environment) originalMessage += `Environment: ${result.environment}\n`;
                        if (result.status) originalMessage += `Status: ${result.status}\n`;
                        // If result has data property with the actual export info
                        if (result.data) {
                            originalMessage = 'Database export initiated.\n' + JSON.stringify(result.data, null, 2);
                        }
                    } else {
                        originalMessage = 'Database export started successfully';
                    }
                    
                    // Get download path for user information
                    const finalDownloadPath = await DownloadConfig.getDownloadPath('database', projectNameForPaths || projectConfig.name || 'default-project', downloadPath, targetEnv);

                    // Build smart response with monitoring and download options
                    let enhancedMessage = `✅ **Database Export Started**\n\n`;

                    // Add export details if available
                    // Check if we can extract additional export ID from result object (fallback)
                    if (!exportId && (result.id || (result.data && result.data.id))) {
                        exportId = result.id || result.data.id;
                    }
                    if (exportId) {
                        enhancedMessage += `**Export ID saved:** ${exportId}\n`;
                        if (shouldMonitor) {
                            enhancedMessage += `**Status checking:** Will be monitored automatically\n`;
                        } else {
                            enhancedMessage += `**Status checking:** Manual (monitoring disabled)\n`;
                        }
                    }
                    enhancedMessage += `**Environment:** ${targetEnv}\n`;
                    enhancedMessage += `**Database:** ${dbName}\n\n`;

                    // Monitoring status - only show monitoring plan if enabled
                    if (shouldMonitor) {
                        if (monitoringMessage.includes('Monitoring Mode')) {
                            enhancedMessage += `✅ **Monitoring Plan**: Will check status ${intervalDisplay}\n`;
                            enhancedMessage += `👁️ **Visible Updates**: Each status check will be shown\n`;

                            if (autoDownloadActual) {
                                enhancedMessage += `📥 **Auto-Download Enabled**: Will download when complete\n`;
                                enhancedMessage += `📂 **Save Location**: \`${finalDownloadPath}\`\n\n`;
                                enhancedMessage += `**Smart Download Features:**\n`;
                                enhancedMessage += `• ✅ Incremental check - won't re-download if file exists\n`;
                                enhancedMessage += `• 📊 Size and time estimate before download\n`;
                                enhancedMessage += `• 🔄 Automatic retry on failure\n\n`;
                            } else {
                                enhancedMessage += `📊 **When Complete**: Will display file size and download URL (no auto-download)\n\n`;
                                enhancedMessage += `**What Happens Next:**\n`;
                                enhancedMessage += `• Export file size will be shown\n`;
                                enhancedMessage += `• Download URL will be provided\n`;
                                enhancedMessage += `• You can then download using db_export_download tool\n`;
                                enhancedMessage += `• File will be saved to: \`${finalDownloadPath}\`\n\n`;
                            }
                        }
                    } else {
                        // Monitoring disabled - don't suggest checking
                        enhancedMessage += `📊 **Monitoring**: Disabled\n`;
                        enhancedMessage += `⏸️ **Status checking**: User will request manually\n\n`;
                    }

                    enhancedMessage += `⏱️ **Estimated Time**: 5-15 minutes (varies by database size)\n\n`;

                    // Automatic server-side monitoring if enabled and exportId available
                    OutputLogger.info(`🔍 Monitoring decision: exportId=${exportId}, monitor=${monitor}`);

                    if (exportId && monitor) {
                        OutputLogger.info(`🚀 Auto-monitoring enabled for export ${exportId}`);

                        // Return immediately with export ID and monitoring instructions
                        enhancedMessage += `\n\n✅ **EXPORT CREATED SUCCESSFULLY**\n`;
                        enhancedMessage += `🆔 **Export ID:** \`${exportId}\`\n`;
                        enhancedMessage += `📍 **Environment:** ${targetEnv}\n`;
                        enhancedMessage += `💾 **Database:** ${dbName}\n\n`;

                        enhancedMessage += `🔄 **MONITORING MODE ACTIVE**\n`;
                        enhancedMessage += `Export created! Takes 5-15 minutes.\n\n`;

                        enhancedMessage += `**🤖 NEXT ACTION: Call db_export_status with waitBeforeCheck**\n\n`;
                        enhancedMessage += `Parameters:\n`;
                        enhancedMessage += `- exportId: "${exportId}"\n`;
                        enhancedMessage += `- environment: "${targetEnv}"\n`;
                        enhancedMessage += `- waitBeforeCheck: 30 (waits 30s, then checks)\n`;
                        enhancedMessage += `- monitor: true\n`;
                        if (autoDownload) {
                            enhancedMessage += `- autoDownload: true\n\n`;
                            enhancedMessage += `Keep calling db_export_status (with waitBeforeCheck: 30) until complete, then download happens automatically.`;
                        } else {
                            enhancedMessage += `- autoDownload: false\n\n`;
                            enhancedMessage += `Keep calling db_export_status (with waitBeforeCheck: 30) until complete, then use db_export_download.`;
                        }

                        result = ResponseBuilder.successWithStructuredData({
                            exportId: exportId,
                            environment: targetEnv,
                            databaseName: dbName,
                            status: 'InProgress',
                            downloadUrl: null
                        }, enhancedMessage);
                    } else if (exportId) {
                        // Show monitoring instructions only if monitoring is enabled
                        if (shouldMonitor) {
                            // Transparent monitoring instructions for AI
                            enhancedMessage += `\n\n📊 **MONITORING INSTRUCTIONS FOR AI**\n\n`;
                            enhancedMessage += `Export created successfully!\n`;
                            enhancedMessage += `Export ID: ${exportId}\n`;
                            enhancedMessage += `Environment: ${targetEnv}\n\n`;
                            // Fixed 2-minute interval (safe for synchronous wait, under 3-min timeout cap)
                            const monitorInterval = 120; // 2 minutes - hardcoded for simplicity and safety
                            enhancedMessage += `**To check status, use db_export_status with:**\n`;
                            enhancedMessage += `• exportId: "${exportId}"\n`;
                            enhancedMessage += `• environment: "${targetEnv}"\n`;
                            enhancedMessage += `• waitBeforeCheck: ${monitorInterval} (waits ${Math.floor(monitorInterval/60)} minute${monitorInterval >= 120 ? 's' : ''} then checks)\n`;
                            enhancedMessage += `• monitor: true (enables monitoring prompts)\n`;
                            enhancedMessage += `• autoDownload: ${autoDownloadActual} ${autoDownloadActual ? '(will auto-download when complete)' : '(will show file size and download URL when complete)'}\n`;
                            enhancedMessage += `\n`;
                            enhancedMessage += `**RECOMMENDED MONITORING PATTERN:**\n`;
                            enhancedMessage += `1. Call db_export_status with:\n`;
                            enhancedMessage += `   - exportId="${exportId}"\n`;
                            enhancedMessage += `   - environment="${targetEnv}"\n`;
                            enhancedMessage += `   - waitBeforeCheck=${monitorInterval}\n`;
                            enhancedMessage += `   - monitor=true\n`;
                            enhancedMessage += `   - autoDownload=${autoDownloadActual}\n`;
                            enhancedMessage += `2. If still in progress, repeat with same interval\n`;
                            if (autoDownloadActual) {
                                enhancedMessage += `3. When complete, download will happen automatically\n\n`;
                            } else {
                                enhancedMessage += `3. When complete, use db_export_download\n\n`;
                            }
                            enhancedMessage += `**Note:** Tool will wait ${monitorInterval} seconds then check automatically.\n`;
                            enhancedMessage += `Export typically takes 5-15 minutes total.`;
                        } else {
                            // Monitoring disabled - just show export ID for manual checking
                            enhancedMessage += `\n\n✅ **Export Created Successfully**\n\n`;
                            enhancedMessage += `**Export ID:** ${exportId}\n`;
                            enhancedMessage += `**Environment:** ${targetEnv}\n`;
                            enhancedMessage += `**Database:** ${dbName}\n\n`;
                            enhancedMessage += `🔄 **Monitoring:** Disabled (monitor: false)\n\n`;
                            enhancedMessage += `**IMPORTANT - AI INSTRUCTION:**\n`;
                            enhancedMessage += `**DO NOT automatically check status** - monitoring is disabled.\n`;
                            enhancedMessage += `User will manually request status checks.\n\n`;
                            enhancedMessage += `**If user requests status check manually:**\n`;
                            enhancedMessage += `Use \`db_export_status\` with exportId: "${exportId}", environment: "${targetEnv}", and monitor: false\n\n`;
                            enhancedMessage += `**To download when ready:**\n`;
                            enhancedMessage += `Use \`db_export_download\` with exportId: "${exportId}" and environment: "${targetEnv}"`;
                        }

                        // DXP-66: Add structured data
                        result = ResponseBuilder.successWithStructuredData({
                            exportId: exportId,
                            environment: targetEnv,
                            databaseName: dbName,
                            status: 'InProgress',
                            monitoringEnabled: shouldMonitor,
                            downloadUrl: null
                        }, enhancedMessage);
                    } else {
                        enhancedMessage += `⚠️ **Note**: Export ID not captured - manual monitoring required\n`;
                        enhancedMessage += `Use: Run db_export_status with exportId: "latest"\n`;
                        enhancedMessage += `Or find exports with: \`list_backups\``;
                        // DXP-66: Add structured data (export without ID)
                        result = ResponseBuilder.successWithStructuredData({
                            exportId: null,
                            environment: targetEnv,
                            databaseName: dbName,
                            status: 'Unknown',
                            downloadUrl: null
                        }, enhancedMessage);
                    }
                }

            return result;

        } catch (error) {
            return ErrorHandler.handleError(error, 'backup', args);
        }
    }
    
    /**
     * Automatic monitoring function that polls export status
     * Returns a complete status message with all updates
     */
    static async monitorExportAutomatically(exportId, projectConfig, environment, databaseName, downloadPath, initialMessage) {
        try {
            const maxAttempts = 15; // Max 30 minutes of monitoring (15 * 2 minutes)
            const checkInterval = 120000; // 2 minutes in milliseconds
            let attempts = 0;
            let allMessages = [initialMessage];

            OutputLogger.info(`🔄 Starting automatic monitoring for export ${exportId}`);

            while (attempts < maxAttempts) {
                attempts++;

            // Wait 2 minutes before checking (including first check - exports take time to initialize)
            if (attempts === 1) {
                OutputLogger.info(`⏳ Waiting 2 minutes for export to initialize before first status check...`);
            } else {
                OutputLogger.info(`⏳ Waiting 2 minutes before next status check... (Check ${attempts}/${maxAttempts})`);
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));

            try {
                OutputLogger.info(`📊 Checking export status (attempt ${attempts})...`);

                // Check the export status with timeout
                const statusPromise = this.internalCheckExportStatus({
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId,
                    exportId: exportId,
                    environment: environment,
                    databaseName: databaseName
                });

                // Add 30 second timeout for status check
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Status check timeout')), 30000)
                );

                const statusResult = await Promise.race([statusPromise, timeoutPromise]);

                let statusData;
                if (statusResult.content && statusResult.content[0]) {
                    // Parse the status response
                    const statusText = statusResult.content[0].text;
                    try {
                        statusData = JSON.parse(statusText);
                        OutputLogger.info(`📊 Status: ${statusData.status}`);
                    } catch (e) {
                        // If not JSON, extract status from text
                        statusData = { status: statusText };
                        OutputLogger.info(`📊 Status (text): ${statusText.substring(0, 100)}`);
                    }
                } else if (typeof statusResult === 'object') {
                    statusData = statusResult;
                    OutputLogger.info(`📊 Status (object): ${statusData.status || 'Unknown'}`);
                }

                // Generate status update message
                let updateMessage = `\n📊 **Status Update (Check ${attempts}):**\n`;

                if (statusData) {
                    if (statusData.status === 'Succeeded') {
                        updateMessage += `✅ **Export Complete!**\n`;
                        if (statusData.downloadLink) {
                            updateMessage += `📦 **Export Ready for Download**\n\n`;
                            updateMessage += `**File:** ${statusData.bacpacName || 'database.bacpac'}\n`;
                            updateMessage += `**Environment:** ${environment}\n`;
                            updateMessage += `**Database:** ${databaseName}\n`;
                            updateMessage += `\n📥 **DOWNLOAD OPTIONS:**\n\n`;
                            updateMessage += `The export has completed successfully. Would you like to:\n\n`;
                            updateMessage += `1. **Download the backup now**\n`;
                            updateMessage += `2. **Keep the download link** (valid for 7 days)\n\n`;
                            updateMessage += `**To download, use:**\n`;
                            updateMessage += `db_export_download with:\n`;
                            updateMessage += `  - exportId: "${exportId}"\n`;
                            updateMessage += `  - environment: "${environment}"\n\n`;
                            updateMessage += `**Note:** The backup will be saved to:\n`;
                            updateMessage += `${downloadPath}`;
                        }

                        allMessages.push(updateMessage);
                        // Return all messages combined
                        return ResponseBuilder.success(allMessages.join('\n'));

                    } else if (statusData.status === 'Failed') {
                        updateMessage += `❌ **Export Failed**\n`;
                        if (statusData.message) {
                            updateMessage += `Error: ${statusData.message}\n`;
                        }
                        allMessages.push(updateMessage);
                        return ResponseBuilder.error(allMessages.join('\n'));

                    } else if (statusData.status === 'InProgress' || statusData.status === 'NotStarted') {
                        updateMessage += `⏳ **Status:** ${statusData.status}\n`;
                        updateMessage += `• Export ID: ${exportId}\n`;
                        updateMessage += `• Environment: ${environment}\n`;
                        updateMessage += `• Database: ${databaseName}\n`;
                        updateMessage += `• Next check in 2 minutes...\n`;
                        allMessages.push(updateMessage);

                    } else {
                        updateMessage += `📋 **Current Status:** ${statusData.status || 'Unknown'}\n`;
                        allMessages.push(updateMessage);
                    }
                } else {
                    updateMessage += `⚠️ Unable to parse status response\n`;
                    allMessages.push(updateMessage);
                }

            } catch (error) {
                OutputLogger.error(`Status check error: ${error.message}`);
                let errorMessage = `\n⚠️ **Status Check Error (Attempt ${attempts}):**\n`;
                errorMessage += `Error: ${error.message}\n`;
                errorMessage += `Will continue monitoring...\n`;
                allMessages.push(errorMessage);
                // Continue monitoring despite errors
            }
        }

            // Timeout reached
            OutputLogger.info(`⏰ Monitoring timeout reached after ${maxAttempts} attempts`);
            allMessages.push(`\n⏰ **Monitoring Timeout**\nExport is taking longer than expected (>30 minutes).\nCheck status manually with: \`db_export_status exportId: "${exportId}"\``);
            return ResponseBuilder.success(allMessages.join('\n'));

        } catch (unexpectedError) {
            OutputLogger.error(`🚨 Unexpected monitoring error: ${unexpectedError.message}`);
            return ResponseBuilder.error(`Monitoring failed unexpectedly: ${unexpectedError.message}\n\nCheck status manually with: \`db_export_status exportId: "${exportId}"\``);
        }
    }

    /**
     * Unified export status checker with auto-download capability
     * Primary status tool - handles all export status checking scenarios
     * Supports automatic download monitoring and completion detection
     */
    static async handleExportStatus(args) {
        try {
            const {
                exportId,
                environment,
                waitBeforeCheck,
                autoDownload,
                monitor,
                project,
                latest,
                // Legacy db_export_status parameters for compatibility
                projectName,
                projectId,
                apiKey,
                apiSecret
            } = args;

            // Debug logging for autoDownload parameter
            OutputLogger.debug(`[handleExportStatus] autoDownload parameter: ${autoDownload} (type: ${typeof autoDownload})`);
            OutputLogger.debug(`[handleExportStatus] monitor parameter: ${monitor} (type: ${typeof monitor})`);

            // Smart wait: Cap at 3 minutes to avoid MCP client timeout (~4 min)
            // Always check status after waiting - never return early
            const MAX_SAFE_WAIT = 180; // 3 minutes - safely under MCP timeout
            if (waitBeforeCheck && waitBeforeCheck > 0) {
                // Cap the wait time at maximum safe value
                const actualWait = Math.min(waitBeforeCheck, MAX_SAFE_WAIT);

                if (waitBeforeCheck > MAX_SAFE_WAIT) {
                    // Warn user that we're capping the wait time
                    const requestedMinutes = Math.floor(waitBeforeCheck / 60);
                    OutputLogger.warn(`⚠️ Requested wait time (${requestedMinutes} min) exceeds safe limit. Capping at 3 minutes to avoid timeout.`);
                }

                // Proceed with synchronous wait
                const waitTime = actualWait * 1000; // Convert to ms
                const waitMinutes = Math.floor(actualWait / 60);
                const waitSeconds = actualWait % 60;

                OutputLogger.info(`⏱️ Waiting ${waitMinutes}m ${waitSeconds}s before checking status...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                OutputLogger.info(`✅ Wait complete, now checking status...`);
            }
            
            // Get project configuration - support legacy db_export_status parameters  
            const projectConfig = await this.getProjectConfig(
                project || projectName,
                {
                    ...args,
                    projectId: projectId || args.projectId,
                    apiKey: apiKey || args.apiKey,
                    apiSecret: apiSecret || args.apiSecret
                }
            );

            // Note: Auto-recovery removed with file persistence removal
            
            // Check for current export state first (for auto-download)
            const currentState = await this.loadCurrentExportState();
            let targetExportId = exportId;
            let backupEnvironment, backupDatabase, backupStartTime;
            let isCurrentExport = false;
            let shouldAutoDownload = false;
            let downloadPath = null;

            // Determine monitoring preference with proper precedence:
            // 1. Explicit monitor parameter (if provided) - highest priority
            // 2. Saved state from export creation (if available)
            // 3. Default to true
            let shouldMonitor = true; // Default
            if (monitor !== undefined) {
                // User explicitly set monitor parameter - use it
                shouldMonitor = monitor;
                OutputLogger.debug(`Using explicit monitor parameter: ${shouldMonitor}`);
            }

            // Priority 1: Use current export if it matches the project and no specific exportId requested
            if (!exportId && currentState.currentExport &&
                currentState.currentExport.projectConfig === projectConfig.name) {
                targetExportId = currentState.currentExport.exportId;
                backupEnvironment = currentState.currentExport.environment;
                backupDatabase = currentState.currentExport.databaseName;
                backupStartTime = currentState.currentExport.startTime;
                isCurrentExport = true;
                shouldAutoDownload = false; // Always false - size preview required
                downloadPath = currentState.currentExport.downloadPath;

                // Only use saved state monitoring preference if monitor param not explicitly provided
                if (monitor === undefined) {
                    shouldMonitor = currentState.currentExport.monitoring !== false;
                    OutputLogger.debug(`Using monitoring preference from saved state: ${shouldMonitor}`);
                }

                OutputLogger.debug(`Found active export for auto-download: ${targetExportId}`);
            }
            // Priority 2: Use specified exportId or latest backup
            else {
                if (!targetExportId || latest) {
                    // Try to get the latest tracked export
                    const latestExport = await this.getLatestTrackedExport(
                        projectConfig,
                        args.environment || 'Production',
                        args.databaseName || 'epicms'
                    );

                    if (latestExport) {
                        targetExportId = latestExport.id;
                        backupEnvironment = latestExport.environment;
                        backupDatabase = latestExport.databaseName;
                        // Extract start time from details if available
                        if (latestExport.details && latestExport.details.bacpacName) {
                            const match = latestExport.details.bacpacName.match(/(\d{14})/);
                            if (match) {
                                const timestamp = match[1];
                                backupStartTime = new Date(
                                    timestamp.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')
                                ).toISOString();
                            }
                        }
                    } else {
                        // Fallback to old method using getLatestBackup
                        const latestBackup = await this.getLatestBackup(projectConfig.name);
                        if (!latestBackup) {
                            // Return a helpful message instead of an error
                            const ResponseBuilder = require('../response-builder');
                            return ResponseBuilder.success(
                                `📊 **No Recent Exports Found**\n\n` +
                                `I couldn't find any exports from this session to check.\n\n` +
                                `**Options:**\n` +
                                `1. Create a new export: \`db_export\`\n` +
                                `2. Check a specific export ID: \`db_export_status exportId: "your-export-id"\`\n` +
                                `3. If you know an export is running, provide its ID directly\n\n` +
                                `💡 **Note**: The \`latest: true\` parameter only works for exports created in the current MCP session.\n` +
                                `Due to PaaS API limitations, we cannot discover exports from previous sessions.`
                            );
                        }
                        targetExportId = latestBackup.exportId;
                        backupEnvironment = latestBackup.environment;
                        backupDatabase = latestBackup.databaseName || 'epicms';
                        backupStartTime = latestBackup.startTime;
                    }
                } else {
                    // For specific exportId, try to find environment from backup history first
                    const backups = await this.getBackupHistory(projectConfig.name, 20);
                    const targetBackup = backups.find(b => b.exportId === targetExportId);
                    
                    if (targetBackup) {
                        // Found in backup history
                        backupEnvironment = targetBackup.environment;
                        backupDatabase = targetBackup.databaseName || 'epicms';
                        backupStartTime = targetBackup.startTime;
                    } else {
                        // Not in backup history - try to get info from recent exports state
                        const state = await this.loadCurrentExportState();
                        const recentExport = state.recentExports?.find(e => e.exportId === targetExportId);
                        
                        if (recentExport) {
                            // Found in recent exports state
                            backupEnvironment = recentExport.environment;
                            backupDatabase = recentExport.databaseName || 'epicms';
                            backupStartTime = recentExport.startTime;
                        } else {
                            // Last resort: default to Production (most common for database exports)
                            backupEnvironment = 'Production';
                            backupDatabase = 'epicms';
                            backupStartTime = null; // Unknown start time
                            OutputLogger.debug(`Export ${targetExportId} not found in history. Defaulting to environment: ${backupEnvironment}`);
                            OutputLogger.info(`💡 Tip: For better accuracy, specify environment when checking status`);
                        }
                    }
                }
            }
            
            // Critical validation: The environment MUST be preserved
            if (!backupEnvironment) {
                return ErrorHandler.handleError(
                    new Error(`Backup environment missing for export ${targetExportId}. Original environment not preserved.`),
                    'backup status',
                    { project: projectConfig.name, exportId: targetExportId }
                );
            }

            // Ensure downloadPath is set (may be null from non-current export paths)
            if (!downloadPath) {
                downloadPath = await DownloadConfig.getDownloadPath('database', projectConfig.name, null, backupEnvironment);
                OutputLogger.debug(`Resolved download path: ${downloadPath}`);
            }

            OutputLogger.debug(`Checking backup status: ${targetExportId} (${backupEnvironment})`);
            
            // Check status using traditional tool
            const result = await this.internalCheckExportStatus({
                projectId: projectConfig.projectId,
                projectName: projectConfig.name,
                exportId: targetExportId,
                environment: backupEnvironment,
                databaseName: backupDatabase,
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret
            });
            
            // Handle the response and optionally auto-download if complete
            if (result.isSuccess) {
                const status = this.parseExportStatus(result);

                if (status.isComplete) {
                    // Only auto-download if explicitly enabled
                    if (status.downloadUrl) {
                        // Clear the current export state since it's complete
                        await this.clearCurrentExportState();

                        // Calculate actual export time if we have API timestamps
                        let timeDisplay = '';
                        if (status.completedAt && status.startTime) {
                            const startMs = new Date(status.startTime).getTime();
                            const endMs = new Date(status.completedAt).getTime();
                            const durationMs = endMs - startMs;
                            const durationMin = Math.round(durationMs / 60000);
                            timeDisplay = `**Time**: ${durationMin}m (actual export time)\n`;
                        } else if (backupStartTime) {
                            timeDisplay = `**Time**: ${this.getElapsedTimeWithContext(backupStartTime, true)}\n`;
                        }

                        // IMPORTANT: Don't download inside db_export_status - it causes MCP timeouts
                        // Instead, return immediately and instruct AI to call db_export_download
                        if (autoDownload === true) {
                            OutputLogger.success('🎉 Database export complete!');

                            // Get file size for display
                            let sizeInfo = '';
                            try {
                                const remoteSize = await this.getRemoteFileSize(status.downloadUrl);
                                if (remoteSize) {
                                    sizeInfo = `**File Size**: ${this.formatBytes(remoteSize)}\n`;
                                }
                            } catch (error) {
                                // Size check failed, continue without it
                            }

                            let autoDownloadMessage = `✅ **Database Export Complete!**

**Export ID**: ${targetExportId}
**Status**: ${status.status}
${timeDisplay}${sizeInfo}**Download URL**: ${status.downloadUrl}

🎯 **Auto-download requested!**

**AI: Immediately call db_export_download to start background download:**
\`\`\`
db_export_download downloadUrl: "${status.downloadUrl}" environment: "${backupEnvironment}" skipConfirmation: true monitor: ${shouldMonitor}
\`\`\`
`;

                            // DXP-66: Add structured data
                            return ResponseBuilder.successWithStructuredData({
                                exportId: targetExportId,
                                environment: backupEnvironment,
                                databaseName: backupDatabase,
                                status: status.status,
                                downloadUrl: status.downloadUrl,
                                bacpacName: status.bacpacName || null,
                                autoDownload: true,
                                monitorDownload: shouldMonitor
                            }, autoDownloadMessage);
                        }

                        // Default: Just show status without auto-download
                        // Try to get file size
                        let sizeInfo = '';
                        try {
                            console.error(`[File Size Check] Attempting to get size from: ${status.downloadUrl.substring(0, 100)}...`);
                            const remoteSize = await this.getRemoteFileSize(status.downloadUrl);
                            console.error(`[File Size Check] Result: ${remoteSize}`);
                            if (remoteSize) {
                                sizeInfo = `**File Size**: ${this.formatBytes(remoteSize)}\n`;
                                console.error(`[File Size Check] Formatted: ${sizeInfo}`);
                            } else {
                                console.error(`[File Size Check] No size returned (null/undefined)`);
                            }
                        } catch (error) {
                            // If size check fails, just don't show it
                            console.error(`[File Size Check] Error: ${error.message}`);
                            console.error(`[File Size Check] Stack: ${error.stack}`);
                        }

                        const completeMessage = `✅ **Database Export Complete!**

**Export ID**: ${targetExportId}
**Status**: ${status.status}
${timeDisplay}${sizeInfo}**Download URL**: ${status.downloadUrl}

🎯 Your backup is ready!

**AI: To download, use db_export_download with downloadUrl parameter:**
\`\`\`
db_export_download downloadUrl: "${status.downloadUrl}" skipConfirmation: true
\`\`\`

**Next Steps**:
1. Download starts in background (returns download ID)
2. Use \`check_download_status\` with the download ID to monitor
3. Or download manually from the URL
4. Backup available for 7 days

💡 **Export completed successfully!**`;

                        // DXP-66: Add structured data
                        return ResponseBuilder.successWithStructuredData({
                            exportId: targetExportId,
                            environment: backupEnvironment,
                            databaseName: backupDatabase,
                            status: status.status,
                            downloadUrl: status.downloadUrl,
                            bacpacName: status.bacpacName || null,
                            autoDownload: false
                        }, completeMessage);
                    }
                } else {
                    // Still in progress - format nicely instead of dumping JSON
                    // Use actual API startTime if available, otherwise fall back to user-initiated time
                    let elapsedTime = 'Unknown';
                    if (status.startTime) {
                        const startMs = new Date(status.startTime).getTime();
                        const nowMs = Date.now();
                        const durationMin = Math.round((nowMs - startMs) / 60000);
                        elapsedTime = `${durationMin}m (elapsed)`;
                    } else if (backupStartTime) {
                        elapsedTime = this.getElapsedTimeWithContext(backupStartTime, false);
                    }

                    let statusMessage = `⏳ **Export In Progress**\n\n`;
                    statusMessage += `**Export ID**: ${targetExportId}\n`;
                    statusMessage += `**Environment**: ${backupEnvironment}\n`;
                    statusMessage += `**Database**: ${backupDatabase}\n`;
                    statusMessage += `**Status**: ${status.status || 'InProgress'}\n`;

                    if (status.bacpacName) {
                        statusMessage += `**Backup File**: ${status.bacpacName}\n`;
                    }

                    statusMessage += `**Time Elapsed**: ${elapsedTime}\n\n`;

                    // Only show monitoring message if monitoring is enabled
                    if (shouldMonitor) {
                        statusMessage += `⏱️ **Monitoring**: Continue checking every 30 seconds\n`;
                    } else {
                        statusMessage += `📊 **Monitoring**: Disabled (monitor: false)\n`;
                    }

                    if (isCurrentExport) {
                        statusMessage += `📥 **When Complete**: Will show file size and download URL`;
                    } else {
                        statusMessage += `💡 **Tip**: Export typically takes 5-15 minutes total`;
                    }

                    // DXP-66: Add structured data
                    return ResponseBuilder.successWithStructuredData({
                        exportId: targetExportId,
                        environment: backupEnvironment,
                        databaseName: backupDatabase,
                        status: status.status || 'InProgress',
                        bacpacName: status.bacpacName || null,
                        downloadUrl: null,
                        monitoringEnabled: shouldMonitor
                    }, statusMessage);
                }
            }

            // If isSuccess is false, return error
            return ResponseBuilder.error(result.error || 'Export status check failed');
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'backup-status', args);
        }
    }
    
    /**
     * Check auto-download capabilities
     */
    static async handleCheckCapabilities(args) {
        try {
            const { downloadPath } = args;
            // For capability check, we'll use generic values since we're just checking the path
            const targetPath = downloadPath || await DownloadConfig.getDownloadPath('database', null, null, 'Production');
            
            const capabilityReport = await CapabilityDetector.generateCapabilityReport(targetPath);
            
            return ResponseBuilder.success(capabilityReport.report);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'capability-check', args);
        }
    }
    
    // REMOVED: handleListExports method (DXP-49)
    // This method relied on queryPaaSExports which cannot work due to EpiCloud API limitations.
    // The Get-EpiDatabaseExport cmdlet requires both DatabaseName AND Id parameters,
    // making it impossible to list all exports without knowing their IDs beforehand.
    // Users should use db_export or db_export_status directly with known export IDs.
    
    // Helper methods
    
    static async getProjectConfig(projectName, args = {}) {
        // If we have credentials passed in from withProjectResolution wrapper, use them directly
        if (args.projectId && args.apiKey && args.apiSecret) {
            return {
                name: args.projectName || projectName || 'Unknown',
                projectId: args.projectId,
                apiKey: args.apiKey,
                apiSecret: args.apiSecret
            };
        }
        
        // Fallback to old method for backward compatibility
        try {
            const projects = ProjectTools.getConfiguredProjects();
            
            if (!projects || projects.length === 0) {
                throw new Error('No projects configured. Run "test_connection setupMode:true" to configure your first project.');
            }
            
            if (projectName) {
                // CRITICAL: Require exact match (case-insensitive) to prevent wrong project selection
                const project = projects.find(p => 
                    p.name && p.name.toLowerCase() === projectName.toLowerCase()
                );
                
                if (!project) {
                    const availableNames = projects.map(p => p.name).filter(Boolean).join(', ') || 'None';
                    throw new Error(`Project "${projectName}" not found. Available: ${availableNames}`);
                }
                
                return project;
            } else {
                const defaultProject = projects.find(p => p.isDefault);
                
                if (defaultProject) {
                    return defaultProject;
                }
                
                if (projects.length === 1) {
                    return projects[0];
                }
                
                const projectNames = projects.map(p => p.name).filter(Boolean).join(', ') || 'None';
                throw new Error(`Multiple projects found but no default set. Available: ${projectNames}`);
            }
        } catch (error) {
            if (error.message.includes('No projects configured')) {
                throw error;
            }
            throw new Error(`Failed to get project configuration: ${error.message}`);
        }
    }
    
    static parseEnvironment(env) {
        if (!env) return 'Integration';
        
        const envLower = env.toLowerCase();
        
        const aliases = {
            'prod': 'Production',
            'production': 'Production',
            'pre': 'Preproduction',
            'prep': 'Preproduction',
            'preproduction': 'Preproduction',
            'staging': 'Preproduction',
            'int': 'Integration',
            'integration': 'Integration',
            'dev': 'Integration',
            'development': 'Integration'
        };
        
        return aliases[envLower] || env;
    }
    
    static extractExportId(result) {
        // Extract export ID from the result
        try {
            // Handle both old format (result.content) and new format (result.result.content)
            let content;
            if (result.result && result.result.content && result.result.content[0]) {
                content = result.result.content[0].text;
            } else if (result.content && result.content[0]) {
                content = result.content[0].text;
            } else {
                return null;
            }
            
            // Try multiple patterns to extract export ID
            const patterns = [
                /Export ID.*?`([a-f0-9-]+)`/i,                                      // Export ID: `uuid-format`
                /Export ID:\s*([a-f0-9-]+)/i,                                       // Export ID: uuid-format
                /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i, // UUID format anywhere
                /Export ID.*?`([0-9]+)`/i,                                          // Export ID: `timestamp-format`
                /Export ID:\s*([0-9]+)/i,                                           // Export ID: timestamp-format
                /\b([0-9]{14})\b/i                                                  // 14-digit timestamp (YYYYMMDDHHMMSS)
            ];
            
            for (const pattern of patterns) {
                const match = content.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }
    
    static parseExportStatus(result) {
        try {
            // Handle both old format (result.content[0].text) and new format (result.data)
            let content;
            let jsonData = null;

            if (result.data) {
                // New internal format from internalCheckExportStatus
                content = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
                // Try to parse as JSON to extract timestamps
                try {
                    jsonData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                } catch {
                    // Not JSON, continue with string matching
                }
            } else if (result.content && result.content[0]) {
                // Old MCP response format
                content = result.content[0].text;
                try {
                    jsonData = JSON.parse(content);
                } catch {
                    // Not JSON, continue with string matching
                }
            } else {
                throw new Error('Invalid result format');
            }

            const parsed = {
                isComplete: content.includes('Succeeded') || content.includes('Complete'),
                status: content.includes('Succeeded') ? 'Complete' :
                       content.includes('InProgress') ? 'In Progress' :
                       content.includes('Failed') ? 'Failed' : 'Unknown',
                downloadUrl: this.extractDownloadUrl(content)
            };

            // Extract timestamps from JSON if available
            if (jsonData) {
                if (jsonData.startTime) {
                    parsed.startTime = jsonData.startTime;
                }
                if (jsonData.completedAt) {
                    parsed.completedAt = jsonData.completedAt;
                }
            }

            return parsed;
        } catch (error) {
            return { isComplete: false, status: 'Unknown' };
        }
    }
    
    static extractDownloadUrl(content) {
        // First try to match a clean URL (no quotes, brackets, or JSON delimiters)
        // This handles most cases where URL is embedded in JSON or text
        const cleanMatch = content.match(/https?:\/\/[^\s"'\]},]+/);
        if (cleanMatch) {
            return cleanMatch[0];
        }

        // Fallback: match any URL and then clean it
        const roughMatch = content.match(/https?:\/\/[^\s]+/);
        if (!roughMatch) return null;

        // Remove trailing characters that shouldn't be part of the URL
        // Common issues: JSON quotes, brackets, commas
        let url = roughMatch[0];
        url = url.replace(/["'\]},]+$/, '');

        return url;
    }
    
    // Simple in-memory storage for backup history (could be persisted to file)
    static backupHistory = {};

    // Persistent state file for tracking current exports (use temp dir for cross-platform compatibility)
    static STATE_FILE = require('path').join(require('os').tmpdir(), '.optimizely-dxp-export-state.json');
    
    /**
     * Save current export state to persistent file
     */
    static async saveCurrentExportState(exportInfo) {
        const fs = require('fs').promises;
        try {
            let state = { currentExport: null, recentExports: [] };
            
            // Try to read existing state
            try {
                const existingState = await fs.readFile(this.STATE_FILE, 'utf8');
                state = JSON.parse(existingState);
            } catch (error) {
                // File doesn't exist or is invalid, use default state
            }
            
            // Update current export
            state.currentExport = exportInfo;
            
            // Add to recent exports (keep last 10)
            if (!state.recentExports) state.recentExports = [];
            state.recentExports.unshift(exportInfo);
            state.recentExports = state.recentExports.slice(0, 10);
            
            // Save to file
            await fs.writeFile(this.STATE_FILE, JSON.stringify(state, null, 2));
            
        } catch (error) {
            OutputLogger.error(`Failed to save export state to ${this.STATE_FILE}:`, error.message || error);
        }
    }
    
    /**
     * Load current export state from persistent file
     */
    static async loadCurrentExportState() {
        const fs = require('fs').promises;
        try {
            const stateData = await fs.readFile(this.STATE_FILE, 'utf8');
            return JSON.parse(stateData);
        } catch (error) {
            // File doesn't exist or is invalid
            return { currentExport: null, recentExports: [] };
        }
    }
    
    /**
     * Clear current export from state (when completed or failed)
     */
    static async clearCurrentExportState() {
        const fs = require('fs').promises;
        try {
            const state = await this.loadCurrentExportState();
            state.currentExport = null;
            await fs.writeFile(this.STATE_FILE, JSON.stringify(state, null, 2));
        } catch (error) {
            OutputLogger.error(`Failed to clear export state from ${this.STATE_FILE}:`, error.message || error);
        }
    }
    
    /**
     * Enhanced export state persistence - survives monitoring interruptions
     * Stores export info both in memory and persistent file storage
     */
    static async storeBackupInfo(projectName, backupInfo) {
        // Store in memory for quick access
        if (!this.backupHistory[projectName]) {
            this.backupHistory[projectName] = [];
        }
        
        this.backupHistory[projectName].unshift(backupInfo);
        
        // Keep only last 10 backups in memory
        if (this.backupHistory[projectName].length > 10) {
            this.backupHistory[projectName] = this.backupHistory[projectName].slice(0, 10);
        }

        // File persistence removed - keeping only in-memory storage
    }

    /**
     * Save download state to persistent storage (works for any status: pending, in_progress, complete, error)
     */
    static async saveDownloadState(download) {
        const fs = require('fs').promises;
        const os = require('os');
        const path = require('path');

        const DOWNLOADS_FILE = path.join(os.tmpdir(), '.optimizely-dxp-downloads.json');

        try {
            let downloads = [];
            try {
                const data = await fs.readFile(DOWNLOADS_FILE, 'utf8');
                downloads = JSON.parse(data);
            } catch {
                // File doesn't exist yet
            }

            // Add this download
            downloads.push({
                downloadId: download.downloadId,
                type: download.type,
                status: download.status,
                filePath: download.filePath,
                bytesDownloaded: download.bytesDownloaded,
                totalBytes: download.totalBytes,
                endTime: download.endTime,
                metadata: download.metadata
            });

            // Keep only last 50 downloads
            if (downloads.length > 50) {
                downloads = downloads.slice(-50);
            }

            await fs.writeFile(DOWNLOADS_FILE, JSON.stringify(downloads, null, 2));
            OutputLogger.debug(`💾 Saved download ${download.downloadId} to persistent storage`);
        } catch (error) {
            OutputLogger.error(`Failed to save download state: ${error.message}`);
        }
    }

    /**
     * Load completed downloads from persistent storage on server start
     */
    static async loadCompletedDownloads() {
        const fs = require('fs').promises;
        const os = require('os');
        const path = require('path');

        const DOWNLOADS_FILE = path.join(os.tmpdir(), '.optimizely-dxp-downloads.json');

        try {
            const data = await fs.readFile(DOWNLOADS_FILE, 'utf8');
            const downloads = JSON.parse(data);

            // Restore to backgroundDownloads Map
            for (const download of downloads) {
                this.backgroundDownloads.set(download.downloadId, download);
            }

            OutputLogger.debug(`📥 Loaded ${downloads.length} completed downloads from persistent storage`);
        } catch (error) {
            // File doesn't exist or is invalid - this is normal on first run
            OutputLogger.debug(`No persisted downloads to load (this is normal on first run)`);
        }
    }

    // File persistence removed - keeping only in-memory storage

    /**
     * Placeholder for removed file recovery - now using in-memory only
     */
    static async recoverExportsFromFile(projectName) {
        // File persistence removed - returning empty array
        return [];
    }
    
    static async getLatestBackup(projectName) {
        // First try memory
        let history = this.backupHistory[projectName];
        
        // If no history in memory, try to recover from file
        if (!history || history.length === 0) {
            history = [];
        }
        
        return history && history.length > 0 ? history[0] : null;
    }
    
    static async getBackupHistory(projectName, limit = 5) {
        // First try memory
        let history = this.backupHistory[projectName] || [];
        
        // If no history in memory, try to recover from file
        if (history.length === 0) {
            history = [];
        }
        
        return history.slice(0, limit);
    }
    
    static getTimeAgo(dateString) {
        const now = new Date();
        const date = new Date(dateString);
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    }
    
    /**
     * Calculate elapsed time since export started
     */
    static getElapsedTime(startTime) {
        const now = new Date();
        const start = new Date(startTime);
        const diffMs = now - start;
        
        const minutes = Math.floor(diffMs / 60000);
        const hours = Math.floor(minutes / 60);
        const remainingMins = minutes % 60;
        
        if (hours > 0) {
            return `${hours}h ${remainingMins}m`;
        } else if (minutes > 0) {
            return `${minutes}m`;
        } else {
            return 'less than 1m';
        }
    }
    
    /**
     * Get elapsed time with context for export status
     */
    static getElapsedTimeWithContext(startTime, isComplete = false) {
        const elapsed = this.getElapsedTime(startTime);
        if (isComplete) {
            return `${elapsed} (total time)`;
        } else {
            return `${elapsed} (elapsed)`;
        }
    }
    
    
    /**
     * Monitor backup progress and auto-download when complete
     */
    static async monitorAndDownload(options) {
        const { exportId, projectConfig, downloadPath, targetEnv, dbName } = options;
        const fs = require('fs').promises;
        const path = require('path');
        const https = require('https');
        
        OutputLogger.progress(`Monitoring backup ${exportId}...`);
        
        // Poll for completion (max 30 minutes)
        const maxAttempts = 60; // 30 minutes with 30-second intervals
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            attempts++;
            
            try {
                // Check backup status
                const statusResult = await this.internalCheckExportStatus({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    exportId: exportId,
                    environment: targetEnv,
                    databaseName: dbName,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret
                });
                
                if (statusResult.isSuccess) {
                    const status = this.parseExportStatus(statusResult);
                    
                    if (status.isComplete && status.downloadUrl) {
                        OutputLogger.success('Backup complete! Starting download...');
                        
                        // Ensure download directory exists
                        await fs.mkdir(downloadPath, { recursive: true });
                        
                        // Generate filename
                        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
                        const filename = `${projectConfig.name}-${targetEnv}-${dbName}-${timestamp}.bacpac`;
                        const filepath = path.join(downloadPath, filename);
                        
                        // Download the backup
                        await this.downloadFile(status.downloadUrl, filepath);
                        
                        OutputLogger.success('Backup downloaded successfully!');
                        OutputLogger.log(`📁 Location: ${filepath}`);
                        OutputLogger.log(`📊 Size: ${await this.getFileSize(filepath)}`);
                        
                        return { success: true, filepath };
                    }
                    
                    if (status.status === 'Failed') {
                        throw new Error('Backup export failed');
                    }
                }
                
                // Wait before next check - using 2 minutes for manual monitoring to be less aggressive
                OutputLogger.progress(`Export still in progress... (check ${attempts}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, 120000)); // 2 minutes
                
            } catch (error) {
                OutputLogger.error(`Error checking backup status: ${error.message}`);
                throw error;
            }
        }
        
        throw new Error('Backup monitoring timed out after 30 minutes');
    }
    
    /**
     * Download file from URL to local path with timeout protection
     * For large database files (>100MB), we use a longer timeout
     * VERSION: v3.33.2-fix-applied (no x-ms-version header for SAS URLs)
     * @param {string} url - URL to download from
     * @param {string} filepath - Local file path to save to
     * @param {number} timeoutMs - Overall timeout in milliseconds
     * @param {string} downloadId - Optional download ID for background tracking
     */
    static async downloadFile(url, filepath, timeoutMs = 1800000, downloadId = null) { // 30 minute default timeout for large DB files
        console.error('[downloadFile] VERSION CHECK: v3.33.2-fix-applied - NO x-ms-version header for SAS URLs');
        const fs = require('fs');
        const https = require('https');

        // Update status to in_progress if tracking
        if (downloadId) {
            this.updateDownloadProgress(downloadId, { status: 'in_progress' });
        }

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(filepath);
            let downloadedBytes = 0;
            let totalBytes = 0;
            let lastProgressTime = Date.now();
            let startTime = Date.now();
            let lastBytes = 0;
            
            // Overall download timeout (30 minutes default for DB files)
            const overallTimeout = setTimeout(() => {
                file.destroy();
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    // File might not exist or already deleted
                }
                const timeoutMinutes = Math.round(timeoutMs / 60000);
                const error = new Error(`Download timed out after ${timeoutMinutes} minutes. For very large files (>500MB), try downloading manually from the DXP portal.`);

                // Mark download as failed if tracking
                if (downloadId) {
                    this.failDownload(downloadId, error);
                }

                reject(error);
            }, timeoutMs);

            // Stall timeout - if no data received for 2 minutes (increased for large files)
            let stallTimeout = setTimeout(() => {
                file.destroy();
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    // File might not exist or already deleted
                }
                const error = new Error('Download stalled - no data received for 2 minutes. Network connection may be unstable.');

                // Mark download as failed if tracking
                if (downloadId) {
                    this.failDownload(downloadId, error);
                }

                reject(error);
            }, 120000);
            
            // Parse URL to add required headers for Azure Blob Storage
            // IMPORTANT: Don't use urlObj.pathname + urlObj.search as it may decode/encode incorrectly
            // Instead, extract path from original URL string to preserve encoding
            const urlObj = new URL(url);
            const pathStart = url.indexOf('/', url.indexOf('//') + 2); // Find first / after hostname
            const pathAndQuery = url.substring(pathStart); // Everything after hostname

            const options = {
                hostname: urlObj.hostname,
                path: pathAndQuery, // Use original string to preserve SAS token encoding
                method: 'GET',
                headers: {
                    // Don't add x-ms-version header with SAS URLs - it invalidates the signature
                    // The SAS token already contains the API version in the 'sv' parameter
                    'User-Agent': 'Jaxon-DXP-MCP/3.33.0'
                }
            };

            console.error('[downloadFile] REQUEST OPTIONS:', {
                hostname: options.hostname,
                path: options.path.substring(0, 100),
                headers: JSON.stringify(options.headers)
            });

            const request = https.request(options, (response) => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    clearTimeout(overallTimeout);
                    clearTimeout(stallTimeout);
                    file.destroy();
                    return this.downloadFile(response.headers.location, filepath, timeoutMs).then(resolve).catch(reject);
                }
                
                // Check for error status codes
                if (response.statusCode !== 200) {
                    clearTimeout(overallTimeout);
                    clearTimeout(stallTimeout);
                    file.destroy();
                    try {
                        fs.unlinkSync(filepath);
                    } catch (e) {
                        // File might not exist
                    }

                    // Capture error body for Azure errors
                    let errorBody = '';
                    response.on('data', (chunk) => {
                        errorBody += chunk.toString();
                    });
                    response.on('end', () => {
                        const errorMsg = errorBody ?
                            `Download failed with status ${response.statusCode}: ${response.statusMessage}. ${errorBody}` :
                            `Download failed with status ${response.statusCode}: ${response.statusMessage}`;
                        reject(new Error(errorMsg));
                    });
                    return;
                }
                
                totalBytes = parseInt(response.headers['content-length'], 10);
                
                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    file.write(chunk);
                    
                    // Reset stall timeout since we received data (2 minutes for large files)
                    clearTimeout(stallTimeout);
                    stallTimeout = setTimeout(() => {
                        file.destroy();
                        try {
                            fs.unlinkSync(filepath);
                        } catch (e) {
                            // File might not exist or already deleted
                        }
                        const error = new Error('Download stalled - no data received for 2 minutes. Network connection may be unstable.');

                        // Mark download as failed if tracking
                        if (downloadId) {
                            this.failDownload(downloadId, error);
                        }

                        reject(error);
                    }, 120000);
                    
                    // Show progress every 5 seconds to avoid spam
                    const now = Date.now();
                    if (now - lastProgressTime > 5000) {
                        // Calculate download speed
                        const intervalBytes = downloadedBytes - lastBytes;
                        const intervalSeconds = (now - lastProgressTime) / 1000;
                        const bytesPerSecond = intervalBytes / intervalSeconds;
                        const mbPerSecond = (bytesPerSecond / (1024 * 1024)).toFixed(2);

                        lastBytes = downloadedBytes;
                        lastProgressTime = now;

                        if (totalBytes) {
                            const percent = Math.round((downloadedBytes / totalBytes) * 100);

                            // Estimate remaining time based on current speed
                            const remainingBytes = totalBytes - downloadedBytes;
                            const remainingSeconds = bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : 0;
                            const remainingMinutes = Math.ceil(remainingSeconds / 60);

                            OutputLogger.progress(`📥 Downloading: ${percent}% (${this.formatBytes(downloadedBytes)}/${this.formatBytes(totalBytes)}) - ${mbPerSecond} MB/s - ETA: ${remainingMinutes} min`);

                            // Update download tracker if in background mode
                            if (downloadId) {
                                this.updateDownloadProgress(downloadId, {
                                    bytesDownloaded: downloadedBytes,
                                    totalBytes: totalBytes,
                                    speed: bytesPerSecond,
                                    eta: `${remainingMinutes} min`
                                });
                            }
                        } else {
                            OutputLogger.progress(`📥 Downloaded: ${this.formatBytes(downloadedBytes)} - ${mbPerSecond} MB/s`);

                            // Update download tracker if in background mode (no total yet)
                            if (downloadId) {
                                this.updateDownloadProgress(downloadId, {
                                    bytesDownloaded: downloadedBytes,
                                    speed: bytesPerSecond
                                });
                            }
                        }
                    }
                });
                
                response.on('end', () => {
                    clearTimeout(overallTimeout);
                    clearTimeout(stallTimeout);

                    // Wait for file stream to finish writing all data to disk
                    file.end(() => {
                        // Verify we got some data (catch zero-byte files)
                        if (downloadedBytes === 0) {
                            try {
                                fs.unlinkSync(filepath);
                            } catch (e) {
                                // File might not exist
                            }
                            const error = new Error(`Download failed: received zero bytes. The download URL may be invalid or expired.`);

                            // Mark download as failed if tracking
                            if (downloadId) {
                                this.failDownload(downloadId, error);
                            }

                            reject(error);
                            return;
                        }

                        // Verify we got the complete file (if Content-Length was provided)
                        if (totalBytes && downloadedBytes < totalBytes) {
                            // Incomplete download - clean up partial file
                            try {
                                fs.unlinkSync(filepath);
                            } catch (e) {
                                // File might not exist
                            }
                            const percentComplete = Math.round((downloadedBytes / totalBytes) * 100);
                            const error = new Error(`Download incomplete: received ${this.formatBytes(downloadedBytes)} of ${this.formatBytes(totalBytes)} (${percentComplete}%). Connection may have been interrupted. Partial file removed.`);

                            // Mark download as failed if tracking
                            if (downloadId) {
                                this.failDownload(downloadId, error);
                            }

                            reject(error);
                            return;
                        }

                        OutputLogger.success(`Download completed: ${this.formatBytes(downloadedBytes)}`);

                        // For tracked downloads, update final bytes before resolving
                        // The caller will verify file size and mark complete
                        if (downloadId) {
                            this.updateDownloadProgress(downloadId, {
                                bytesDownloaded: downloadedBytes,
                                totalBytes: totalBytes || downloadedBytes,
                                percent: 100
                            });
                        }

                        resolve();
                    });
                });

                response.on('error', (error) => {
                    clearTimeout(overallTimeout);
                    clearTimeout(stallTimeout);
                    file.destroy();
                    try {
                        fs.unlinkSync(filepath);
                    } catch (e) {
                        // File might not exist
                    }

                    // Mark download as failed if tracking
                    if (downloadId) {
                        this.failDownload(downloadId, error);
                    }

                    reject(error);
                });
            });
            
            request.on('error', (error) => {
                clearTimeout(overallTimeout);
                clearTimeout(stallTimeout);
                file.destroy();
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    // File might not exist
                }

                // Mark download as failed if tracking
                if (downloadId) {
                    this.failDownload(downloadId, error);
                }

                reject(error);
            });

            // Set request timeout (connection timeout)
            request.setTimeout(30000, () => {
                request.destroy();
                clearTimeout(overallTimeout);
                clearTimeout(stallTimeout);
                file.destroy();
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    // File might not exist
                }
                const error = new Error('Connection timeout - could not establish connection to download server');

                // Mark download as failed if tracking
                if (downloadId) {
                    this.failDownload(downloadId, error);
                }

                reject(error);
            });

            // Must call .end() when using https.request (not needed for https.get)
            request.end();
        });
    }
    
    /**
     * Get file size in human-readable format
     */
    static async getFileSize(filepath) {
        const fs = require('fs').promises;
        const stats = await fs.stat(filepath);
        return this.formatBytes(stats.size);
    }
    
    /**
     * Format bytes to human-readable size
     */
    static formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Estimate download time based on file size
     */
    static estimateDownloadTime(bytes) {
        // Assume average download speeds
        const speedMbps = {
            slow: 10,      // 10 Mbps (1.25 MB/s)
            average: 50,   // 50 Mbps (6.25 MB/s)
            fast: 100      // 100 Mbps (12.5 MB/s)
        };

        const bytesPerSecond = speedMbps.average * 125000; // Convert Mbps to bytes/sec
        const seconds = bytes / bytesPerSecond;

        if (seconds < 60) {
            return `< 1 minute`;
        } else if (seconds < 300) {
            return `2-5 minutes`;
        } else if (seconds < 600) {
            return `5-10 minutes`;
        } else if (seconds < 1800) {
            return `10-30 minutes`;
        } else {
            return `30+ minutes`;
        }
    }

    /**
     * Get file size from remote URL without downloading
     */
    static async getRemoteFileSize(url) {
        const https = require('https');
        const { URL } = require('url');
        const OutputLogger = require('../output-logger');

        return new Promise((resolve) => {
            try {
                // Parse URL to add required headers for Azure Blob Storage
                // IMPORTANT: Don't use parsedUrl.pathname + parsedUrl.search as it may decode/encode incorrectly
                // Instead, extract path from original URL string to preserve encoding
                const parsedUrl = new URL(url);
                const pathStart = url.indexOf('/', url.indexOf('//') + 2); // Find first / after hostname
                const pathAndQuery = url.substring(pathStart); // Everything after hostname

                const options = {
                    method: 'HEAD',
                    hostname: parsedUrl.hostname,
                    path: pathAndQuery, // Use original string to preserve SAS token encoding
                    port: parsedUrl.port || 443,
                    headers: {
                        // Don't add x-ms-version header with SAS URLs - it invalidates the signature
                        // The SAS token already contains the API version in the 'sv' parameter
                        'User-Agent': 'Jaxon-DXP-MCP/3.33.0'
                    }
                };

                console.error(`[getRemoteFileSize] Making HEAD request to ${parsedUrl.hostname}${pathAndQuery.substring(0, 50)}...`);

                const req = https.request(options, (res) => {
                    console.error(`[getRemoteFileSize] Response status: ${res.statusCode}`);
                    if (res.statusCode === 200) {
                        const contentLength = res.headers['content-length'];
                        console.error(`[getRemoteFileSize] Content-Length header: ${contentLength}`);
                        resolve(contentLength ? parseInt(contentLength) : null);
                    } else {
                        console.error(`[getRemoteFileSize] Non-200 status, returning null`);
                        resolve(null);
                    }
                });

                req.on('error', (error) => {
                    console.error(`[getRemoteFileSize] Request error: ${error.message}`);
                    resolve(null); // Return null if we can't get size
                });

                req.setTimeout(30000, () => {
                    console.error(`[getRemoteFileSize] Request timeout after 30 seconds`);
                    req.destroy();
                    resolve(null); // Return null on timeout
                });

                req.end();
            } catch (error) {
                console.error(`[getRemoteFileSize] Exception: ${error.message}`);
                resolve(null); // Return null on any error
            }
        });
    }
    
    /**
     * Get the latest database export
     * Since Get-EpiDatabaseExport requires an actual export ID and there's no way to list exports,
     * we rely on our internal tracking of exports created during this session
     */
    static async getLatestTrackedExport(projectConfig, environment = 'Production', databaseName = 'epicms') {
        try {
            const OutputLogger = require('../output-logger');

            OutputLogger.debug(`🔍 Getting latest tracked export for ${environment}/${databaseName}`);

            // First check our in-memory backup history
            const backups = this.backupHistory[projectConfig.name] || [];

            // Filter for the specific environment and database, then sort by time
            const relevantBackups = backups
                .filter(b =>
                    (!environment || b.environment === environment) &&
                    (!databaseName || b.databaseName === databaseName)
                )
                .sort((a, b) => {
                    const timeA = new Date(a.startTime || a.completedAt || 0).getTime();
                    const timeB = new Date(b.startTime || b.completedAt || 0).getTime();
                    return timeB - timeA;  // Most recent first
                });

            if (relevantBackups.length > 0) {
                const latest = relevantBackups[0];
                OutputLogger.debug(`Found latest tracked export: ${latest.exportId}`);

                // Verify it still exists by checking its status
                try {
                    const statusResult = await this.internalCheckExportStatus({
                        exportId: latest.exportId,
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret,
                        projectId: projectConfig.projectId,
                        environment: latest.environment,
                        databaseName: latest.databaseName
                    });

                    if (statusResult.success) {
                        return {
                            id: latest.exportId,
                            status: statusResult.status,
                            details: statusResult.details,
                            environment: latest.environment,
                            databaseName: latest.databaseName
                        };
                    }
                } catch (error) {
                    OutputLogger.debug(`Tracked export ${latest.exportId} no longer exists`);
                }
            }

            OutputLogger.debug('No tracked exports found for this session');
            return null;

        } catch (error) {
            OutputLogger.debug(`Failed to get latest tracked export: ${error.message}`);
            return null;
        }
    }

    /**
     * Test Get-EpiDatabaseExport command directly
     * DXP-101: DEPRECATED - PowerShell has been removed in favor of direct REST API calls
     */
    static async testExportQuery(args = {}) {
        return {
            content: [{
                type: 'text',
                text: '⚠️ **Tool Deprecated**\n\n' +
                      'The `test_export_query` tool has been deprecated as part of DXP-101 REST API migration.\n\n' +
                      'PowerShell dependency has been removed - all operations now use direct REST API calls.\n\n' +
                      '**Use these tools instead:**\n' +
                      '• `db_export` - Start database export\n' +
                      '• `db_export_status` - Check export status\n' +
                      '• `db_export_download` - Download completed export'
            }]
        };

        /* REMOVED - PowerShell-based implementation
        try {
            const PowerShellCommandBuilder = require('../powershell-command-builder');
            const PowerShellHelper = require('../powershell-helper');
            const ResponseBuilder = require('../response-builder');
            const OutputLogger = require('../output-logger');

            // Get project configuration
            const ProjectResolver = require('../project-resolver');
            const projectConfig = await ProjectResolver.resolveProject(args);

            const environment = args.environment || 'Production';

            let testResults = '🧪 **Testing Get-EpiDatabaseExport Command**\n\n';

            // Test 1: List all exports (no ID parameter)
            testResults += '**Test 1: List all exports (no ID)**\n';
            const listCommand = new PowerShellCommandBuilder('Get-EpiDatabaseExport')
                .addParam('ProjectId', projectConfig.projectId)
                .addParam('Environment', environment)
                .build();

            testResults += `Command: ${listCommand}\n`;

            const listResult = await PowerShellHelper.executeEpiCommandDirectWithCredentials(
                listCommand,
                {
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId
                },
                { parseJson: true, timeout: 10000 }
            );

            testResults += `Success: ${listResult.isSuccess}\n`;
            testResults += `Has Data: ${!!listResult.data}\n`;
            if (listResult.data) {
                testResults += `Data Type: ${typeof listResult.data}\n`;
                testResults += `Is Array: ${Array.isArray(listResult.data)}\n`;
                if (Array.isArray(listResult.data)) {
                    testResults += `Array Length: ${listResult.data.length}\n`;
                    if (listResult.data.length > 0) {
                        testResults += `First Item: ${JSON.stringify(listResult.data[0], null, 2)}\n`;
                    }
                } else {
                    testResults += `Data: ${JSON.stringify(listResult.data).substring(0, 500)}...\n`;
                }
            }
            if (listResult.error) {
                testResults += `Error: ${listResult.error}\n`;
            }

            return ResponseBuilder.success(testResults);

        } catch (error) {
            return ResponseBuilder.error('Test failed', error.message);
        }
        */ // End REMOVED PowerShell implementation
    }

    /**
     * Query PaaS portal for existing database exports
     * DXP-101: DISABLED - PowerShell has been removed, and this function never worked correctly
     * @deprecated Cannot list exports without knowing their IDs, PowerShell removed
     */
    /* DISABLED - PowerShell dependency removed
    static async queryPaaSExports(projectConfig, environment) {
        // This function is deprecated and no longer works after PowerShell removal
        return null;

        // REMOVED - PowerShell-based implementation (never worked correctly)
        try {
            const PowerShellCommandBuilder = require('../powershell-command-builder');
            const PowerShellHelper = require('../powershell-helper');
            const OutputLogger = require('../output-logger');

            OutputLogger.info(`🔍 Querying PaaS portal for existing database exports in ${environment}...`);
            console.error(`[DEBUG] queryPaaSExports called for environment: ${environment}`);

            // Build command to list all exports for the environment
            const command = new PowerShellCommandBuilder('Get-EpiDatabaseExport')
                .addParam('ProjectId', projectConfig.projectId)
                .addParam('Environment', environment)
                // No ID parameter = list all exports
                .build();

            console.error(`[DEBUG] PowerShell command: ${command}`);
            console.error(`[DEBUG] ProjectId: ${projectConfig.projectId}`);
            console.error(`[DEBUG] Environment: ${environment}`);

            // Execute command
            const result = await PowerShellHelper.executeEpiCommandDirectWithCredentials(
                command,
                {
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId
                },
                { parseJson: true }
            );

            console.error(`[DEBUG] Command result success: ${result.isSuccess}`);
            console.error(`[DEBUG] Result data exists: ${!!result.data}`);
            if (result.data) {
                console.error(`[DEBUG] Result data type: ${typeof result.data}`);
                console.error(`[DEBUG] Result data length: ${Array.isArray(result.data) ? result.data.length : 'not array'}`);
            }
            if (result.error) {
                console.error(`[DEBUG] Error: ${result.error}`);
            }

            if (!result.isSuccess || !result.data) {
                OutputLogger.debug('No exports found or unable to query exports');
                return [];
            }

            // Parse the results - could be array or single object
            const exports = Array.isArray(result.data) ? result.data : [result.data];

            OutputLogger.debug(`Raw exports from PaaS: ${exports.length} total exports found`);
            if (exports.length > 0) {
                OutputLogger.debug(`First export sample: ${JSON.stringify(exports[0], null, 2)}`);
            }

            // Filter and format the exports
            const formattedExports = exports
                .filter(exp => exp && exp.id) // Must have an ID
                .map(exp => ({
                    exportId: exp.id,
                    environment: exp.environment || environment,
                    databaseName: exp.databaseDisplayName || exp.databaseName || 'epicms',
                    status: exp.status,
                    startTime: exp.startTime || exp.created,
                    completedAt: exp.completedAt,
                    downloadUrl: exp.downloadLink || exp.downloadUrl,
                    bacpacName: exp.bacpacName,
                    isComplete: exp.status === 'Succeeded' || exp.status === 'Complete' || exp.status === 'succeeded' || exp.status === 'complete'
                }));

            OutputLogger.debug(`After initial mapping: ${formattedExports.length} exports`);
            OutputLogger.debug(`Filtering criteria: isComplete && downloadUrl`);

            const filteredExports = formattedExports
                .filter(exp => {
                    const hasDownloadUrl = !!(exp.downloadUrl);
                    const isComplete = exp.isComplete;
                    OutputLogger.debug(`Export ${exp.exportId}: status=${exp.status}, isComplete=${isComplete}, hasDownloadUrl=${hasDownloadUrl}`);
                    return exp.isComplete; // Remove downloadUrl requirement for now to see all completed exports
                })
                .sort((a, b) => {
                    // Sort by date, newest first
                    const dateA = new Date(a.completedAt || a.startTime);
                    const dateB = new Date(b.completedAt || b.startTime);
                    return dateB - dateA;
                });

            OutputLogger.success(`Found ${filteredExports.length} completed database export(s) on PaaS portal`);
            return filteredExports;

        } catch (error) {
            OutputLogger.error(`Failed to query PaaS exports: ${error.message}`);
            return [];
        }
    }
    */ // End DISABLED queryPaaSExports

    /**
     * Find an available completed backup for environment and database
     */
    static async findAvailableBackup(projectConfig, environment, databaseName) {
        try {
            const backups = await this.getBackupHistory(projectConfig.name, 20); // Check last 20 backups
            const availableBackups = [];

            // Look for ALL completed backups for the same environment and database
            for (const backup of backups) {
                if (backup.environment === environment && backup.databaseName === databaseName) {
                    // No time limit - show ALL backups regardless of age
                    // Verify the backup is actually complete by checking its status
                    try {
                        const statusResult = await this.internalCheckExportStatus({
                            projectId: projectConfig.projectId,
                            projectName: projectConfig.name,
                            exportId: backup.exportId,
                            environment: environment,
                            databaseName: databaseName,
                            apiKey: projectConfig.apiKey,
                            apiSecret: projectConfig.apiSecret
                        });

                        if (statusResult.isSuccess) {
                            const status = this.parseExportStatus(statusResult);
                            if (status.isComplete && status.downloadUrl) {
                                // Found a valid, downloadable backup
                                availableBackups.push({
                                    ...backup,
                                    downloadUrl: status.downloadUrl,
                                    status: status.status
                                });
                            }
                        }
                    } catch (error) {
                        // Skip this backup if we can't check its status
                        continue;
                    }
                }
            }

            // Return array of all available backups, sorted by newest first
            return availableBackups.length > 0 ? availableBackups : null;
        } catch (error) {
            // If we can't check for existing backups, just return null
            return null;
        }
    }
    
    /**
     * Download an existing backup
     */
    static async downloadExistingBackup(backup, projectConfig, downloadPath, targetEnv, dbName) {
        const fs = require('fs').promises;
        const path = require('path');
        
        OutputLogger.success('Downloading existing backup...');
        
        // Ensure download directory exists
        await fs.mkdir(downloadPath, { recursive: true });
        
        // Generate filename
        const backupDate = new Date(backup.startTime);
        const timestamp = backupDate.toISOString().replace(/:/g, '-').split('.')[0];
        const filename = `${projectConfig.name}-${targetEnv}-${dbName}-${timestamp}.bacpac`;
        const filepath = path.join(downloadPath, filename);
        
        // Download the backup
        await this.downloadFile(backup.downloadUrl, filepath);
        
        OutputLogger.success('Existing backup downloaded successfully!');
        OutputLogger.log(`📁 Location: ${filepath}`);
        OutputLogger.log(`📊 Size: ${await this.getFileSize(filepath)}`);
        
        return { success: true, filepath };
    }
    
    /**
     * Download backup from URL with proper naming and error handling
     */
    static async downloadFromUrl(downloadUrl, downloadPath, projectName, environment, databaseName, skipConfirmation = false, incremental = true) {
        const fs = require('fs').promises;
        const path = require('path');
        const https = require('https');
        const OutputLogger = require('../output-logger');
        const ManifestManager = require('../manifest-manager');
        const ResponseBuilder = require('../response-builder');

        // Debug logging
        console.error('[downloadFromUrl] Called with URL:', {
            urlLength: downloadUrl ? downloadUrl.length : 0,
            urlStart: downloadUrl ? downloadUrl.substring(0, 80) : 'null',
            urlEnd: downloadUrl ? downloadUrl.substring(downloadUrl.length - 80) : 'null',
            skipConfirmation: skipConfirmation,
            environment: environment
        });
        OutputLogger.debug(`[downloadFromUrl] skipConfirmation: ${skipConfirmation} (type: ${typeof skipConfirmation})`);

        // First check if we can extract a filename from the URL or use bacpac name
        let filename;
        const urlMatch = downloadUrl.match(/([^/]+\.bacpac)/i);
        if (urlMatch) {
            filename = urlMatch[1];
        } else {
            // Generate filename with current timestamp as fallback
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            filename = `${projectName}-${environment}-${databaseName}-${timestamp}.bacpac`;
        }

        const filepath = path.join(downloadPath, filename);

        // Check if file already exists locally for smart incremental download
        if (incremental) {
            try {
                const stats = await fs.stat(filepath);
                if (stats && stats.isFile()) {
                    const localSize = stats.size;
                    const remoteSize = await this.getRemoteFileSize(downloadUrl);

                    // If sizes match, assume it's the same file
                    if (remoteSize && localSize === remoteSize) {
                        OutputLogger.success(`✨ Smart Download: File already exists locally`);
                        OutputLogger.info(`📁 Location: ${filepath}`);
                        OutputLogger.info(`📊 Size: ${this.formatBytes(localSize)}`);
                        return ResponseBuilder.success(
                            `✅ **Database Backup Already Downloaded**\n\n` +
                            `The backup file already exists locally with matching size.\n\n` +
                            `**File:** ${filename}\n` +
                            `**Location:** ${filepath}\n` +
                            `**Size:** ${this.formatBytes(localSize)}\n\n` +
                            `💡 Skipped download to save bandwidth. Run \`db_export\` again to create a fresh backup.`
                        );
                    }
                }
            } catch (error) {
                // File doesn't exist, proceed with download
            }
        }

        // Database exports: Only show confirmation if explicitly requested
        // Unlike blobs/logs, database exports are small and expected when user asks to download
        // So we skip confirmation by default (user already confirmed by asking to download)
        if (skipConfirmation === false) {
            // Explicit false means show confirmation
            let confirmationMessage = `📊 **Database Export Ready for Download**\n\n`;
            confirmationMessage += `**Environment:** ${environment}\n`;
            confirmationMessage += `**Database:** ${databaseName}\n`;
            confirmationMessage += `**Save Location:** \`${filepath}\`\n\n`;
            confirmationMessage += `**Note:** Database exports are typically 100MB-10GB depending on content.\n\n`;
            confirmationMessage += `**AWAITING USER CONFIRMATION**\n`;
            confirmationMessage += `To download this backup, please confirm.\n\n`;
            confirmationMessage += `Say "yes" to proceed or "no" to cancel.`;

            return {
                requiresConfirmation: true,
                fileSize: 'Unknown',
                estimatedSize: null,
                downloadUrl,
                message: confirmationMessage
            };
        }
        // If undefined or true, proceed with download (no double confirmation needed)

        // If we get here, skipConfirmation is true, so proceed with download
        OutputLogger.info(`📥 Starting auto-download to ${filepath}...`);

        // Ensure download directory exists
        await fs.mkdir(downloadPath, { recursive: true });

        try {
            // Download the backup
            await this.downloadFile(downloadUrl, filepath);

            // Get file size for response
            const fileSize = await this.getFileSize(filepath);

            OutputLogger.success(`✅ Database backup downloaded successfully!`);
            OutputLogger.info(`📁 Location: ${filepath}`);
            OutputLogger.info(`📊 Size: ${fileSize}`);

            return {
                success: true,
                filepath,
                fileSize,
                filename,
                requiresConfirmation: false
            };
        } catch (error) {
            OutputLogger.error(`❌ Download failed: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Estimate remaining time for backup completion
     */
    static estimateRemainingTime() {
        // Database exports typically take 15-30 minutes
        return '15-30 minutes';
    }

    /**
     * Check for existing backups in the download folder
     */
    static async checkForExistingBackups(downloadPath, projectName, environment, databaseName) {
        const fs = require('fs').promises;
        const path = require('path');

        try {
            // Check if directory exists
            await fs.access(downloadPath);

            // Read all files in the directory
            const files = await fs.readdir(downloadPath);

            // Filter for .bacpac files
            const bacpacFiles = files.filter(f => f.endsWith('.bacpac'));

            if (bacpacFiles.length === 0) {
                return null; // No backups found
            }

            // Find the most recent backup file
            let mostRecentBackup = null;
            let mostRecentTime = 0;

            for (const filename of bacpacFiles) {
                const filepath = path.join(downloadPath, filename);
                const stats = await fs.stat(filepath);

                // Check if this file matches our database (look for project name, env, and db name patterns)
                const lowerFilename = filename.toLowerCase();
                const matchesProject = projectName && lowerFilename.includes(projectName.toLowerCase());
                const matchesEnv = environment && lowerFilename.includes(environment.toLowerCase());
                const matchesDb = databaseName && (lowerFilename.includes(databaseName.toLowerCase()) ||
                                                   lowerFilename.includes('cms') ||
                                                   lowerFilename.includes('commerce'));

                // Also check for timestamp patterns in filename (YYYYMMDDHHMMSS or similar)
                const timestampMatch = filename.match(/(\d{14})|(\d{4}-?\d{2}-?\d{2})/);

                // If file seems relevant and is more recent, use it
                if (stats.mtime.getTime() > mostRecentTime) {
                    mostRecentBackup = {
                        filename,
                        filepath,
                        stats,
                        matchesProject,
                        matchesEnv,
                        matchesDb,
                        hasTimestamp: !!timestampMatch
                    };
                    mostRecentTime = stats.mtime.getTime();
                }
            }

            if (!mostRecentBackup) {
                return null;
            }

            // Calculate age of the backup
            const ageMs = Date.now() - mostRecentBackup.stats.mtime.getTime();
            const ageHours = ageMs / (1000 * 60 * 60);
            const ageDays = ageMs / (1000 * 60 * 60 * 24);

            // Format age display
            let ageDisplay;
            let isRecent = false;

            if (ageHours < 1) {
                const ageMinutes = Math.floor(ageMs / (1000 * 60));
                ageDisplay = `${ageMinutes} minute${ageMinutes !== 1 ? 's' : ''}`;
                isRecent = true;
            } else if (ageHours < 24) {
                const hours = Math.floor(ageHours);
                ageDisplay = `${hours} hour${hours !== 1 ? 's' : ''}`;
                isRecent = ageHours < 6; // Consider backups less than 6 hours old as recent
            } else if (ageDays < 7) {
                const days = Math.floor(ageDays);
                ageDisplay = `${days} day${days !== 1 ? 's' : ''}`;
                isRecent = ageDays < 2; // Consider backups less than 2 days old as somewhat recent
            } else if (ageDays < 30) {
                const weeks = Math.floor(ageDays / 7);
                ageDisplay = `${weeks} week${weeks !== 1 ? 's' : ''}`;
                isRecent = false;
            } else {
                const months = Math.floor(ageDays / 30);
                ageDisplay = `${months} month${months !== 1 ? 's' : ''}`;
                isRecent = false;
            }

            // Get file size
            const sizeBytes = mostRecentBackup.stats.size;
            const sizeDisplay = this.formatBytes(sizeBytes);

            return {
                filename: mostRecentBackup.filename,
                filepath: mostRecentBackup.filepath,
                size: sizeDisplay,
                sizeBytes,
                ageDisplay,
                ageHours,
                ageDays,
                isRecent,
                modifiedTime: mostRecentBackup.stats.mtime,
                matchesProject: mostRecentBackup.matchesProject,
                matchesEnv: mostRecentBackup.matchesEnv,
                matchesDb: mostRecentBackup.matchesDb
            };

        } catch (error) {
            // Directory doesn't exist or other error - return null
            return null;
        }
    }
    
    /**
     * Start persistent background monitoring that survives manual monitoring interruptions
     * This creates a truly independent background process that can't be cancelled by user interactions
     */
    static startBackgroundMonitoring(exportId, projectConfig, environment, databaseName, downloadPath) {
        console.error(`[MONITOR DEBUG] startBackgroundMonitoring called for export: ${exportId}`);

        // Check if already monitoring this export
        if (DatabaseSimpleTools.backgroundMonitors.has(exportId)) {
            OutputLogger.debug(`🔄 Background monitoring already active for export: ${exportId}`);
            console.error(`[MONITOR DEBUG] Already monitoring ${exportId}, returning existing monitor`);
            return DatabaseSimpleTools.backgroundMonitors.get(exportId);
        }

        const { EventEmitter } = require('events');
        const monitor = new EventEmitter();
        let isMonitoring = true;
        const startTime = Date.now();
        const pollInterval = 30 * 1000; // Check every 30 seconds (matches deployment monitoring)
        const maxDuration = 45 * 60 * 1000; // Stop after 45 minutes
        
        const OutputLogger = require('../output-logger');
        
        // Store monitoring metadata
        const monitorData = {
            monitor,
            exportId,
            projectConfig,
            environment,
            databaseName,
            downloadPath,
            startTime,
            isMonitoring: true,
            stop: () => { 
                isMonitoring = false; 
                monitorData.isMonitoring = false;
                DatabaseSimpleTools.backgroundMonitors.delete(exportId);
                OutputLogger.debug(`🛑 Background monitoring stopped for export: ${exportId}`);
            }
        };
        
        // Register the monitor 
        DatabaseSimpleTools.backgroundMonitors.set(exportId, monitorData);
        
        OutputLogger.success(`🚀 Background monitoring started for export: ${exportId}`);
        OutputLogger.info(`   ⏱️ Checking status every 30 seconds`);
        OutputLogger.info(`   📊 You'll see progress updates here`);
        OutputLogger.info(`   💾 Auto-download will trigger when export completes`);
        OutputLogger.info(`   🔍 Manual check: db_export_status exportId: "${exportId}"`);
        OutputLogger.debug(`[MONITOR] Starting monitoring loop for ${exportId}`);
        
        const monitorLoop = async () => {
            let checkCount = 0;
            
            OutputLogger.debug(`[MONITOR] Entering monitoring loop for ${exportId}`);

            // Do immediate first check, then wait for subsequent checks
            let initialCheck = true;

            while (isMonitoring) {
                checkCount++;

                try {
                    OutputLogger.info(`🔄 [MONITOR] Check #${checkCount} for export ${exportId.slice(-8)}`);

                    // Check if we've exceeded max duration
                    if (Date.now() - startTime > maxDuration) {
                        OutputLogger.error(`⏰ Auto-download monitoring timed out after 45 minutes for export: ${exportId}`);
                        isMonitoring = false;
                        break;
                    }
                    
                    // Check export status using our existing tools
                    const result = await this.internalCheckExportStatus({
                        projectId: projectConfig.projectId,
                        projectName: projectConfig.name,
                        exportId: exportId,
                        environment: environment,
                        databaseName: databaseName,
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret
                    });
                    
                    if (result.isSuccess) {
                        const status = this.parseExportStatus(result);
                        
                        if (status.isComplete && status.downloadUrl) {
                            // Export is ready - check if auto-download is possible
                            const capabilityCheck = await CapabilityDetector.checkAutoDownloadCapability(downloadPath, 100 * 1024 * 1024);
                            
                            if (capabilityCheck.canAutoDownload) {
                                OutputLogger.success(`🎉 Export ${exportId} completed! Checking file size...`);

                                try {
                                    // Always show size preview first - never skip confirmation
                                    const downloadResult = await this.downloadFromUrl(
                                        status.downloadUrl,
                                        downloadPath,
                                        projectConfig.name,
                                        environment,
                                        databaseName,
                                        false // Never skip confirmation - user must see size and decide
                                    );

                                    // Check if confirmation is required
                                    if (downloadResult.requiresConfirmation) {
                                        return ResponseBuilder.success(downloadResult.message);
                                    }
                                    
                                    // Clear the current export state since it's complete
                                    await this.clearCurrentExportState();
                                    
                                    OutputLogger.success(`✅ AUTO-DOWNLOAD COMPLETE!`);
                                    OutputLogger.success(`📁 File: ${downloadResult.filepath}`);
                                    OutputLogger.success(`📊 Size: ${downloadResult.fileSize}`);
                                    
                                    // Emit completion event
                                    monitor.emit('complete', {
                                        exportId,
                                        downloadPath: downloadResult.filepath,
                                        fileSize: downloadResult.fileSize,
                                        elapsed: Date.now() - startTime
                                    });
                                    
                                    isMonitoring = false;
                                    break;
                                    
                                } catch (downloadError) {
                                    OutputLogger.error(`❌ Auto-download failed: ${downloadError.message}`);
                                    OutputLogger.debug(`📥 Manual download available: ${status.downloadUrl}`);
                                    
                                    monitor.emit('download_failed', {
                                        exportId,
                                        downloadUrl: status.downloadUrl,
                                        error: downloadError.message
                                    });
                                    
                                    isMonitoring = false;
                                    break;
                                }
                            } else {
                                // Cannot auto-download - provide URL and instructions
                                const clientInfo = CapabilityDetector.detectMCPClient();
                                
                                if (clientInfo.isClaudeDesktop) {
                                    OutputLogger.success(`🎉 Export ${exportId} completed! Download URL ready.`);
                                    OutputLogger.debug(`🔗 Download URL: ${status.downloadUrl}`);
                                    OutputLogger.debug(`💡 Tip: Copy the URL above and open in your browser, or use Claude Code CLI for auto-download`);
                                } else {
                                    OutputLogger.success(`🎉 Export ${exportId} completed! Manual download required.`);
                                    OutputLogger.debug(`📥 Manual download available: ${status.downloadUrl}`);
                                    OutputLogger.debug(`⚠️ Auto-download not available: ${capabilityCheck.issues[0] || 'File system access limited'}`);
                                }
                                
                                // Clear the current export state since it's complete
                                await this.clearCurrentExportState();
                                
                                // Emit completion event
                                monitor.emit('complete', {
                                    exportId,
                                    downloadUrl: status.downloadUrl,
                                    autoDownloadFailed: true,
                                    reason: capabilityCheck.issues[0] || 'Auto-download not supported',
                                    elapsed: Date.now() - startTime
                                });
                                
                                isMonitoring = false;
                                break;
                            }
                        } else {
                            // Still in progress - provide periodic status updates with context
                            const elapsedMs = Date.now() - startTime;
                            const elapsedMinutes = Math.round(elapsedMs / 1000 / 60);
                            const elapsedSeconds = Math.round(elapsedMs / 1000);
                            
                            // Provide different messages based on elapsed time
                            let progressMessage = '';
                            let messageIcon = '⏳';
                            
                            // Special case for immediate first check
                            if (elapsedSeconds < 30) {
                                // Immediate check (within 30 seconds)
                                progressMessage = `Export ${exportId} started - performing initial status check`;
                                messageIcon = '🔍';
                            } else if (elapsedMinutes < 5) {
                                // First 5 minutes - normal progress
                                progressMessage = `Export ${exportId} in progress (${elapsedMinutes}m elapsed)`;
                                messageIcon = '⏳';
                            } else if (elapsedMinutes < 15) {
                                // 5-15 minutes - still normal
                                progressMessage = `Export ${exportId} still running after ${elapsedMinutes} minutes - this is normal for larger databases`;
                                messageIcon = '⏱️';
                            } else if (elapsedMinutes < 30) {
                                // 15-30 minutes - taking longer but still OK
                                progressMessage = `Export ${exportId} running for ${elapsedMinutes} minutes - larger exports can take up to 30 minutes`;
                                messageIcon = '⌛';
                            } else if (elapsedMinutes < 45) {
                                // 30-45 minutes - unusual but continuing
                                progressMessage = `Export ${exportId} has been running for ${elapsedMinutes} minutes - this is longer than usual but monitoring continues`;
                                messageIcon = '⚠️';
                            } else {
                                // 45+ minutes - likely stuck
                                progressMessage = `Export ${exportId} has been running for ${elapsedMinutes} minutes - may be stuck. Consider checking DXP portal or starting a new export`;
                                messageIcon = '🚨';
                            }
                            
                            // Always log updates since we check every 2 minutes
                            // This ensures users see activity and know monitoring is working
                            const shouldLogUpdate = true;

                            if (shouldLogUpdate) {
                                OutputLogger.info(`${messageIcon} ${progressMessage}`);
                                OutputLogger.debug(`   📊 Status: ${status.status || 'In Progress'}`);
                                OutputLogger.debug(`   🔄 Next check in 2 minutes...`);

                                // Provide helpful tips at certain milestones
                                if (elapsedMinutes === 10) {
                                    OutputLogger.info(`   💡 Manual check: db_export_status exportId: "${exportId}"`);
                                } else if (elapsedMinutes === 20) {
                                    OutputLogger.info(`   💡 If monitoring seems stuck, you can check the DXP portal directly`);
                                } else if (elapsedMinutes === 35) {
                                    OutputLogger.warn(`   💡 Export taking longer than usual - may need to check portal or restart`);
                                }
                            }
                            
                            monitor.emit('progress', {
                                exportId,
                                status: status.status,
                                elapsed: elapsedMs,
                                elapsedMinutes
                            });
                        }
                    } else {
                        // Error checking status - log but continue trying
                        OutputLogger.error(`⚠️ Failed to check export status: ${result.error || 'Unknown error'}`);
                    }
                    
                    // Wait before next check (only if still monitoring)
                    // Skip wait on first check to get immediate feedback
                    if (isMonitoring && !initialCheck) {
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                    }
                    initialCheck = false;
                    
                } catch (error) {
                    OutputLogger.error(`❌ Background monitoring error: ${error.message}`);
                    
                    // Don't stop monitoring for transient errors, just log and continue
                    monitor.emit('error', {
                        exportId,
                        error: error.message,
                        elapsed: Date.now() - startTime
                    });
                    
                    if (isMonitoring && !initialCheck) {
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                    }
                    initialCheck = false;
                }
            }
        };
        
        // Start monitoring in background (fire and forget)
        OutputLogger.info(`🚀 [MONITOR] Starting monitoring loop for export ${exportId.slice(-8)}`);
        OutputLogger.info(`📊 You should see progress updates every 30 seconds`);

        monitorLoop().catch(error => {
            OutputLogger.error(`💥 Critical monitoring error: ${error.message}`);
            OutputLogger.error(`💥 Stack trace: ${error.stack}`);
            monitor.emit('critical_error', { exportId, error: error.message });
        });

        OutputLogger.info(`✅ [MONITOR] Monitoring background process initiated`);
        
        // Store monitor reference for potential cleanup
        if (!this.activeMonitors) {
            this.activeMonitors = new Map();
        }
        this.activeMonitors.set(exportId, { monitor, stop: () => { isMonitoring = false; } });
        
        OutputLogger.success(`🚀 Background auto-download monitoring started for export: ${exportId}`);
        OutputLogger.debug(`⏰ Checking every 5 minutes, will auto-download when ready`);
        
        return monitorData;
    }

    /**
     * Get status of all active background monitors
     */
    static getActiveBackgroundMonitors() {
        const activeMonitors = [];
        for (const [exportId, monitorData] of DatabaseSimpleTools.backgroundMonitors.entries()) {
            if (monitorData.isMonitoring) {
                activeMonitors.push({
                    exportId,
                    environment: monitorData.environment,
                    databaseName: monitorData.databaseName,
                    startTime: monitorData.startTime,
                    elapsedMinutes: Math.round((Date.now() - monitorData.startTime) / (1000 * 60)),
                    downloadPath: monitorData.downloadPath
                });
            }
        }
        return activeMonitors;
    }

    /**
     * Stop background monitoring for a specific export
     */
    static stopBackgroundMonitoring(exportId) {
        const monitorData = DatabaseSimpleTools.backgroundMonitors.get(exportId);
        if (monitorData) {
            monitorData.stop();
            return true;
        }
        return false;
    }

    /**
     * Stop all background monitoring processes
     */
    static stopAllBackgroundMonitoring() {
        const stopped = [];
        for (const [exportId, monitorData] of DatabaseSimpleTools.backgroundMonitors.entries()) {
            monitorData.stop();
            stopped.push(exportId);
        }
        return stopped;
    }

    /**
     * Resume background monitoring for an export if it was interrupted
     * This enables recovery from manual monitoring cancellation
     */
    static resumeBackgroundMonitoring(exportId, projectConfig, environment, databaseName, downloadPath) {
        if (DatabaseSimpleTools.backgroundMonitors.has(exportId)) {
            OutputLogger.debug(`🔄 Background monitoring already active for export: ${exportId}`);
            return false; // Already monitoring
        }
        
        // Start fresh monitoring
        this.startBackgroundMonitoring(exportId, projectConfig, environment, databaseName, downloadPath);
        OutputLogger.success(`🔄 Resumed background monitoring for export: ${exportId}`);
        return true;
    }

    /**
     * Find an available recent backup that can be used instead of creating a new one
     * @param {Object} projectConfig - Project configuration
     * @param {string} targetEnv - Target environment
     * @param {string} dbName - Database name
     * @returns {Object|null} - Existing backup info or null if none suitable
     */
    static async findAvailableBackup(projectConfig, targetEnv, dbName) {
        try {
            OutputLogger.debug('🔍 Checking for recent completed backups...');
            
            // File recovery removed - using in-memory only
            const recentExports = this.backupHistory[projectConfig.name] || [];
            
            if (recentExports.length === 0) {
                OutputLogger.debug('No recent backups found in history');
                return null;
            }
            
            // Find ALL matching exports for the same environment and database (no time restriction)
            const matchingExports = recentExports.filter(exp => {
                // Check environment match (case-insensitive)
                const envMatch = exp.environment?.toLowerCase() === targetEnv.toLowerCase();
                
                // Check database match (case-insensitive)
                const dbMatch = exp.databaseName?.toLowerCase() === dbName.toLowerCase();
                
                // Check if export completed successfully
                const isComplete = exp.status === 'Completed' || exp.status === 'succeeded' || 
                                 exp.downloadLink || exp.downloadUrl;
                
                return envMatch && dbMatch && isComplete;
            });
            
            if (matchingExports.length === 0) {
                OutputLogger.debug('No matching backups found');
                return null;
            }

            OutputLogger.success(`✅ Found ${matchingExports.length} existing backup${matchingExports.length > 1 ? 's' : ''}`);

            // Return ALL matching backups
            return matchingExports;
            
        } catch (error) {
            OutputLogger.error(`Error checking for available backups: ${error.message}`);
            // Don't fail the whole operation if we can't check history
            return null;
        }
    }

    /**
     * Download an existing backup that was found
     */
    static async downloadExistingBackup(backupInfo, projectConfig, downloadPath, targetEnv, dbName) {
        const fs = require('fs').promises;
        const path = require('path');
        const https = require('https');
        
        try {
            // First check if we have a download URL
            const downloadUrl = backupInfo.downloadLink || backupInfo.downloadUrl;
            
            if (!downloadUrl) {
                // Try to get the download URL by checking status
                OutputLogger.debug('🔍 Fetching download URL for existing backup...');
                
                const statusResult = await this.internalCheckExportStatus({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    exportId: backupInfo.exportId,
                    environment: targetEnv,
                    databaseName: dbName,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret
                });
                
                if (!statusResult.isSuccess) {
                    throw new Error('Could not retrieve backup status');
                }
                
                // Extract download URL from status
                const status = this.parseExportStatus(statusResult);
                if (!status.downloadUrl) {
                    throw new Error('Backup does not have a download URL yet');
                }
                
                backupInfo.downloadUrl = status.downloadUrl;
            }
            
            // Ensure download directory exists
            await fs.mkdir(downloadPath, { recursive: true });
            
            // Generate filename
            const timestamp = new Date(backupInfo.startTime || backupInfo.completedAt)
                .toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const filename = `${projectConfig.name}-${targetEnv}-${dbName}-${timestamp}.bacpac`;
            const filePath = path.join(downloadPath, filename);
            
            OutputLogger.progress(`📥 Downloading existing backup to ${filePath}...`);
            
            // Download the file
            await this.downloadFile(backupInfo.downloadUrl || downloadUrl, filePath);
            
            OutputLogger.success(`✅ Successfully downloaded existing backup to: ${filePath}`);
            
            // Update backup info
            backupInfo.localPath = filePath;
            backupInfo.downloadedAt = new Date().toISOString();
            
            // Save updated state
            await this.saveBackupState({
                exportId: backupInfo.exportId,
                projectConfig,
                environment: targetEnv,
                databaseName: dbName,
                downloadPath,
                autoDownload: false,
                startTime: backupInfo.startTime || backupInfo.completedAt,
                status: 'downloaded',
                localPath: filePath
            });
            
            return filePath;
            
        } catch (error) {
            OutputLogger.error(`Failed to download existing backup: ${error.message}`);
            throw error;
        }
    }

    /**
     * Smart export conflict resolution
     * When an export is blocked by existing operation, intelligently handle based on database match
     */
    static async resolveExportConflict(targetEnv, targetDb, projectConfig, downloadPath) {
        try {
            OutputLogger.debug('🔍 Analyzing existing operations for intelligent conflict resolution...');
            
            // File recovery removed - using in-memory only
            const recentExports = this.backupHistory[projectConfig.name] || [];
            
            // Look for recent exports (within last 2 hours) that might be in progress
            const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
            const potentiallyActive = recentExports.filter(exp => {
                const startTime = new Date(exp.startTime).getTime();
                return startTime > twoHoursAgo;
            });

            // Check each potentially active export
            for (const exportInfo of potentiallyActive) {
                try {
                    const statusResult = await this.internalCheckExportStatus({
                        projectId: projectConfig.projectId,
                        projectName: projectConfig.name,
                        exportId: exportInfo.exportId,
                        environment: exportInfo.environment,
                        databaseName: exportInfo.databaseName,
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret
                    });

                    if (statusResult.isSuccess) {
                        const status = this.parseExportStatus(statusResult);
                        
                        if (!status.isComplete) {
                            // Found active export! Now determine resolution strategy
                            const sameDatabase = (exportInfo.environment === targetEnv && 
                                                exportInfo.databaseName === targetDb);
                                                
                            if (sameDatabase) {
                                // CASE 1: Same database export already running - switch to monitoring it
                                OutputLogger.success(`🎯 Found existing export for same database (${targetEnv} ${targetDb})`);
                                OutputLogger.debug(`🔄 Switching to monitor existing export: ${exportInfo.exportId}`);
                                
                                // Start monitoring the existing export
                                this.startBackgroundMonitoring(
                                    exportInfo.exportId, 
                                    projectConfig, 
                                    exportInfo.environment, 
                                    exportInfo.databaseName,
                                    downloadPath || await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, targetEnv)
                                );

                                const smartResponse = ResponseBuilder.success(
                                    `🎯 **Smart Resolution: Using Existing Export**\n\n` +
                                    `Found an active export for the same database (${targetEnv} ${targetDb}).\n\n` +
                                    `**Export ID:** ${exportInfo.exportId}\n` +
                                    `**Started:** ${new Date(exportInfo.startTime).toLocaleString()}\n` +
                                    `**Status:** In Progress\n\n` +
                                    `🔄 **Background Monitoring**: Switched to existing export\n` +
                                    `✅ **Auto-Download**: Will download to ${downloadPath || await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, targetEnv)} when ready\n` +
                                    `⏰ **Check Interval**: Every 5 minutes\n` +
                                    `📊 **Status**: Use \`check export status\` anytime\n\n` +
                                    `💡 **No new export needed** - this provides exactly what you requested!`
                                );

                                return { resolved: true, result: smartResponse };
                                
                            } else {
                                // CASE 2: Different database export running - queue this one
                                OutputLogger.debug(`⏳ Different database export running (${exportInfo.environment} ${exportInfo.databaseName})`);
                                OutputLogger.debug(`🔄 Will start ${targetEnv} ${targetDb} export when current export completes`);
                                
                                // Start monitoring the blocking export for completion
                                this.startQueuedExportMonitoring(
                                    exportInfo,
                                    { environment: targetEnv, databaseName: targetDb, projectConfig, downloadPath }
                                );

                                const queuedResponse = ResponseBuilder.success(
                                    `⏳ **Smart Queuing: Export Scheduled**\n\n` +
                                    `Another export is currently running:\n` +
                                    `• **Current:** ${exportInfo.environment} ${exportInfo.databaseName} (${exportInfo.exportId})\n` +
                                    `• **Started:** ${new Date(exportInfo.startTime).toLocaleString()}\n\n` +
                                    `**Your Request:** ${targetEnv} ${targetDb}\n` +
                                    `**Status:** Queued - will start automatically when current export completes\n\n` +
                                    `🔄 **Smart Monitoring**: Watching current export for completion\n` +
                                    `✅ **Auto-Start**: Your export will begin immediately after\n` +
                                    `📊 **Track Progress**: Use \`check export status\` to monitor both exports\n\n` +
                                    `💡 **Intelligent queuing** - no manual intervention needed!`
                                );

                                return { resolved: true, result: queuedResponse };
                            }
                        }
                    }
                } catch (error) {
                    // Export might have expired - continue checking others
                    OutputLogger.debug(`💡 Export ${exportInfo.exportId} is no longer active`);
                }
            }

            // No active exports found in our records - might be a different type of operation
            OutputLogger.debug('🔍 No matching exports found - conflict might be from deployment or other operation');
            return { resolved: false };
            
        } catch (error) {
            OutputLogger.error(`❌ Conflict resolution failed: ${error.message}`);
            return { resolved: false };
        }
    }

    /**
     * Start monitoring a blocking export and queue a new export to start when it completes
     */
    static startQueuedExportMonitoring(blockingExport, queuedExport) {
        const queueId = `${blockingExport.exportId}->${queuedExport.environment}-${queuedExport.databaseName}`;
        
        OutputLogger.debug(`🔄 Starting queued export monitoring: ${queueId}`);
        
        // Monitor the blocking export
        const monitorLoop = async () => {
            try {
                while (true) {
                    // Check if blocking export is complete
                    const statusResult = await this.internalCheckExportStatus({
                        projectId: queuedExport.projectConfig.projectId,
                        projectName: queuedExport.projectConfig.name,
                        exportId: blockingExport.exportId,
                        environment: blockingExport.environment,
                        databaseName: blockingExport.databaseName,
                        apiKey: queuedExport.projectConfig.apiKey,
                        apiSecret: queuedExport.projectConfig.apiSecret
                    });

                    if (statusResult.isSuccess) {
                        const status = this.parseExportStatus(statusResult);
                        
                        if (status.isComplete) {
                            OutputLogger.success(`✅ Blocking export completed! Starting queued export: ${queuedExport.environment} ${queuedExport.databaseName}`);
                            
                            // Start the queued export
                            try {
                                const queuedResult = await this.handleExportDatabase({
                                    environment: queuedExport.environment,
                                    databaseName: queuedExport.databaseName,
                                    downloadPath: queuedExport.downloadPath,
                                    project: queuedExport.projectConfig.name,
                                    // Pass through project config directly
                                    projectId: queuedExport.projectConfig.projectId,
                                    apiKey: queuedExport.projectConfig.apiKey,
                                    apiSecret: queuedExport.projectConfig.apiSecret
                                });
                                
                                OutputLogger.success(`🚀 Queued export started successfully!`);
                                
                            } catch (error) {
                                OutputLogger.error(`❌ Failed to start queued export: ${error.message}`);
                            }
                            
                            break; // Exit monitoring loop
                        }
                    }
                    
                    // Wait 2 minutes before checking again (more frequent than background monitoring)
                    await new Promise(resolve => setTimeout(resolve, 120000));
                }
                
            } catch (error) {
                OutputLogger.error(`❌ Queued export monitoring failed: ${error.message}`);
            }
        };
        
        // Start monitoring in background
        monitorLoop().catch(error => {
            OutputLogger.error(`💥 Critical queued monitoring error: ${error.message}`);
        });
        
        OutputLogger.success(`⏳ Queued export monitoring started - will auto-start when blocking export completes`);
    }

    /**
     * Auto-recovery mechanism - detect interrupted exports and offer to resume monitoring
     * This runs automatically when checking export status or listing exports
     */
    static async detectAndOfferRecovery(projectConfig) {
        try {
            // File recovery removed - using in-memory only
            const recentExports = this.backupHistory[projectConfig.name] || [];
            
            // Find exports that might still be in progress (started within last 2 hours)
            const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
            const potentiallyActiveExports = recentExports.filter(exp => {
                const startTime = new Date(exp.startTime).getTime();
                return startTime > twoHoursAgo && !DatabaseSimpleTools.backgroundMonitors.has(exp.exportId);
            });

            if (potentiallyActiveExports.length > 0) {
                OutputLogger.debug(`🔍 Found ${potentiallyActiveExports.length} potentially active export(s) that lost monitoring`);
                
                // For each potentially active export, check if it's still in progress
                for (const exportInfo of potentiallyActiveExports) {
                    try {
                        // Quick status check to see if export is still active
                            const statusResult = await this.internalCheckExportStatus({
                            projectId: projectConfig.projectId,
                            projectName: projectConfig.name,
                            exportId: exportInfo.exportId,
                            environment: exportInfo.environment,
                            databaseName: exportInfo.databaseName,
                            apiKey: projectConfig.apiKey,
                            apiSecret: projectConfig.apiSecret
                        });

                        if (statusResult.isSuccess) {
                            const status = this.parseExportStatus(statusResult);
                            
                            if (!status.isComplete) {
                                // Export is still in progress - offer to resume monitoring
                                const downloadPath = exportInfo.downloadPath || await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, targetEnv);
                                
                                OutputLogger.success(`🔄 Auto-resuming monitoring for in-progress export: ${exportInfo.exportId}`);
                                this.startBackgroundMonitoring(
                                    exportInfo.exportId,
                                    projectConfig,
                                    exportInfo.environment,
                                    exportInfo.databaseName,
                                    downloadPath
                                );
                            }
                        }
                    } catch (error) {
                        // Export might have expired or failed - that's ok, continue
                        OutputLogger.debug(`💡 Export ${exportInfo.exportId} is no longer active (this is normal)`);
                    }
                }
            }
            
        } catch (error) {
            OutputLogger.error(`❌ Auto-recovery failed: ${error.message}`);
            // Don't throw - recovery is optional
        }
    }
    
    /**
     * Stop background monitoring for a specific export
     */
    static stopBackgroundMonitoring(exportId) {
        if (this.activeMonitors && this.activeMonitors.has(exportId)) {
            const monitor = this.activeMonitors.get(exportId);
            monitor.stop();
            this.activeMonitors.delete(exportId);
            
            const OutputLogger = require('../output-logger');
            OutputLogger.debug(`🛑 Stopped background monitoring for export: ${exportId}`);
            return true;
        }
        return false;
    }
    
    /**
     * Get active background monitors
     */
    static getActiveMonitors() {
        if (!this.activeMonitors) {
            return [];
        }
        return Array.from(this.activeMonitors.keys());
    }
    /**
     * Download a completed database export
     * Simple, focused tool - just downloads an export that's ready
     */
    static async handleDownloadDatabaseExport(args) {
        try {
            const {
                exportId,
                environment,
                downloadUrl,
                background,
                monitor,
                project,
                projectName,
                projectId,
                apiKey,
                apiSecret,
                downloadPath,
                skipConfirmation
            } = args;

            // If downloadUrl is provided, use direct download (no API check)
            if (downloadUrl) {
                // Get project configuration for paths (but don't validate credentials)
                const projectConfig = await this.getProjectConfig(
                    project || projectName,
                    {
                        ...args,
                        projectId: projectId || args.projectId,
                        apiKey: apiKey || args.apiKey,
                        apiSecret: apiSecret || args.apiSecret
                    },
                    true // allowMissingCredentials - we don't need them for direct download
                );

                // Determine download path
                const finalDownloadPath = downloadPath ||
                    await DownloadConfig.getDownloadPath('database', projectConfig?.name || 'default', null, environment || 'Production');

                // Check if background mode requested (default to true for large files)
                const useBackground = background !== false; // Default to true

                if (useBackground) {
                    // Background download mode - return immediately with download ID
                    const fs = require('fs');
                    const path = require('path');

                    // Extract filename from URL (same logic as sync download)
                    let filename;
                    const urlMatch = downloadUrl.match(/([^/]+\.bacpac)/i);
                    if (urlMatch) {
                        filename = urlMatch[1];
                    } else {
                        // Fallback to manual construction only if URL doesn't contain filename
                        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '').split('.')[0];
                        filename = `${projectConfig?.name || 'export'}.${environment || 'Production'}.epicms.sqldb.${timestamp}.bacpac`;
                    }
                    const filepath = path.join(finalDownloadPath, filename);

                    // Create download tracking entry
                    const downloadId = this.createDownload('database', {
                        project: projectConfig?.name || 'export',
                        environment: environment || 'Production',
                        database: 'epicms',
                        exportId: exportId || 'direct',
                        filename: filename
                    });

                    // Start background download
                    await this.startBackgroundDownloadFromUrl(downloadId, downloadUrl, filepath);

                    // Build full file path for display
                    const fullPath = path.join(finalDownloadPath, filename);

                    // Return immediately with download ID
                    // DXP-66: Add structured data
                    let downloadMessage = `📥 **Download Started**\n\n` +
                        `**Downloading to**: ${fullPath}\n` +
                        `**Type**: Database Export\n\n`;

                    // Add monitoring instructions if monitor=true
                    if (monitor) {
                        downloadMessage += `**🤖 AI: Immediately call check_download_status to monitor:**\n` +
                            `\`\`\`\ncheck_download_status downloadId: "${downloadId}" waitBeforeCheck: 30 monitor: true\n\`\`\`\n` +
                            `Keep calling check_download_status until download completes.\n\n`;
                    } else {
                        downloadMessage += `✅ Use \`check_download_status\` to check progress if needed:\n` +
                            `\`\`\`\ncheck_download_status downloadId: "${downloadId}"\n\`\`\`\n\n`;
                    }

                    downloadMessage += `_Download ID: ${downloadId}_`;

                    return ResponseBuilder.successWithStructuredData({
                        downloadId: downloadId,
                        downloadPath: fullPath,
                        type: 'database_export',
                        status: 'downloading',
                        downloadUrl: downloadUrl.substring(0, 100),
                        monitor: monitor || false
                    }, downloadMessage);
                }

                // Synchronous download mode (for backward compatibility or small files)
                const downloadResult = await this.downloadFromUrl(
                    downloadUrl,
                    finalDownloadPath,
                    projectConfig?.name || 'export',
                    environment || 'Production',
                    'epicms', // Default database name
                    skipConfirmation || false
                );

                // If confirmation required, return the confirmation message
                if (downloadResult.requiresConfirmation) {
                    return ResponseBuilder.success(downloadResult.message);
                }

                // Download complete!
                // DXP-66: Add structured data
                return ResponseBuilder.successWithStructuredData({
                    filepath: downloadResult.filepath,
                    fileSize: downloadResult.fileSize,
                    downloadUrl: downloadUrl.substring(0, 100),
                    type: 'database_export',
                    status: 'completed'
                },
                    `✅ **Database Export Downloaded**\n\n` +
                    `**Download URL**: ${downloadUrl.substring(0, 80)}...\n` +
                    `**File**: ${downloadResult.filepath}\n` +
                    `**Size**: ${downloadResult.fileSize}\n\n` +
                    `💡 Your backup is ready to use!`
                );
            }

            // Original flow: use exportId and environment to check status first
            // Validate required parameters
            if (!exportId || !environment) {
                return ResponseBuilder.invalidParams('Either provide downloadUrl OR both exportId and environment');
            }

            // Get project configuration
            console.error('[db_export_download] Getting project config...');
            console.error('[db_export_download] Args keys:', Object.keys(args));
            const projectConfig = await this.getProjectConfig(
                project || projectName,
                {
                    ...args,
                    projectId: projectId || args.projectId,
                    apiKey: apiKey || args.apiKey,
                    apiSecret: apiSecret || args.apiSecret
                }
            );
            console.error('[db_export_download] Got project config:', {
                name: projectConfig.name,
                projectId: projectConfig.projectId,
                hasApiKey: !!projectConfig.apiKey,
                hasApiSecret: !!projectConfig.apiSecret
            });

            // Check export status with retry for transient errors
            let result;
            let retries = 3;
            for (let attempt = 1; attempt <= retries; attempt++) {
                result = await this.internalCheckExportStatus({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    exportId: exportId,
                    environment: environment,
                    databaseName: 'epicms', // Will be determined from status
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret
                });

                if (result.isSuccess) {
                    break; // Success, exit retry loop
                }

                if (attempt < retries) {
                    // Wait before retrying (exponential backoff)
                    const waitMs = attempt * 2000; // 2s, 4s
                    OutputLogger.debug(`Status check failed (attempt ${attempt}/${retries}), retrying in ${waitMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitMs));
                }
            }

            if (!result.isSuccess) {
                return ResponseBuilder.error(
                    `Could not check export status after ${retries} attempts.\n\n` +
                    `**Workaround**: Use db_export_download with the downloadUrl parameter instead:\n` +
                    `\`db_export_download downloadUrl: "<url>" skipConfirmation: true\`\n\n` +
                    `Error: ${result.error || 'Unknown error'}`
                );
            }

            const status = this.parseExportStatus(result);

            console.error('[db_export_download] Parsed status from exportId/environment path:', {
                isComplete: status.isComplete,
                status: status.status,
                hasDownloadUrl: !!status.downloadUrl,
                downloadUrlLength: status.downloadUrl ? status.downloadUrl.length : 0,
                downloadUrlStart: status.downloadUrl ? status.downloadUrl.substring(0, 80) : 'null',
                downloadUrlEnd: status.downloadUrl ? status.downloadUrl.substring(status.downloadUrl.length - 50) : 'null'
            });

            // Must be complete to download
            if (!status.isComplete) {
                return ResponseBuilder.error(
                    `Export is not complete yet. Status: ${status.status}\n\n` +
                    `Use db_export_status to monitor progress.`
                );
            }

            // Must have download link
            if (!status.downloadUrl) {
                return ResponseBuilder.error('Export is complete but download link is not available');
            }

            // Determine download path
            const finalDownloadPath = downloadPath ||
                await DownloadConfig.getDownloadPath('database', projectConfig.name, null, environment);

            // Parse export details from the result data
            let databaseName = 'epicms';
            try {
                const exportData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
                databaseName = exportData.databaseDisplayName || exportData.databaseName || 'epicms';
            } catch (e) {
                // Use default if parsing fails
            }

            // Download with confirmation (respects skipConfirmation parameter)
            console.error('[db_export_download] About to call downloadFromUrl with:', {
                downloadUrlLength: status.downloadUrl.length,
                downloadUrlStart: status.downloadUrl.substring(0, 80),
                downloadUrlEnd: status.downloadUrl.substring(status.downloadUrl.length - 80),
                downloadPath: finalDownloadPath,
                skipConfirmation: skipConfirmation || false
            });

            const downloadResult = await this.downloadFromUrl(
                status.downloadUrl,
                finalDownloadPath,
                projectConfig.name,
                environment,
                databaseName,
                skipConfirmation || false
            );

            // If confirmation required, return the confirmation message
            if (downloadResult.requiresConfirmation) {
                return ResponseBuilder.success(downloadResult.message);
            }

            // Download complete!
            // DXP-66: Add structured data
            return ResponseBuilder.successWithStructuredData({
                exportId: exportId,
                environment: environment,
                databaseName: databaseName,
                filepath: downloadResult.filepath,
                fileSize: downloadResult.fileSize,
                type: 'database_export',
                status: 'completed'
            },
                `✅ **Database Export Downloaded**\n\n` +
                `**Export ID**: ${exportId}\n` +
                `**Environment**: ${environment}\n` +
                `**Database**: ${databaseName}\n` +
                `**File**: ${downloadResult.filepath}\n` +
                `**Size**: ${downloadResult.fileSize}\n\n` +
                `💡 Your backup is ready to use!`
            );

        } catch (error) {
            console.error('[db_export_download] CAUGHT ERROR:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            return ErrorHandler.handleError(error, 'download-database-export', args);
        }
    }
}

module.exports = DatabaseSimpleTools;
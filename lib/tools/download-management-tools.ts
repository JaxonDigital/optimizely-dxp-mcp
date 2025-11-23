/**
 * Download Management Tools
 * Handles listing, cancelling, and monitoring active downloads
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import downloadManager from '../download-manager';
import ResponseBuilder from '../response-builder';
import OutputLogger from '../output-logger';

/**
 * Download list arguments (DXP-82)
 */
interface DownloadListArgs {
    status?: 'active' | 'completed' | 'failed' | 'all';
    type?: 'logs' | 'database' | 'all';
    limit?: number;
    offset?: number;
}

/**
 * Download cancel arguments
 */
interface DownloadCancelArgs {
    downloadId?: string;
}

/**
 * Download status arguments
 */
interface DownloadStatusArgs {
    downloadId: string;
    monitor?: boolean;
}

/**
 * Log download structure
 */
interface LogDownload {
    key: string;
    status: string;
    progress: number;
    startTime: number;
    endTime?: number;
    containerName: string;
    projectName: string;
    environment: string;
    dateRange?: string;
    pid?: number;
    error?: string;
}

/**
 * Database download structure
 */
interface DatabaseDownload {
    downloadId: string;
    status: string;
    percent?: number;
    startTime: number;
    endTime?: number;
    bytesDownloaded?: number;
    totalBytes?: number;
    filePath?: string;
    error?: string;
}

/**
 * Unified download format
 */
interface UnifiedDownload {
    downloadId: string;
    type: 'logs' | 'database';
    status: string;
    progress: number;
    startTime: number;
    endTime: number | null;
    elapsedMs: number;
    containerName?: string;
    projectName?: string;
    environment?: string;
    dateRange?: string;
    pid?: number | null;
    bytesDownloaded?: number;
    totalBytes?: number;
    filePath?: string | null;
    error?: string | null;
}

/**
 * Live progress structure (DXP-3)
 */
interface LiveProgress {
    totalFiles: number;
    filesDownloaded: number;
    percentage: number;
    bytesDownloaded: number;
    totalBytes: number;
    speed: number;
    eta?: number;
    currentFile?: string;
}

/**
 * Cancel result
 */
interface CancelResult {
    success: boolean;
    download?: any;
    error?: string;
}

/**
 * Skipped download (database)
 */
interface SkippedDownload {
    downloadId: string;
    type: string;
    reason: string;
}

/**
 * Failed cancel
 */
interface FailedCancel {
    downloadId: string;
    reason: string;
}

class DownloadManagementTools {
    /**
     * List downloads with flexible filtering (DXP-82)
     * Consolidates list_active_downloads and download_history
     */
    static async handleDownloadList(args: DownloadListArgs): Promise<any> {
        try {
            const { status = 'active', type = 'all', limit = 10, offset = 0 } = args;

            // Validate parameters
            const validStatuses = ['active', 'completed', 'failed', 'all'];
            if (!validStatuses.includes(status)) {
                return ResponseBuilder.invalidParams(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
            }

            const validTypes = ['logs', 'database', 'all'];
            if (!validTypes.includes(type)) {
                return ResponseBuilder.invalidParams(`Invalid type: ${type}. Must be one of: ${validTypes.join(', ')}`);
            }

            if (limit < 0 || limit > 100) {
                return ResponseBuilder.invalidParams(`Invalid limit: ${limit}. Must be between 0 and 100`);
            }

            if (offset < 0) {
                return ResponseBuilder.invalidParams(`Invalid offset: ${offset}. Must be >= 0`);
            }

            // Get downloads from both systems
            // DXP-178 FIX: Need .default for ES module default export
            const DatabaseSimpleTools = require('./database-simple-tools').default;

            // Get log downloads
            const logDownloads = status === 'active'
                ? downloadManager.getActiveDownloads()
                : downloadManager.getHistory(1000); // Get all history for filtering

            // Get database downloads
            // DXP-177: Add null check to prevent "Cannot read properties of undefined (reading 'entries')" error
            const dbDownloadsArray = DatabaseSimpleTools.backgroundDownloads
                ? Array.from(DatabaseSimpleTools.backgroundDownloads.entries() as IterableIterator<[string, any]>)
                    .map(([downloadId, download]) => ({ ...download, downloadId }))
                : [];

            // Apply status filter
            const filteredLogDownloads = this._filterByStatus(logDownloads, status);
            const filteredDbDownloads = this._filterByStatus(dbDownloadsArray, status);

            // Apply type filter
            let allDownloads: UnifiedDownload[] = [];
            if (type === 'all' || type === 'logs') {
                allDownloads.push(...filteredLogDownloads.map(d => this._formatLogDownload(d)));
            }
            if (type === 'all' || type === 'database') {
                allDownloads.push(...filteredDbDownloads.map(d => this._formatDatabaseDownload(d)));
            }

            // Sort by startTime (most recent first)
            allDownloads.sort((a, b) => b.startTime - a.startTime);

            // Apply pagination (only for non-active status)
            let paginatedDownloads = allDownloads;
            let hasMore = false;
            if (status !== 'active' && limit > 0) {
                paginatedDownloads = allDownloads.slice(offset, offset + limit);
                hasMore = allDownloads.length > offset + limit;
            }

            // Build message
            const message = this._buildDownloadListMessage(paginatedDownloads, status, type, hasMore, offset, limit);

            // Build structured data
            const structuredData = {
                downloads: paginatedDownloads,
                totalCount: paginatedDownloads.length,
                hasMore: hasMore
            };

            return ResponseBuilder.successWithStructuredData(structuredData, message);

        } catch (error: any) {
            OutputLogger.error(`Download list error: ${error}`);
            return ResponseBuilder.internalError('Failed to list downloads', error.message);
        }
    }

    /**
     * Filter downloads by status
     * @private
     */
    static _filterByStatus(downloads: any[], status: string): any[] {
        const statusMap: Record<string, string[] | null> = {
            'active': ['starting', 'running', 'pending', 'in_progress'],
            'completed': ['completed', 'complete'],
            'failed': ['failed', 'cancelled', 'error'],
            'all': null
        };

        const validStatuses = statusMap[status];
        if (!validStatuses) return downloads; // Show all

        return downloads.filter((d: any) => validStatuses.includes(d.status));
    }

    /**
     * Format log download for unified response
     * @private
     */
    static _formatLogDownload(download: LogDownload): UnifiedDownload {
        return {
            downloadId: download.key,
            type: 'logs',
            status: download.status,
            progress: download.progress,
            startTime: download.startTime,
            endTime: download.endTime || null,
            elapsedMs: Date.now() - download.startTime,
            containerName: download.containerName,
            projectName: download.projectName,
            environment: download.environment,
            dateRange: download.dateRange || 'all-time',
            pid: download.pid || null,
            error: download.error || null
        };
    }

    /**
     * Format database download for unified response
     * @private
     */
    static _formatDatabaseDownload(download: DatabaseDownload): UnifiedDownload {
        return {
            downloadId: download.downloadId,
            type: 'database',
            status: download.status,
            progress: download.percent || 0,
            startTime: download.startTime,
            endTime: download.endTime || null,
            elapsedMs: Date.now() - download.startTime,
            bytesDownloaded: download.bytesDownloaded || 0,
            totalBytes: download.totalBytes || 0,
            filePath: download.filePath || null,
            error: download.error || null
        };
    }

    /**
     * Build human-readable message for download list
     * @private
     */
    static _buildDownloadListMessage(
        downloads: UnifiedDownload[],
        status: string,
        _type: string,
        hasMore: boolean,
        offset: number,
        limit: number
    ): string {
        if (downloads.length === 0) {
            const statusLabel = status === 'active' ? 'active' : status;
            return `📭 No ${statusLabel} downloads found.`;
        }

        const statusEmoji: Record<string, string> = {
            'active': '📥',
            'completed': '📜',
            'failed': '📜',
            'all': '📜'
        };

        const emoji = statusEmoji[status] || '📥';
        const statusLabel = status === 'active' ? 'Active Downloads' : 'Download History';
        let message = `# ${emoji} ${statusLabel} (${downloads.length})\n\n`;

        for (const download of downloads) {
            if (download.type === 'database') {
                message += this._formatDatabaseDownloadMessage(download);
            } else {
                message += this._formatLogDownloadMessage(download);
            }
        }

        // Add action suggestions
        message += `\n**Actions:**\n`;
        message += `• View details: \`download_status({ downloadId: "<download-id>" })\`\n`;

        if (status === 'active') {
            message += `• Monitor progress: \`download_status({ downloadId: "<download-id>", monitor: true })\`\n`;
            message += `• Cancel download: \`download_cancel({ downloadId: "<download-id>" })\`\n`;
            message += `• Cancel all: \`download_cancel()\`\n`;
            message += `• View history: \`download_list({ status: "all" })\`\n`;
        } else {
            message += `• View active: \`download_list({ status: "active" })\`\n`;
        }

        // Add pagination info
        if (hasMore) {
            const nextOffset = offset + limit;
            message += `\n**Pagination:**\n`;
            message += `• Next page: \`download_list({ status: "${status}", limit: ${limit}, offset: ${nextOffset} })\`\n`;
        }

        return message;
    }

    /**
     * Format database download message
     * @private
     */
    static _formatDatabaseDownloadMessage(download: UnifiedDownload): string {
        const elapsed = download.elapsedMs;
        const elapsedMinutes = Math.floor(elapsed / 60000);
        const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

        const statusEmoji: Record<string, string> = {
            'pending': '⏳',
            'in_progress': '⏳',
            'complete': '✅',
            'error': '❌'
        };

        const emoji = statusEmoji[download.status] || '📦';

        let message = `## ${emoji} Database Export\n`;
        message += `• **Download ID**: \`${download.downloadId}\`\n`;
        message += `• **Status**: ${download.status}\n`;
        message += `• **Progress**: ${download.progress}%\n`;

        if (download.bytesDownloaded && download.totalBytes) {
            const downloadedMB = (download.bytesDownloaded / (1024 * 1024)).toFixed(2);
            const totalMB = (download.totalBytes / (1024 * 1024)).toFixed(2);
            message += `• **Downloaded**: ${downloadedMB} MB / ${totalMB} MB\n`;
        }

        if (download.status === 'in_progress' || download.status === 'pending') {
            message += `• **Running**: ${elapsedMinutes}m ${elapsedSeconds}s\n`;
        } else if (download.endTime) {
            const duration = Math.floor((download.endTime - download.startTime) / 60000);
            message += `• **Duration**: ${duration} minutes\n`;
        }

        if (download.filePath) {
            message += `• **File**: ${download.filePath}\n`;
        }

        if (download.error) {
            message += `• **Error**: ${download.error}\n`;
        }

        message += `\n`;
        return message;
    }

    /**
     * Format log download message
     * @private
     */
    static _formatLogDownloadMessage(download: UnifiedDownload): string {
        const elapsed = download.elapsedMs;
        const elapsedMinutes = Math.floor(elapsed / 60000);
        const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

        const statusEmoji: Record<string, string> = {
            'starting': '⏳',
            'running': '⏳',
            'completed': '✅',
            'cancelled': '❌',
            'failed': '💥'
        };

        const emoji = statusEmoji[download.status] || '🔄';

        let message = `## ${emoji} ${download.containerName} logs\n`;
        message += `• **Download ID**: \`${download.downloadId}\`\n`;
        message += `• **Project**: ${download.projectName} (${download.environment})\n`;
        message += `• **Status**: ${download.status}\n`;
        message += `• **Progress**: ${download.progress}%\n`;

        if (download.status === 'running' || download.status === 'starting') {
            message += `• **Running**: ${elapsedMinutes}m ${elapsedSeconds}s\n`;
        } else if (download.endTime) {
            const duration = Math.floor((download.endTime - download.startTime) / 60000);
            message += `• **Duration**: ${duration} minutes\n`;
        }

        if (download.dateRange && download.dateRange !== 'all-time') {
            message += `• **Date Range**: ${download.dateRange}\n`;
        }

        if (download.error) {
            message += `• **Error**: ${download.error}\n`;
        }

        message += `\n`;
        return message;
    }

    /**
     * Cancel one or all downloads (DXP-82)
     * Consolidates cancel_download and cancel_all_downloads
     */
    static async handleDownloadCancel(args?: DownloadCancelArgs): Promise<any> {
        const { downloadId } = args || {};

        try {
            // Cancel specific download
            if (downloadId) {
                return await this._cancelSingleDownload(downloadId);
            }

            // Cancel all downloads
            return await this._cancelAllDownloads();

        } catch (error: any) {
            OutputLogger.error(`Cancel download error: ${error}`);
            return ResponseBuilder.internalError('Failed to cancel download(s)', error.message);
        }
    }

    /**
     * Cancel a single download
     * @private
     */
    static async _cancelSingleDownload(downloadId: string): Promise<any> {
        // Check if it's a database download
        // DXP-178 FIX: Need .default for ES module default export
        const DatabaseSimpleTools = require('./database-simple-tools').default;
        // DXP-178 FIX: Use .backgroundDownloads.get() instead of non-existent .getDownloadStatus()
        const dbDownload = DatabaseSimpleTools.backgroundDownloads.get(downloadId);

        if (dbDownload) {
            return ResponseBuilder.error(
                `❌ **Cannot Cancel Database Download**\n\n` +
                `Database downloads use Azure Blob streaming and cannot be interrupted. ` +
                `The download will complete in the background.\n\n` +
                `**Download ID**: ${downloadId}\n` +
                `**Progress**: ${dbDownload.percent || 0}%\n\n` +
                `**Monitor progress:** \`download_status({ downloadId: "${downloadId}" })\``
            );
        }

        // Check if it's a log download
        const logDownload = downloadManager.getDownload(downloadId);
        if (!logDownload) {
            return ResponseBuilder.error(
                `Download ${downloadId} not found.\n\n` +
                `**View active downloads:** \`download_list({ status: "active" })\``
            );
        }

        // Cancel the log download
        const result: CancelResult = downloadManager.cancelDownload(downloadId);

        if (result.success) {
            const download = result.download;
            const elapsed = Math.floor((Date.now() - download.startTime) / 60000);

            const structuredData = {
                cancelled: [downloadId],
                skipped: [],
                failed: []
            };

            const message = `❌ **Download Cancelled**\n\n` +
                `**Download**: ${download.containerName} logs\n` +
                `**Runtime**: ${elapsed} minutes\n` +
                `**Progress**: ${download.progress}%\n\n` +
                `Partially downloaded files have been preserved.`;

            return ResponseBuilder.successWithStructuredData(structuredData, message);
        } else {
            return ResponseBuilder.error(`Failed to cancel: ${result.error}`);
        }
    }

    /**
     * Cancel all active downloads
     * @private
     */
    static async _cancelAllDownloads(): Promise<any> {
        const logResults: CancelResult[] = downloadManager.cancelAllDownloads();

        // Find database downloads that can't be cancelled
        // DXP-178 FIX: Need .default for ES module default export
        const DatabaseSimpleTools = require('./database-simple-tools').default;
        const dbDownloads: SkippedDownload[] = [];
        for (const [id, download] of DatabaseSimpleTools.backgroundDownloads.entries()) {
            if (download.status === 'in_progress' || download.status === 'pending') {
                dbDownloads.push({
                    downloadId: id,
                    type: 'database',
                    reason: 'Database downloads cannot be cancelled'
                });
            }
        }

        const cancelled = logResults.filter(r => r.success).map(r => r.download!.key);
        const failed: FailedCancel[] = logResults.filter(r => !r.success).map(r => ({
            downloadId: r.download?.key || 'unknown',
            reason: r.error || 'Unknown error'
        }));

        if (cancelled.length === 0 && dbDownloads.length === 0 && failed.length === 0) {
            return ResponseBuilder.success('📭 No active downloads to cancel.');
        }

        let message = `❌ **Cancel All Downloads**\n\n`;

        if (cancelled.length > 0) {
            message += `**Cancelled log downloads** (${cancelled.length}):\n`;
            for (const id of cancelled) {
                message += `• ${id}\n`;
            }
            message += `\n`;
        }

        if (dbDownloads.length > 0) {
            message += `**Database downloads continuing** (${dbDownloads.length}):\n`;
            message += `These downloads cannot be cancelled and will complete in background.\n`;
            for (const db of dbDownloads) {
                message += `• ${db.downloadId}\n`;
            }
            message += `\n`;
        }

        if (failed.length > 0) {
            message += `**Failed to cancel** (${failed.length}):\n`;
            for (const f of failed) {
                message += `• ${f.downloadId}: ${f.reason}\n`;
            }
            message += `\n`;
        }

        const structuredData = {
            cancelled: cancelled,
            skipped: dbDownloads,
            failed: failed
        };

        return ResponseBuilder.successWithStructuredData(structuredData, message);
    }

    /**
     * Get download status for a specific download (DXP-82)
     * Checks both log downloads (downloadManager) and database exports (DatabaseSimpleTools)
     */
    static async handleDownloadStatus(args: DownloadStatusArgs): Promise<any> {
        if (!args.downloadId) {
            return ResponseBuilder.invalidParams('downloadId is required.');
        }

        // DXP-3: Check if auto-monitoring is enabled
        const shouldMonitor = args.monitor === true;

        try {
            // DXP-3: If monitoring enabled, poll until complete
            if (shouldMonitor) {
                return await this.monitorDownloadProgress(args.downloadId);
            }

            // First check log download system (active + history)
            let download = downloadManager.getDownloadOrHistory(args.downloadId);

            // If not found, check database export system
            if (!download) {
                const DatabaseSimpleTools = require('./database-simple-tools');
                // DXP-178 FIX: Use .backgroundDownloads.get() instead of non-existent .getDownloadStatus()
                download = DatabaseSimpleTools.backgroundDownloads.get(args.downloadId);

                // If found in database system, return database-specific status
                if (download) {
                    return this._formatDatabaseStatusResponse(download, args.downloadId);
                }

                // Not found in either system
                return ResponseBuilder.error(
                    `Download ${args.downloadId} not found.\n\n` +
                    `**View active downloads:** \`download_list({ status: "active" })\`\n` +
                    `**View recent history:** \`download_list({ status: "all" })\``
                );
            }

            // DXP-3: Get live progress from ProgressMonitor if available
            const liveProgress: LiveProgress | null = downloadManager.getLiveProgress(args.downloadId) as LiveProgress | null;

            // Format log download status
            const elapsed = Date.now() - download.startTime;
            const elapsedMinutes = Math.floor(elapsed / 60000);
            const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

            let message = `# 📊 Download Status\n\n`;
            message += `**ID**: ${download.key}\n`;
            message += `**Type**: ${download.containerName} logs\n`;
            message += `**Project**: ${download.projectName} (${download.environment})\n`;
            message += `**Status**: ${download.status}\n`;

            // DXP-3: Show detailed progress if ProgressMonitor is available
            if (liveProgress && liveProgress.totalFiles) {
                message += `**Progress**: ${liveProgress.percentage}% (${liveProgress.filesDownloaded}/${liveProgress.totalFiles} files)\n`;

                if (liveProgress.bytesDownloaded > 0) {
                    const formatBytes = (bytes: number): string => {
                        if (bytes === 0) return '0 B';
                        const k = 1024;
                        const sizes = ['B', 'KB', 'MB', 'GB'];
                        const i = Math.floor(Math.log(bytes) / Math.log(k));
                        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                    };

                    message += `**Downloaded**: ${formatBytes(liveProgress.bytesDownloaded)}`;
                    if (liveProgress.totalBytes > 0) {
                        message += ` / ${formatBytes(liveProgress.totalBytes)}`;
                    }
                    message += `\n`;

                    if (liveProgress.speed > 0) {
                        message += `**Speed**: ${formatBytes(liveProgress.speed)}/s\n`;

                        if (liveProgress.eta && liveProgress.eta > 0) {
                            const etaMinutes = Math.floor(liveProgress.eta / 60);
                            const etaSeconds = Math.round(liveProgress.eta % 60);
                            message += `**ETA**: ${etaMinutes}m ${etaSeconds}s\n`;
                        }
                    }
                }

                if (liveProgress.currentFile) {
                    const displayFile = liveProgress.currentFile.length > 60
                        ? '...' + liveProgress.currentFile.substring(liveProgress.currentFile.length - 57)
                        : liveProgress.currentFile;
                    message += `**Current File**: ${displayFile}\n`;
                }
            } else {
                message += `**Progress**: ${download.progress}%\n`;
            }

            message += `**Runtime**: ${elapsedMinutes}m ${elapsedSeconds}s\n`;

            if (download.dateRange && download.dateRange !== 'all-time') {
                message += `**Date Range**: ${download.dateRange}\n`;
            }

            if (download.pid) {
                message += `**Process ID**: ${download.pid}\n`;
            }

            // DXP-190: Show download path if completed
            if (download.status === 'completed' && download.result && download.result.downloadPath) {
                message += `\n📁 **Files Location:**\n`;
                message += `\`\`\`\n${download.result.downloadPath}\n\`\`\`\n`;
                if (download.result.actualFilesOnDisk !== undefined) {
                    message += `✅ Verified ${download.result.actualFilesOnDisk} files on disk\n`;
                }
            }

            // Show error if download failed
            if (download.error) {
                message += `\n**❌ Error**: ${download.error}\n`;
            }

            message += `\n**Actions**:\n`;
            if (download.status === 'failed') {
                message += `• Retry: Start a new download with same parameters\n`;
                message += `• Debug: Set DEBUG=true environment variable for detailed logs\n`;
            } else {
                message += `• Cancel: \`download_cancel({ downloadId: "${download.key}" })\`\n`;
            }
            message += `• View all: \`download_list({ status: "active" })\`\n`;

            // DXP-3: Add structured data with live progress
            const structuredData: any = {
                downloadId: download.key,
                type: 'logs',
                containerName: download.containerName,
                projectName: download.projectName,
                environment: download.environment,
                status: download.status,
                progress: download.progress,
                dateRange: download.dateRange || 'all-time',
                elapsedMs: elapsed,
                pid: download.pid || null
            };

            // DXP-190: Include download path and verified file count if completed
            if (download.status === 'completed' && download.result) {
                if (download.result.downloadPath) {
                    structuredData.downloadPath = download.result.downloadPath;
                }
                if (download.result.actualFilesOnDisk !== undefined) {
                    structuredData.actualFilesOnDisk = download.result.actualFilesOnDisk;
                }
            }

            // Include live progress data if available
            if (liveProgress && liveProgress.totalFiles) {
                structuredData.liveProgress = liveProgress;
            }

            return ResponseBuilder.successWithStructuredData(structuredData, message);

        } catch (error: any) {
            OutputLogger.error(`Get download status error: ${error}`);
            return ResponseBuilder.internalError('Failed to get download status', error.message);
        }
    }

    /**
     * Format database export download status message
     * @private
     */
    static _formatDatabaseStatusResponse(download: any, downloadId: string): any {
        const elapsed = Date.now() - download.startTime;
        const elapsedMinutes = Math.floor(elapsed / 60000);
        const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

        let message = `# 📊 Database Export Download Status\n\n`;
        message += `**ID**: ${downloadId}\n`;
        message += `**Type**: Database Export\n`;
        message += `**Status**: ${download.status}\n`;

        if (download.percent !== undefined) {
            message += `**Progress**: ${download.percent}%\n`;
        }

        if (download.bytesDownloaded && download.totalBytes) {
            const downloadedMB = (download.bytesDownloaded / (1024 * 1024)).toFixed(2);
            const totalMB = (download.totalBytes / (1024 * 1024)).toFixed(2);
            message += `**Downloaded**: ${downloadedMB} MB / ${totalMB} MB\n`;
        }

        message += `**Runtime**: ${elapsedMinutes}m ${elapsedSeconds}s\n`;

        if (download.filePath) {
            message += `**File Path**: ${download.filePath}\n`;
        }

        if (download.error) {
            message += `**Error**: ${download.error}\n`;
        }

        message += `\n**Actions**:\n`;
        message += `• Check again: \`download_status({ downloadId: "${downloadId}" })\`\n`;
        message += `• View all: \`download_list({ status: "active" })\`\n`;

        return ResponseBuilder.successWithStructuredData({
            downloadId: downloadId,
            type: 'database_export',
            status: download.status,
            progress: download.percent || 0,
            bytesDownloaded: download.bytesDownloaded || 0,
            totalBytes: download.totalBytes || 0,
            filePath: download.filePath || null,
            elapsedMs: elapsed,
            error: download.error || null
        }, message);
    }

    /**
     * DXP-3: Monitor download progress with live updates
     * Polls every 10 seconds until download completes
     */
    static async monitorDownloadProgress(downloadId: string): Promise<any> {
        const updates: string[] = [];
        const startTime = Date.now();
        let pollCount = 0;
        const MAX_POLLS = 180; // 30 minutes max (180 * 10s)

        OutputLogger.info(`📊 Monitoring download: ${downloadId}`);
        OutputLogger.info(`Will poll every 10 seconds until complete...`);

        // Wait 2 seconds before first poll to give download time to start
        if (process.env.DEBUG === 'true') {
            console.error('[DEBUG] Waiting 2 seconds before first poll...');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        while (pollCount < MAX_POLLS) {
            pollCount++;

            // Get current status (check active and history)
            const download = downloadManager.getDownloadOrHistory(downloadId);

            // Check if download no longer exists
            if (!download) {
                return ResponseBuilder.error(`Download ${downloadId} not found`);
            }

            // Check if download is in final state (completed/failed)
            if (download.status === 'completed' || download.status === 'failed' || download.status === 'cancelled') {
                updates.push(`\n✅ **Download Complete**`);
                if (download.status === 'completed') {
                    updates.push(`Final status: Completed successfully`);
                } else if (download.status === 'failed') {
                    updates.push(`Final status: Failed - ${download.error || 'Unknown error'}`);
                } else {
                    updates.push(`Final status: ${download.status}`);
                }
                break;
            }

            // Get live progress
            const liveProgress: LiveProgress | null = downloadManager.getLiveProgress(downloadId) as LiveProgress | null;

            // Format update
            let update = `\n📥 **Progress Update #${pollCount}** (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`;

            if (liveProgress && liveProgress.totalFiles) {
                update += `\n   ${liveProgress.percentage}% - ${liveProgress.filesDownloaded}/${liveProgress.totalFiles} files`;

                if (liveProgress.bytesDownloaded > 0) {
                    const formatBytes = (bytes: number): string => {
                        if (bytes === 0) return '0 B';
                        const k = 1024;
                        const sizes = ['B', 'KB', 'MB', 'GB'];
                        const i = Math.floor(Math.log(bytes) / Math.log(k));
                        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
                    };

                    update += ` (${formatBytes(liveProgress.bytesDownloaded)}`;
                    if (liveProgress.totalBytes > 0) {
                        update += ` / ${formatBytes(liveProgress.totalBytes)}`;
                    }
                    update += `)`;

                    if (liveProgress.speed > 0) {
                        update += ` - ${formatBytes(liveProgress.speed)}/s`;

                        if (liveProgress.eta && liveProgress.eta > 0) {
                            const etaMin = Math.floor(liveProgress.eta / 60);
                            const etaSec = Math.round(liveProgress.eta % 60);
                            update += ` - ETA: ${etaMin}m ${etaSec}s`;
                        }
                    }
                }
            } else {
                update += `\n   ${download.progress}% complete`;
            }

            updates.push(update);

            // Check if download is complete
            const status = download.status as string;
            if (status === 'completed' || status === 'failed' || status === 'cancelled') {
                updates.push(`\n✅ **Download ${status}**`);
                break;
            }

            // Wait 10 seconds before next poll
            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        if (pollCount >= MAX_POLLS) {
            updates.push(`\n⚠️ **Monitoring timeout** - download still running after 30 minutes`);
            updates.push(`Check status manually: \`download_status({ downloadId: "${downloadId}" })\``);
        }

        const message = `# 📊 Download Monitoring Complete\n\n` +
            `**Download ID**: ${downloadId}\n` +
            `**Total monitoring time**: ${Math.floor((Date.now() - startTime) / 1000)}s\n` +
            `**Updates**: ${pollCount}\n` +
            updates.join('\n');

        return ResponseBuilder.success(message);
    }
}

export default DownloadManagementTools;

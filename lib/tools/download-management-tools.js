/**
 * Download Management Tools
 * Handles listing, cancelling, and monitoring active downloads
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const downloadManager = require('../download-manager');
const ResponseBuilder = require('../response-builder');
const OutputLogger = require('../output-logger');

class DownloadManagementTools {
    /**
     * List all active downloads (both log downloads and database exports)
     */
    static async handleListActiveDownloads(args) {
        try {
            // Get log downloads
            const logDownloads = downloadManager.getActiveDownloads();

            // Get database export downloads (DXP-65 fix)
            const DatabaseSimpleTools = require('./database-simple-tools');
            const dbDownloads = [];
            for (const [downloadId, download] of DatabaseSimpleTools.backgroundDownloads.entries()) {
                if (download.status === 'in_progress' || download.status === 'pending') {
                    dbDownloads.push({ ...download, downloadId });
                }
            }

            const totalDownloads = logDownloads.length + dbDownloads.length;

            if (totalDownloads === 0) {
                return ResponseBuilder.success('📭 No active downloads running.');
            }

            let message = `# 📥 Active Downloads\n\n`;

            // Show database export downloads first
            for (const download of dbDownloads) {
                const elapsed = Date.now() - download.startTime;
                const elapsedMinutes = Math.floor(elapsed / 60000);
                const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

                message += `## 📦 ${download.downloadId}\n`;
                message += `• **Type**: Database Export\n`;
                message += `• **Status**: ${download.status}\n`;
                if (download.percent !== undefined) {
                    message += `• **Progress**: ${download.percent}%\n`;
                }
                message += `• **Running**: ${elapsedMinutes}m ${elapsedSeconds}s\n`;
                if (download.filePath) {
                    message += `• **File**: ${download.filePath}\n`;
                }
                message += `• **Check Status**: \`get_download_status({ downloadId: "${download.downloadId}" })\`\n\n`;
            }

            // Show log downloads
            for (const download of logDownloads) {
                const elapsed = Date.now() - download.startTime;
                const elapsedMinutes = Math.floor(elapsed / 60000);
                const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

                message += `## 🔄 ${download.key}\n`;
                message += `• **Type**: ${download.containerName} logs\n`;
                message += `• **Project**: ${download.projectName}\n`;
                message += `• **Environment**: ${download.environment}\n`;
                message += `• **Status**: ${download.status}\n`;
                message += `• **Progress**: ${download.progress}%\n`;
                message += `• **Running**: ${elapsedMinutes}m ${elapsedSeconds}s\n`;

                if (download.dateRange && download.dateRange !== 'all-time') {
                    message += `• **Date Range**: ${download.dateRange}\n`;
                }

                message += `• **Cancel**: \`cancel_download ${download.key}\`\n\n`;
            }

            message += `**Bulk Actions:**\n`;
            message += `• Cancel all: \`cancel_all_downloads\`\n`;
            message += `• Download history: \`download_history\`\n`;

            // DXP-66: Build structured data for automation tools
            const structuredData = {
                totalDownloads: totalDownloads,
                databaseDownloads: dbDownloads.map(d => ({
                    downloadId: d.downloadId,
                    type: 'database_export',
                    status: d.status,
                    progress: d.percent || 0,
                    filePath: d.filePath || null,
                    startTime: d.startTime,
                    elapsedMs: Date.now() - d.startTime
                })),
                logDownloads: logDownloads.map(d => ({
                    downloadId: d.key,
                    type: 'logs',
                    containerName: d.containerName,
                    projectName: d.projectName,
                    environment: d.environment,
                    status: d.status,
                    progress: d.progress,
                    dateRange: d.dateRange || 'all-time',
                    startTime: d.startTime,
                    elapsedMs: Date.now() - d.startTime
                }))
            };

            return ResponseBuilder.successWithStructuredData(structuredData, message);

        } catch (error) {
            OutputLogger.error('List active downloads error:', error);
            return ResponseBuilder.internalError('Failed to list active downloads', error.message);
        }
    }
    
    /**
     * Cancel a specific download
     */
    static async handleCancelDownload(args) {
        if (!args.downloadId) {
            return ResponseBuilder.invalidParams('downloadId is required. Use list_active_downloads to see available IDs.');
        }
        
        try {
            const result = downloadManager.cancelDownload(args.downloadId);
            
            if (result.success) {
                const download = result.download;
                const elapsed = Date.now() - download.startTime;
                const elapsedMinutes = Math.floor(elapsed / 60000);
                
                let message = `❌ **Download Cancelled**\n\n`;
                message += `**Download**: ${download.containerName} logs (${download.projectName})\n`;
                message += `**Runtime**: ${elapsedMinutes} minutes\n`;
                message += `**Progress**: ${download.progress}%\n\n`;
                message += `Any partially downloaded files have been preserved.\n`;
                message += `Use \`list_active_downloads\` to see remaining active downloads.`;
                
                return ResponseBuilder.success(message);
            } else {
                return ResponseBuilder.error(`Failed to cancel download: ${result.error}`);
            }
            
        } catch (error) {
            OutputLogger.error('Cancel download error:', error);
            return ResponseBuilder.internalError('Failed to cancel download', error.message);
        }
    }
    
    /**
     * Cancel all active downloads
     */
    static async handleCancelAllDownloads(args) {
        try {
            const results = downloadManager.cancelAllDownloads();
            const successful = results.filter(r => r.success);
            const failed = results.filter(r => !r.success);
            
            if (results.length === 0) {
                return ResponseBuilder.success('📭 No active downloads to cancel.');
            }
            
            let message = `❌ **Cancelled All Downloads**\n\n`;
            
            if (successful.length > 0) {
                message += `**Successfully cancelled** (${successful.length}):\n`;
                for (const result of successful) {
                    const download = result.download;
                    const elapsed = Math.floor((Date.now() - download.startTime) / 60000);
                    message += `• ${download.containerName} logs - ${elapsed}m runtime\n`;
                }
                message += `\n`;
            }
            
            if (failed.length > 0) {
                message += `**Failed to cancel** (${failed.length}):\n`;
                for (const result of failed) {
                    message += `• ${result.error}\n`;
                }
                message += `\n`;
            }
            
            message += `All partially downloaded files have been preserved.`;
            
            return ResponseBuilder.success(message);
            
        } catch (error) {
            OutputLogger.error('Cancel all downloads error:', error);
            return ResponseBuilder.internalError('Failed to cancel downloads', error.message);
        }
    }
    
    /**
     * Show recent download history (both log downloads and database exports)
     */
    static async handleDownloadHistory(args) {
        try {
            const limit = args.limit || 10;

            // Get log download history
            const logHistory = downloadManager.getHistory(limit);

            // Get database export download history (DXP-65 fix)
            const DatabaseSimpleTools = require('./database-simple-tools');
            const dbHistory = [];
            for (const [downloadId, download] of DatabaseSimpleTools.backgroundDownloads.entries()) {
                if (download.status === 'complete' || download.status === 'error') {
                    dbHistory.push({ ...download, downloadId });
                }
            }

            // Sort by end time (most recent first) and limit
            dbHistory.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
            const limitedDbHistory = dbHistory.slice(0, limit);

            const totalHistory = logHistory.length + limitedDbHistory.length;

            if (totalHistory === 0) {
                return ResponseBuilder.success('📜 No recent downloads found.');
            }

            let message = `# 📜 Recent Downloads\n\n`;

            // Show database export history first
            for (const download of limitedDbHistory) {
                const startTime = new Date(download.startTime);
                const endTime = download.endTime ? new Date(download.endTime) : null;
                const duration = endTime ?
                    Math.floor((download.endTime - download.startTime) / 60000) : null;

                const statusEmoji = download.status === 'complete' ? '✅' : '💥';

                message += `## ${statusEmoji} Database Export\n`;
                message += `• **ID**: ${download.downloadId}\n`;
                message += `• **Started**: ${startTime.toLocaleString()}\n`;

                if (endTime) {
                    message += `• **Completed**: ${endTime.toLocaleString()}\n`;
                }

                if (duration !== null) {
                    message += `• **Duration**: ${duration} minutes\n`;
                }

                if (download.filePath) {
                    message += `• **File**: ${download.filePath}\n`;
                }

                if (download.error) {
                    message += `• **Error**: ${download.error}\n`;
                }

                message += `\n`;
            }

            // Show log download history
            for (const download of logHistory) {
                const startTime = new Date(download.startTime);
                const endTime = download.endTime ? new Date(download.endTime) : null;
                const duration = endTime ?
                    Math.floor((download.endTime - download.startTime) / 60000) : null;

                const statusEmoji = {
                    'completed': '✅',
                    'cancelled': '❌',
                    'failed': '💥'
                }[download.status] || '❓';

                message += `## ${statusEmoji} ${download.containerName} logs\n`;
                message += `• **Project**: ${download.projectName} (${download.environment})\n`;
                message += `• **Started**: ${startTime.toLocaleString()}\n`;

                if (endTime) {
                    message += `• **Completed**: ${endTime.toLocaleString()}\n`;
                }

                if (duration !== null) {
                    message += `• **Duration**: ${duration} minutes\n`;
                }

                message += `• **Final Progress**: ${download.progress}%\n`;

                if (download.error) {
                    message += `• **Error**: ${download.error}\n`;
                }

                message += `\n`;
            }

            return ResponseBuilder.success(message);

        } catch (error) {
            OutputLogger.error('Download history error:', error);
            return ResponseBuilder.internalError('Failed to get download history', error.message);
        }
    }
    
    /**
     * Get download status for a specific download
     * Checks both log downloads (downloadManager) and database exports (DatabaseSimpleTools)
     */
    static async handleGetDownloadStatus(args) {
        if (!args.downloadId) {
            return ResponseBuilder.invalidParams('downloadId is required.');
        }

        try {
            // First check log download system
            let download = downloadManager.getDownload(args.downloadId);

            // If not found, check database export system (DXP-65 fix)
            if (!download) {
                const DatabaseSimpleTools = require('./database-simple-tools');
                download = DatabaseSimpleTools.getDownloadStatus(args.downloadId);

                // If found in database system, return database-specific status
                if (download) {
                    return this._formatDatabaseDownloadStatus(download, args.downloadId);
                }

                // Not found in either system
                return ResponseBuilder.error(`Download ${args.downloadId} not found.`);
            }

            // Format log download status (existing behavior)
            const elapsed = Date.now() - download.startTime;
            const elapsedMinutes = Math.floor(elapsed / 60000);
            const elapsedSeconds = Math.floor((elapsed % 60000) / 1000);

            let message = `# 📊 Download Status\n\n`;
            message += `**ID**: ${download.key}\n`;
            message += `**Type**: ${download.containerName} logs\n`;
            message += `**Project**: ${download.projectName} (${download.environment})\n`;
            message += `**Status**: ${download.status}\n`;
            message += `**Progress**: ${download.progress}%\n`;
            message += `**Runtime**: ${elapsedMinutes}m ${elapsedSeconds}s\n`;

            if (download.dateRange && download.dateRange !== 'all-time') {
                message += `**Date Range**: ${download.dateRange}\n`;
            }

            if (download.pid) {
                message += `**Process ID**: ${download.pid}\n`;
            }

            message += `\n**Actions**:\n`;
            message += `• Cancel: \`cancel_download ${download.key}\`\n`;
            message += `• All active: \`list_active_downloads\`\n`;

            // DXP-66: Add structured data
            return ResponseBuilder.successWithStructuredData({
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
            }, message);

        } catch (error) {
            OutputLogger.error('Get download status error:', error);
            return ResponseBuilder.internalError('Failed to get download status', error.message);
        }
    }

    /**
     * Format database export download status message
     * @private
     */
    static _formatDatabaseDownloadStatus(download, downloadId) {
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
        message += `• Check again: \`get_download_status({ downloadId: "${downloadId}" })\`\n`;
        message += `• All downloads: \`list_active_downloads\`\n`;

        // DXP-66: Add structured data (reusing elapsed from line 374)
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
}

module.exports = DownloadManagementTools;
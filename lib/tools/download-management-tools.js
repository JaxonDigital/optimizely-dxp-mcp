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
     * List all active downloads
     */
    static async handleListActiveDownloads(args) {
        try {
            const activeDownloads = downloadManager.getActiveDownloads();
            
            if (activeDownloads.length === 0) {
                return ResponseBuilder.success('📭 No active downloads running.');
            }
            
            let message = `# 📥 Active Downloads\n\n`;
            
            for (const download of activeDownloads) {
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
            
            return ResponseBuilder.success(message);
            
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
     * Show recent download history
     */
    static async handleDownloadHistory(args) {
        try {
            const limit = args.limit || 10;
            const history = downloadManager.getHistory(limit);
            
            if (history.length === 0) {
                return ResponseBuilder.success('📜 No recent downloads found.');
            }
            
            let message = `# 📜 Recent Downloads\n\n`;
            
            for (const download of history) {
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
     */
    static async handleGetDownloadStatus(args) {
        if (!args.downloadId) {
            return ResponseBuilder.invalidParams('downloadId is required.');
        }
        
        try {
            const download = downloadManager.getDownload(args.downloadId);
            
            if (!download) {
                return ResponseBuilder.error(`Download ${args.downloadId} not found.`);
            }
            
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
            
            return ResponseBuilder.success(message);
            
        } catch (error) {
            OutputLogger.error('Get download status error:', error);
            return ResponseBuilder.internalError('Failed to get download status', error.message);
        }
    }
}

module.exports = DownloadManagementTools;
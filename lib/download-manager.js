/**
 * Download Manager - Tracks and manages active downloads
 * Prevents overlapping downloads and enables cancellation
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const EventEmitter = require('events');
const { spawn } = require('child_process');
const OutputLogger = require('./output-logger');

class DownloadManager extends EventEmitter {
    constructor() {
        super();
        this.activeDownloads = new Map();
        this.downloadHistory = [];
    }

    /**
     * Generate a unique key for tracking downloads
     */
    static generateDownloadKey(projectName, containerName, environment, dateRange = null) {
        const parts = [
            projectName || 'unknown',
            containerName || 'all-containers',
            environment || 'production',
            dateRange || 'all-time'
        ];
        return parts.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
    }

    /**
     * Check if a download overlaps with existing downloads
     */
    checkOverlap(newDownload) {
        const overlaps = [];
        
        for (const [key, active] of this.activeDownloads) {
            // Same project and environment
            if (active.projectName === newDownload.projectName && 
                active.environment === newDownload.environment) {
                
                // Check container overlap
                const containerOverlap = this.checkContainerOverlap(
                    active.containerName, 
                    newDownload.containerName
                );
                
                // Check date range overlap
                const dateOverlap = this.checkDateOverlap(
                    active.dateRange, 
                    newDownload.dateRange
                );
                
                if (containerOverlap && dateOverlap) {
                    overlaps.push({
                        key,
                        active,
                        overlapType: containerOverlap,
                        dateOverlapType: dateOverlap
                    });
                }
            }
        }
        
        return overlaps;
    }

    /**
     * Check if containers overlap
     */
    checkContainerOverlap(activeContainer, newContainer) {
        // "all" containers includes everything
        if (activeContainer === 'all-containers' || newContainer === 'all-containers') {
            return 'complete';
        }
        
        // Exact match
        if (activeContainer === newContainer) {
            return 'exact';
        }
        
        return null;
    }

    /**
     * Check if date ranges overlap
     */
    checkDateOverlap(activeDateRange, newDateRange) {
        // "all-time" includes everything
        if (activeDateRange === 'all-time' || newDateRange === 'all-time') {
            return 'complete';
        }
        
        // Exact match
        if (activeDateRange === newDateRange) {
            return 'exact';
        }
        
        // For now, assume any specific date ranges might overlap
        // TODO: Implement proper date range intersection logic
        return 'partial';
    }

    /**
     * Register a new download
     */
    registerDownload(downloadInfo) {
        const key = DownloadManager.generateDownloadKey(
            downloadInfo.projectName,
            downloadInfo.containerName,
            downloadInfo.environment,
            downloadInfo.dateRange
        );

        const download = {
            ...downloadInfo,
            key,
            startTime: Date.now(),
            status: 'starting',
            progress: 0,
            pid: null,
            childProcess: null
        };

        this.activeDownloads.set(key, download);
        this.emit('downloadStarted', download);
        
        OutputLogger.info(`📥 Registered download: ${key}`);
        return key;
    }

    /**
     * Update download progress
     */
    updateProgress(key, progress, status = null) {
        const download = this.activeDownloads.get(key);
        if (download) {
            download.progress = progress;
            if (status) {
                download.status = status;
            }
            download.lastUpdate = Date.now();
            this.emit('downloadProgress', download);
        }
    }

    /**
     * Set process information for a download
     */
    setProcess(key, childProcess) {
        const download = this.activeDownloads.get(key);
        if (download) {
            download.pid = childProcess.pid;
            download.childProcess = childProcess;
            download.status = 'running';
        }
    }

    /**
     * Cancel a specific download
     */
    cancelDownload(key) {
        const download = this.activeDownloads.get(key);
        if (!download) {
            return { success: false, error: `Download ${key} not found` };
        }

        try {
            if (download.childProcess && !download.childProcess.killed) {
                download.childProcess.kill('SIGTERM');
                
                // Force kill after 5 seconds if still running
                setTimeout(() => {
                    if (!download.childProcess.killed) {
                        download.childProcess.kill('SIGKILL');
                    }
                }, 5000);
            }

            download.status = 'cancelled';
            download.endTime = Date.now();
            
            // Move to history
            this.downloadHistory.push(download);
            this.activeDownloads.delete(key);
            
            this.emit('downloadCancelled', download);
            OutputLogger.info(`❌ Cancelled download: ${key}`);
            
            return { success: true, download };
        } catch (error) {
            OutputLogger.error(`Failed to cancel download ${key}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cancel all active downloads
     */
    cancelAllDownloads() {
        const results = [];
        const keys = Array.from(this.activeDownloads.keys());
        
        for (const key of keys) {
            results.push(this.cancelDownload(key));
        }
        
        return results;
    }

    /**
     * Mark download as completed
     */
    completeDownload(key, result = null) {
        const download = this.activeDownloads.get(key);
        if (download) {
            download.status = 'completed';
            download.endTime = Date.now();
            download.result = result;
            
            // Move to history
            this.downloadHistory.push(download);
            this.activeDownloads.delete(key);
            
            this.emit('downloadCompleted', download);
            OutputLogger.info(`✅ Completed download: ${key}`);
        }
    }

    /**
     * Mark download as failed
     */
    failDownload(key, error) {
        const download = this.activeDownloads.get(key);
        if (download) {
            download.status = 'failed';
            download.endTime = Date.now();
            download.error = error;
            
            // Move to history
            this.downloadHistory.push(download);
            this.activeDownloads.delete(key);
            
            this.emit('downloadFailed', download);
            OutputLogger.error(`❌ Failed download: ${key} - ${error}`);
        }
    }

    /**
     * Get all active downloads
     */
    getActiveDownloads() {
        return Array.from(this.activeDownloads.values());
    }

    /**
     * Get download by key
     */
    getDownload(key) {
        return this.activeDownloads.get(key);
    }

    /**
     * Get recent download history
     */
    getHistory(limit = 10) {
        return this.downloadHistory
            .sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime))
            .slice(0, limit);
    }

    /**
     * Clean up old history entries (keep last 50)
     */
    cleanupHistory() {
        if (this.downloadHistory.length > 50) {
            this.downloadHistory = this.downloadHistory
                .sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime))
                .slice(0, 50);
        }
    }

    /**
     * Format overlap warning message
     */
    formatOverlapWarning(newDownload, overlaps) {
        let message = `⚠️ **Download Already In Progress**\n\n`;
        
        const overlap = overlaps[0]; // Show the most relevant overlap
        const active = overlap.active;
        
        if (overlap.overlapType === 'complete') {
            message += `📥 **Active Download**: ${active.containerName} logs (${active.environment})\n`;
            message += `🎯 **Includes**: Your requested ${newDownload.containerName} logs\n`;
        } else {
            message += `📥 **Active Download**: ${active.containerName} logs (${active.environment})\n`;
            message += `🎯 **Conflicts with**: Your ${newDownload.containerName} logs request\n`;
        }
        
        // Calculate progress and ETA
        const elapsed = Date.now() - active.startTime;
        const elapsedMinutes = Math.floor(elapsed / 60000);
        
        message += `⏱️ **Running**: ${elapsedMinutes} minutes\n`;
        message += `📊 **Progress**: ${active.progress}%\n\n`;
        
        message += `**Options:**\n`;
        message += `• **Wait**: Use \`list_active_downloads\` to monitor progress\n`;
        message += `• **Cancel current**: Use \`cancel_download ${active.key}\`\n`;
        message += `• **Cancel all**: Use \`cancel_all_downloads\`\n`;
        message += `• **Proceed anyway**: Add \`force: true\` (will create duplicates)\n`;
        
        return message;
    }
}

// Singleton instance
const downloadManager = new DownloadManager();

module.exports = downloadManager;
/**
 * Download Manager - Tracks and manages active downloads
 * Prevents overlapping downloads and enables cancellation
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import OutputLogger from './output-logger';
import ProgressMonitor from './progress-monitor';
import DownloadResourceHandler from './resources/download-resource';

// Type definitions
interface DownloadInfo {
    projectName: string;
    containerName: string;
    environment: string;
    dateRange?: string;
    [key: string]: any;
}

interface Download extends DownloadInfo {
    key: string;
    startTime: number;
    status: 'starting' | 'running' | 'completed' | 'cancelled' | 'failed';
    progress: number;
    pid: number | null;
    childProcess: ChildProcess | null;
    progressMonitor: ProgressMonitor | null;
    lastUpdate?: number;
    endTime?: number;
    result?: any;
    error?: string;
}

interface OverlapInfo {
    key: string;
    active: Download;
    overlapType: string;
    dateOverlapType: string;
}

interface CancelResult {
    success: boolean;
    error?: string;
    download?: Download;
}

interface ProgressInfo {
    filesDownloaded: number;
    totalFiles: number;
    bytesDownloaded: number;
    totalBytes: number;
    percentage: number;
    speed: number;
    eta: number | null;
    currentFile: string | null;
    elapsedTime: number;
}

interface BasicProgress {
    status: string;
    progress: number;
    startTime: number;
    elapsed: number;
}

class DownloadManager extends EventEmitter {
    private activeDownloads: Map<string, Download>;
    private downloadHistory: Download[];

    constructor() {
        super();
        this.activeDownloads = new Map();
        this.downloadHistory = [];

        // DXP-156: Wire DownloadResourceHandler to existing events
        this.on('downloadStarted', (download: Download) => {
            try {
                DownloadResourceHandler.emitStarted(download.key, {
                    project: download.projectName,
                    environment: download.environment,
                    containerName: download.containerName,
                    dateRange: download.dateRange
                });
            } catch (error: any) {
                console.error(`Failed to emit download started event: ${error.message}`);
            }
        });

        this.on('downloadProgress', (download: Download) => {
            try {
                DownloadResourceHandler.emitInProgress(download.key, {
                    status: download.status,
                    progress: download.progress,
                    lastUpdate: download.lastUpdate
                });
            } catch (error: any) {
                console.error(`Failed to emit download progress event: ${error.message}`);
            }
        });

        this.on('downloadCompleted', (download: Download) => {
            try {
                DownloadResourceHandler.emitSucceeded(download.key, {
                    result: download.result,
                    environment: download.environment,
                    endTime: download.endTime
                });
            } catch (error: any) {
                console.error(`Failed to emit download completed event: ${error.message}`);
            }
        });

        this.on('downloadFailed', (download: Download) => {
            try {
                DownloadResourceHandler.emitFailed(download.key, {
                    error: download.error || 'Download failed',
                    environment: download.environment,
                    endTime: download.endTime
                });
            } catch (error: any) {
                console.error(`Failed to emit download failed event: ${error.message}`);
            }
        });

        this.on('downloadCancelled', (download: Download) => {
            try {
                DownloadResourceHandler.emitCancelled(download.key, {
                    environment: download.environment,
                    endTime: download.endTime
                });
            } catch (error: any) {
                console.error(`Failed to emit download cancelled event: ${error.message}`);
            }
        });
    }

    /**
     * Generate a unique key for tracking downloads
     */
    generateDownloadKey(
        projectName: string,
        containerName: string,
        environment: string,
        dateRange: string | null = null
    ): string {
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
    checkOverlap(newDownload: DownloadInfo): OverlapInfo[] {
        const overlaps: OverlapInfo[] = [];

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
    checkContainerOverlap(activeContainer: string, newContainer: string): string | null {
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
    checkDateOverlap(activeDateRange: string | undefined, newDateRange: string | undefined): string | null {
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
    registerDownload(downloadInfo: DownloadInfo): string {
        const key = this.generateDownloadKey(
            downloadInfo.projectName,
            downloadInfo.containerName,
            downloadInfo.environment,
            downloadInfo.dateRange
        );

        const download: Download = {
            ...downloadInfo,
            key,
            startTime: Date.now(),
            status: 'starting',
            progress: 0,
            pid: null,
            childProcess: null,
            progressMonitor: null  // DXP-3: Store ProgressMonitor for live progress updates
        };

        this.activeDownloads.set(key, download);
        this.emit('downloadStarted', download);

        OutputLogger.info(`📥 Registered download: ${key}`);
        return key;
    }

    /**
     * Update download progress
     */
    updateProgress(key: string, progress: number, status: string | null = null): void {
        const download = this.activeDownloads.get(key);
        if (download) {
            download.progress = progress;
            if (status) {
                download.status = status as Download['status'];
            }
            download.lastUpdate = Date.now();
            this.emit('downloadProgress', download);
        }
    }

    /**
     * Set process information for a download
     */
    setProcess(key: string, childProcess: ChildProcess): void {
        const download = this.activeDownloads.get(key);
        if (download) {
            download.pid = childProcess.pid || null;
            download.childProcess = childProcess;
            download.status = 'running';
        }
    }

    /**
     * DXP-3: Set ProgressMonitor for a download (for live progress updates)
     */
    setProgressMonitor(key: string, progressMonitor: ProgressMonitor): void {
        const download = this.activeDownloads.get(key);
        if (download) {
            download.progressMonitor = progressMonitor;
        }
    }

    /**
     * DXP-3: Get ProgressMonitor for a download
     */
    getProgressMonitor(key: string): ProgressMonitor | null {
        const download = this.activeDownloads.get(key);
        return download ? download.progressMonitor : null;
    }

    /**
     * DXP-3: Get live progress data from ProgressMonitor
     */
    getLiveProgress(key: string): ProgressInfo | BasicProgress | null {
        const download = this.activeDownloads.get(key);
        if (!download) {
            return null;
        }

        const progressMonitor = download.progressMonitor;
        if (!progressMonitor) {
            return {
                status: download.status,
                progress: download.progress,
                startTime: download.startTime,
                elapsed: Date.now() - download.startTime
            };
        }

        // Return detailed progress from ProgressMonitor
        return progressMonitor.getProgress();
    }

    /**
     * Cancel a specific download
     */
    cancelDownload(key: string): CancelResult {
        const download = this.activeDownloads.get(key);
        if (!download) {
            return { success: false, error: `Download ${key} not found` };
        }

        try {
            if (download.childProcess && !download.childProcess.killed) {
                download.childProcess.kill('SIGTERM');

                // Force kill after 5 seconds if still running
                setTimeout(() => {
                    if (download.childProcess && !download.childProcess.killed) {
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
            OutputLogger.error(`Failed to cancel download ${key}: ${error}`);
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Cancel all active downloads
     */
    cancelAllDownloads(): CancelResult[] {
        const results: CancelResult[] = [];
        const keys = Array.from(this.activeDownloads.keys());

        for (const key of keys) {
            results.push(this.cancelDownload(key));
        }

        return results;
    }

    /**
     * Mark download as completed
     */
    completeDownload(key: string, result: any = null): void {
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
    failDownload(key: string, error: string): void {
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
    getActiveDownloads(): Download[] {
        return Array.from(this.activeDownloads.values());
    }

    /**
     * Get download by key
     */
    getDownload(key: string): Download | undefined {
        return this.activeDownloads.get(key);
    }

    /**
     * Get download by key from active downloads or history
     */
    getDownloadOrHistory(key: string): Download | undefined {
        // Check active downloads first
        const active = this.activeDownloads.get(key);
        if (active) {
            return active;
        }

        // Check history if not in active
        return this.downloadHistory.find(d => d.key === key);
    }

    /**
     * Get recent download history
     */
    getHistory(limit: number = 10): Download[] {
        return this.downloadHistory
            .sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime))
            .slice(0, limit);
    }

    /**
     * Clean up old history entries (keep last 50)
     */
    cleanupHistory(): void {
        if (this.downloadHistory.length > 50) {
            this.downloadHistory = this.downloadHistory
                .sort((a, b) => (b.endTime || b.startTime) - (a.endTime || a.startTime))
                .slice(0, 50);
        }
    }

    /**
     * Format overlap warning message
     */
    formatOverlapWarning(newDownload: DownloadInfo, overlaps: OverlapInfo[]): string {
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

export default downloadManager;

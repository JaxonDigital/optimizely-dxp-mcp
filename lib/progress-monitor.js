/**
 * Progress Monitor - Real-time download progress tracking
 * Provides unified progress reporting for logs, blobs, and database downloads
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const OutputLogger = require('./output-logger');
const Config = require('./config');

class ProgressMonitor {
    constructor(options = {}) {
        this.totalFiles = options.totalFiles || 0;
        this.totalBytes = options.totalBytes || 0;
        this.filesDownloaded = 0;
        this.bytesDownloaded = 0;
        this.startTime = Date.now();
        this.lastUpdateTime = this.startTime;
        this.lastBytesDownloaded = 0;
        this.updateInterval = options.updateInterval || 10000; // 10 seconds default
        this.updateThreshold = options.updateThreshold || 10; // Update every 10 files (lowered from 100)
        this.lastDisplayTime = 0;
        this.minDisplayInterval = 5000; // Minimum 5 seconds between displays
        this.currentFile = null;
        this.enabled = options.enabled !== false;
        this.downloadType = options.downloadType || 'files'; // 'files', 'blobs', 'logs', 'database'
        this.speeds = []; // Array of recent speed samples for smoothing
        this.maxSpeedSamples = 10;
        this.messages = []; // DXP-3: Accumulate messages for MCP response
        this.hasShownProgress = false; // Track if we've shown at least one progress update
    }

    /**
     * Update progress with new file/byte counts
     */
    update(filesDownloaded, bytesDownloaded, currentFile = null) {
        if (!this.enabled) return;

        this.filesDownloaded = filesDownloaded;
        this.bytesDownloaded = bytesDownloaded;
        this.currentFile = currentFile;

        const now = Date.now();
        const timeSinceLastUpdate = now - this.lastUpdateTime;

        // Check if we should display progress
        const shouldDisplay =
            timeSinceLastUpdate >= this.updateInterval ||
            (this.filesDownloaded > 0 && this.filesDownloaded % this.updateThreshold === 0) ||
            this.filesDownloaded === this.totalFiles;

        if (shouldDisplay && (now - this.lastDisplayTime) >= this.minDisplayInterval) {
            this.displayProgress();
            this.lastDisplayTime = now;
        }

        this.lastUpdateTime = now;
    }

    /**
     * Calculate current download speed (bytes per second)
     */
    calculateSpeed() {
        const now = Date.now();
        const elapsedSeconds = (now - this.startTime) / 1000;

        if (elapsedSeconds === 0) return 0;

        // Calculate instantaneous speed
        const instantSpeed = this.bytesDownloaded / elapsedSeconds;

        // Add to speed samples for smoothing
        this.speeds.push(instantSpeed);
        if (this.speeds.length > this.maxSpeedSamples) {
            this.speeds.shift();
        }

        // Return average of recent samples
        const avgSpeed = this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;
        return avgSpeed;
    }

    /**
     * Calculate estimated time remaining
     */
    calculateETA() {
        const speed = this.calculateSpeed();
        if (speed === 0 || this.totalBytes === 0) return null;

        const remainingBytes = this.totalBytes - this.bytesDownloaded;
        const secondsRemaining = remainingBytes / speed;

        return secondsRemaining;
    }

    /**
     * Format bytes to human-readable string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        if (!bytes) return 'Unknown';

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Format seconds to human-readable duration
     */
    formatDuration(seconds) {
        if (!seconds || seconds <= 0) return 'calculating...';
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.round((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }

    /**
     * Display current progress
     */
    displayProgress() {
        if (!this.enabled) return;

        const percentage = this.totalFiles > 0
            ? Math.round((this.filesDownloaded / this.totalFiles) * 100)
            : 0;

        const speed = this.calculateSpeed();
        const eta = this.calculateETA();

        let message = `\n📥 Download Progress: ${percentage}%`;

        if (this.totalFiles > 0) {
            message += ` (${this.filesDownloaded.toLocaleString()}/${this.totalFiles.toLocaleString()} files)`;
        } else {
            message += ` (${this.filesDownloaded.toLocaleString()} files)`;
        }

        if (this.totalBytes > 0) {
            message += `\n📦 Data: ${this.formatBytes(this.bytesDownloaded)} / ${this.formatBytes(this.totalBytes)}`;
        } else if (this.bytesDownloaded > 0) {
            message += `\n📦 Downloaded: ${this.formatBytes(this.bytesDownloaded)}`;
        }

        if (speed > 0) {
            message += `\n⚡ Speed: ${this.formatBytes(speed)}/s`;

            if (eta !== null) {
                message += ` | ETA: ${this.formatDuration(eta)}`;
            }
        }

        if (this.currentFile) {
            // Truncate long file paths
            const displayFile = this.currentFile.length > 60
                ? '...' + this.currentFile.substring(this.currentFile.length - 57)
                : this.currentFile;
            message += `\n📄 Current: ${displayFile}`;
        }

        // DXP-3: Accumulate message for MCP response instead of just logging
        this.messages.push(message);
        this.hasShownProgress = true;
        OutputLogger.info(message);
    }

    /**
     * Mark download as complete
     */
    complete() {
        if (!this.enabled) return;

        const totalTime = (Date.now() - this.startTime) / 1000;
        const avgSpeed = this.bytesDownloaded / totalTime;

        let message = `\n✅ Download Complete!`;
        message += `\n📊 Total: ${this.filesDownloaded.toLocaleString()} files`;

        if (this.bytesDownloaded > 0) {
            message += ` (${this.formatBytes(this.bytesDownloaded)})`;
        }

        message += `\n⏱️  Duration: ${this.formatDuration(totalTime)}`;

        if (avgSpeed > 0) {
            message += `\n⚡ Average Speed: ${this.formatBytes(avgSpeed)}/s`;
        }

        // DXP-3: Accumulate message for MCP response
        this.messages.push(message);
        OutputLogger.success(message);
    }

    /**
     * Report an error
     */
    error(errorMessage) {
        if (!this.enabled) return;

        const totalTime = (Date.now() - this.startTime) / 1000;

        let message = `\n❌ Download Failed`;
        message += `\n📊 Downloaded: ${this.filesDownloaded.toLocaleString()} files`;

        if (this.bytesDownloaded > 0) {
            message += ` (${this.formatBytes(this.bytesDownloaded)})`;
        }

        message += `\n⏱️  Time: ${this.formatDuration(totalTime)}`;
        message += `\n💥 Error: ${errorMessage}`;

        // DXP-3: Accumulate message for MCP response
        this.messages.push(message);
        OutputLogger.error(message);
    }

    /**
     * Get all accumulated messages for inclusion in MCP response
     * @returns {string} All progress messages joined together
     */
    getMessages() {
        return this.messages.join('\n');
    }

    /**
     * Check if any progress was shown
     * @returns {boolean} True if at least one progress update was displayed
     */
    hasProgress() {
        return this.hasShownProgress || this.messages.length > 0;
    }

    /**
     * Create progress callback for Azure SDK
     * Returns a function that can be passed to Azure SDK download operations
     */
    createAzureProgressCallback() {
        return (progress) => {
            if (!this.enabled) return;

            // Azure SDK reports: { loadedBytes: number }
            if (progress && typeof progress.loadedBytes === 'number') {
                this.update(this.filesDownloaded, progress.loadedBytes, this.currentFile);
            }
        };
    }

    /**
     * Set total counts (useful when determined during download)
     */
    setTotals(totalFiles, totalBytes) {
        this.totalFiles = totalFiles;
        this.totalBytes = totalBytes;
    }

    /**
     * Get current progress as object (for API responses)
     */
    getProgress() {
        return {
            filesDownloaded: this.filesDownloaded,
            totalFiles: this.totalFiles,
            bytesDownloaded: this.bytesDownloaded,
            totalBytes: this.totalBytes,
            percentage: this.totalFiles > 0
                ? Math.round((this.filesDownloaded / this.totalFiles) * 100)
                : 0,
            speed: this.calculateSpeed(),
            eta: this.calculateETA(),
            currentFile: this.currentFile,
            elapsedTime: (Date.now() - this.startTime) / 1000
        };
    }

    /**
     * Enable or disable monitoring
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
}

module.exports = ProgressMonitor;

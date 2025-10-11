/**
 * Upload Progress Module
 * Provides progress tracking for large file uploads
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class UploadProgress extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = {
            updateInterval: options.updateInterval || 1000, // Update every second
            showSpinner: options.showSpinner !== false,
            showPercentage: options.showPercentage !== false,
            showSpeed: options.showSpeed !== false,
            showETA: options.showETA !== false,
            ...options
        };
        
        this.reset();
    }

    /**
     * Reset progress tracking
     */
    reset() {
        this.startTime = null;
        this.bytesUploaded = 0;
        this.totalBytes = 0;
        this.lastUpdate = null;
        this.lastBytes = 0;
        this.speeds = [];
        this.isComplete = false;
        this.isPaused = false;
    }

    /**
     * Start tracking upload progress
     * @param {string} filePath - Path to file being uploaded
     * @param {number} totalBytes - Total bytes to upload (optional)
     */
    async start(filePath, totalBytes = null) {
        this.reset();
        
        // Get file size if not provided
        if (!totalBytes && filePath) {
            try {
                const stats = await fs.promises.stat(filePath);
                this.totalBytes = stats.size;
            } catch (error) {
                console.error('Could not get file size:', error.message);
                this.totalBytes = 0;
            }
        } else {
            this.totalBytes = totalBytes || 0;
        }

        this.startTime = Date.now();
        this.lastUpdate = this.startTime;
        
        // Emit start event
        this.emit('start', {
            totalBytes: this.totalBytes,
            fileName: filePath ? path.basename(filePath) : 'unknown'
        });

        // Start progress display
        this.displayProgress();
    }

    /**
     * Update progress with bytes uploaded
     * @param {number} bytes - Additional bytes uploaded
     */
    update(bytes) {
        if (this.isComplete || this.isPaused) return;
        
        this.bytesUploaded += bytes;
        const now = Date.now();
        
        // Calculate speed
        if (now - this.lastUpdate >= this.options.updateInterval) {
            const timeDiff = (now - this.lastUpdate) / 1000;
            const bytesDiff = this.bytesUploaded - this.lastBytes;
            const speed = bytesDiff / timeDiff;
            
            // Keep rolling average of last 5 speeds
            this.speeds.push(speed);
            if (this.speeds.length > 5) {
                this.speeds.shift();
            }
            
            this.lastUpdate = now;
            this.lastBytes = this.bytesUploaded;
            
            // Emit progress event
            this.emit('progress', this.getStatus());
            
            // Update display
            this.displayProgress();
        }
    }

    /**
     * Set absolute progress
     * @param {number} bytesUploaded - Total bytes uploaded so far
     */
    setProgress(bytesUploaded) {
        if (this.isComplete || this.isPaused) return;
        
        const bytes = bytesUploaded - this.bytesUploaded;
        this.update(bytes);
    }

    /**
     * Mark upload as complete
     */
    complete() {
        if (this.isComplete) return;
        
        this.isComplete = true;
        this.bytesUploaded = this.totalBytes || this.bytesUploaded;
        
        const duration = (Date.now() - this.startTime) / 1000;
        
        // Emit complete event
        this.emit('complete', {
            totalBytes: this.bytesUploaded,
            duration,
            averageSpeed: this.bytesUploaded / duration
        });
        
        // Final display
        this.displayComplete();
    }

    /**
     * Mark upload as failed
     * @param {Error} error - Error that caused failure
     */
    fail(error) {
        if (this.isComplete) return;
        
        this.isComplete = true;
        
        // Emit error event
        this.emit('error', {
            error,
            bytesUploaded: this.bytesUploaded,
            totalBytes: this.totalBytes
        });
        
        // Display error
        this.displayError(error);
    }

    /**
     * Pause progress tracking
     */
    pause() {
        this.isPaused = true;
        this.emit('pause');
    }

    /**
     * Resume progress tracking
     */
    resume() {
        this.isPaused = false;
        this.lastUpdate = Date.now();
        this.emit('resume');
    }

    /**
     * Get current status
     * @returns {Object} Current upload status
     */
    getStatus() {
        const now = Date.now();
        const elapsed = (now - this.startTime) / 1000;
        const percentage = this.totalBytes > 0 
            ? Math.min(100, (this.bytesUploaded / this.totalBytes) * 100)
            : 0;
        
        // Calculate average speed
        const avgSpeed = this.speeds.length > 0
            ? this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length
            : this.bytesUploaded / elapsed;
        
        // Calculate ETA
        const remaining = this.totalBytes - this.bytesUploaded;
        const eta = avgSpeed > 0 ? remaining / avgSpeed : 0;
        
        return {
            bytesUploaded: this.bytesUploaded,
            totalBytes: this.totalBytes,
            percentage,
            elapsed,
            speed: avgSpeed,
            eta,
            isComplete: this.isComplete,
            isPaused: this.isPaused
        };
    }

    /**
     * Display progress in console
     */
    displayProgress() {
        if (this.isComplete || !process.stderr.isTTY) return;
        
        const status = this.getStatus();
        const parts = [];
        
        // Build progress message
        if (this.options.showSpinner) {
            const spinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
            const index = Math.floor(Date.now() / 100) % spinners.length;
            parts.push(spinners[index]);
        }
        
        parts.push('Uploading');
        
        if (this.options.showPercentage && status.totalBytes > 0) {
            parts.push(`${status.percentage.toFixed(1)}%`);
        }
        
        if (this.options.showSpeed) {
            parts.push(`(${this.formatBytes(status.speed)}/s)`);
        }
        
        if (this.totalBytes > 0) {
            parts.push(`${this.formatBytes(status.bytesUploaded)}/${this.formatBytes(status.totalBytes)}`);
        } else {
            parts.push(`${this.formatBytes(status.bytesUploaded)}`);
        }
        
        if (this.options.showETA && status.eta > 0 && status.totalBytes > 0) {
            parts.push(`ETA: ${this.formatTime(status.eta)}`);
        }
        
        // Progress bar
        if (status.totalBytes > 0) {
            const barLength = 30;
            const filled = Math.round((status.percentage / 100) * barLength);
            const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
            parts.push(`[${bar}]`);
        }
        
        // Write to stderr (allows overwriting)
        process.stderr.write('\r' + parts.join(' ') + '  ');
    }

    /**
     * Display completion message
     */
    displayComplete() {
        if (!process.stderr.isTTY) return;
        
        const duration = (Date.now() - this.startTime) / 1000;
        const avgSpeed = this.bytesUploaded / duration;
        
        process.stderr.write('\r' + ' '.repeat(80) + '\r'); // Clear line
        console.error(`✅ Upload complete: ${this.formatBytes(this.bytesUploaded)} in ${this.formatTime(duration)} (${this.formatBytes(avgSpeed)}/s)`);
    }

    /**
     * Display error message
     * @param {Error} error - Error to display
     */
    displayError(error) {
        if (!process.stderr.isTTY) return;
        
        process.stderr.write('\r' + ' '.repeat(80) + '\r'); // Clear line
        console.error(`❌ Upload failed: ${error.message}`);
        
        if (this.bytesUploaded > 0) {
            const percentage = this.totalBytes > 0 
                ? ((this.bytesUploaded / this.totalBytes) * 100).toFixed(1)
                : 'unknown';
            console.error(`   Uploaded ${this.formatBytes(this.bytesUploaded)} (${percentage}%) before failure`);
        }
    }

    /**
     * Format bytes for display
     * @param {number} bytes - Bytes to format
     * @returns {string} Formatted string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
    }

    /**
     * Format time for display
     * @param {number} seconds - Seconds to format
     * @returns {string} Formatted string
     */
    formatTime(seconds) {
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        } else if (seconds < 3600) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.round(seconds % 60);
            return `${mins}m ${secs}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            return `${hours}h ${mins}m`;
        }
    }

    /**
     * Create a progress tracker for PowerShell uploads
     * @param {string} filePath - File being uploaded
     * @returns {Object} Progress tracking functions
     */
    static createTracker(filePath) {
        const progress = new UploadProgress({
            showSpinner: true,
            showPercentage: true,
            showSpeed: true,
            showETA: true
        });

        // Start tracking
        progress.start(filePath);

        // Return control functions
        return {
            update: (bytes) => progress.update(bytes),
            setProgress: (bytes) => progress.setProgress(bytes),
            complete: () => progress.complete(),
            fail: (error) => progress.fail(error),
            pause: () => progress.pause(),
            resume: () => progress.resume(),
            getStatus: () => progress.getStatus(),
            instance: progress
        };
    }
}

module.exports = UploadProgress;
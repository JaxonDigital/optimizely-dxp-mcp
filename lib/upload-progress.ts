/**
 * Upload Progress Module
 * Provides progress tracking for large file uploads
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// Type definitions
interface UploadProgressOptions {
    updateInterval?: number;
    showSpinner?: boolean;
    showPercentage?: boolean;
    showSpeed?: boolean;
    showETA?: boolean;
}

interface UploadStatus {
    bytesUploaded: number;
    totalBytes: number;
    percentage: number;
    elapsed: number;
    speed: number;
    eta: number;
    isComplete: boolean;
    isPaused: boolean;
}

interface StartEvent {
    totalBytes: number;
    fileName: string;
}

interface CompleteEvent {
    totalBytes: number;
    duration: number;
    averageSpeed: number;
}

interface ErrorEvent {
    error: Error;
    bytesUploaded: number;
    totalBytes: number;
}

interface ProgressTracker {
    update: (bytes: number) => void;
    setProgress: (bytes: number) => void;
    complete: () => void;
    fail: (error: Error) => void;
    pause: () => void;
    resume: () => void;
    getStatus: () => UploadStatus;
    instance: UploadProgress;
}

class UploadProgress extends EventEmitter {
    private options: Required<UploadProgressOptions>;
    private startTime: number | null;
    private bytesUploaded: number;
    private totalBytes: number;
    private lastUpdate: number | null;
    private lastBytes: number;
    private speeds: number[];
    private isComplete: boolean;
    private isPaused: boolean;

    constructor(options: UploadProgressOptions = {}) {
        super();
        this.options = {
            updateInterval: options.updateInterval || 1000, // Update every second
            showSpinner: options.showSpinner !== false,
            showPercentage: options.showPercentage !== false,
            showSpeed: options.showSpeed !== false,
            showETA: options.showETA !== false
        };

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
     * Reset progress tracking
     */
    reset(): void {
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
     */
    async start(filePath: string | null, totalBytes: number | null = null): Promise<void> {
        this.reset();

        // Get file size if not provided
        if (!totalBytes && filePath) {
            try {
                const stats = await fs.promises.stat(filePath);
                this.totalBytes = stats.size;
            } catch (error) {
                console.error('Could not get file size:', (error as Error).message);
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
        } as StartEvent);

        // Start progress display
        this.displayProgress();
    }

    /**
     * Update progress with bytes uploaded
     */
    update(bytes: number): void {
        if (this.isComplete || this.isPaused) return;

        this.bytesUploaded += bytes;
        const now = Date.now();

        // Calculate speed
        if (this.lastUpdate && now - this.lastUpdate >= this.options.updateInterval) {
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
     */
    setProgress(bytesUploaded: number): void {
        if (this.isComplete || this.isPaused) return;

        const bytes = bytesUploaded - this.bytesUploaded;
        this.update(bytes);
    }

    /**
     * Mark upload as complete
     */
    complete(): void {
        if (this.isComplete) return;

        this.isComplete = true;
        this.bytesUploaded = this.totalBytes || this.bytesUploaded;

        const duration = (Date.now() - (this.startTime || 0)) / 1000;

        // Emit complete event
        this.emit('complete', {
            totalBytes: this.bytesUploaded,
            duration,
            averageSpeed: this.bytesUploaded / duration
        } as CompleteEvent);

        // Final display
        this.displayComplete();
    }

    /**
     * Mark upload as failed
     */
    fail(error: Error): void {
        if (this.isComplete) return;

        this.isComplete = true;

        // Emit error event
        this.emit('error', {
            error,
            bytesUploaded: this.bytesUploaded,
            totalBytes: this.totalBytes
        } as ErrorEvent);

        // Display error
        this.displayError(error);
    }

    /**
     * Pause progress tracking
     */
    pause(): void {
        this.isPaused = true;
        this.emit('pause');
    }

    /**
     * Resume progress tracking
     */
    resume(): void {
        this.isPaused = false;
        this.lastUpdate = Date.now();
        this.emit('resume');
    }

    /**
     * Get current status
     */
    getStatus(): UploadStatus {
        const now = Date.now();
        const elapsed = (now - (this.startTime || 0)) / 1000;
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
    private displayProgress(): void {
        if (this.isComplete || !process.stderr.isTTY) return;

        const status = this.getStatus();
        const parts: string[] = [];

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
    private displayComplete(): void {
        if (!process.stderr.isTTY) return;

        const duration = (Date.now() - (this.startTime || 0)) / 1000;
        const avgSpeed = this.bytesUploaded / duration;

        process.stderr.write('\r' + ' '.repeat(80) + '\r'); // Clear line
        console.error(`✅ Upload complete: ${this.formatBytes(this.bytesUploaded)} in ${this.formatTime(duration)} (${this.formatBytes(avgSpeed)}/s)`);
    }

    /**
     * Display error message
     */
    private displayError(error: Error): void {
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
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';

        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
    }

    /**
     * Format time for display
     */
    private formatTime(seconds: number): string {
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
     */
    static createTracker(filePath: string): ProgressTracker {
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

export default UploadProgress;

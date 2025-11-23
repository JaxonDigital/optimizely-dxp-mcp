/**
 * Manifest Manager - Tracks downloaded files for incremental downloads
 * Enables smart diff downloads by maintaining a manifest of what's already downloaded
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import OutputLogger from './output-logger';

// Type definitions
interface FileEntry {
    name: string;
    size: number;
    lastModified: string;
    downloadedAt: string;
    checksum: string | null;
    source: string;
}

interface ManifestStatistics {
    totalFiles: number;
    totalSize: number;
    lastSync: string | null;
    lastIncrementalDownload: string | null;
}

interface Manifest {
    version: string;
    created: string;
    updated: string;
    downloadPath: string;
    files: { [key: string]: FileEntry };
    statistics: ManifestStatistics;
}

interface FileInfo {
    size?: number;
    lastModified?: string;
    checksum?: string | null;
    source?: string;
}

interface RemoteFile {
    name: string;
    size: number;
    lastModified?: string;
    checksum?: string;
    [key: string]: any;
}

interface SkippedFile {
    name: string;
    reason: string;
    size: number;
}

interface FilesToDownloadResult {
    manifest: Manifest;
    filesToDownload: RemoteFile[];
    skippedFiles: SkippedFile[];
    totalRemoteFiles: number;
}

class ManifestManager {
    /**
     * Get manifest file path for a download location
     */
    static getManifestPath(downloadPath: string): string {
        return path.join(downloadPath, '.download-manifest.json');
    }

    /**
     * Load existing manifest or create new one
     */
    static async loadManifest(downloadPath: string): Promise<Manifest> {
        const manifestPath = this.getManifestPath(downloadPath);

        try {
            const data = await fs.readFile(manifestPath, 'utf8');
            const manifest: Manifest = JSON.parse(data);

            // Validate manifest structure
            if (!manifest.version || !manifest.files) {
                throw new Error('Invalid manifest structure');
            }

            return manifest;
        } catch (error) {
            // Create new manifest if doesn't exist or invalid
            return {
                version: '1.0.0',
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                downloadPath: downloadPath,
                files: {},
                statistics: {
                    totalFiles: 0,
                    totalSize: 0,
                    lastSync: null,
                    lastIncrementalDownload: null
                }
            };
        }
    }

    /**
     * Save manifest to disk
     */
    static async saveManifest(downloadPath: string, manifest: Manifest): Promise<void> {
        const manifestPath = this.getManifestPath(downloadPath);

        // Update metadata
        manifest.updated = new Date().toISOString();
        manifest.statistics.totalFiles = Object.keys(manifest.files).length;
        manifest.statistics.totalSize = Object.values(manifest.files).reduce((sum, file) => sum + (file.size || 0), 0);

        // Pretty print for readability
        const manifestJson = JSON.stringify(manifest, null, 2);

        try {
            await fs.writeFile(manifestPath, manifestJson, 'utf8');
            OutputLogger.info(`[MANIFEST] ✅ Saved manifest with ${manifest.statistics.totalFiles} files to ${manifestPath}`);
        } catch (error) {
            OutputLogger.error(`[MANIFEST] ❌ Failed to save manifest: ${(error as Error).message}`);
            throw error; // Re-throw to ensure caller knows save failed
        }
    }

    /**
     * Add file to manifest
     */
    static addFileToManifest(manifest: Manifest, fileName: string, fileInfo: FileInfo): void {
        manifest.files[fileName] = {
            name: fileName,
            size: fileInfo.size || 0,
            lastModified: fileInfo.lastModified || new Date().toISOString(),
            downloadedAt: new Date().toISOString(),
            checksum: fileInfo.checksum || null,
            source: fileInfo.source || 'unknown'
        };
    }

    /**
     * Check if file exists in manifest and is up to date
     */
    static isFileUpToDate(manifest: Manifest, fileName: string, remoteFileInfo: RemoteFile): boolean {
        const localFile = manifest.files[fileName];

        if (!localFile) {
            OutputLogger.debug(`[MANIFEST] ${fileName} not in manifest`);
            return false;
        }

        // If we have checksums, compare them
        if (localFile.checksum && remoteFileInfo.checksum) {
            const match = localFile.checksum === remoteFileInfo.checksum;
            OutputLogger.debug(`[MANIFEST] ${fileName} checksum ${match ? 'matches' : 'differs'}`);
            return match;
        }

        // Otherwise compare size and modified time
        if (localFile.size !== remoteFileInfo.size) {
            OutputLogger.debug(`[MANIFEST] ${fileName} size mismatch: local=${localFile.size}, remote=${remoteFileInfo.size}`);
            return false;
        }

        // If remote file is newer, we should download it
        if (remoteFileInfo.lastModified) {
            const localModified = new Date(localFile.lastModified);
            const remoteModified = new Date(remoteFileInfo.lastModified);
            const isOlder = remoteModified <= localModified;
            OutputLogger.debug(`[MANIFEST] ${fileName} date check: remote=${remoteModified.toISOString()}, local=${localModified.toISOString()}, up-to-date=${isOlder}`);
            return isOlder;
        }

        // If we can't determine, assume it's up to date
        OutputLogger.debug(`[MANIFEST] ${fileName} assumed up-to-date (no date info)`);
        return true;
    }

    /**
     * Get list of files that need to be downloaded
     */
    static async getFilesToDownload(downloadPath: string, remoteFiles: RemoteFile[]): Promise<FilesToDownloadResult> {
        const manifest = await this.loadManifest(downloadPath);
        const filesToDownload: RemoteFile[] = [];
        const skippedFiles: SkippedFile[] = [];

        // Debug: Log manifest state
        const manifestFileCount = Object.keys(manifest.files || {}).length;
        OutputLogger.debug(`[MANIFEST] Checking ${remoteFiles.length} remote files against ${manifestFileCount} files in manifest`);

        for (const remoteFile of remoteFiles) {
            const fileName = remoteFile.name;

            // Check if file exists locally and is up to date
            const isUpToDate = this.isFileUpToDate(manifest, fileName, remoteFile);

            if (isUpToDate) {
                // Also verify the file actually exists on disk
                const localPath = path.join(downloadPath, fileName);
                try {
                    await fs.access(localPath);
                    skippedFiles.push({
                        name: fileName,
                        reason: 'up-to-date',
                        size: remoteFile.size
                    });
                    OutputLogger.debug(`[MANIFEST] Skipping ${fileName} - already up-to-date`);
                    continue;
                } catch (error) {
                    // File in manifest but not on disk, need to download
                    OutputLogger.debug(`[MANIFEST] File ${fileName} in manifest but missing on disk - will download`);
                }
            } else {
                OutputLogger.debug(`[MANIFEST] File ${fileName} needs download - not in manifest or outdated`);
            }

            filesToDownload.push(remoteFile);
        }

        return {
            manifest,
            filesToDownload,
            skippedFiles,
            totalRemoteFiles: remoteFiles.length
        };
    }

    /**
     * Calculate checksum for a file
     */
    static async calculateChecksum(filePath: string): Promise<string | null> {
        try {
            const data = await fs.readFile(filePath);
            return crypto.createHash('md5').update(data).digest('hex');
        } catch (error) {
            return null;
        }
    }

    /**
     * Clean manifest of deleted files
     */
    static async cleanManifest(downloadPath: string, manifest: Manifest): Promise<number> {
        const deletedFiles: string[] = [];

        for (const fileName of Object.keys(manifest.files)) {
            const filePath = path.join(downloadPath, fileName);
            try {
                await fs.access(filePath);
            } catch (error) {
                // File no longer exists
                delete manifest.files[fileName];
                deletedFiles.push(fileName);
            }
        }

        if (deletedFiles.length > 0) {
            if (process.env.DEBUG === 'true') {
                console.error(`[MANIFEST] Removed ${deletedFiles.length} deleted files from manifest`);
            }
            await this.saveManifest(downloadPath, manifest);
        }

        return deletedFiles.length;
    }

    /**
     * Generate download summary report
     */
    static generateIncrementalSummary(skippedFiles: SkippedFile[], filesToDownload: RemoteFile[]): string {
        const skippedSize = skippedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
        const downloadSize = filesToDownload.reduce((sum, f) => sum + (f.size || 0), 0);
        const totalSize = skippedSize + downloadSize;
        const savedPercentage = totalSize > 0 ? Math.round((skippedSize / totalSize) * 100) : 0;

        let summary = `## 📊 Incremental Download Summary\n\n`;
        summary += `• **Files already up-to-date**: ${skippedFiles.length}\n`;
        summary += `• **Files to download**: ${filesToDownload.length}\n`;
        summary += `• **Data already local**: ${this.formatBytes(skippedSize)}\n`;
        summary += `• **Data to download**: ${this.formatBytes(downloadSize)}\n`;
        summary += `• **Bandwidth saved**: ${savedPercentage}%\n\n`;

        if (skippedFiles.length > 0 && process.env.DEBUG === 'true') {
            summary += `### Skipped Files (first 10)\n`;
            skippedFiles.slice(0, 10).forEach(f => {
                summary += `• ${f.name} (${f.reason})\n`;
            });
            if (skippedFiles.length > 10) {
                summary += `• ... and ${skippedFiles.length - 10} more\n`;
            }
            summary += '\n';
        }

        return summary;
    }

    /**
     * Format bytes to human readable
     */
    static formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

export default ManifestManager;

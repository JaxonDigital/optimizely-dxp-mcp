/**
 * Manifest Manager - Tracks downloaded files for incremental downloads
 * Enables smart diff downloads by maintaining a manifest of what's already downloaded
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const OutputLogger = require('./output-logger');

class ManifestManager {
    /**
     * Get manifest file path for a download location
     */
    static getManifestPath(downloadPath) {
        return path.join(downloadPath, '.download-manifest.json');
    }

    /**
     * Load existing manifest or create new one
     */
    static async loadManifest(downloadPath) {
        const manifestPath = this.getManifestPath(downloadPath);
        
        try {
            const data = await fs.readFile(manifestPath, 'utf8');
            const manifest = JSON.parse(data);
            
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
    static async saveManifest(downloadPath, manifest) {
        const manifestPath = this.getManifestPath(downloadPath);
        
        // Update metadata
        manifest.updated = new Date().toISOString();
        manifest.statistics.totalFiles = Object.keys(manifest.files).length;
        manifest.statistics.totalSize = Object.values(manifest.files).reduce((sum, file) => sum + (file.size || 0), 0);
        
        // Pretty print for readability
        const manifestJson = JSON.stringify(manifest, null, 2);
        
        try {
            await fs.writeFile(manifestPath, manifestJson, 'utf8');
            if (process.env.DEBUG === 'true') {
                console.error(`[MANIFEST] Saved manifest with ${manifest.statistics.totalFiles} files`);
            }
        } catch (error) {
            OutputLogger.warn(`Failed to save manifest: ${error.message}`);
        }
    }

    /**
     * Add file to manifest
     */
    static addFileToManifest(manifest, fileName, fileInfo) {
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
    static isFileUpToDate(manifest, fileName, remoteFileInfo) {
        const localFile = manifest.files[fileName];
        
        if (!localFile) {
            return false;
        }
        
        // If we have checksums, compare them
        if (localFile.checksum && remoteFileInfo.checksum) {
            return localFile.checksum === remoteFileInfo.checksum;
        }
        
        // Otherwise compare size and modified time
        if (localFile.size !== remoteFileInfo.size) {
            return false;
        }
        
        // If remote file is newer, we should download it
        if (remoteFileInfo.lastModified) {
            const localModified = new Date(localFile.lastModified);
            const remoteModified = new Date(remoteFileInfo.lastModified);
            return remoteModified <= localModified;
        }
        
        // If we can't determine, assume it's up to date
        return true;
    }

    /**
     * Get list of files that need to be downloaded
     */
    static async getFilesToDownload(downloadPath, remoteFiles) {
        const manifest = await this.loadManifest(downloadPath);
        const filesToDownload = [];
        const skippedFiles = [];
        
        for (const remoteFile of remoteFiles) {
            const fileName = remoteFile.name;
            
            // Check if file exists locally and is up to date
            if (this.isFileUpToDate(manifest, fileName, remoteFile)) {
                // Also verify the file actually exists on disk
                const localPath = path.join(downloadPath, fileName);
                try {
                    await fs.access(localPath);
                    skippedFiles.push({
                        name: fileName,
                        reason: 'up-to-date',
                        size: remoteFile.size
                    });
                    continue;
                } catch (error) {
                    // File in manifest but not on disk, need to download
                    if (process.env.DEBUG === 'true') {
                        console.error(`[MANIFEST] File in manifest but missing on disk: ${fileName}`);
                    }
                }
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
    static async calculateChecksum(filePath) {
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
    static async cleanManifest(downloadPath, manifest) {
        const deletedFiles = [];
        
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
    static generateIncrementalSummary(skippedFiles, filesToDownload) {
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
    static formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

module.exports = ManifestManager;
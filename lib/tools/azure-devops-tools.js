/**
 * Azure DevOps Tools Module
 * Handles Azure DevOps artifact download and integration
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { ResponseBuilder, Config } = require('../index');

class AzureDevOpsTools {
    /**
     * Download artifact from Azure DevOps and extract .nupkg file
     */
    static async downloadArtifact(artifactUrl, options = {}) {
        const { pat, artifactName = 'drop', downloadPath, timeout = 300000 } = options;
        
        if (!pat) {
            throw new Error('Azure DevOps Personal Access Token is required');
        }

        console.error('🔗 Downloading Azure DevOps artifact...');
        console.error(`📍 URL: ${this.maskUrl(artifactUrl)}`);

        let tempZipPath = null;
        let extractedDir = null;

        try {
            // Parse the artifact URL to understand the structure
            const urlInfo = this.parseArtifactUrl(artifactUrl);
            
            // Build the download URL
            const downloadUrl = this.buildDownloadUrl(urlInfo, artifactName);
            
            console.error(`📦 Artifact: ${artifactName}`);
            console.error(`🔽 Download URL: ${this.maskUrl(downloadUrl)}`);
            console.error(`🔧 API Type: ${urlInfo.apiType} | Direct File: ${urlInfo.isDirectFile || 'false'}`);

            // Create temporary download path for ZIP file
            tempZipPath = this.createTempDownloadPath(artifactName);
            
            // Ensure download directory exists
            await fs.mkdir(path.dirname(tempZipPath), { recursive: true });

            // Check if this is a direct .nupkg download (Resources API)
            const isDirect = urlInfo.apiType === 'resources' && 
                            (urlInfo.artifactPath?.endsWith('.nupkg') || 
                             downloadUrl.includes('.nupkg') || 
                             (artifactName.includes('.nupkg') && !downloadUrl.includes('$format=zip')));
            
            if (isDirect) {
                // Direct .nupkg download - no extraction needed
                const finalDownloadPath = downloadPath || tempZipPath.replace('.zip', '.nupkg');
                await this.downloadFile(downloadUrl, finalDownloadPath, pat, timeout);
                
                const finalStats = await fs.stat(finalDownloadPath);
                const finalSizeMB = (finalStats.size / (1024 * 1024)).toFixed(2);
                
                console.error(`✅ NuGet package downloaded directly: ${finalSizeMB} MB`);
                console.error(`📁 Location: ${finalDownloadPath}`);

                return {
                    success: true,
                    downloadPath: finalDownloadPath,
                    size: finalStats.size,
                    sizeMB: finalSizeMB,
                    artifactName: artifactName,
                    extractedFrom: 'Direct download (no extraction needed)'
                };
            } else {
                // ZIP download - needs extraction
                await this.downloadFile(downloadUrl, tempZipPath, pat, timeout);
                
                // Verify the download
                const zipStats = await fs.stat(tempZipPath);
                const zipSizeMB = (zipStats.size / (1024 * 1024)).toFixed(2);
                
                console.error(`✅ ZIP downloaded: ${zipSizeMB} MB`);
                console.error(`📂 Extracting artifact contents...`);

                // Extract the ZIP file
                extractedDir = await this.extractZipFile(tempZipPath);
                
                // Find the .nupkg file inside the extracted contents
                const nupkgPath = await this.findNupkgFile(extractedDir);
                
                if (!nupkgPath) {
                    throw new Error('No .nupkg file found in the Azure DevOps artifact');
                }

                // Move the .nupkg to final location or use the found path
                const finalDownloadPath = downloadPath || nupkgPath;
                if (downloadPath && downloadPath !== nupkgPath) {
                    await fs.copyFile(nupkgPath, finalDownloadPath);
                }

                // Get final file stats
                const finalStats = await fs.stat(finalDownloadPath);
                const finalSizeMB = (finalStats.size / (1024 * 1024)).toFixed(2);
                
                console.error(`✅ NuGet package extracted: ${finalSizeMB} MB`);
                console.error(`📁 Location: ${finalDownloadPath}`);

                // Clean up temporary files
                await this.cleanupTempFiles(tempZipPath, extractedDir, nupkgPath !== finalDownloadPath ? nupkgPath : null);
                
                return {
                    success: true,
                    downloadPath: finalDownloadPath,
                    size: finalStats.size,
                    sizeMB: finalSizeMB,
                    artifactName: artifactName,
                    extractedFrom: path.basename(tempZipPath)
                };
            }

        } catch (error) {
            // Clean up on error
            if (tempZipPath || extractedDir) {
                await this.cleanupTempFiles(tempZipPath, extractedDir).catch(() => {});
            }
            
            console.error(`❌ Artifact download failed: ${error.message}`);
            throw new Error(`Failed to download Azure DevOps artifact: ${error.message}`);
        }
    }

    /**
     * Parse Azure DevOps artifact URL to extract components
     */
    static parseArtifactUrl(artifactUrl) {
        // Support different Azure DevOps URL formats:
        // Build API: https://dev.azure.com/{org}/{project}/_apis/build/builds/{buildId}/artifacts  
        // Resources API: https://dev.azure.com/{org}/_apis/resources/Containers/{containerId}/drop
        // Build results: https://dev.azure.com/{org}/{project}/_build/results?buildId={buildId}
        // Legacy: https://{org}.visualstudio.com/{project}/_apis/build/builds/{buildId}/artifacts

        const patterns = [
            // Resources API format (newer, more reliable)
            {
                pattern: /https:\/\/dev\.azure\.com\/([^\/]+)\/_apis\/resources\/Containers\/(\d+)\/([^?]+)/,
                type: 'resources',
                extract: (match) => ({
                    organization: match[1],
                    containerId: match[2],
                    artifactPath: match[3],
                    baseUrl: `https://dev.azure.com/${match[1]}`,
                    // Detect if this is a direct file link
                    isDirectFile: match[3].includes('.nupkg') || match[3].includes('.')
                })
            },
            // Modern Azure DevOps Build API format
            {
                pattern: /https:\/\/dev\.azure\.com\/([^\/]+)\/([^\/]+)\/_apis\/build\/builds\/(\d+)\/artifacts/,
                type: 'build',
                extract: (match) => ({
                    organization: match[1],
                    project: match[2],
                    buildId: match[3],
                    baseUrl: `https://dev.azure.com/${match[1]}/${match[2]}`
                })
            },
            // Legacy Visual Studio format  
            {
                pattern: /https:\/\/([^\.]+)\.visualstudio\.com\/([^\/]+)\/_apis\/build\/builds\/(\d+)\/artifacts/,
                type: 'build',
                extract: (match) => ({
                    organization: match[1],
                    project: match[2],
                    buildId: match[3],
                    baseUrl: `https://${match[1]}.visualstudio.com/${match[2]}`
                })
            },
            // Build results format - need to convert to API URL
            {
                pattern: /https:\/\/dev\.azure\.com\/([^\/]+)\/([^\/]+)\/_build\/results\?buildId=(\d+)/,
                type: 'build',
                extract: (match) => ({
                    organization: match[1],
                    project: match[2], 
                    buildId: match[3],
                    baseUrl: `https://dev.azure.com/${match[1]}/${match[2]}`
                })
            }
        ];

        for (const { pattern, type, extract } of patterns) {
            const match = artifactUrl.match(pattern);
            if (match) {
                const result = extract(match);
                result.apiType = type;
                return result;
            }
        }

        throw new Error(`Unsupported Azure DevOps URL format: ${artifactUrl}. Supported formats:
- Resources API: https://dev.azure.com/{org}/_apis/resources/Containers/{id}/drop
- Build API: https://dev.azure.com/{org}/{project}/_apis/build/builds/{id}/artifacts  
- Build Results: https://dev.azure.com/{org}/{project}/_build/results?buildId={id}`);
    }

    /**
     * Build the direct download URL for an artifact
     */
    static buildDownloadUrl(urlInfo, artifactName = 'drop') {
        const { apiType } = urlInfo;
        
        if (apiType === 'resources') {
            // Resources API - can do direct download or ZIP container
            const { organization, containerId, artifactPath } = urlInfo;
            
            // If we already have the full path to a specific file, download it directly
            if (artifactPath && artifactPath !== 'drop') {
                // Direct file download (e.g., drop/filename.nupkg)
                return `https://dev.azure.com/${organization}/_apis/resources/Containers/${containerId}/${artifactPath}?api-version=7.0-preview`;
            }
            
            // If artifactName looks like a specific file, try direct download first
            if (artifactName.includes('.nupkg') || artifactName.includes('.')) {
                return `https://dev.azure.com/${organization}/_apis/resources/Containers/${containerId}/drop/${artifactName}?api-version=7.0-preview`;
            }
            
            // Otherwise, download the container as ZIP for extraction
            return `https://dev.azure.com/${organization}/_apis/resources/Containers/${containerId}/${artifactName}?api-version=7.0-preview&$format=zip`;
            
        } else if (apiType === 'build') {
            // Build API - traditional approach
            const { organization, project, buildId, baseUrl } = urlInfo;
            
            const apiUrl = baseUrl.includes('dev.azure.com')
                ? `https://dev.azure.com/${organization}/${project}/_apis/build/builds/${buildId}/artifacts`
                : `${baseUrl}/_apis/build/builds/${buildId}/artifacts`;
                
            // Add query parameters for specific artifact and format
            return `${apiUrl}?artifactName=${encodeURIComponent(artifactName)}&api-version=7.0&$format=zip`;
        }
        
        throw new Error(`Unsupported API type: ${apiType}`);
    }

    /**
     * Create a temporary download path for the artifact
     */
    static createTempDownloadPath(artifactName) {
        const tempDir = os.tmpdir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const randomId = crypto.randomBytes(4).toString('hex');
        const fileName = `azure-artifact-${artifactName}-${timestamp}-${randomId}.zip`;
        
        return path.join(tempDir, 'optimizely-dxp-mcp', fileName);
    }

    /**
     * Download file from Azure DevOps with authentication
     */
    static async downloadFile(url, filePath, pat, timeout = 300000) {
        return new Promise((resolve, reject) => {
            // Create Basic Authentication header
            const auth = Buffer.from(`:${pat}`).toString('base64');
            const headers = {
                'Authorization': `Basic ${auth}`,
                'User-Agent': 'Optimizely-DXP-MCP/3.8.2',
                'Accept': 'application/octet-stream'
            };

            console.error('🔐 Authenticating with Azure DevOps...');

            const request = https.get(url, { headers, timeout }, (response) => {
                // Handle redirects - Azure DevOps often redirects to a different domain
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    console.error(`↪️  Following redirect: ${response.statusCode}`);
                    // IMPORTANT: Don't pass PAT to redirected URLs as they may be to different domains
                    // Azure DevOps redirects include authentication tokens in the URL itself
                    const redirectUrl = response.headers.location;
                    
                    // If redirect is to visualstudio.com or dev.azure.com, keep auth headers
                    // Otherwise, it's likely a signed URL that doesn't need auth
                    const needsAuth = redirectUrl.includes('visualstudio.com') || 
                                    redirectUrl.includes('dev.azure.com') ||
                                    redirectUrl.includes('azure.com');
                    
                    if (needsAuth) {
                        return this.downloadFile(redirectUrl, filePath, pat, timeout)
                            .then(resolve)
                            .catch(reject);
                    } else {
                        // For storage URLs, download without PAT
                        return this.downloadFileWithoutAuth(redirectUrl, filePath, timeout)
                            .then(resolve)
                            .catch(reject);
                    }
                }

                // Accept any 2xx status code as success
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    // Check if we got HTML instead of binary data
                    const contentType = response.headers['content-type'] || '';
                    if (contentType.includes('text/html')) {
                        return reject(new Error(`Authentication failed - received HTML login page instead of artifact. Check PAT token and permissions.`));
                    }
                    return reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                }

                // Get content length for progress tracking
                const totalBytes = parseInt(response.headers['content-length'], 10);
                let downloadedBytes = 0;
                let lastProgressUpdate = 0;

                // Create write stream
                const fileStream = require('fs').createWriteStream(filePath);

                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    fileStream.write(chunk);

                    // Show progress every 5% or 5MB, whichever is more frequent
                    if (totalBytes) {
                        const progress = (downloadedBytes / totalBytes) * 100;
                        const progressThreshold = Math.max(5, Math.min(10, totalBytes / (20 * 1024 * 1024))); // At least 5%, max 10%
                        
                        if (progress - lastProgressUpdate >= progressThreshold) {
                            const sizeMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                            const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                            console.error(`📥 Downloading: ${progress.toFixed(0)}% (${sizeMB}/${totalMB} MB)`);
                            lastProgressUpdate = progress;
                        }
                    }
                });

                response.on('end', () => {
                    fileStream.end();
                    resolve();
                });

                response.on('error', (error) => {
                    fileStream.destroy();
                    fs.unlink(filePath).catch(() => {}); // Clean up on error
                    reject(error);
                });

                fileStream.on('error', (error) => {
                    reject(error);
                });
            });

            request.on('timeout', () => {
                request.destroy();
                reject(new Error('Download timeout after ' + (timeout / 1000) + ' seconds'));
            });

            request.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Download file without authentication (for signed URLs)
     */
    static async downloadFileWithoutAuth(url, filePath, timeout = 300000) {
        return new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': 'Optimizely-DXP-MCP/3.10.0',
                'Accept': 'application/octet-stream'
            };

            console.error('📥 Downloading from signed URL...');

            const request = https.get(url, { headers, timeout }, (response) => {
                // Handle additional redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    console.error(`↪️  Following redirect: ${response.statusCode}`);
                    return this.downloadFileWithoutAuth(response.headers.location, filePath, timeout)
                        .then(resolve)
                        .catch(reject);
                }

                // Accept any 2xx status code
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    return reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                }

                // Get content length for progress tracking
                const totalBytes = parseInt(response.headers['content-length'], 10);
                let downloadedBytes = 0;
                let lastProgressUpdate = 0;

                // Create write stream
                const fileStream = require('fs').createWriteStream(filePath);

                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    fileStream.write(chunk);

                    // Show progress
                    if (totalBytes) {
                        const progress = (downloadedBytes / totalBytes) * 100;
                        const progressThreshold = Math.max(5, Math.min(10, totalBytes / (20 * 1024 * 1024)));
                        
                        if (progress - lastProgressUpdate >= progressThreshold) {
                            const sizeMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                            const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                            console.error(`📥 Downloading: ${progress.toFixed(0)}% (${sizeMB}/${totalMB} MB)`);
                            lastProgressUpdate = progress;
                        }
                    }
                });

                response.on('end', () => {
                    fileStream.end();
                    resolve();
                });

                response.on('error', (error) => {
                    fileStream.destroy();
                    fs.unlink(filePath).catch(() => {});
                    reject(error);
                });

                fileStream.on('error', (error) => {
                    reject(error);
                });
            });

            request.on('timeout', () => {
                request.destroy();
                reject(new Error('Download timeout after ' + (timeout / 1000) + ' seconds'));
            });

            request.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Mask sensitive parts of URLs for logging
     */
    static maskUrl(url) {
        // Mask organization and project names for privacy in logs
        return url.replace(
            /(https:\/\/[^\/]+\/)([^\/]+)\/([^\/]+)/,
            '$1***/$3'
        ).replace(
            /buildId=(\d+)/,
            'buildId=***'
        );
    }

    /**
     * Extract ZIP file using Node.js built-in capabilities
     */
    static async extractZipFile(zipPath) {
        const { spawn } = require('child_process');
        const extractDir = path.join(path.dirname(zipPath), `extracted-${crypto.randomBytes(4).toString('hex')}`);
        
        await fs.mkdir(extractDir, { recursive: true });
        
        return new Promise((resolve, reject) => {
            // Use platform-specific unzip command
            const isWindows = process.platform === 'win32';
            const command = isWindows ? 'powershell' : 'unzip';
            const args = isWindows 
                ? ['-Command', `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}"`]
                : ['-q', zipPath, '-d', extractDir];
            
            console.error(`🔧 Extracting with: ${command} ${args.join(' ')}`);
            
            const unzipProcess = spawn(command, args);
            
            let stderr = '';
            unzipProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            unzipProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(extractDir);
                } else {
                    reject(new Error(`Extraction failed with code ${code}: ${stderr}`));
                }
            });
            
            unzipProcess.on('error', (error) => {
                reject(new Error(`Extraction command failed: ${error.message}`));
            });
        });
    }

    /**
     * Find .nupkg file recursively in extracted directory
     */
    static async findNupkgFile(directory) {
        const findNupkg = async (dir) => {
            const items = await fs.readdir(dir);
            
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = await fs.stat(fullPath);
                
                if (stat.isDirectory()) {
                    // Recursively search subdirectories
                    const found = await findNupkg(fullPath);
                    if (found) return found;
                } else if (item.toLowerCase().endsWith('.nupkg')) {
                    console.error(`🎯 Found NuGet package: ${item}`);
                    return fullPath;
                }
            }
            return null;
        };
        
        return await findNupkg(directory);
    }

    /**
     * Clean up temporary files and directories
     */
    static async cleanupTempFiles(zipPath, extractedDir, nupkgPath) {
        const cleanup = async (filePath, description) => {
            if (!filePath) return;
            
            try {
                const stat = await fs.stat(filePath);
                if (stat.isDirectory()) {
                    await fs.rm(filePath, { recursive: true, force: true });
                } else {
                    await fs.unlink(filePath);
                }
                console.error(`🧹 Cleaned up ${description}: ${path.basename(filePath)}`);
            } catch (error) {
                console.error(`⚠️  Could not clean up ${description}: ${error.message}`);
            }
        };
        
        await cleanup(zipPath, 'ZIP file');
        await cleanup(extractedDir, 'extracted directory');
        await cleanup(nupkgPath, 'temporary NuGet package');
    }

    /**
     * Clean up downloaded artifacts (legacy method for compatibility)
     */
    static async cleanupArtifact(artifactPath) {
        try {
            await fs.unlink(artifactPath);
            console.error(`🧹 Cleaned up artifact: ${path.basename(artifactPath)}`);
        } catch (error) {
            console.error(`⚠️  Could not clean up artifact: ${error.message}`);
        }
    }

    /**
     * Validate Azure DevOps Personal Access Token
     */
    static async validatePat(pat, testUrl) {
        try {
            // Try to make a simple API call to validate the token
            const auth = Buffer.from(`:${pat}`).toString('base64');
            const headers = {
                'Authorization': `Basic ${auth}`,
                'User-Agent': 'Optimizely-DXP-MCP/3.8.2'
            };

            return new Promise((resolve, reject) => {
                const request = https.get(testUrl, { headers }, (response) => {
                    if (response.statusCode === 401) {
                        reject(new Error('Invalid Azure DevOps Personal Access Token'));
                    } else if (response.statusCode === 403) {
                        reject(new Error('Azure DevOps PAT does not have sufficient permissions'));
                    } else if (response.statusCode >= 200 && response.statusCode < 300) {
                        resolve(true);
                    } else {
                        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    }
                    
                    // Consume the response to prevent memory leaks
                    response.on('data', () => {});
                    response.on('end', () => {});
                });

                request.on('error', reject);
                request.setTimeout(10000, () => {
                    request.destroy();
                    reject(new Error('Token validation timeout'));
                });
            });
        } catch (error) {
            throw new Error(`Failed to validate Azure DevOps PAT: ${error.message}`);
        }
    }

    /**
     * Extract build information from webhook payload
     */
    static extractBuildInfo(webhookPayload) {
        try {
            const resource = webhookPayload.resource;
            if (!resource) {
                throw new Error('Invalid webhook payload: missing resource');
            }

            return {
                buildId: resource.id,
                buildNumber: resource.buildNumber,
                result: resource.result,
                status: resource.status,
                repositoryName: resource.repository?.name,
                repositoryUrl: resource.repository?.url,
                definitionName: resource.definition?.name,
                requestedBy: resource.requestedBy?.displayName,
                downloadUrl: resource.downloadUrl,
                // Construct the artifact URL if not provided
                artifactUrl: resource.downloadUrl || this.buildArtifactUrlFromPayload(resource)
            };
        } catch (error) {
            throw new Error(`Failed to extract build info from webhook: ${error.message}`);
        }
    }

    /**
     * Build artifact URL from webhook payload resource
     */
    static buildArtifactUrlFromPayload(resource) {
        // Extract from various possible locations in the payload
        if (resource.repository?.url) {
            const repoUrl = resource.repository.url;
            const match = repoUrl.match(/https:\/\/([^\/]+)\/([^\/]+)\//);
            if (match && resource.id) {
                const [, org, project] = match;
                return `https://dev.azure.com/${org}/${project}/_apis/build/builds/${resource.id}/artifacts`;
            }
        }
        
        throw new Error('Cannot construct artifact URL from webhook payload');
    }
}

module.exports = AzureDevOpsTools;
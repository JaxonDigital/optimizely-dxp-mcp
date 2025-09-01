/**
 * Package Tools Module
 * Handles package upload and management operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');
const UploadProgress = require('../upload-progress');
const fs = require('fs');
const path = require('path');

class PackageTools {
    /**
     * Upload deployment package
     */
    static async handleUploadDeploymentPackage(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.packagePath) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.uploadDeploymentPackage(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Upload package error:', error);
            return ResponseBuilder.internalError('Failed to upload package', error.message);
        }
    }

    static async uploadDeploymentPackage(args) {
        const { apiKey, apiSecret, projectId, packagePath, chunkSize } = args;
        
        console.error(`Uploading deployment package: ${packagePath}`);

        // Check file size for progress tracking
        let fileSize = 0;
        let tracker = null;
        try {
            const stats = await fs.promises.stat(packagePath);
            fileSize = stats.size;
            
            // Show progress for files larger than 10MB
            if (fileSize > 10 * 1024 * 1024) {
                console.error(`📦 Package size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
                tracker = UploadProgress.createTracker(packagePath);
                
                // For very large files, show a warning and timeout info
                if (fileSize > 100 * 1024 * 1024) {
                    const timeoutMinutes = Math.ceil(5 + (fileSize / (10 * 1024 * 1024)));
                    console.error(`⚠️  Large file detected! Upload may take several minutes.`);
                    console.error(`   File size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);
                    console.error(`   Timeout set to: ${timeoutMinutes} minutes`);
                    console.error(`   Alternative: Use generate_sas_upload_url for direct upload`);
                }
            }
        } catch (error) {
            console.error(`Could not determine file size: ${error.message}`);
        }

        // Build command with progress support
        let command = `Add-EpiDeploymentPackage -ProjectId '${projectId}' -Path '${packagePath}'`;
        if (chunkSize) command += ` -ChunkSize ${chunkSize}`;
        
        // Add verbose flag for progress tracking if file is large
        if (fileSize > 10 * 1024 * 1024) {
            command += ' -Verbose';
        }
        
        // Execute with progress monitoring
        const executeWithProgress = async () => {
            const result = await PowerShellHelper.executeEpiCommandStreaming(
                command,
                { apiKey, apiSecret, projectId },
                { 
                    parseJson: true,
                    // Calculate timeout: 5 min base + 1 min per 10MB
                    // For 177MB: 5 + (177/10) = ~23 minutes
                    timeout: Math.max(300000, 300000 + Math.ceil(fileSize / (10 * 1024 * 1024)) * 60000),
                    onProgress: tracker ? (data) => {
                        // Parse progress from verbose output
                        const progressMatch = data.match(/(\d+)%/);
                        if (progressMatch) {
                            const percentage = parseInt(progressMatch[1]);
                            tracker.setProgress((percentage / 100) * fileSize);
                        }
                        
                        // Also look for byte progress
                        const bytesMatch = data.match(/(\d+)\s*bytes/i);
                        if (bytesMatch) {
                            const bytes = parseInt(bytesMatch[1]);
                            tracker.setProgress(bytes);
                        }
                    } : undefined
                }
            );
            
            // Mark upload complete
            if (tracker) {
                tracker.complete();
            }
            
            return result;
        };
        
        let result;
        try {
            result = await executeWithProgress();
        } catch (error) {
            if (tracker) {
                tracker.fail(error);
            }
            throw error;
        }

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Upload Package',
                projectId,
                packagePath
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response with upload statistics
        if (result.parsedData) {
            const uploadStats = tracker ? tracker.getStatus() : { fileSize };
            return this.formatUploadResponse(result.parsedData, packagePath, uploadStats);
        }

        // Check for success patterns in stdout
        if (result.stdout) {
            const uploadMatch = result.stdout.match(/Uploaded.*to\s+([^\s]+)/i);
            if (uploadMatch) {
                return this.formatUploadSuccess(uploadMatch[1], packagePath);
            }
        }

        return ResponseBuilder.addFooter('Package upload initiated');
    }

    static formatUploadResponse(data, packagePath, uploadStats = {}) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.SUCCESS} **Package Upload Completed**\n\n`;
        response += `**Package:** ${packagePath}\n`;
        
        if (data.location) {
            response += `**Location:** ${data.location}\n`;
        }
        if (data.size) {
            response += `**Size:** ${data.size}\n`;
        } else if (uploadStats.fileSize) {
            const sizeMB = (uploadStats.fileSize / (1024 * 1024)).toFixed(2);
            response += `**Size:** ${sizeMB} MB\n`;
        }
        if (data.uploadTime) {
            response += `**Upload Time:** ${data.uploadTime} seconds\n`;
        } else if (uploadStats.duration) {
            response += `**Upload Time:** ${uploadStats.duration.toFixed(1)} seconds\n`;
        }
        if (uploadStats.averageSpeed) {
            const speedMB = (uploadStats.averageSpeed / (1024 * 1024)).toFixed(2);
            response += `**Average Speed:** ${speedMB} MB/s\n`;
        }
        
        const tips = [
            'Package is now ready for deployment',
            'Use start_deployment to deploy this package',
            'Package location can be used in deployment commands'
        ];
        
        response += '\n' + ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response);
    }

    static formatUploadSuccess(location, packagePath) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.SUCCESS} **Package Upload Successful**\n\n`;
        response += `**Package:** ${packagePath}\n`;
        response += `**Location:** \`${location}\`\n\n`;
        
        const tips = [
            'Package has been uploaded to DXP storage',
            'Save the location for deployment operations',
            'Use this location with start_deployment'
        ];
        
        response += ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Deploy package and start (combined workflow)
     */
    static async handleDeployPackageAndStart(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || 
            !args.packagePath || !args.targetEnvironment) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            // First upload the package
            const uploadResult = await this.uploadDeploymentPackage({
                apiKey: args.apiKey,
                apiSecret: args.apiSecret,
                projectId: args.projectId,
                packagePath: args.packagePath
            });

            // Extract package location from upload result
            let packageLocation = null;
            if (uploadResult.includes('Location:')) {
                const match = uploadResult.match(/Location:\s*`?([^`\n]+)`?/i);
                if (match) {
                    packageLocation = match[1].trim();
                }
            }

            if (!packageLocation) {
                return ResponseBuilder.internalError('Failed to get package location after upload');
            }

            // Now start deployment with the uploaded package
            const DeploymentTools = require('./deployment-tools');
            const deployResult = await DeploymentTools.startDeployment({
                apiKey: args.apiKey,
                apiSecret: args.apiSecret,
                projectId: args.projectId,
                targetEnvironment: args.targetEnvironment,
                packages: [packageLocation],
                useMaintenancePage: args.useMaintenancePage,
                directDeploy: args.directDeploy,
                zeroDowntimeMode: args.zeroDowntimeMode,
                warmUpUrl: args.warmUpUrl,
                waitForCompletion: args.waitForCompletion,
                waitTimeoutMinutes: args.waitTimeoutMinutes
            });

            // Combine results
            const combinedResult = this.formatCombinedWorkflow(uploadResult, deployResult, packageLocation);
            return ResponseBuilder.success(combinedResult);
        } catch (error) {
            console.error('Deploy package and start error:', error);
            return ResponseBuilder.internalError('Failed to deploy package', error.message);
        }
    }

    static formatCombinedWorkflow(uploadResult, deployResult, packageLocation) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.ROCKET} **Package Deployment Workflow Completed**\n\n`;
        response += `${STATUS_ICONS.SUCCESS} **Step 1: Package Upload**\n`;
        response += `Package Location: \`${packageLocation}\`\n\n`;
        response += `${STATUS_ICONS.SUCCESS} **Step 2: Deployment Started**\n`;
        response += deployResult;
        
        return response;
    }

    /**
     * Deploy package from Azure DevOps artifact URL
     */
    static async handleDeployAzureArtifact(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || 
            !args.artifactUrl || !args.targetEnvironment) {
            return ResponseBuilder.invalidParams('Missing required parameters: apiKey, apiSecret, projectId, artifactUrl, targetEnvironment');
        }

        const { 
            artifactUrl, 
            azureDevOpsPat,
            azureDevOpsOrg,
            azureDevOpsProject,
            artifactName = 'drop',
            cleanupAfterDeploy = true,
            forceResourcesApi = false,
            ...deploymentArgs 
        } = args;

        // Get configuration from args or environment
        const pat = azureDevOpsPat || process.env.AZURE_DEVOPS_PAT;
        const org = azureDevOpsOrg || process.env.AZURE_DEVOPS_ORG;
        const project = azureDevOpsProject || process.env.AZURE_DEVOPS_PROJECT;
        
        if (!pat) {
            return ResponseBuilder.invalidParams('Azure DevOps Personal Access Token is required. Provide azureDevOpsPat parameter or set AZURE_DEVOPS_PAT environment variable.');
        }
        
        // Log configuration (without sensitive data)
        console.error(`🔧 Azure DevOps Config: Org=${org || 'auto-detect'}, Project=${project || 'auto-detect'}`);
        
        // Enhance artifact URL with configuration if needed
        let enhancedArtifactUrl = artifactUrl;
        if (org && project && !artifactUrl.includes('/_apis/resources/')) {
            // Only enhance Build API URLs, Resources API URLs are already complete
            if (artifactUrl.includes('_apis/build/builds/') && !artifactUrl.includes(`/${org}/${project}/`)) {
                console.error('🔧 Enhancing artifact URL with organization and project configuration');
                enhancedArtifactUrl = artifactUrl.replace(
                    /https:\/\/dev\.azure\.com\/[^\/]+\/[^\/]+\/_apis/,
                    `https://dev.azure.com/${org}/${project}/_apis`
                );
            }
        }

        let downloadedArtifactPath = null;

        try {
            console.error('🔗 Starting Azure DevOps artifact deployment...');
            
            // Step 1: Download the artifact from Azure DevOps
            const AzureDevOpsTools = require('./azure-devops-tools');
            
            // Parse URL to show which API format is detected
            try {
                const urlInfo = AzureDevOpsTools.parseArtifactUrl(enhancedArtifactUrl);
                console.error(`🔍 Detected API Format: ${urlInfo.apiType.toUpperCase()} API`);
                console.error(`📋 Organization: ${urlInfo.organization}`);
                if (urlInfo.project) console.error(`📁 Project: ${urlInfo.project}`);
                if (urlInfo.containerId) console.error(`📦 Container ID: ${urlInfo.containerId}`);
                if (urlInfo.artifactPath) console.error(`📄 Artifact Path: ${urlInfo.artifactPath}`);
                if (urlInfo.isDirectFile) console.error(`🎯 Direct File Download: YES`);
            } catch (parseError) {
                console.error(`⚠️ URL parsing warning: ${parseError.message}`);
            }
            
            console.error('📥 Step 1: Downloading artifact from Azure DevOps');
            const downloadResult = await AzureDevOpsTools.downloadArtifact(enhancedArtifactUrl, {
                pat,
                artifactName,
                timeout: 600000 // 10 minutes for large artifacts
            });

            if (!downloadResult.success) {
                return ResponseBuilder.internalError('Failed to download Azure DevOps artifact');
            }

            downloadedArtifactPath = downloadResult.downloadPath;
            console.error(`✅ Artifact downloaded: ${downloadResult.sizeMB} MB`);

            // Step 2: Upload to DXP
            console.error('📤 Step 2: Uploading to Optimizely DXP');
            const uploadResult = await this.uploadDeploymentPackage({
                apiKey: deploymentArgs.apiKey,
                apiSecret: deploymentArgs.apiSecret,
                projectId: deploymentArgs.projectId,
                packagePath: downloadedArtifactPath
            });

            // Extract package location from upload result
            let packageLocation = null;
            if (uploadResult.includes('Location:')) {
                const match = uploadResult.match(/Location:\s*`?([^`\n]+)`?/i);
                if (match) {
                    packageLocation = match[1].trim();
                }
            }

            if (!packageLocation) {
                return ResponseBuilder.internalError('Failed to get package location after upload');
            }

            console.error('🚀 Step 3: Starting deployment');
            
            // Step 3: Start deployment
            const DeploymentTools = require('./deployment-tools');
            const deployResult = await DeploymentTools.startDeployment({
                ...deploymentArgs,
                packages: [packageLocation]
            });

            // Format the combined result
            const combinedResult = this.formatAzureArtifactWorkflow(
                artifactUrl,
                downloadResult,
                uploadResult, 
                deployResult, 
                packageLocation
            );

            // Clean up downloaded artifact if requested
            if (cleanupAfterDeploy && downloadedArtifactPath) {
                try {
                    await AzureDevOpsTools.cleanupArtifact(downloadedArtifactPath);
                } catch (cleanupError) {
                    console.error(`⚠️  Cleanup warning: ${cleanupError.message}`);
                }
            }

            return ResponseBuilder.success(combinedResult);

        } catch (error) {
            console.error('Azure artifact deployment error:', error);
            
            // Clean up on error
            if (downloadedArtifactPath && cleanupAfterDeploy) {
                try {
                    const AzureDevOpsTools = require('./azure-devops-tools');
                    await AzureDevOpsTools.cleanupArtifact(downloadedArtifactPath);
                } catch (cleanupError) {
                    console.error(`Cleanup error: ${cleanupError.message}`);
                }
            }
            
            return ResponseBuilder.internalError('Failed to deploy Azure DevOps artifact', error.message);
        }
    }

    static formatAzureArtifactWorkflow(artifactUrl, downloadResult, uploadResult, deployResult, packageLocation) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.ROCKET} **Azure DevOps Artifact Deployment Completed**\n\n`;
        
        // Step 1: Download from Azure DevOps
        response += `${STATUS_ICONS.SUCCESS} **Step 1: Azure DevOps Download & Extraction**\n`;
        response += `Artifact: ${downloadResult.artifactName}\n`;
        response += `NuGet Package Size: ${downloadResult.sizeMB} MB\n`;
        response += `Extracted from: ${downloadResult.extractedFrom || 'Build artifact ZIP'}\n`;
        response += `Source: Azure DevOps Build Pipeline\n\n`;
        
        // Step 2: Upload to DXP
        response += `${STATUS_ICONS.SUCCESS} **Step 2: DXP Package Upload**\n`;
        response += `Package Location: \`${packageLocation}\`\n\n`;
        
        // Step 3: Deployment
        response += `${STATUS_ICONS.SUCCESS} **Step 3: Deployment Started**\n`;
        response += deployResult;
        
        const tips = [
            'Artifact ZIP was downloaded and automatically extracted to find .nupkg file',
            'NuGet package was uploaded to DXP and deployment started',
            'Temporary files were cleaned up to save disk space',
            'Full 3-step workflow: Download → Extract → Upload → Deploy'
        ];
        
        response += '\n' + ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Enhanced deploy package that supports both local files and Azure DevOps artifacts
     */
    static async handleDeployPackageEnhanced(args) {
        const { packagePath, artifactUrl } = args;

        // Determine deployment type
        if (artifactUrl) {
            // Azure DevOps artifact deployment
            return await this.handleDeployAzureArtifact(args);
        } else if (packagePath) {
            // Traditional local file deployment
            return await this.handleDeployPackageAndStart(args);
        } else {
            return ResponseBuilder.invalidParams('Either packagePath or artifactUrl must be provided');
        }
    }
}

module.exports = PackageTools;
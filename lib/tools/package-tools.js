/**
 * Package Tools Module
 * Handles package upload and management operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');

class PackageTools {
    /**
     * Upload deployment package
     */
    static async handleUploadDeploymentPackage(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.packagePath) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
        }

        try {
            const result = await this.uploadDeploymentPackage(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Upload package error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to upload package', error.message);
        }
    }

    static async uploadDeploymentPackage(args) {
        const { apiKey, apiSecret, projectId, packagePath, chunkSize } = args;
        
        console.error(`Uploading deployment package: ${packagePath}`);

        // Build command
        let command = `Add-EpiDeploymentPackage -ProjectId '${projectId}' -Path '${packagePath}'`;
        if (chunkSize) command += ` -ChunkSize ${chunkSize}`;
        
        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

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

        // Format response
        if (result.parsedData) {
            return this.formatUploadResponse(result.parsedData, packagePath);
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

    static formatUploadResponse(data, packagePath) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.SUCCESS} **Package Upload Completed**\n\n`;
        response += `**Package:** ${packagePath}\n`;
        
        if (data.location) {
            response += `**Location:** ${data.location}\n`;
        }
        if (data.size) {
            response += `**Size:** ${data.size}\n`;
        }
        if (data.uploadTime) {
            response += `**Upload Time:** ${data.uploadTime} seconds\n`;
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
    static async handleDeployPackageAndStart(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || 
            !args.packagePath || !args.targetEnvironment) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
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
                return ResponseBuilder.internalError(requestId, 'Failed to get package location after upload');
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
            return ResponseBuilder.success(requestId, combinedResult);
        } catch (error) {
            console.error('Deploy package and start error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to deploy package', error.message);
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
}

module.exports = PackageTools;
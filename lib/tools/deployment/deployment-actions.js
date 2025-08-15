/**
 * Deployment Action Operations
 * Handles start, complete, and reset operations for deployments
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../../index');
const PowerShellCommandBuilder = require('../../powershell-command-builder');
const DeploymentFormatters = require('./deployment-formatters');
const DeploymentValidator = require('../../deployment-validator');
const { getGlobalMonitor } = require('../../deployment-monitor');

class DeploymentActionOperations {
    /**
     * Start a new deployment
     */
    static async handleStartDeployment(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.startDeployment(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Start deployment error:', error);
            return ResponseBuilder.internalError('Failed to start deployment', error.message);
        }
    }

    static async startDeployment(args) {
        const { 
            apiKey, apiSecret, projectId,
            sourceEnvironment, targetEnvironment,
            deploymentType, sourceApps,
            includeBlob, includeDatabase,
            directDeploy, useMaintenancePage 
        } = args;
        
        console.error(`Starting deployment from ${sourceEnvironment} to ${targetEnvironment} for project ${projectId}`);

        // Validate deployment path
        const pathValidation = DeploymentValidator.validateDeploymentPath(sourceEnvironment, targetEnvironment);
        if (!pathValidation.valid) {
            return ResponseBuilder.error(
                `❌ Invalid Deployment Path\n\n${pathValidation.error}\n\n💡 ${pathValidation.suggestion}`
            );
        }

        // Show warnings if any
        if (pathValidation.warnings && pathValidation.warnings.length > 0) {
            let warningMsg = '⚠️  **Deployment Warnings:**\n\n';
            pathValidation.warnings.forEach(warn => {
                warningMsg += `${warn.message}\n`;
                if (warn.suggestion) {
                    warningMsg += `   💡 ${warn.suggestion}\n`;
                }
                warningMsg += '\n';
            });
            console.error(warningMsg);
        }

        // Validate deployment parameters
        const paramValidation = DeploymentValidator.validateDeploymentParams(args);
        if (!paramValidation.valid) {
            return ResponseBuilder.error(
                `❌ Invalid Parameters\n\n${paramValidation.errors.join('\n')}`
            );
        }

        // Use sanitized parameters
        const sanitizedArgs = paramValidation.sanitized;

        // Check deployment timing
        const timingCheck = DeploymentValidator.validateDeploymentTiming({
            targetEnvironment
        });
        if (timingCheck.warnings && timingCheck.warnings.length > 0) {
            timingCheck.warnings.forEach(warn => {
                console.error(`Timing warning: ${warn.message}`);
            });
        }

        // Determine if this is upward (code) or downward (content) deployment
        const isUpward = pathValidation.isUpward;
        
        // Apply smart defaults based on deployment direction
        let deployCode = false;
        let deployContent = false;
        
        if (sanitizedArgs.deploymentType) {
            // User specified deployment type
            if (sanitizedArgs.deploymentType === 'code') {
                deployCode = true;
            } else if (sanitizedArgs.deploymentType === 'content') {
                deployContent = true;
            } else if (sanitizedArgs.deploymentType === 'all') {
                deployCode = true;
                deployContent = true;
            }
        } else {
            // Apply smart defaults
            if (isUpward) {
                deployCode = true; // Code flows up
                console.error('Defaulting to CODE deployment (upward flow)');
            } else {
                deployContent = true; // Content flows down
                console.error('Defaulting to CONTENT deployment (downward flow)');
            }
        }

        // Build command using the new builder
        const builder = PowerShellCommandBuilder.create('Start-EpiDeployment')
            .addParam('ProjectId', projectId)
            .addParam('SourceEnvironment', sourceEnvironment)
            .addParam('TargetEnvironment', targetEnvironment);

        // Add deployment type parameters
        if (deployCode) {
            // SourceApp is required for code deployments
            const appsToUse = sourceApps && sourceApps.length > 0 
                ? sourceApps 
                : ['cms']; // Default to CMS app
            builder.addArray('SourceApp', appsToUse);
            
            console.error(`Deploying code with apps: ${appsToUse.join(', ')}`);
        }
        
        if (deployContent) {
            // Add content deployment flags
            builder.addSwitchIf(includeBlob !== false, 'IncludeBlob')
                   .addSwitchIf(includeDatabase !== false, 'IncludeDatabase');
            
            console.error(`Deploying content with IncludeBlob=${includeBlob !== false}, IncludeDatabase=${includeDatabase !== false}`);
        }

        // Add optional parameters
        builder.addSwitchIf(directDeploy === true, 'DirectDeploy')
               .addSwitchIf(useMaintenancePage === true, 'UseMaintenancePage');

        const command = builder.build();
        console.error(`Executing command: ${command}`);

        // Execute with retry logic - deployments are critical operations
        const result = await PowerShellHelper.executeWithRetry(
            command,
            { apiKey, apiSecret, projectId },
            { 
                parseJson: true,
                operation: 'start_deployment',
                cacheInvalidate: true
            },
            {
                maxAttempts: 3,
                initialDelay: 2000,  // Start with 2 second delay
                verbose: true
            }
        );

        // Check for errors
        if (result.stderr) {
            console.error('PowerShell stderr:', result.stderr);
            
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Start Deployment',
                sourceEnvironment,
                targetEnvironment,
                projectId
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            const formattedResult = DeploymentFormatters.formatDeploymentStarted(result.parsedData, args);
            
            // Extract deployment ID from parsed data and start monitoring
            if (result.parsedData.id) {
                try {
                    const monitor = getGlobalMonitor();
                    const monitorId = monitor.startMonitoring({
                        deploymentId: result.parsedData.id,
                        projectId: args.projectId,
                        apiKey: args.apiKey,
                        apiSecret: args.apiSecret,
                        interval: 60 * 1000 // 1 minute default
                    });
                    
                    console.error(`Started monitoring deployment ${result.parsedData.id} (Monitor ID: ${monitorId})`);
                } catch (monitorError) {
                    console.error(`Failed to start monitoring: ${monitorError.message}`);
                    // Don't fail the deployment if monitoring fails
                }
            }
            
            return formattedResult;
        }

        return ResponseBuilder.addFooter('Deployment started but no details available');
    }

    /**
     * Complete a deployment in verification state
     */
    static async handleCompleteDeployment(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.deploymentId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.completeDeployment(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Complete deployment error:', error);
            return ResponseBuilder.internalError('Failed to complete deployment', error.message);
        }
    }

    static async completeDeployment(args) {
        const { apiKey, apiSecret, projectId, deploymentId } = args;
        
        console.error(`Completing deployment ${deploymentId} for project ${projectId}`);

        // Build command using the new builder
        const command = PowerShellCommandBuilder.create('Complete-EpiDeployment')
            .addParam('ProjectId', projectId)
            .addParam('Id', deploymentId)
            .build();

        // Execute with retry logic
        const result = await PowerShellHelper.executeWithRetry(
            command,
            { apiKey, apiSecret, projectId },
            { 
                parseJson: true,
                operation: 'complete_deployment',
                cacheInvalidate: true
            },
            {
                maxAttempts: 3,
                verbose: true
            }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Complete Deployment',
                deploymentId,
                projectId
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            return DeploymentFormatters.formatDeploymentCompleted(result.parsedData);
        }

        return ResponseBuilder.addFooter('Deployment completed successfully');
    }

    /**
     * Reset/rollback a deployment
     */
    static async handleResetDeployment(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.deploymentId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.resetDeployment(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Reset deployment error:', error);
            return ResponseBuilder.internalError('Failed to reset deployment', error.message);
        }
    }

    static async resetDeployment(args) {
        const { apiKey, apiSecret, projectId, deploymentId } = args;
        
        console.error(`Resetting deployment ${deploymentId} for project ${projectId}`);

        // First, get deployment details to determine if DB rollback is needed
        const statusCommand = PowerShellCommandBuilder.create('Get-EpiDeployment')
            .addParam('ProjectId', projectId)
            .addParam('Id', deploymentId)
            .build();

        const statusResult = await PowerShellHelper.executeEpiCommand(
            statusCommand,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        let includeDbRollback = false;
        if (statusResult.parsedData) {
            // Check if this deployment included database changes
            const deployment = statusResult.parsedData;
            includeDbRollback = deployment.includeDatabase === true;
        }

        // Build reset command using the new builder
        const command = PowerShellCommandBuilder.create('Reset-EpiDeployment')
            .addParam('ProjectId', projectId)
            .addParam('Id', deploymentId)
            .build();

        // Execute with cache invalidation
        const result = await PowerShellHelper.executeEpiCommandWithInvalidation(
            command,
            { apiKey, apiSecret, projectId },
            { 
                parseJson: true,
                operation: 'reset_deployment'
            }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Reset Deployment',
                deploymentId,
                projectId
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            return DeploymentFormatters.formatDeploymentReset(result.parsedData, includeDbRollback);
        }

        return ResponseBuilder.addFooter('Deployment reset successfully');
    }
}

module.exports = DeploymentActionOperations;
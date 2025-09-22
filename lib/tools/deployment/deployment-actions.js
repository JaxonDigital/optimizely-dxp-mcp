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
const PermissionChecker = require('../permission-checker');
const OutputLogger = require('../../output-logger');

class DeploymentActionOperations {
    /**
     * Start a new deployment
     */
    static async handleStartDeployment(args) {
        // Check if this is a self-hosted project
        if (args.isSelfHosted || args.connectionString) {
            return ResponseBuilder.invalidParams('Deployments are not available for self-hosted projects. Self-hosted projects can only download existing backups and blobs.');
        }
        
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
            apiKey, apiSecret, projectId, projectName,
            sourceEnvironment, targetEnvironment,
            deploymentType, sourceApps,
            includeBlob, includeDatabase,
            directDeploy, useMaintenancePage 
        } = args;
        
        console.error(`Starting deployment from ${sourceEnvironment} to ${targetEnvironment} for project ${projectId}`);

        // Check permissions for both environments first
        const projectConfig = {
            apiKey: apiKey,
            apiSecret: apiSecret,
            projectId: projectId,
            id: projectId,
            name: projectName || 'Project'
        };
        
        const permissions = await PermissionChecker.getOrCheckPermissionsSafe(projectConfig);
        
        // Check if user has access to both source and target
        const missingAccess = [];
        if (!permissions.accessible.includes(sourceEnvironment)) {
            missingAccess.push(sourceEnvironment);
        }
        if (!permissions.accessible.includes(targetEnvironment)) {
            missingAccess.push(targetEnvironment);
        }
        
        if (missingAccess.length > 0) {
            let response = `ℹ️ **Access Level Check**\n\n`;
            response += `Deployments require access to both source and target environments.\n\n`;
            response += `**Requested:** ${sourceEnvironment} → ${targetEnvironment}\n`;
            response += `**Your access level:** ${permissions.accessible.join(', ')} environment${permissions.accessible.length > 1 ? 's' : ''}\n`;
            response += `**Additional access needed:** ${missingAccess.join(', ')}\n\n`;
            
            // Suggest valid deployment paths based on what they have access to
            if (permissions.accessible.length >= 2) {
                response += `**Available Deployment Options:**\n\n`;
                
                // Check for valid deployment paths
                const hasInt = permissions.accessible.includes('Integration');
                const hasPre = permissions.accessible.includes('Preproduction');
                const hasProd = permissions.accessible.includes('Production');
                
                if (hasInt && hasPre) {
                    response += `• **Integration → Preproduction** (Code deployment)\n`;
                    response += `  \`start_deployment sourceEnvironment: "Integration" targetEnvironment: "Preproduction"\`\n\n`;
                }
                
                if (hasPre && hasProd) {
                    response += `• **Preproduction → Production** (Code deployment)\n`;
                    response += `  \`start_deployment sourceEnvironment: "Preproduction" targetEnvironment: "Production"\`\n\n`;
                }
                
                // For content copy (if they have the environments but trying wrong direction)
                if (hasProd && hasPre) {
                    response += `• **Production → Preproduction** (Content copy - use copy_content instead)\n`;
                    response += `  \`copy_content sourceEnvironment: "Production" targetEnvironment: "Preproduction"\`\n\n`;
                }
                
                if (hasProd && hasInt) {
                    response += `• **Production → Integration** (Content copy - use copy_content instead)\n`;
                    response += `  \`copy_content sourceEnvironment: "Production" targetEnvironment: "Integration"\`\n\n`;
                }
                
                response += `\n💡 **Important:** Code deployments only work upward (Int→Pre→Prod).\n`;
                response += `For downward content sync, use the \`copy_content\` tool instead.`;
            } else if (permissions.accessible.length === 1) {
                response += `⚠️ You need access to at least 2 environments for deployments.\n`;
                response += `Your API key only has access to ${permissions.accessible[0]}.`;
            }
            
            return ResponseBuilder.success(response);
        }

        // Check for any running deployments before starting a new one
        console.error('Checking for active deployments...');
        try {
            const DeploymentListOperations = require('./deployment-list');
            const listResult = await DeploymentListOperations.listDeployments({
                apiKey, 
                apiSecret, 
                projectId, 
                limit: 5,
                offset: 0
            });
            
            // DEBUG: Log the actual result to troubleshoot blocking issue
            console.error('DEBUG: listResult type:', typeof listResult);
            console.error('DEBUG: listResult (first 500 chars):', 
                typeof listResult === 'string' ? listResult.substring(0, 500) : JSON.stringify(listResult).substring(0, 500));
            
            // Check if there's a deployment in progress
            // CRITICAL FIX (v3.17.2): First check if this is an error response, not deployment data
            // Previously, error messages containing "InProgress" text would falsely trigger 
            // the "deployment already in progress" check, preventing all new deployments
            if (listResult && typeof listResult === 'string') {
                // Skip check if this is an error message
                const isError = listResult.includes('❌') || 
                               listResult.includes('Error') ||
                               listResult.includes('Failed') ||
                               listResult.includes('Invalid') ||
                               listResult.includes('Forbidden') ||
                               listResult.includes('support@jaxondigital.com');
                
                console.error('DEBUG: isError check result:', isError);
                
                if (isError) {
                    // Log error but continue - we can't check deployment status but shouldn't block
                    console.error('DEBUG: Detected error in deployment list, continuing with deployment...');
                    console.error('Warning: Could not check for active deployments due to error:', listResult.substring(0, 200));
                } else {
                    // Only check for in-progress deployments if this is actual deployment data
                    console.error('DEBUG: Checking for in-progress deployments in actual deployment data...');
                    
                    // FIXED: Don't use 🔄 emoji as it appears in all deployments (even completed ones)
                    // Only look for actual status indicators of in-progress deployments
                    const hasInProgress = listResult.includes('InProgress') || 
                                         listResult.includes('Deploying') ||
                                         listResult.includes('Status: **InProgress**') ||
                                         listResult.includes('Status: **Deploying**');
                    
                    console.error('DEBUG: hasInProgress result:', hasInProgress);
                    console.error('DEBUG: Contains InProgress:', listResult.includes('InProgress'));
                    console.error('DEBUG: Contains Deploying:', listResult.includes('Deploying'));
                    console.error('DEBUG: Contains Status: **InProgress**:', listResult.includes('Status: **InProgress**'));
                    console.error('DEBUG: Contains Status: **Deploying**:', listResult.includes('Status: **Deploying**'));
                    
                    if (hasInProgress) {
                        console.error('DEBUG: Found in-progress deployment, blocking new deployment...');
                    // Extract details about the in-progress deployment if possible
                    const lines = listResult.split('\n');
                    let inProgressDetails = '';
                    
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes('InProgress') || lines[i].includes('🔄')) {
                            // Try to get the deployment ID and environments
                            const deploymentIdMatch = lines[i].match(/#([a-f0-9-]+)/);
                            if (deploymentIdMatch) {
                                inProgressDetails = `Deployment ${deploymentIdMatch[1]} `;
                            }
                            
                            // Look for environment info in nearby lines
                            for (let j = Math.max(0, i-2); j < Math.min(lines.length, i+3); j++) {
                                if (lines[j].includes('→')) {
                                    const envMatch = lines[j].match(/(\w+)\s*→\s*(\w+)/);
                                    if (envMatch) {
                                        inProgressDetails += `(${envMatch[1]} → ${envMatch[2]})`;
                                        break;
                                    }
                                }
                            }
                            break;
                        }
                    }
                    
                    return `⚠️ **Deployment Already In Progress**\n\n` +
                           `Cannot start a new deployment while another is running.\n\n` +
                           (inProgressDetails ? `**Active Deployment:** ${inProgressDetails}\n\n` : '') +
                           `Please wait for the current deployment to complete or reset it before starting a new one.\n\n` +
                           `**Options:**\n` +
                           `• Use \`get_deployment_status\` to check progress\n` +
                           `• Use \`reset_deployment\` if the deployment is stuck\n` +
                           `• Wait for automatic completion (usually 10-30 minutes)`;
                    }
                }
            }
        } catch (checkError) {
            // Don't fail the deployment if we can't check status
            console.error('Warning: Could not check for active deployments:', checkError.message);
        }
        
        // Validate deployment path
        const pathValidation = DeploymentValidator.validateDeploymentPath(sourceEnvironment, targetEnvironment);
        if (!pathValidation.valid) {
            // Check if this is a downward deployment that should use content copy
            if (sourceEnvironment === 'Production' || 
                (sourceEnvironment === 'Preproduction' && targetEnvironment === 'Integration')) {
                
                let response = `ℹ️ **Invalid Deployment Direction**\n\n`;
                response += `You're trying to deploy from **${sourceEnvironment}** to **${targetEnvironment}**.\n\n`;
                response += `❌ **Code deployments can only go upward:**\n`;
                response += `• Integration → Preproduction\n`;
                response += `• Preproduction → Production\n\n`;
                response += `✅ **For downward content synchronization, use:**\n`;
                response += `\`copy_content sourceEnvironment: "${sourceEnvironment}" targetEnvironment: "${targetEnvironment}"\`\n\n`;
                response += `💡 **Why?** Code changes should flow through proper testing stages (Int→Pre→Prod),\n`;
                response += `while content can be copied from production back to lower environments for testing.`;
                
                return ResponseBuilder.success(response);
            }
            
            // For other invalid paths (like Int→Prod), show the standard error
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
                    
                    OutputLogger.info(`🔄 Auto-monitoring started for deployment ${result.parsedData.id}`);
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
        // Check if this is a self-hosted project
        if (args.isSelfHosted || args.connectionString) {
            return ResponseBuilder.invalidParams('Deployment completion is not available for self-hosted projects. Self-hosted projects can only download existing backups and blobs.');
        }
        
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
        let formattedResponse;
        if (result.parsedData) {
            formattedResponse = DeploymentFormatters.formatDeploymentCompleted(result.parsedData);
        } else {
            formattedResponse = ResponseBuilder.addFooter('Deployment completed successfully');
        }
        
        // Add confirmation check to verify deployment actually completed
        try {
            console.error('Verifying deployment completion...');
            
            // Wait a moment for the completion to register
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Check the deployment status to confirm it's actually completed
            const DeploymentListOperations = require('./deployment-list');
            const statusCheck = await DeploymentListOperations.getDeploymentStatus({
                apiKey,
                apiSecret,
                projectId,
                deploymentId
            });
            
            // Extract status from the response
            let currentStatus = 'Unknown';
            if (typeof statusCheck === 'string' && statusCheck.includes('Status:')) {
                const statusMatch = statusCheck.match(/Status:\s*\*\*([^*]+)\*\*/);
                if (statusMatch) {
                    currentStatus = statusMatch[1].trim();
                }
            }
            
            // Add confirmation to response
            if (currentStatus.toLowerCase().includes('succeeded') || 
                currentStatus.toLowerCase().includes('completed')) {
                formattedResponse += '\n\n✅ **Confirmed**: Deployment successfully completed';
            } else if (currentStatus.toLowerCase().includes('fail')) {
                formattedResponse += `\n\n⚠️ **Warning**: Deployment appears to have failed (Status: ${currentStatus})`;
            } else {
                formattedResponse += `\n\n📊 **Current Status**: ${currentStatus}`;
                if (currentStatus.toLowerCase().includes('progress')) {
                    formattedResponse += '\n*Note: Deployment may still be completing. Check status again in a moment.*';
                }
            }
            
        } catch (confirmError) {
            console.error(`Failed to confirm deployment status: ${confirmError.message}`);
            formattedResponse += '\n\n⚠️ *Unable to confirm deployment completion. Please check status manually.*';
        }
        
        return formattedResponse;
    }

    /**
     * Reset/rollback a deployment
     */
    static async handleResetDeployment(args) {
        // Check if this is a self-hosted project
        if (args.isSelfHosted || args.connectionString) {
            return ResponseBuilder.invalidParams('Deployment reset is not available for self-hosted projects. Self-hosted projects can only download existing backups and blobs.');
        }
        
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
        const { apiKey, apiSecret, projectId, deploymentId, projectName } = args;
        
        console.error(`Resetting deployment ${deploymentId} for project ${projectId}`);

        // First, get deployment details to determine if DB rollback is needed
        const statusCommand = PowerShellCommandBuilder.create('Get-EpiDeployment')
            .addParam('ProjectId', projectId)
            .addParam('ClientKey', apiKey)
            .addParam('ClientSecret', apiSecret)
            .addParam('Id', deploymentId)
            .build();

        const statusResult = await PowerShellHelper.executeEpiCommandDirect(
            statusCommand,
            { parseJson: true }
        );

        let includeDbRollback = false;
        let deploymentData = null;
        if (statusResult.parsedData) {
            // Check if this deployment included database changes
            deploymentData = statusResult.parsedData;
            includeDbRollback = deploymentData.includeDatabase === true;
        }

        // Build reset command using the new builder
        const command = PowerShellCommandBuilder.create('Reset-EpiDeployment')
            .addParam('ProjectId', projectId)
            .addParam('ClientKey', apiKey)
            .addParam('ClientSecret', apiSecret)
            .addParam('Id', deploymentId)
            .build();

        // Execute using direct method
        const result = await PowerShellHelper.executeEpiCommandDirect(
            command,
            { 
                parseJson: true
            }
        );
        
        // Cache invalidation removed - caching disabled

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

        // Merge deployment data if available
        const resetData = result.parsedData || {};
        if (deploymentData && deploymentData.parameters) {
            resetData.parameters = deploymentData.parameters;
        }

        // Start monitoring the reset in the background
        this.monitorResetProgress(deploymentId, projectId, apiKey, apiSecret, projectName);

        // Format response
        return DeploymentFormatters.formatDeploymentReset(resetData, includeDbRollback, projectName);
    }

    /**
     * Monitor reset progress in the background
     */
    static async monitorResetProgress(deploymentId, projectId, apiKey, apiSecret, projectName) {
        const checkInterval = 30000; // Check every 30 seconds
        const maxChecks = 20; // Maximum 10 minutes
        let checkCount = 0;

        const checkStatus = async () => {
            checkCount++;
            
            try {
                const command = PowerShellCommandBuilder.create('Get-EpiDeployment')
                    .addParam('ProjectId', projectId)
                    .addParam('ClientKey', apiKey)
                    .addParam('ClientSecret', apiSecret)
                    .addParam('Id', deploymentId)
                    .build();

                const result = await PowerShellHelper.executeEpiCommandDirect(
                    command,
                    { parseJson: true }
                );

                if (result.parsedData) {
                    const status = result.parsedData.status;
                    
                    // Check if reset is complete
                    if (status === 'Reset' || status === 'Completed' || status === 'Failed') {
                        const message = this.formatResetCompleteMessage(
                            deploymentId, 
                            status, 
                            result.parsedData,
                            projectName
                        );
                        console.error('\n' + message);
                        return; // Stop monitoring
                    }
                }
            } catch (error) {
                console.error('Error checking reset status:', error.message);
            }

            // Continue checking if not at max
            if (checkCount < maxChecks) {
                setTimeout(checkStatus, checkInterval);
            } else {
                console.error(`\n⚠️ Reset monitoring timed out for deployment ${deploymentId}. Please check status manually.`);
            }
        };

        // Start checking after initial delay
        setTimeout(checkStatus, checkInterval);
    }

    /**
     * Format reset completion message
     */
    static formatResetCompleteMessage(deploymentId, status, deployment, projectName) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        let message = '\n' + '='.repeat(60) + '\n';
        
        if (status === 'Reset' || status === 'Completed') {
            message += `${STATUS_ICONS.SUCCESS} **Reset Complete`;
        } else {
            message += `${STATUS_ICONS.ERROR} **Reset Failed`;
        }

        if (projectName) {
            message += ` - ${projectName}**\n\n`;
        } else {
            message += '**\n\n';
        }

        message += `**Deployment ID**: ${deploymentId}\n`;
        message += `**Final Status**: ${status}\n`;

        if (status === 'Reset' || status === 'Completed') {
            message += '\n✅ The deployment has been successfully rolled back.\n';
            message += 'The environment has been restored to its previous state.\n';
        } else {
            message += '\n❌ The reset operation failed.\n';
            message += 'Please check the deployment logs for more information.\n';
        }

        message += '\n' + '='.repeat(60);
        return message;
    }
}

module.exports = DeploymentActionOperations;
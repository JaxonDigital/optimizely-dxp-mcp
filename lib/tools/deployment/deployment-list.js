/**
 * Deployment List Operations
 * Handles listing and status checking for deployments
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler } = require('../../index');
const PowerShellCommandBuilder = require('../../powershell-command-builder');
const DeploymentFormatters = require('./deployment-formatters');

class DeploymentListOperations {
    /**
     * List all deployments
     */
    static async handleListDeployments(args) {
        // Check if this is a self-hosted project
        if (args.isSelfHosted || args.connectionString) {
            return ResponseBuilder.invalidParams('Deployment listing is not available for self-hosted projects. Self-hosted projects can only download existing backups and blobs.');
        }
        
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.listDeployments(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('List deployments error:', error);
            return ResponseBuilder.internalError('Failed to list deployments', error.message);
        }
    }

    static async listDeployments(args) {
        const { apiKey, apiSecret, projectId, limit, offset } = args;
        
        // Use PowerShell for reliable deployment data
        // Note: Optimizely DXP API uses proprietary epi-hmac authentication
        
        // Check permissions first to know which environments to query
        let command;
        try {
            const PermissionChecker = require('../permission-checker');
            const permissions = await PermissionChecker.getOrCheckPermissionsSafe({
                apiKey,
                apiSecret,
                projectId,
                id: projectId
            });
            
            // If we have limited access, specify the accessible environment
            if (permissions.accessible && permissions.accessible.length === 1) {
                // Single environment access - query that specific environment
                command = PowerShellCommandBuilder.create('Get-EpiDeployment')
                    .addParam('ProjectId', projectId)
                    .addParam('ClientKey', apiKey)
                    .addParam('ClientSecret', apiSecret)
                    .addParam('Environment', permissions.accessible[0])
                    .build();
            } else {
                // Multiple environments or full access - get all
                command = PowerShellCommandBuilder.create('Get-EpiDeployment')
                    .addParam('ProjectId', projectId)
                    .addParam('ClientKey', apiKey)
                    .addParam('ClientSecret', apiSecret)
                    .build();
            }
        } catch (permError) {
            // If permission check fails, try without environment filter
            command = PowerShellCommandBuilder.create('Get-EpiDeployment')
                .addParam('ProjectId', projectId)
                .addParam('ClientKey', apiKey)
                .addParam('ClientSecret', apiSecret)
                .build();
        }

        // Execute with PowerShell using direct method
        const result = await PowerShellHelper.executeEpiCommandDirect(
            command,
            { 
                parseJson: true,
                timeout: 15000 // 15 second timeout for list operations
            }
        );
        
        // Log deployment count for debugging
        if (result.parsedData) {
            const deployments = Array.isArray(result.parsedData) ? result.parsedData : [result.parsedData];
            // console.error(`Retrieved ${deployments.length} deployments from API`);
        }

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'List Deployments',
                projectId,
                projectName: args.projectName,
                apiKey
            });

            if (error) {
                return ErrorHandler.formatError(error, { 
                    projectId, 
                    projectName: args.projectName,
                    apiKey
                });
            }
        }

        // Format response
        if (result.parsedData) {
            return DeploymentFormatters.formatDeploymentList(result.parsedData, projectId, limit, args.projectName);
        }

        return ResponseBuilder.addFooter('No deployments found');
    }

    /**
     * Get deployment status
     */
    static async handleGetDeploymentStatus(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.getDeploymentStatus(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Get deployment status error:', error);
            return ResponseBuilder.internalError('Failed to get deployment status', error.message);
        }
    }

    static async getDeploymentStatus(args) {
        const { apiKey, apiSecret, projectId, deploymentId, limit } = args;
        
        // console.error(`Getting deployment status for project ${projectId}${deploymentId ? `, deployment ${deploymentId}` : ''}`);

        // Check if this is a newly created deployment (within last 30 seconds)
        // If the caller indicates this is a new deployment, add an initial delay
        if (args.isNewDeployment) {
            // Wait 3 seconds before first check to allow deployment to register
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Build command using the new builder
        const commandBuilder = PowerShellCommandBuilder.create('Get-EpiDeployment')
            .addParam('ProjectId', projectId);
        
        if (deploymentId) {
            commandBuilder.addParam('Id', deploymentId);
        }
        
        const command = commandBuilder.build();

        // Execute with retry logic for this critical operation
        // For new deployments, use longer initial delay between retries
        const retryOptions = args.isNewDeployment ? 
            { 
                maxAttempts: 3,
                initialDelay: 3000,  // 3 seconds for new deployments
                verbose: true 
            } : 
            { 
                maxAttempts: 3,
                verbose: true 
            };

        const result = await PowerShellHelper.executeWithRetry(
            command,
            { apiKey, apiSecret, projectId },
            { 
                parseJson: true,
                operation: deploymentId ? 'Get Deployment Status' : 'List Deployments',
                cacheArgs: { deploymentId, limit }
            },
            retryOptions
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Get Deployment Status',
                projectId,
                projectName: args.projectName,
                deploymentId,
                apiKey
            });

            if (error) {
                return ErrorHandler.formatError(error, { 
                    projectId, 
                    projectName: args.projectName,
                    deploymentId,
                    apiKey
                });
            }
        }

        // Format response
        if (result.parsedData) {
            if (Array.isArray(result.parsedData)) {
                return DeploymentFormatters.formatMultipleDeployments(result.parsedData, limit);
            } else {
                return DeploymentFormatters.formatSingleDeployment(result.parsedData, args.projectName);
            }
        }

        return ResponseBuilder.addFooter('No deployment data available');
    }
}

module.exports = DeploymentListOperations;
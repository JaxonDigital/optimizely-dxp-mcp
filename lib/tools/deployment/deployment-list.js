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
        
        console.error(`Listing deployments for project ${projectId}`);

        // Build command using the new builder
        const command = PowerShellCommandBuilder.create('Get-EpiDeployment')
            .addParam('ProjectId', projectId)
            .build();

        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'List Deployments',
                projectId
            });

            if (error) {
                return ErrorHandler.formatError(error, { projectId });
            }
        }

        // Format response
        if (result.parsedData) {
            return DeploymentFormatters.formatDeploymentList(result.parsedData, projectId, limit);
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
        
        console.error(`Getting deployment status for project ${projectId}${deploymentId ? `, deployment ${deploymentId}` : ''}`);

        // Build command using the new builder
        const commandBuilder = PowerShellCommandBuilder.create('Get-EpiDeployment')
            .addParam('ProjectId', projectId);
        
        if (deploymentId) {
            commandBuilder.addParam('Id', deploymentId);
        }
        
        const command = commandBuilder.build();

        // Execute with retry logic for this critical operation
        const result = await PowerShellHelper.executeWithRetry(
            command,
            { apiKey, apiSecret, projectId },
            { 
                parseJson: true,
                operation: deploymentId ? 'Get Deployment Status' : 'List Deployments'
            },
            { 
                maxAttempts: 3,
                verbose: true 
            }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Get Deployment Status',
                projectId,
                deploymentId
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            if (Array.isArray(result.parsedData)) {
                return DeploymentFormatters.formatMultipleDeployments(result.parsedData, limit);
            } else {
                return DeploymentFormatters.formatSingleDeployment(result.parsedData);
            }
        }

        return ResponseBuilder.addFooter('No deployment data available');
    }
}

module.exports = DeploymentListOperations;
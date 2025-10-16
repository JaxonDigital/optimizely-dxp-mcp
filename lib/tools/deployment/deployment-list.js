/**
 * Deployment List Operations
 * Handles listing and status checking for deployments
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { ResponseBuilder, ErrorHandler } = require('../../index');
const DeploymentFormatters = require('./deployment-formatters');
const DXPRestClient = require('../../dxp-rest-client');

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

            // DXP-66: Check if result is structured response with data and message
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            // Fallback for legacy string responses
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('List deployments error:', error);
            return ResponseBuilder.internalError('Failed to list deployments', error.message);
        }
    }

    static async listDeployments(args) {
        const { apiKey, apiSecret, projectId, limit, offset, activeOnly = false } = args;

        // DXP-101: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
        try {
            // Get deployments directly from REST API
            const deployments = await DXPRestClient.getDeployments(
                projectId,
                apiKey,
                apiSecret,
                null, // No specific deployment ID - get all
                { apiUrl: args.apiUrl } // Support custom API URLs for Optimizely internal team
            );

            // Ensure we have an array
            let deploymentList = Array.isArray(deployments) ? deployments : [deployments];

            // DXP-103: Filter to active deployments only if requested
            if (activeOnly) {
                const activeStatuses = ['InProgress', 'AwaitingVerification', 'Resetting', 'Completing'];
                deploymentList = deploymentList.filter(dep =>
                    dep.Status && activeStatuses.includes(dep.Status)
                );
            }

            // Format response
            if (deploymentList.length > 0) {
                return DeploymentFormatters.formatDeploymentList(deploymentList, projectId, limit, args.projectName);
            }

            return ResponseBuilder.addFooter(activeOnly ? 'No active deployments found' : 'No deployments found');

        } catch (error) {
            // Handle REST API errors
            const errorDetails = {
                operation: 'List Deployments',
                projectId,
                projectName: args.projectName,
                apiKey
            };

            // Check if this is an access denied error
            if (error.statusCode === 401 || error.statusCode === 403) {
                return ErrorHandler.formatError({
                    type: 'ACCESS_DENIED',
                    message: 'Access denied to deployment API',
                    statusCode: error.statusCode
                }, errorDetails);
            }

            // Generic error handling
            return ErrorHandler.formatError({
                type: 'API_ERROR',
                message: error.message,
                statusCode: error.statusCode
            }, errorDetails);
        }
    }

    /**
     * Get deployment status
     */
    static async handleGetDeploymentStatus(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        const { waitBeforeCheck = 0, monitor = false } = args;

        // Implement transparent wait-then-check pattern like database exports
        if (waitBeforeCheck > 0) {
            const OutputLogger = require('../../output-logger');
            const waitMinutes = Math.floor(waitBeforeCheck / 60);
            const waitSeconds = waitBeforeCheck % 60;
            const waitDisplay = waitMinutes > 0 ?
                `${waitMinutes} minute${waitMinutes > 1 ? 's' : ''}${waitSeconds > 0 ? ` ${waitSeconds} second${waitSeconds > 1 ? 's' : ''}` : ''}` :
                `${waitSeconds} second${waitSeconds > 1 ? 's' : ''}`;

            OutputLogger.info(`⏳ Waiting ${waitDisplay} before checking deployment status...`);
            await new Promise(resolve => setTimeout(resolve, waitBeforeCheck * 1000));
            OutputLogger.success(`✅ Wait complete. Checking deployment status now...`);
        }

        try {
            const result = await this.getDeploymentStatus(args);

            // Check if result is already a structured response with data and message
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                // Add monitoring instructions if monitor mode is enabled
                if (monitor && result.data && result.data.status) {
                    const monitoringInstructions = this.generateMonitoringInstructions(
                        args.deploymentId,
                        result.data.status,
                        result.data.percentComplete || 0,
                        args
                    );
                    result.message = result.message + '\n\n' + monitoringInstructions;
                }
                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            // Fallback for legacy string responses
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Get deployment status error:', error);
            return ResponseBuilder.internalError('Failed to get deployment status', error.message);
        }
    }

    static async getDeploymentStatus(args) {
        const { apiKey, apiSecret, projectId, deploymentId, limit } = args;

        // Check if this is a newly created deployment (within last 30 seconds)
        // If the caller indicates this is a new deployment, add an initial delay
        if (args.isNewDeployment) {
            // Wait 3 seconds before first check to allow deployment to register
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // DXP-101: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
        try {
            // Get deployment(s) directly from REST API
            const result = await DXPRestClient.getDeployments(
                projectId,
                apiKey,
                apiSecret,
                deploymentId, // Pass deployment ID if checking specific deployment, null for all
                { apiUrl: args.apiUrl } // Support custom API URLs
            );

            // Format response based on whether we got single or multiple deployments
            if (Array.isArray(result)) {
                return DeploymentFormatters.formatMultipleDeployments(result, limit);
            } else if (result) {
                return DeploymentFormatters.formatSingleDeployment(result, args.projectName);
            }

            return {
                data: { deployments: [] },
                message: ResponseBuilder.addFooter('No deployment data available')
            };

        } catch (error) {
            // Handle REST API errors
            const errorDetails = {
                operation: 'Get Deployment Status',
                projectId,
                projectName: args.projectName,
                deploymentId,
                apiKey
            };

            // Check if this is an access denied error
            if (error.statusCode === 401 || error.statusCode === 403) {
                return ErrorHandler.formatError({
                    type: 'ACCESS_DENIED',
                    message: 'Access denied to deployment API',
                    statusCode: error.statusCode
                }, errorDetails);
            }

            // Generic error handling
            return ErrorHandler.formatError({
                type: 'API_ERROR',
                message: error.message,
                statusCode: error.statusCode
            }, errorDetails);
        }
    }

    /**
     * Generate transparent monitoring instructions for AI
     * Similar to database export monitoring pattern
     */
    static generateMonitoringInstructions(deploymentId, status, percentComplete, args) {
        let instructions = '';

        // Determine if deployment is still in progress
        // DXP-71: Added 'Completing' as transitional state
        const inProgressStatuses = ['InProgress', 'Resetting', 'Completing'];
        const awaitingVerificationStatuses = ['AwaitingVerification'];
        const completeStatuses = ['Succeeded', 'Failed', 'Reset'];

        if (completeStatuses.includes(status)) {
            // Deployment is complete - no more monitoring needed
            instructions += `---\n\n`;
            instructions += `✅ **Deployment Complete**\n\n`;
            instructions += `Final Status: **${status}**\n`;
            instructions += `Progress: **${percentComplete}%**\n\n`;

            if (status === 'AwaitingVerification') {
                instructions += `🔍 **Next Steps:**\n`;
                instructions += `• Review the deployment at verification URLs\n`;
                instructions += `• Use \`complete_deployment\` when ready to finalize\n`;
                instructions += `• Use \`reset_deployment\` to rollback if issues found\n`;
            } else if (status === 'Succeeded') {
                instructions += `🎉 Deployment completed successfully! No further action needed.\n`;
            } else if (status === 'Failed') {
                instructions += `⚠️ Deployment failed. Review logs and consider using \`reset_deployment\` to rollback.\n`;
            }

            instructions += `\n**AI: Stop monitoring - deployment is complete.**`;

        } else if (awaitingVerificationStatuses.includes(status)) {
            // Deployment awaiting verification
            instructions += `---\n\n`;
            instructions += `🔍 **Deployment Awaiting Verification**\n\n`;
            instructions += `The deployment has completed and is ready for review.\n\n`;
            instructions += `**Next Steps:**\n`;
            instructions += `1. Review the deployment at verification URLs\n`;
            instructions += `2. Use \`complete_deployment\` to finalize if everything looks good\n`;
            instructions += `3. Use \`reset_deployment\` to rollback if issues are found\n\n`;
            instructions += `**AI: Stop monitoring - deployment awaits user verification.**`;

        } else if (inProgressStatuses.includes(status)) {
            // Deployment still in progress - provide monitoring instructions
            instructions += `---\n\n`;
            instructions += `📊 **MONITORING INSTRUCTIONS FOR AI**\n\n`;
            instructions += `Deployment still in progress.\n`;
            instructions += `Deployment ID: ${deploymentId}\n`;
            instructions += `Current Status: ${status}\n`;
            instructions += `Progress: ${percentComplete}%\n\n`;

            // Use 30-second interval for deployments (faster than exports)
            const monitorInterval = 30; // 30 seconds

            instructions += `**To continue monitoring, use get_deployment_status with:**\n`;
            instructions += `• deploymentId: "${deploymentId}"\n`;
            instructions += `• waitBeforeCheck: ${monitorInterval} (waits ${monitorInterval} seconds then checks)\n`;
            instructions += `• monitor: true (enables monitoring prompts)\n`;
            instructions += `• projectName: "${args.projectName || ''}"\n`;
            instructions += `\n`;
            instructions += `**RECOMMENDED MONITORING PATTERN:**\n`;
            instructions += `1. Call get_deployment_status with:\n`;
            instructions += `   - deploymentId="${deploymentId}"\n`;
            instructions += `   - waitBeforeCheck=${monitorInterval}\n`;
            instructions += `   - monitor=true\n`;
            instructions += `2. If still InProgress, repeat with same interval\n`;
            instructions += `3. When AwaitingVerification, prompt user to verify\n`;
            instructions += `4. When Succeeded/Failed, stop monitoring\n\n`;
            instructions += `**Note:** Tool will wait ${monitorInterval} seconds then check automatically.\n`;
            instructions += `Deployments can take 30-90 minutes depending on complexity and size. Be patient and don't raise concerns unless status is Failed or stuck for several hours.`;
        }

        return instructions;
    }
}

module.exports = DeploymentListOperations;
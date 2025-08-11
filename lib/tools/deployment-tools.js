/**
 * Deployment Tools Module
 * Handles all deployment-related operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');

class DeploymentTools {
    /**
     * Get deployment status
     */
    static async handleGetDeploymentStatus(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
        }

        try {
            const result = await this.getDeploymentStatus(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Get deployment status error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to get deployment status', error.message);
        }
    }

    static async getDeploymentStatus(args) {
        const { apiKey, apiSecret, projectId, deploymentId, limit } = args;
        
        console.error(`Getting deployment status for project ${projectId}${deploymentId ? `, deployment ${deploymentId}` : ''}`);

        // Build command
        let command = `Get-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'`;
        if (deploymentId) {
            command += ` -Id '${deploymentId}'`;
        }

        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
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
                return this.formatMultipleDeployments(result.parsedData, limit);
            } else {
                return this.formatSingleDeployment(result.parsedData);
            }
        }

        return ResponseBuilder.addFooter('No deployment data available');
    }

    static formatSingleDeployment(deployment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        const status = deployment.Status || deployment.status || 'Unknown';
        const deploymentId = deployment.Id || deployment.id;
        const percentComplete = deployment.PercentComplete || deployment.percentComplete || 0;
        const startTime = deployment.StartTime || deployment.startTime;
        const endTime = deployment.EndTime || deployment.endTime;
        const validationLinks = deployment.ValidationLinks || deployment.validationLinks || [];
        const params = deployment.parameters || {};

        // Determine status icon
        let statusIcon = STATUS_ICONS.INFO;
        switch (status.toLowerCase()) {
            case 'succeeded':
            case 'completed':
                statusIcon = STATUS_ICONS.SUCCESS;
                break;
            case 'inprogress':
            case 'completing':
            case 'resetting':
                statusIcon = STATUS_ICONS.IN_PROGRESS;
                break;
            case 'failed':
                statusIcon = STATUS_ICONS.ERROR;
                break;
            case 'awaitingverification':
                statusIcon = STATUS_ICONS.WAITING;
                break;
        }

        let response = `${STATUS_ICONS.ROCKET} **Deployment Status**\n\n`;
        response += `${statusIcon} **${status.toUpperCase()}** - ${deploymentId}\n`;
        
        if (startTime) {
            const start = new Date(startTime);
            response += `**Started:** ${start.toLocaleString()}\n`;
            
            if (endTime) {
                const end = new Date(endTime);
                const duration = Math.round((end - start) / 1000 / 60);
                response += `**Completed:** ${end.toLocaleString()}\n`;
                response += `**Duration:** ${duration} minutes\n`;
            } else {
                const now = new Date();
                const elapsed = Math.round((now - start) / 1000 / 60);
                response += `**Current Progress:** ${percentComplete}%\n`;
                response += `**Duration:** ${elapsed} minutes\n`;
            }
        }

        // Add operation details
        if (params.sourceEnvironment && params.targetEnvironment) {
            response += `**Operation:** ${params.sourceEnvironment} → ${params.targetEnvironment}\n`;
        } else if (params.targetEnvironment) {
            response += `**Target Environment:** ${params.targetEnvironment}\n`;
        }

        // Add validation links
        if (validationLinks.length > 0) {
            response += `${STATUS_ICONS.LOCK} **Preview URL:** ${validationLinks[0]}\n`;
        }

        // Add status-specific tips
        if (status.toLowerCase() === 'awaitingverification') {
            response += '\n' + ResponseBuilder.formatTips([
                'Deployment is in staging slot awaiting verification',
                'Use complete_deployment to move to live',
                'Use reset_deployment to rollback'
            ]);
        }

        return ResponseBuilder.addFooter(response);
    }

    static formatMultipleDeployments(deployments, limit) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.CLIPBOARD} **Recent Deployments**\n\n`;
        
        const deploymentsToShow = limit ? deployments.slice(0, limit) : deployments;
        
        deploymentsToShow.forEach((deployment, index) => {
            const status = deployment.Status || deployment.status || 'Unknown';
            const deploymentId = deployment.Id || deployment.id;
            const startTime = deployment.StartTime || deployment.startTime;
            const environment = deployment.Environment || deployment.environment || 'Unknown';
            
            response += `${index + 1}. **${deploymentId}**\n`;
            response += `   Status: ${status} | Environment: ${environment}\n`;
            if (startTime) {
                response += `   Started: ${new Date(startTime).toLocaleString()}\n`;
            }
            response += '\n';
        });

        if (deployments.length > deploymentsToShow.length) {
            response += `*Showing ${deploymentsToShow.length} of ${deployments.length} deployments*\n`;
        }

        return ResponseBuilder.addFooter(response);
    }

    /**
     * Start deployment
     */
    static async handleStartDeployment(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.targetEnvironment) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
        }

        // Validate deployment type
        const isPackageDeployment = args.packages && args.packages.length > 0;
        const isEnvironmentDeployment = args.sourceEnvironment && !isPackageDeployment;
        
        if (!isPackageDeployment && !isEnvironmentDeployment) {
            return ResponseBuilder.invalidParams(requestId, 'Must specify either packages or sourceEnvironment');
        }

        try {
            const result = await this.startDeployment(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Start deployment error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to start deployment', error.message);
        }
    }

    static async startDeployment(args) {
        const { 
            apiKey, apiSecret, projectId, targetEnvironment,
            packages, sourceEnvironment, sourceApps,
            includeBlob, includeDatabase,
            useMaintenancePage, directDeploy,
            zeroDowntimeMode, warmUpUrl,
            waitForCompletion, waitTimeoutMinutes
        } = args;

        const isPackageDeployment = packages && packages.length > 0;
        const isEnvironmentDeployment = sourceEnvironment && !isPackageDeployment;

        console.error(`Starting ${isPackageDeployment ? 'package' : 'environment'} deployment to ${targetEnvironment}`);

        // Build command
        let command = `Start-EpiDeployment -ProjectId '${projectId}' -TargetEnvironment '${targetEnvironment}'`;
        
        if (isPackageDeployment) {
            const packageList = packages.map(p => `'${p}'`).join(',');
            command += ` -PackageLocation @(${packageList})`;
        } else if (isEnvironmentDeployment) {
            command += ` -SourceEnvironment '${sourceEnvironment}'`;
            if (sourceApps && sourceApps.length > 0) {
                const appsList = sourceApps.map(a => `'${a}'`).join(',');
                command += ` -SourceApp @(${appsList})`;
            }
            if (includeBlob) command += ' -IncludeBlob';
            if (includeDatabase) command += ' -IncludeDb';
        }

        // Add options
        if (useMaintenancePage) command += ' -UseMaintenancePage';
        if (directDeploy) command += ' -DirectDeploy';
        if (zeroDowntimeMode) command += ` -ZeroDowntimeMode '${zeroDowntimeMode}'`;
        if (warmUpUrl) command += ` -WarmUpUrl '${warmUpUrl}'`;
        if (waitForCompletion) {
            command += ' -Wait';
            if (waitTimeoutMinutes) command += ` -WaitTimeoutMinutes ${waitTimeoutMinutes}`;
        }

        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Start Deployment',
                projectId,
                targetEnvironment
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            return this.formatDeploymentStarted(result.parsedData, args);
        }

        return ResponseBuilder.addFooter('Deployment command executed');
    }

    static formatDeploymentStarted(deployment, args) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.ROCKET} **Deployment Started Successfully!**\n\n`;
        response += `${STATUS_ICONS.SUCCESS} **Deployment Initiated**\n`;
        response += `**Deployment ID:** \`${deployment.id}\`\n`;
        response += `**Status:** ${deployment.status}\n`;
        response += `**Target Environment:** ${args.targetEnvironment}\n`;
        
        if (deployment.startTime) {
            response += `**Started:** ${new Date(deployment.startTime).toLocaleString()}\n`;
        }
        
        response += `**Progress:** ${deployment.percentComplete || 0}%\n`;

        // Add deployment type info
        if (args.packages) {
            response += `**Packages:** ${args.packages.join(', ')}\n`;
            response += `**Type:** Package Deployment\n`;
        } else if (args.sourceEnvironment) {
            response += `**Source:** ${args.sourceEnvironment} → ${args.targetEnvironment}\n`;
            response += `**Type:** Environment-to-Environment\n`;
            if (args.sourceApps) {
                response += `**Source Apps:** ${args.sourceApps.join(', ')}\n`;
            }
        }

        // Add options
        const options = [];
        if (args.useMaintenancePage) options.push('Maintenance Page');
        if (args.directDeploy) options.push('Direct Deploy');
        if (args.zeroDowntimeMode) options.push(`Zero Downtime (${args.zeroDowntimeMode})`);
        
        if (options.length > 0) {
            response += `**Options:** ${options.join(', ')}\n`;
        }

        // Add tips
        const tips = [
            'Monitor deployment progress using get_deployment_status',
            'Deployment typically takes 5-15 minutes',
            args.directDeploy ? 'Deployment will go directly to live' : 'Deployment will be in staging slot awaiting verification'
        ];

        response += '\n' + ResponseBuilder.formatTips(tips);
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Complete deployment
     */
    static async handleCompleteDeployment(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.deploymentId) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
        }

        try {
            const result = await this.completeDeployment(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Complete deployment error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to complete deployment', error.message);
        }
    }

    static async completeDeployment(args) {
        const { apiKey, apiSecret, projectId, deploymentId, waitForCompletion, waitTimeoutMinutes } = args;
        
        console.error(`Completing deployment ${deploymentId}`);

        // Build command
        let command = `Complete-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -Id '${deploymentId}'`;
        
        if (waitForCompletion) {
            command += ' -Wait';
            if (waitTimeoutMinutes) command += ` -WaitTimeoutMinutes ${waitTimeoutMinutes}`;
        }

        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Complete Deployment',
                projectId,
                deploymentId,
                expectedState: 'AwaitingVerification'
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            return this.formatDeploymentCompleted(result.parsedData);
        }

        return ResponseBuilder.addFooter('Deployment completion initiated');
    }

    static formatDeploymentCompleted(deployment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.SUCCESS} **Deployment Completion Started!**\n\n`;
        response += `${STATUS_ICONS.SUCCESS} **Staging Slot → Live Environment**\n`;
        response += `**Deployment ID:** \`${deployment.id}\`\n`;
        response += `**Status:** ${deployment.status}\n`;
        
        const tips = [
            'Monitor completion progress using get_deployment_status',
            'Completion typically takes 2-5 minutes',
            'Test your live site once completion finishes'
        ];

        response += '\n' + ResponseBuilder.formatTips(tips);
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Reset deployment
     */
    static async handleResetDeployment(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.deploymentId) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
        }

        try {
            const result = await this.resetDeployment(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Reset deployment error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to reset deployment', error.message);
        }
    }

    static async resetDeployment(args) {
        const { apiKey, apiSecret, projectId, deploymentId, includeDbRollback, waitForCompletion, waitTimeoutMinutes } = args;
        
        console.error(`Resetting deployment ${deploymentId}`);

        // Build command
        let command = `Reset-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -Id '${deploymentId}'`;
        
        if (includeDbRollback) command += ' -IncludeDbRollback';
        if (waitForCompletion) {
            command += ' -Wait';
            if (waitTimeoutMinutes) command += ` -WaitTimeoutMinutes ${waitTimeoutMinutes}`;
        }

        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Reset Deployment',
                projectId,
                deploymentId,
                expectedState: 'AwaitingVerification or Failed'
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            return this.formatDeploymentReset(result.parsedData, includeDbRollback);
        }

        return ResponseBuilder.addFooter('Deployment reset initiated');
    }

    static formatDeploymentReset(deployment, includeDbRollback) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.IN_PROGRESS} **Deployment Reset Status**\n\n`;
        response += `**Status:** ${deployment.status}\n`;
        response += `**Deployment ID:** ${deployment.id}\n`;
        response += `**DB Rollback:** ${includeDbRollback ? 'Included' : 'Not included'}\n`;
        
        const tips = [
            'The deployment has been reset',
            'You can now redeploy or make changes as needed',
            includeDbRollback ? 'Database has been rolled back' : 'Database was not rolled back'
        ];

        response += '\n' + ResponseBuilder.formatTips(tips);
        
        return ResponseBuilder.addFooter(response);
    }
}

module.exports = DeploymentTools;
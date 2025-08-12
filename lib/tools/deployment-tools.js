/**
 * Deployment Tools Module
 * Handles all deployment-related operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');

class DeploymentTools {
    /**
     * List all deployments
     */
    static async handleListDeployments(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
        }

        try {
            const result = await this.listDeployments(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('List deployments error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to list deployments', error.message);
        }
    }

    static async listDeployments(args) {
        const { apiKey, apiSecret, projectId } = args;
        
        console.error(`Listing deployments for project ${projectId}`);

        // Build command - without -Id parameter to get all deployments
        const command = `Get-EpiDeployment -ProjectId '${projectId}'`;

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
            return this.formatDeploymentList(result.parsedData);
        }

        return ResponseBuilder.addFooter('No deployments found');
    }

    static formatDeploymentList(deployments) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        // Get project name if available
        const projectName = process.env.OPTIMIZELY_PROJECT_NAME;
        const projectId = process.env.OPTIMIZELY_PROJECT_ID;
        
        let response = `${STATUS_ICONS.DEPLOY} **Recent Deployments`;
        if (projectName) {
            response += ` - ${projectName}**\n\n`;
        } else if (projectId) {
            response += ` - ${projectId}**\n\n`;
        } else {
            response += `**\n\n`;
        }
        
        if (Array.isArray(deployments) && deployments.length > 0) {
            // Sort by start time (most recent first)
            const sorted = deployments.sort((a, b) => {
                const dateA = new Date(a.startTime || a.created || 0);
                const dateB = new Date(b.startTime || b.created || 0);
                return dateB - dateA;
            });
            
            // Show up to 10 most recent deployments
            const recentDeployments = sorted.slice(0, 10);
            
            recentDeployments.forEach((deployment, index) => {
                const status = deployment.status || 'Unknown';
                let statusIcon = STATUS_ICONS.IN_PROGRESS;
                
                if (status.toLowerCase().includes('success') || status.toLowerCase().includes('completed')) {
                    statusIcon = STATUS_ICONS.SUCCESS;
                } else if (status.toLowerCase().includes('fail')) {
                    statusIcon = STATUS_ICONS.ERROR;
                } else if (status.toLowerCase().includes('reset')) {
                    statusIcon = STATUS_ICONS.WARNING;
                }
                
                response += `\n${index + 1}. ${statusIcon} **${status}**\n`;
                response += `   ID: \`${deployment.id}\`\n`;
                
                if (deployment.startTime) {
                    response += `   Started: ${new Date(deployment.startTime).toLocaleString()}\n`;
                }
                
                if (deployment.source && deployment.target) {
                    response += `   Route: ${deployment.source} → ${deployment.target}\n`;
                } else if (deployment.targetEnvironment) {
                    response += `   Target: ${deployment.targetEnvironment}\n`;
                }
                
                if (deployment.deploymentType) {
                    response += `   Type: ${deployment.deploymentType}\n`;
                }
            });
            
            if (deployments.length > 10) {
                response += `\n_Showing 10 most recent deployments out of ${deployments.length} total_\n`;
            }
        } else {
            response += 'No deployments found for this project.\n';
        }
        
        const tips = [
            'Ask me to "check status of [deployment ID]" for details',
            'Ask me to "deploy from X to Y" to create a new deployment',
            'Deployments awaiting verification can be completed or reset'
        ];
        
        response += '\n' + ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response);
    }

    
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

        // Determine status icon and clean status display
        let statusIcon = STATUS_ICONS.INFO;
        let displayStatus = status;
        switch (status.toLowerCase()) {
            case 'succeeded':
            case 'completed':
                statusIcon = STATUS_ICONS.SUCCESS;
                displayStatus = 'COMPLETED';
                break;
            case 'inprogress':
            case 'completing':
                statusIcon = STATUS_ICONS.IN_PROGRESS;
                displayStatus = 'IN PROGRESS';
                break;
            case 'resetting':
                statusIcon = STATUS_ICONS.IN_PROGRESS;
                displayStatus = 'RESETTING';
                break;
            case 'failed':
                statusIcon = STATUS_ICONS.ERROR;
                displayStatus = 'FAILED';
                break;
            case 'awaitingverification':
                statusIcon = STATUS_ICONS.WAITING;
                displayStatus = 'AWAITING VERIFICATION';
                break;
            default:
                displayStatus = status.toUpperCase();
        }

        let response = `${STATUS_ICONS.ROCKET} **Deployment Status**\n\n`;
        response += `${statusIcon} **Status:** ${displayStatus} ${statusIcon}\n`;
        response += `**Deployment ID:** ${deploymentId}\n`;
        
        // Show progress
        if (percentComplete > 0) {
            response += `**Progress:** ${percentComplete}% Complete ${percentComplete === 100 ? '✅' : ''}\n`;
        }
        
        // Show timing information
        if (startTime) {
            const start = new Date(startTime);
            
            if (endTime) {
                const end = new Date(endTime);
                const duration = Math.round((end - start) / 1000 / 60);
                response += `**Duration:** ${duration} minutes ✅\n`;
            } else {
                const now = new Date();
                const elapsed = Math.round((now - start) / 1000 / 60);
                response += `**Duration:** ${elapsed} minutes\n`;
            }
        }

        // Add operation details
        if (params.sourceEnvironment && params.targetEnvironment) {
            response += `**Operation:** ${params.sourceEnvironment} → ${params.targetEnvironment} ✅\n`;
        } else if (params.targetEnvironment) {
            response += `**Target Environment:** ${params.targetEnvironment}\n`;
        }

        // ALWAYS show validation/preview URL if available
        if (validationLinks && validationLinks.length > 0) {
            const previewUrl = Array.isArray(validationLinks) ? validationLinks[0] : validationLinks;
            response += `**Preview URL:** ${previewUrl} ✅\n`;
        } else if (status.toLowerCase() === 'awaitingverification') {
            // If awaiting verification but no URL yet, note it's coming
            response += `**Preview URL:** Loading... ⏳\n`;
        }

        // Add friendly next actions for awaiting verification status
        if (status.toLowerCase() === 'awaitingverification') {
            response += '\n**Next Action Available:**\n';
            response += '✅ **Complete Deployment** (move to live)\n';
            response += '↩️ **Reset Deployment** (rollback)\n';
            
            response += '\n' + ResponseBuilder.formatTips([
                'Test your changes at the preview URL above',
                'When ready, ask me to "complete the deployment" to go live',
                'Or ask me to "reset the deployment" if you need to rollback'
            ]);
        } else if (status.toLowerCase() === 'succeeded' || status.toLowerCase() === 'completed') {
            response += '\n' + ResponseBuilder.formatTips([
                'Deployment completed successfully!',
                'Your changes are now live',
                'Test your live environment to verify'
            ]);
        } else if (status.toLowerCase() === 'failed') {
            response += '\n' + ResponseBuilder.formatTips([
                'Deployment failed - check logs for details',
                'You may need to reset and try again',
                'Contact support if the issue persists'
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
        const isPackageDeployment = args.packages && Array.isArray(args.packages) && args.packages.length > 0;
        const isEnvironmentDeployment = args.sourceEnvironment && !isPackageDeployment;
        
        if (!isPackageDeployment && !isEnvironmentDeployment) {
            return ResponseBuilder.invalidParams(requestId, 'Must specify either packages or sourceEnvironment');
        }
        
        // Validate deployment path - code cannot skip environments
        if (isEnvironmentDeployment && args.sourceEnvironment === 'Integration' && args.targetEnvironment === 'Production') {
            // Check if this is a code deployment (default for upward or explicit)
            const deploymentType = args.deploymentType;
            if (!deploymentType || deploymentType === 'code' || deploymentType === 'all') {
                return ResponseBuilder.invalidParams(requestId, 
                    'Code cannot be deployed directly from Integration to Production. ' +
                    'Deploy to Preproduction first, then to Production. ' +
                    'To copy content from Production to Integration, use deploymentType: "content"');
            }
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
            deploymentType, includeBlob, includeDatabase,
            useMaintenancePage, directDeploy,
            zeroDowntimeMode, warmUpUrl,
            waitForCompletion, waitTimeoutMinutes
        } = args;

        const isPackageDeployment = packages && Array.isArray(packages) && packages.length > 0;
        const isEnvironmentDeployment = sourceEnvironment && !isPackageDeployment;

        console.error(`Deployment type detection: isPackage=${isPackageDeployment}, isEnvironment=${isEnvironmentDeployment}`);
        console.error(`Args received: packages=${JSON.stringify(packages)}, sourceEnvironment=${sourceEnvironment}`);

        // Determine what to deploy based on deployment direction and type
        // Smart defaults based on typical deployment patterns:
        // - Upward (Int→Pre, Pre→Prod): Default to CODE deployment
        // - Downward (Prod→Pre, Pre→Int, Prod→Int): Default to CONTENT copy
        
        const envOrder = { 'Integration': 1, 'Preproduction': 2, 'Production': 3 };
        const sourceLevel = envOrder[sourceEnvironment];
        const targetLevel = envOrder[targetEnvironment];
        const isUpwardDeployment = sourceLevel < targetLevel;
        const isDownwardDeployment = sourceLevel > targetLevel;
        
        // Set smart defaults based on deployment direction
        let deployCode, deployBlobs, deployDatabase;
        
        if (deploymentType) {
            // If deploymentType is explicitly specified, use it
            switch (deploymentType) {
                case 'code':
                    deployCode = true;
                    deployBlobs = false;
                    deployDatabase = false;
                    break;
                case 'content':
                    deployCode = false;
                    deployBlobs = true;
                    deployDatabase = true;
                    break;
                case 'all':
                    deployCode = true;
                    deployBlobs = true;
                    deployDatabase = true;
                    break;
            }
        } else {
            // Use smart defaults based on deployment direction
            if (isUpwardDeployment) {
                // Int→Pre or Pre→Prod: Default to CODE deployment
                deployCode = true;
                deployBlobs = false;
                deployDatabase = false;
                console.error(`Smart default: Upward deployment (${sourceEnvironment}→${targetEnvironment}) defaults to CODE only`);
            } else if (isDownwardDeployment) {
                // Prod→Pre, Pre→Int, or Prod→Int: Default to CONTENT copy
                deployCode = false;
                deployBlobs = true;
                deployDatabase = true;
                console.error(`Smart default: Downward deployment (${sourceEnvironment}→${targetEnvironment}) defaults to CONTENT only`);
            } else {
                // Same environment? Default to code
                deployCode = true;
                deployBlobs = false;
                deployDatabase = false;
            }
        }
        
        // If explicit flags were provided, they override everything
        if (args.hasOwnProperty('includeBlob')) deployBlobs = includeBlob;
        if (args.hasOwnProperty('includeDatabase')) deployDatabase = includeDatabase;

        console.error(`Starting ${isPackageDeployment ? 'package' : 'environment'} deployment to ${targetEnvironment}`);
        console.error(`Source: ${sourceEnvironment || 'package'}, Target: ${targetEnvironment}`);
        console.error(`Deploying: Code=${deployCode}, Blobs=${deployBlobs}, Database=${deployDatabase}`);

        // Build command - Start-EpiDeployment requires ClientKey/ClientSecret as direct parameters
        let command = `Start-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -TargetEnvironment '${targetEnvironment}'`;
        
        if (isPackageDeployment) {
            const packageList = packages.map(p => `'${p}'`).join(',');
            command += ` -DeploymentPackage @(${packageList})`;
        } else if (isEnvironmentDeployment) {
            command += ` -SourceEnvironment '${sourceEnvironment}'`;
            
            // CRITICAL: For environment-to-environment deployments:
            // - To deploy CODE: Must specify -SourceApp (typically 'cms' for CMS projects)
            // - To deploy CONTENT: Must specify -IncludeBlob and/or -IncludeDb
            // - Without any of these, the deployment will fail with "must provide what to deploy" error
            
            // Handle source apps (for code deployment)
            if (deployCode) {
                // If no specific apps specified, default to 'cms'
                // Users can specify sourceApps: ['cms', 'commerce'] for Commerce projects
                const appsToUse = sourceApps && sourceApps.length > 0 
                    ? sourceApps 
                    : ['cms']; // Default to CMS app, most common scenario
                const appsList = appsToUse.map(a => `'${a}'`).join(',');
                command += ` -SourceApp @(${appsList})`;
            }
            
            // Add content flags (these deploy content IN ADDITION to code if SourceApp is specified)
            if (deployBlobs) command += ' -IncludeBlob';
            if (deployDatabase) command += ' -IncludeDb';
        } else {
            // This shouldn't happen due to validation, but add safety check
            console.error('ERROR: Invalid deployment configuration - neither package nor environment deployment');
            return ErrorHandler.formatError({
                type: 'INVALID_CONFIGURATION',
                title: 'Invalid Deployment Configuration',
                message: 'Unable to determine deployment type. Please specify either sourceEnvironment for environment-to-environment deployment or packages for package deployment.',
                solution: 'For environment deployment, provide sourceEnvironment. For package deployment, provide packages array.'
            });
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
        console.error(`Executing PowerShell command: ${command}`);
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Log full result for debugging
        console.error('PowerShell execution result:', {
            hasStdout: !!result.stdout,
            hasStderr: !!result.stderr,
            success: result.success,
            stderr: result.stderr,
            stdout: result.stdout?.substring(0, 500) // First 500 chars of stdout
        });

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Start Deployment',
                projectId,
                targetEnvironment
            });

            if (error) {
                console.error('ErrorHandler detected error:', error);
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            // Pass the deployment flags to the formatter
            const enhancedArgs = {
                ...args,
                deploymentType: deploymentType || (deployBlobs && deployDatabase ? 'all' : deployBlobs ? 'content' : 'code'),
                includeBlob: deployBlobs,
                includeDatabase: deployDatabase
            };
            return this.formatDeploymentStarted(result.parsedData, enhancedArgs);
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
            
            // Show what's being deployed
            const deploymentContent = [];
            if (args.deploymentType === 'all') {
                deploymentContent.push('Code', 'BLOBs', 'Database');
            } else if (args.deploymentType === 'content') {
                deploymentContent.push('BLOBs', 'Database');
            } else if (args.deploymentType === 'code' || (!args.includeBlob && !args.includeDatabase)) {
                deploymentContent.push('Code');
            } else {
                if (!args.includeBlob && !args.includeDatabase) deploymentContent.push('Code');
                if (args.includeBlob) deploymentContent.push('BLOBs');
                if (args.includeDatabase) deploymentContent.push('Database');
            }
            response += `**Deploying:** ${deploymentContent.join(', ')}\n`;
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
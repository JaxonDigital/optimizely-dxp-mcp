/**
 * Deployment Formatters
 * Handles formatting of deployment responses
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { Config, ResponseBuilder } = require('../../index');

class DeploymentFormatters {
    /**
     * Format a list of deployments
     */
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
                } else if (status.toLowerCase().includes('verification')) {
                    statusIcon = STATUS_ICONS.VERIFICATION;
                }
                
                response += `${statusIcon} **Deployment #${deployment.id}**\n`;
                response += `• From: ${deployment.startEnvironment || 'Unknown'} → To: ${deployment.endEnvironment || 'Unknown'}\n`;
                response += `• Status: **${status}**\n`;
                
                if (deployment.startTime) {
                    const date = new Date(deployment.startTime);
                    response += `• Started: ${date.toLocaleString()}\n`;
                }
                
                if (deployment.completionTime) {
                    const date = new Date(deployment.completionTime);
                    response += `• Completed: ${date.toLocaleString()}\n`;
                }
                
                // Show preview URL for deployments awaiting verification
                if (status.toLowerCase().includes('verification')) {
                    const previewUrl = this.getPreviewUrl(deployment.endEnvironment, projectId);
                    if (previewUrl) {
                        response += `• **Preview URL**: ${previewUrl}\n`;
                    }
                }
                
                response += '\n';
            });
            
            if (deployments.length > 10) {
                response += `_Showing 10 most recent deployments out of ${deployments.length} total_\n`;
            }
        } else {
            response += 'No deployments found.\n';
        }
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Format a single deployment
     */
    static formatSingleDeployment(deployment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        const projectId = process.env.OPTIMIZELY_PROJECT_ID;
        const projectName = process.env.OPTIMIZELY_PROJECT_NAME;
        
        let response = `${STATUS_ICONS.DEPLOY} **Deployment Details`;
        if (projectName) {
            response += ` - ${projectName}**\n\n`;
        } else {
            response += `**\n\n`;
        }
        
        const status = deployment.status || 'Unknown';
        let statusIcon = STATUS_ICONS.IN_PROGRESS;
        
        if (status.toLowerCase().includes('success') || status.toLowerCase().includes('completed')) {
            statusIcon = STATUS_ICONS.SUCCESS;
        } else if (status.toLowerCase().includes('fail')) {
            statusIcon = STATUS_ICONS.ERROR;
        } else if (status.toLowerCase().includes('reset')) {
            statusIcon = STATUS_ICONS.WARNING;
        } else if (status.toLowerCase().includes('verification')) {
            statusIcon = STATUS_ICONS.VERIFICATION;
        }
        
        response += `${statusIcon} **Deployment #${deployment.id}**\n\n`;
        
        response += `**Status**: ${status}\n`;
        response += `**From**: ${deployment.startEnvironment || 'Unknown'}\n`;
        response += `**To**: ${deployment.endEnvironment || 'Unknown'}\n`;
        
        // Always show preview URL for deployments awaiting verification
        if (status.toLowerCase().includes('verification')) {
            const previewUrl = this.getPreviewUrl(deployment.endEnvironment, projectId);
            if (previewUrl) {
                response += `\n**🔗 Preview URL**: ${previewUrl}\n`;
                response += `_Review your changes at the preview URL above_\n`;
            }
        }
        
        if (deployment.startTime) {
            const date = new Date(deployment.startTime);
            response += `\n**Started**: ${date.toLocaleString()}\n`;
        }
        
        if (deployment.completionTime) {
            const date = new Date(deployment.completionTime);
            response += `**Completed**: ${date.toLocaleString()}\n`;
        }
        
        if (deployment.validationMessages && deployment.validationMessages.length > 0) {
            response += '\n**Validation Messages**:\n';
            deployment.validationMessages.forEach(msg => {
                response += `• ${msg}\n`;
            });
        }
        
        if (deployment.deploymentErrors && deployment.deploymentErrors.length > 0) {
            response += '\n**Errors**:\n';
            deployment.deploymentErrors.forEach(err => {
                response += `• ${err}\n`;
            });
        }
        
        // Add action hint for verification state
        if (status.toLowerCase().includes('verification')) {
            response += '\n**Next Actions**:\n';
            response += '• Review changes at the preview URL\n';
            response += '• Use `complete_deployment` to finalize\n';
            response += '• Use `reset_deployment` to rollback\n';
        }
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Format multiple deployments with optional limit
     */
    static formatMultipleDeployments(deployments, limit) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        const projectId = process.env.OPTIMIZELY_PROJECT_ID;
        
        // Ensure deployments is an array
        const deploymentArray = Array.isArray(deployments) ? deployments : [deployments];
        
        // Sort by start time (most recent first)
        const sorted = deploymentArray.sort((a, b) => {
            const dateA = new Date(a.startTime || a.created || 0);
            const dateB = new Date(b.startTime || b.created || 0);
            return dateB - dateA;
        });
        
        // Apply limit if specified
        const toShow = limit ? sorted.slice(0, limit) : sorted;
        
        let response = `${STATUS_ICONS.DEPLOY} **Deployment Status**\n\n`;
        
        toShow.forEach((deployment) => {
            const status = deployment.status || 'Unknown';
            let statusIcon = STATUS_ICONS.IN_PROGRESS;
            
            if (status.toLowerCase().includes('success') || status.toLowerCase().includes('completed')) {
                statusIcon = STATUS_ICONS.SUCCESS;
            } else if (status.toLowerCase().includes('fail')) {
                statusIcon = STATUS_ICONS.ERROR;
            } else if (status.toLowerCase().includes('reset')) {
                statusIcon = STATUS_ICONS.WARNING;
            } else if (status.toLowerCase().includes('verification')) {
                statusIcon = STATUS_ICONS.VERIFICATION;
            }
            
            response += `${statusIcon} **Deployment #${deployment.id}**\n`;
            response += `• Status: **${status}**\n`;
            response += `• From: ${deployment.startEnvironment || 'N/A'} → To: ${deployment.endEnvironment || 'N/A'}\n`;
            
            // Always show preview URL for deployments awaiting verification
            if (status.toLowerCase().includes('verification')) {
                const previewUrl = this.getPreviewUrl(deployment.endEnvironment, projectId);
                if (previewUrl) {
                    response += `• **Preview URL**: ${previewUrl}\n`;
                }
            }
            
            if (deployment.startTime) {
                const date = new Date(deployment.startTime);
                response += `• Started: ${date.toLocaleString()}\n`;
            }
            
            response += '\n';
        });
        
        if (limit && deploymentArray.length > limit) {
            response += `_Showing ${limit} most recent deployments out of ${deploymentArray.length} total_\n`;
        }
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Format deployment started response
     */
    static formatDeploymentStarted(deployment, args) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        const projectId = process.env.OPTIMIZELY_PROJECT_ID;
        const projectName = process.env.OPTIMIZELY_PROJECT_NAME;
        
        let response = `${STATUS_ICONS.SUCCESS} **Deployment Started`;
        if (projectName) {
            response += ` - ${projectName}**\n\n`;
        } else {
            response += `**\n\n`;
        }
        
        response += `**Deployment ID**: ${deployment.id}\n`;
        response += `**From**: ${args.sourceEnvironment}\n`;
        response += `**To**: ${args.targetEnvironment}\n`;
        
        // Show what's being deployed
        let deploymentType = args.deploymentType;
        if (!deploymentType) {
            // Apply smart defaults
            const isUpward = this.isUpwardDeployment(args.sourceEnvironment, args.targetEnvironment);
            deploymentType = isUpward ? 'code' : 'content';
        }
        
        response += `**Type**: ${deploymentType.charAt(0).toUpperCase() + deploymentType.slice(1)}`;
        
        if (deploymentType === 'code' && args.sourceApps) {
            response += ` (${args.sourceApps.join(', ')})`;
        }
        response += '\n';
        
        if (deployment.status) {
            response += `**Status**: ${deployment.status}\n`;
        }
        
        // Always show preview URL for deployments that will need verification
        const needsVerification = args.targetEnvironment === 'Production' && !args.directDeploy;
        if (needsVerification) {
            const previewUrl = this.getPreviewUrl(args.targetEnvironment, projectId);
            if (previewUrl) {
                response += `\n**🔗 Preview URL**: ${previewUrl}\n`;
                response += `_Your deployment will be available for preview at this URL once it enters verification state_\n`;
            }
        }
        
        response += '\n**Next Steps**:\n';
        response += `• Use \`get_deployment_status\` with deployment ID **${deployment.id}** to check progress\n`;
        
        if (needsVerification) {
            response += '• Once in Verification state, review your changes at the preview URL\n';
            response += '• Use `complete_deployment` to finalize or `reset_deployment` to rollback\n';
        }
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Format deployment completed response
     */
    static formatDeploymentCompleted(deployment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        const projectName = process.env.OPTIMIZELY_PROJECT_NAME;
        
        let response = `${STATUS_ICONS.SUCCESS} **Deployment Completed Successfully`;
        if (projectName) {
            response += ` - ${projectName}**\n\n`;
        } else {
            response += `**\n\n`;
        }
        
        response += `**Deployment ID**: ${deployment.id}\n`;
        
        if (deployment.status) {
            response += `**Final Status**: ${deployment.status}\n`;
        }
        
        if (deployment.completionTime) {
            const date = new Date(deployment.completionTime);
            response += `**Completed At**: ${date.toLocaleString()}\n`;
        }
        
        response += '\nThe deployment has been successfully completed and changes are now live.';
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Format deployment reset response
     */
    static formatDeploymentReset(deployment, includeDbRollback) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        const projectName = process.env.OPTIMIZELY_PROJECT_NAME;
        
        let response = `${STATUS_ICONS.WARNING} **Deployment Reset`;
        if (projectName) {
            response += ` - ${projectName}**\n\n`;
        } else {
            response += `**\n\n`;
        }
        
        response += `**Deployment ID**: ${deployment.id}\n`;
        
        if (deployment.status) {
            response += `**Status**: ${deployment.status}\n`;
        }
        
        response += '\nThe deployment has been rolled back.\n';
        
        if (includeDbRollback) {
            response += '\n**Note**: Database changes have also been rolled back.';
        }
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Helper to check if deployment is upward (code flow)
     */
    static isUpwardDeployment(source, target) {
        const envOrder = ['Integration', 'Preproduction', 'Production'];
        const sourceIndex = envOrder.indexOf(source);
        const targetIndex = envOrder.indexOf(target);
        return targetIndex > sourceIndex;
    }

    /**
     * Get preview URL for an environment
     */
    static getPreviewUrl(environment, projectId) {
        if (!projectId) return null;
        
        const envMap = {
            'Integration': 'integration',
            'Preproduction': 'preproduction',
            'Production': 'production'
        };
        
        const envSlug = envMap[environment];
        if (!envSlug) return null;
        
        // Remove any @ prefix from project ID if present
        const cleanProjectId = projectId.replace(/^@/, '');
        
        return `https://${cleanProjectId}.${envSlug}.dxp.optimizely.com/`;
    }
}

module.exports = DeploymentFormatters;
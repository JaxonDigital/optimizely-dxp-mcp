/**
 * Deployment Formatters
 * Handles formatting of deployment responses
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { Config, ResponseBuilder } = require('../../index');

class DeploymentFormatters {
    /**
     * Format date/time in user's local timezone with timezone name
     */
    static formatLocalDateTime(dateInput) {
        if (!dateInput) return 'N/A';
        
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) return 'Invalid date';
        
        // Get the user's timezone
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        
        // Format date and time portions separately
        const dateOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };
        
        const timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short'
        };
        
        const datePart = date.toLocaleDateString('en-US', dateOptions);
        const timePart = date.toLocaleTimeString('en-US', timeOptions);
        
        // Format as: Aug 6, 2025 (12:26 PM CDT)
        return `${datePart} (${timePart})`;
    }
    
    /**
     * Format duration between two dates
     */
    static formatDuration(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const duration = end - start;
        
        if (duration < 0) return 'Invalid duration';
        
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        
        if (minutes > 60) {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${hours}h ${mins}m`;
        }
        
        return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }
    /**
     * Format a list of deployments
     */
    static formatDeploymentList(deployments, projectId = null, limit = null, projectName = null) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        // Get project info from configured projects if not provided
        if (!projectId || !projectName) {
            try {
                const ProjectTools = require('../project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                if (projects && projects.length > 0) {
                    const defaultProject = projects.find(p => p.isDefault) || projects[0];
                    projectId = projectId || defaultProject.id;
                    projectName = projectName || defaultProject.name;
                }
            } catch (error) {
                // Fall back to environment variables if ProjectTools fails
                projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME;
                projectId = projectId || process.env.OPTIMIZELY_PROJECT_ID;
            }
        }
        
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
            
            // Apply limit if specified, otherwise show up to 5 for performance
            const displayLimit = limit || 5;
            const recentDeployments = sorted.slice(0, displayLimit);
            
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
                
                // Get environment names - check direct fields first, then parameters
                // For package uploads, there's no source environment
                const sourceEnv = deployment.startEnvironment || deployment.parameters?.sourceEnvironment || null;
                const targetEnv = deployment.endEnvironment || deployment.parameters?.targetEnvironment || 'Unknown';
                const isPackageUpload = deployment.parameters?.packages && deployment.parameters?.packages.length > 0;
                
                // Format deployment path - handle package uploads differently
                if (isPackageUpload && !sourceEnv) {
                    const packageName = deployment.parameters.packages[0];
                    response += `• Package: ${packageName} → ${targetEnv}\n`;
                } else if (!sourceEnv || sourceEnv === 'Unknown') {
                    response += `• To: ${targetEnv} (Package Upload)\n`;
                } else {
                    response += `• From: ${sourceEnv} → To: ${targetEnv}\n`;
                }
                response += `• Status: **${status}**`;
                
                // Add progress for in-progress deployments
                if (deployment.percentComplete !== undefined && deployment.percentComplete < 100) {
                    response += ` (${deployment.percentComplete}%)`;
                }
                response += '\n';
                
                if (deployment.startTime) {
                    response += `• Started: ${this.formatLocalDateTime(deployment.startTime)}`;
                    
                    // Add duration for completed deployments
                    if (deployment.endTime) {
                        const duration = this.formatDuration(deployment.startTime, deployment.endTime);
                        response += ` (Duration: ${duration})`;
                    }
                    response += '\n';
                }
                
                // Show deployment type if available and limit is small
                if (displayLimit <= 5 && deployment.parameters) {
                    if (deployment.parameters.sourceApps && deployment.parameters.sourceApps.length > 0) {
                        response += `• Apps: ${deployment.parameters.sourceApps.join(', ')}`;
                        
                        // Add flags for blob/db
                        const flags = [];
                        if (deployment.parameters.includeBlob) flags.push('Blob');
                        if (deployment.parameters.includeDb) flags.push('DB');
                        if (flags.length > 0) {
                            response += ` (+${flags.join(', ')})`;
                        }
                        response += '\n';
                    }
                }
                
                // Show errors/warnings if present
                if (deployment.deploymentErrors && deployment.deploymentErrors.length > 0) {
                    response += `• **❌ ${deployment.deploymentErrors.length} Error(s)**\n`;
                }
                if (deployment.deploymentWarnings && deployment.deploymentWarnings.length > 0) {
                    response += `• **⚠️ ${deployment.deploymentWarnings.length} Warning(s)**\n`;
                }
                
                // Show preview URL for deployments awaiting verification
                if (status.toLowerCase().includes('verification')) {
                    const previewUrl = this.getPreviewUrl(targetEnv, projectId);
                    if (previewUrl) {
                        response += `• **Preview URL**: ${previewUrl}\n`;
                    }
                }
                
                response += '\n';
            });
            
            if (deployments.length > displayLimit) {
                response += `_Showing ${displayLimit} most recent deployments out of ${deployments.length} total_\n`;
            }
        } else {
            response += 'No deployments found.\n';
        }
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Format a single deployment
     */
    static formatSingleDeployment(deployment, projectName = null) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        // Get project info from configured projects if not provided
        let projectId = null;
        if (!projectName) {
            try {
                const ProjectTools = require('../project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                if (projects && projects.length > 0) {
                    const defaultProject = projects.find(p => p.isDefault) || projects[0];
                    projectId = defaultProject.id;
                    projectName = projectName || defaultProject.name;
                }
            } catch (error) {
                // Fall back to environment variables if ProjectTools fails
                projectId = process.env.OPTIMIZELY_PROJECT_ID;
                projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME;
            }
        }
        
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
        
        // Get environment names - check direct fields first, then parameters
        const sourceEnv = deployment.startEnvironment || deployment.parameters?.sourceEnvironment || null;
        const targetEnv = deployment.endEnvironment || deployment.parameters?.targetEnvironment || 'Unknown';
        const isPackageUpload = deployment.parameters?.packages && deployment.parameters?.packages.length > 0;
        
        response += `**Status**: ${status}\n`;
        if (isPackageUpload && !sourceEnv) {
            response += `**Package**: ${deployment.parameters.packages[0]}\n`;
            response += `**To**: ${targetEnv}\n`;
            response += `**Type**: Package Upload\n`;
        } else if (!sourceEnv || sourceEnv === 'Unknown') {
            response += `**To**: ${targetEnv}\n`;
            response += `**Type**: Package Upload\n`;
        } else {
            response += `**From**: ${sourceEnv}\n`;
            response += `**To**: ${targetEnv}\n`;
        }
        
        // Show progress if available
        if (deployment.percentComplete !== undefined) {
            response += `**Progress**: ${deployment.percentComplete}%\n`;
        }
        
        // Always show preview URL for deployments awaiting verification
        if (status.toLowerCase().includes('verification')) {
            const previewUrl = this.getPreviewUrl(targetEnv, projectId);
            if (previewUrl) {
                response += `\n**🔗 Preview URL**: ${previewUrl}\n`;
                response += `_Review your changes at the preview URL above_\n`;
            }
        }
        
        // Timing information
        response += '\n**📅 Timeline**:\n';
        if (deployment.startTime) {
            response += `• Started: ${this.formatLocalDateTime(deployment.startTime)}\n`;
        }
        
        if (deployment.endTime) {
            response += `• Ended: ${this.formatLocalDateTime(deployment.endTime)}\n`;
            
            // Calculate duration if both times are available
            if (deployment.startTime) {
                const duration = this.formatDuration(deployment.startTime, deployment.endTime);
                response += `• Duration: ${duration}\n`;
            }
        }
        
        // Deployment configuration details
        if (deployment.parameters) {
            response += '\n**⚙️ Configuration**:\n';
            
            if (deployment.parameters.sourceApps && deployment.parameters.sourceApps.length > 0) {
                response += `• Apps: ${deployment.parameters.sourceApps.join(', ')}\n`;
            }
            
            if (deployment.parameters.includeBlob !== undefined) {
                response += `• Include Blob: ${deployment.parameters.includeBlob ? 'Yes' : 'No'}\n`;
            }
            
            if (deployment.parameters.includeDb !== undefined) {
                response += `• Include Database: ${deployment.parameters.includeDb ? 'Yes' : 'No'}\n`;
            }
            
            if (deployment.parameters.maintenancePage !== undefined) {
                response += `• Maintenance Page: ${deployment.parameters.maintenancePage ? 'Enabled' : 'Disabled'}\n`;
            }
            
            if (deployment.parameters.zeroDowntimeMode && deployment.parameters.zeroDowntimeMode !== 'NotApplicable') {
                response += `• Zero Downtime Mode: ${deployment.parameters.zeroDowntimeMode}\n`;
            }
            
            // Reset parameters if this was a rollback
            if (deployment.parameters.resetParameters) {
                response += '\n**🔄 Reset Configuration**:\n';
                const reset = deployment.parameters.resetParameters;
                if (reset.resetWithDbRollback !== undefined) {
                    response += `• Database Rollback: ${reset.resetWithDbRollback ? 'Yes' : 'No'}\n`;
                }
                if (reset.validateBeforeSwap !== undefined) {
                    response += `• Validate Before Swap: ${reset.validateBeforeSwap ? 'Yes' : 'No'}\n`;
                }
                if (reset.complete !== undefined) {
                    response += `• Auto-Complete: ${reset.complete ? 'Yes' : 'No'}\n`;
                }
            }
        }
        
        // Validation links if available
        if (deployment.validationLinks && deployment.validationLinks.length > 0) {
            response += '\n**🔗 Validation Links**:\n';
            deployment.validationLinks.forEach(link => {
                response += `• ${link}\n`;
            });
        }
        
        // Warnings
        if (deployment.deploymentWarnings && deployment.deploymentWarnings.length > 0) {
            response += '\n**⚠️ Warnings**:\n';
            deployment.deploymentWarnings.forEach(warning => {
                response += `• ${warning}\n`;
            });
        }
        
        // Errors
        if (deployment.deploymentErrors && deployment.deploymentErrors.length > 0) {
            response += '\n**❌ Errors**:\n';
            deployment.deploymentErrors.forEach(err => {
                response += `• ${err}\n`;
            });
        }
        
        // Validation messages (legacy field)
        if (deployment.validationMessages && deployment.validationMessages.length > 0) {
            response += '\n**Validation Messages**:\n';
            deployment.validationMessages.forEach(msg => {
                response += `• ${msg}\n`;
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
        
        // Get project info from configured projects
        let projectId = null;
        let projectName = null;
        try {
            const ProjectTools = require('../project-tools');
            const projects = ProjectTools.getConfiguredProjects();
            if (projects && projects.length > 0) {
                const defaultProject = projects.find(p => p.isDefault) || projects[0];
                projectId = defaultProject.id;
                projectName = defaultProject.name;
            }
        } catch (error) {
            // Fall back to environment variables if ProjectTools fails
            projectId = process.env.OPTIMIZELY_PROJECT_ID;
        }
        
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
            
            const sourceEnv = deployment.startEnvironment || deployment.parameters?.sourceEnvironment || null;
            const targetEnv = deployment.endEnvironment || deployment.parameters?.targetEnvironment || 'N/A';
            
            if (!sourceEnv || sourceEnv === 'Unknown' || sourceEnv === 'N/A') {
                response += `• To: ${targetEnv} (Package Upload)\n`;
            } else {
                response += `• From: ${sourceEnv} → To: ${targetEnv}\n`;
            }
            
            // Always show preview URL for deployments awaiting verification
            if (status.toLowerCase().includes('verification')) {
                const previewUrl = this.getPreviewUrl(deployment.endEnvironment, projectId);
                if (previewUrl) {
                    response += `• **Preview URL**: ${previewUrl}\n`;
                }
            }
            
            if (deployment.startTime) {
                response += `• Started: ${this.formatLocalDateTime(deployment.startTime)}\n`;
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
        
        // Get project info from args, configured projects, or environment variables
        let projectId = args.projectId;
        let projectName = args.projectName;
        
        if (!projectId || !projectName) {
            try {
                const ProjectTools = require('../project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                if (projects && projects.length > 0) {
                    const defaultProject = projects.find(p => p.isDefault) || projects[0];
                    projectId = projectId || defaultProject.id;
                    projectName = projectName || defaultProject.name;
                }
            } catch (error) {
                // Fall back to environment variables if ProjectTools fails
                projectId = projectId || process.env.OPTIMIZELY_PROJECT_ID;
                projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME;
            }
        }
        
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
    static formatDeploymentCompleted(deployment, projectName = null) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME;
        
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
            response += `**Completed At**: ${this.formatLocalDateTime(deployment.completionTime)}\n`;
        }
        
        response += '\nThe deployment has been successfully completed and changes are now live.';
        
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Format deployment reset response
     */
    static formatDeploymentReset(deployment, includeDbRollback, projectName = null) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME;
        
        let response = `${STATUS_ICONS.WARNING} **Deployment Reset Initiated`;
        if (projectName) {
            response += ` - ${projectName}**\n\n`;
        } else {
            response += `**\n\n`;
        }
        
        response += `**Deployment ID**: ${deployment.id}\n`;
        
        if (deployment.status) {
            response += `**Status**: ${deployment.status || 'Resetting'}\n`;
        }
        
        // Get deployment details if available
        if (deployment.parameters) {
            const source = deployment.parameters.sourceEnvironment;
            const target = deployment.parameters.targetEnvironment;
            if (source && target) {
                response += `**Original Deployment**: ${source} → ${target}\n`;
            }
        }
        
        response += '\n🔄 **Reset in Progress**\n';
        response += 'The deployment is being rolled back. This typically takes 2-5 minutes.\n';
        
        if (includeDbRollback) {
            response += '\n⚠️ **Database Rollback**: Database changes are also being reverted.\n';
        }
        
        response += '\n📊 **I\'ll monitor the reset progress and notify you when it\'s complete.**';
        response += '\n\nYou can continue working while the reset completes. I\'ll update you with:';
        response += '\n• Reset completion status';
        response += '\n• Environment restoration confirmation';
        response += '\n• Any errors or issues encountered';
        
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
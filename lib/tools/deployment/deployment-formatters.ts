/**
 * Deployment Formatters
 * Handles formatting of deployment responses
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import { Config, ResponseBuilder } from '../../index';

/**
 * Deployment object from API
 */
interface Deployment {
    id: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    completionTime?: string;
    percentComplete?: number;
    startEnvironment?: string;
    endEnvironment?: string;
    targetEnvironment?: string;
    created?: string;
    parameters?: DeploymentParameters;
    deploymentErrors?: string[];
    deploymentWarnings?: string[];
    validationLinks?: string[];
    validationMessages?: string[];
}

/**
 * Deployment parameters
 */
interface DeploymentParameters {
    sourceEnvironment?: string;
    targetEnvironment?: string;
    packages?: string[];
    sourceApps?: string[];
    includeBlob?: boolean;
    includeDb?: boolean;
    maintenancePage?: boolean;
    zeroDowntimeMode?: string;
    resetParameters?: ResetParameters;
}

/**
 * Reset parameters for rollback
 */
interface ResetParameters {
    resetWithDbRollback?: boolean;
    validateBeforeSwap?: boolean;
    complete?: boolean;
}

/**
 * Structured deployment data for automation
 */
interface StructuredDeploymentData {
    deploymentId: string;
    status: string;
    sourceEnvironment?: string | null;
    targetEnvironment: string;
    startTime?: string | null;
    endTime?: string | null;
    percentComplete: number;
    [key: string]: any;
}

/**
 * Structured deployment list data
 */
interface StructuredDeploymentListData {
    projectId: string | null;
    projectName?: string | null;
    deployments: StructuredDeploymentData[];
    totalCount: number;
    displayLimit: number;
}

/**
 * Structured result with data and message
 */
interface StructuredResult {
    data: any;
    message: string;
}

/**
 * Start deployment arguments
 */
interface StartDeploymentArgs {
    projectId?: string;
    projectName?: string;
    sourceEnvironment?: string;
    targetEnvironment?: string;
    deploymentType?: string;
    sourceApps?: string[];
    includeBlob?: boolean;
    includeDatabase?: boolean;
    directDeploy?: boolean;
    useMaintenancePage?: boolean;
}

class DeploymentFormatters {
    /**
     * Format date/time in user's local timezone with timezone name
     */
    static formatLocalDateTime(dateInput: string | Date | null | undefined): string {
        if (!dateInput) return 'N/A';

        const date = new Date(dateInput);
        if (isNaN(date.getTime())) return 'Invalid date';

        // Get the user's timezone
        // const _timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Format date and time portions separately
        const dateOptions: Intl.DateTimeFormatOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };

        const timeOptions: Intl.DateTimeFormatOptions = {
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
    static formatDuration(startDate: string | Date, endDate: string | Date): string {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const duration = end.getTime() - start.getTime();

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
    static formatDeploymentList(
        deployments: Deployment[],
        projectId: string | null = null,
        limit: number | null = null,
        projectName: string | null = null
    ): StructuredResult {
        const { FORMATTING: { STATUS_ICONS } } = Config;

        // Get project info from configured projects if not provided
        // DXP-126: Only fill in missing values, don't replace both if only one is missing
        if (!projectId || !projectName) {
            try {
                const ProjectTools = require('../project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                if (projects && projects.length > 0) {
                    // If projectName is provided but projectId is not, find matching project by name
                    if (projectName && !projectId) {
                        const matchingProject = projects.find((p: any) => p.name === projectName);
                        if (matchingProject) {
                            projectId = matchingProject.id || matchingProject.projectId;
                        }
                    }
                    // If projectId is provided but projectName is not, find matching project by ID
                    else if (projectId && !projectName) {
                        const matchingProject = projects.find((p: any) => p.id === projectId || p.projectId === projectId);
                        if (matchingProject) {
                            projectName = matchingProject.name;
                        }
                    }
                    // If both are missing, use default project
                    else if (!projectId && !projectName) {
                        const defaultProject = projects.find((p: any) => p.isDefault) || projects[0];
                        projectId = defaultProject.id || defaultProject.projectId;
                        projectName = defaultProject.name;
                    }
                }
            } catch (error) {
                // Fall back to environment variables if ProjectTools fails
                projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME || null;
                projectId = projectId || process.env.OPTIMIZELY_PROJECT_ID || null;
            }
        }

        // DXP-66: Prepare structured data for automation tools
        const structuredData: StructuredDeploymentListData = {
            projectId: projectId,
            projectName: projectName,
            deployments: [],
            totalCount: 0,
            displayLimit: limit || 5
        };

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
                return dateB.getTime() - dateA.getTime();
            });

            // Apply limit if specified, otherwise show up to 5 for performance
            const displayLimit = limit || 5;
            const recentDeployments = sorted.slice(0, displayLimit);

            // DXP-66: Build structured data array for automation tools
            structuredData.totalCount = deployments.length;

            recentDeployments.forEach((deployment, _index) => {
                const status = deployment.status || 'Unknown';
                let statusIcon: string = STATUS_ICONS.IN_PROGRESS;

                if (status.toLowerCase().includes('success') || status.toLowerCase().includes('completed')) {
                    statusIcon = STATUS_ICONS.SUCCESS as string;
                } else if (status.toLowerCase().includes('fail')) {
                    statusIcon = STATUS_ICONS.ERROR as string;
                } else if (status.toLowerCase().includes('reset')) {
                    statusIcon = STATUS_ICONS.WARNING as string;
                } else if (status.toLowerCase().includes('verification')) {
                    statusIcon = STATUS_ICONS.VERIFICATION as string;
                }

                // DXP-66: Add deployment to structured data
                const sourceEnv = deployment.startEnvironment || deployment.parameters?.sourceEnvironment || null;
                const targetEnv = deployment.endEnvironment || deployment.parameters?.targetEnvironment || 'Unknown';

                structuredData.deployments.push({
                    deploymentId: deployment.id,
                    status: status,
                    sourceEnvironment: sourceEnv,
                    targetEnvironment: targetEnv,
                    startTime: deployment.startTime || null,
                    endTime: deployment.endTime || null,
                    percentComplete: deployment.percentComplete || 0
                });

                response += `${statusIcon} **Deployment #${deployment.id}**\n`;

                // Get package upload info
                const isPackageUpload = deployment.parameters?.packages && deployment.parameters?.packages.length > 0;

                // Format deployment path - handle package uploads differently
                if (isPackageUpload && !sourceEnv) {
                    const packageName = deployment.parameters!.packages![0];
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
                    // DXP-87: Show validation links from API
                    if (deployment.validationLinks && deployment.validationLinks.length > 0) {
                        deployment.validationLinks.forEach(link => {
                            response += `• **🔗 Verification**: ${link}\n`;
                        });
                    } else {
                        const previewUrl = this.getPreviewUrl(targetEnv, projectId);
                        if (previewUrl) {
                            if (targetEnv === 'Production') {
                                response += `• **Preview URL (Slot)**: ${previewUrl}\n`;
                            } else {
                                response += `• **Preview URL**: ${previewUrl}\n`;
                            }
                        } else if (targetEnv === 'Production') {
                            response += `• **Verification URL**: Check DXP portal for slot URL\n`;
                        }
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

        // DXP-66: Return both structured data and formatted message
        response = ResponseBuilder.addFooter(response);
        return { data: structuredData, message: response };
    }

    /**
     * Format a single deployment
     */
    static formatSingleDeployment(deployment: Deployment, projectName: string | null = null): StructuredResult {
        const { FORMATTING: { STATUS_ICONS } } = Config;

        // Get project info from configured projects if not provided
        let projectId: string | null = null;
        if (!projectName) {
            try {
                const ProjectTools = require('../project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                if (projects && projects.length > 0) {
                    const defaultProject = projects.find((p: any) => p.isDefault) || projects[0];
                    projectId = defaultProject.id;
                    projectName = projectName || defaultProject.name;
                }
            } catch (error) {
                // Fall back to environment variables if ProjectTools fails
                projectId = process.env.OPTIMIZELY_PROJECT_ID || null;
                projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME || null;
            }
        }

        const status = deployment.status || 'Unknown';
        const sourceEnv = deployment.startEnvironment || deployment.parameters?.sourceEnvironment || null;
        const targetEnv = deployment.endEnvironment || deployment.parameters?.targetEnvironment || 'Unknown';
        const isPackageUpload = deployment.parameters?.packages && deployment.parameters?.packages.length > 0;
        const previewUrl = status.toLowerCase().includes('verification') ? this.getPreviewUrl(targetEnv, projectId) : null;

        // Build structured data for automation tools
        const structuredData: StructuredDeploymentData = {
            deploymentId: deployment.id,
            status: status,
            sourceEnvironment: sourceEnv,
            targetEnvironment: targetEnv,
            percentComplete: deployment.percentComplete || 0,
            startTime: deployment.startTime || null,
            endTime: deployment.endTime || null,
            isPackageUpload: isPackageUpload,
            previewUrl: previewUrl,
            parameters: deployment.parameters,
            warnings: deployment.deploymentWarnings || [],
            errors: deployment.deploymentErrors || [],
            validationLinks: deployment.validationLinks || []
        };

        // Build human-readable message
        let statusIcon: string = STATUS_ICONS.IN_PROGRESS;

        if (status.toLowerCase().includes('success') || status.toLowerCase().includes('completed')) {
            statusIcon = STATUS_ICONS.SUCCESS as string;
        } else if (status.toLowerCase().includes('fail')) {
            statusIcon = STATUS_ICONS.ERROR as string;
        } else if (status.toLowerCase().includes('reset')) {
            statusIcon = STATUS_ICONS.WARNING as string;
        } else if (status.toLowerCase().includes('verification')) {
            statusIcon = STATUS_ICONS.VERIFICATION as string;
        }

        let message = `${STATUS_ICONS.DEPLOY} **Deployment Details`;
        if (projectName) {
            message += ` - ${projectName}**\n\n`;
        } else {
            message += `**\n\n`;
        }

        message += `${statusIcon} **Deployment #${deployment.id}**\n\n`;

        message += `**Status**: ${status}\n`;
        if (isPackageUpload && !sourceEnv) {
            message += `**Package**: ${deployment.parameters!.packages![0]}\n`;
            message += `**To**: ${targetEnv}\n`;
            message += `**Type**: Package Upload\n`;
        } else if (!sourceEnv || sourceEnv === 'Unknown') {
            message += `**To**: ${targetEnv}\n`;
            message += `**Type**: Package Upload\n`;
        } else {
            message += `**From**: ${sourceEnv}\n`;
            message += `**To**: ${targetEnv}\n`;
        }

        // Show progress if available
        if (deployment.percentComplete !== undefined) {
            message += `**Progress**: ${deployment.percentComplete}%\n`;
        }

        // Always show preview URL for deployments awaiting verification
        if (status.toLowerCase().includes('verification')) {
            // DXP-87: Show validation links from API
            if (deployment.validationLinks && deployment.validationLinks.length > 0) {
                message += `\n**🔗 Verification URLs**:\n`;
                deployment.validationLinks.forEach(link => {
                    message += `• ${link}\n`;
                });
                message += `_Review your changes at the verification URL(s) above before completing_\n`;
            } else if (previewUrl) {
                if (targetEnv === 'Production') {
                    message += `\n**🔗 Preview URL (Slot)**: ${previewUrl}\n`;
                    message += `_Review your changes in the deployment slot before completing_\n`;
                } else {
                    message += `\n**🔗 Preview URL**: ${previewUrl}\n`;
                    message += `_Review your changes at the preview URL above_\n`;
                }
            } else if (targetEnv === 'Production') {
                message += `\n**🔗 Verification URL**: Check DXP portal for slot URL\n`;
            }
        }

        // Timing information
        message += '\n**📅 Timeline**:\n';
        if (deployment.startTime) {
            message += `• Started: ${this.formatLocalDateTime(deployment.startTime)}\n`;
        }

        if (deployment.endTime) {
            message += `• Ended: ${this.formatLocalDateTime(deployment.endTime)}\n`;

            // Calculate duration if both times are available
            if (deployment.startTime) {
                const duration = this.formatDuration(deployment.startTime, deployment.endTime);
                message += `• Duration: ${duration}\n`;
            }
        }

        // Deployment configuration details
        if (deployment.parameters) {
            message += '\n**⚙️ Configuration**:\n';

            if (deployment.parameters.sourceApps && deployment.parameters.sourceApps.length > 0) {
                message += `• Apps: ${deployment.parameters.sourceApps.join(', ')}\n`;
            }

            if (deployment.parameters.includeBlob !== undefined) {
                message += `• Include Blob: ${deployment.parameters.includeBlob ? 'Yes' : 'No'}\n`;
            }

            if (deployment.parameters.includeDb !== undefined) {
                message += `• Include Database: ${deployment.parameters.includeDb ? 'Yes' : 'No'}\n`;
            }

            if (deployment.parameters.maintenancePage !== undefined) {
                message += `• Maintenance Page: ${deployment.parameters.maintenancePage ? 'Enabled' : 'Disabled'}\n`;
            }

            if (deployment.parameters.zeroDowntimeMode && deployment.parameters.zeroDowntimeMode !== 'NotApplicable') {
                message += `• Zero Downtime Mode: ${deployment.parameters.zeroDowntimeMode}\n`;
            }

            // Reset parameters if this was a rollback
            if (deployment.parameters.resetParameters) {
                message += '\n**🔄 Reset Configuration**:\n';
                const reset = deployment.parameters.resetParameters;
                if (reset.resetWithDbRollback !== undefined) {
                    message += `• Database Rollback: ${reset.resetWithDbRollback ? 'Yes' : 'No'}\n`;
                }
                if (reset.validateBeforeSwap !== undefined) {
                    message += `• Validate Before Swap: ${reset.validateBeforeSwap ? 'Yes' : 'No'}\n`;
                }
                if (reset.complete !== undefined) {
                    message += `• Auto-Complete: ${reset.complete ? 'Yes' : 'No'}\n`;
                }
            }
        }

        // Validation links if available
        if (deployment.validationLinks && deployment.validationLinks.length > 0) {
            message += '\n**🔗 Validation Links**:\n';
            deployment.validationLinks.forEach(link => {
                message += `• ${link}\n`;
            });
        }

        // Warnings
        if (deployment.deploymentWarnings && deployment.deploymentWarnings.length > 0) {
            message += '\n**⚠️ Warnings**:\n';
            deployment.deploymentWarnings.forEach(warning => {
                message += `• ${warning}\n`;
            });
        }

        // Errors
        if (deployment.deploymentErrors && deployment.deploymentErrors.length > 0) {
            message += '\n**❌ Errors**:\n';
            deployment.deploymentErrors.forEach(err => {
                message += `• ${err}\n`;
            });
        }

        // Validation messages (legacy field)
        if (deployment.validationMessages && deployment.validationMessages.length > 0) {
            message += '\n**Validation Messages**:\n';
            deployment.validationMessages.forEach(msg => {
                message += `• ${msg}\n`;
            });
        }

        // Add action hint for verification state
        if (status.toLowerCase().includes('verification')) {
            message += '\n**Next Actions**:\n';
            message += '• Review changes at the preview URL\n';
            message += '• Use `complete_deployment` to finalize\n';
            message += '• Use `reset_deployment` to rollback\n';
        }

        message = ResponseBuilder.addFooter(message);

        // Return both structured data and message
        return { data: structuredData, message: message };
    }

    /**
     * Format multiple deployments with optional limit
     */
    static formatMultipleDeployments(deployments: Deployment | Deployment[], limit?: number): string {
        const { FORMATTING: { STATUS_ICONS } } = Config;

        // Get project info from configured projects
        let projectId: string | null = null;
        try {
            const ProjectTools = require('../project-tools');
            const projects = ProjectTools.getConfiguredProjects();
            if (projects && projects.length > 0) {
                const defaultProject = projects.find((p: any) => p.isDefault) || projects[0];
                projectId = defaultProject.id;
            }
        } catch (error) {
            // Fall back to environment variables if ProjectTools fails
            projectId = process.env.OPTIMIZELY_PROJECT_ID || null;
        }

        // Ensure deployments is an array
        const deploymentArray: Deployment[] = Array.isArray(deployments) ? deployments : [deployments];

        // Sort by start time (most recent first)
        const sorted = deploymentArray.sort((a, b) => {
            const dateA = new Date(a.startTime || a.created || 0);
            const dateB = new Date(b.startTime || b.created || 0);
            return dateB.getTime() - dateA.getTime();
        });

        // Apply limit if specified
        const toShow = limit ? sorted.slice(0, limit) : sorted;

        let response = `${STATUS_ICONS.DEPLOY} **Deployment Status**\n\n`;

        toShow.forEach((deployment) => {
            const status = deployment.status || 'Unknown';
            let statusIcon: string = STATUS_ICONS.IN_PROGRESS;

            if (status.toLowerCase().includes('success') || status.toLowerCase().includes('completed')) {
                statusIcon = STATUS_ICONS.SUCCESS as string;
            } else if (status.toLowerCase().includes('fail')) {
                statusIcon = STATUS_ICONS.ERROR as string;
            } else if (status.toLowerCase().includes('reset')) {
                statusIcon = STATUS_ICONS.WARNING as string;
            } else if (status.toLowerCase().includes('verification')) {
                statusIcon = STATUS_ICONS.VERIFICATION as string;
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
                // DXP-87: Show validation links from API
                if (deployment.validationLinks && deployment.validationLinks.length > 0) {
                    deployment.validationLinks.forEach(link => {
                        response += `• **🔗 Verification**: ${link}\n`;
                    });
                } else {
                    const previewUrl = this.getPreviewUrl(deployment.endEnvironment || '', projectId);
                    if (previewUrl) {
                        response += `• **Preview URL**: ${previewUrl}\n`;
                    }
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
    static formatDeploymentStarted(deployment: Deployment, args: StartDeploymentArgs): StructuredResult {
        const { FORMATTING: { STATUS_ICONS } } = Config;

        // Get project info from args, configured projects, or environment variables
        let projectId = args.projectId;
        let projectName = args.projectName;

        if (!projectId || !projectName) {
            try {
                const ProjectTools = require('../project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                if (projects && projects.length > 0) {
                    const defaultProject = projects.find((p: any) => p.isDefault) || projects[0];
                    projectId = projectId || defaultProject.id;
                    projectName = projectName || defaultProject.name;
                }
            } catch (error) {
                // Fall back to environment variables if ProjectTools fails
                projectId = projectId || process.env.OPTIMIZELY_PROJECT_ID;
                projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME;
            }
        }

        // Determine deployment type
        let deploymentType = args.deploymentType;
        if (!deploymentType) {
            // Apply smart defaults
            const isUpward = this.isUpwardDeployment(args.sourceEnvironment, args.targetEnvironment);
            deploymentType = isUpward ? 'code' : 'content';
        }

        const needsVerification = args.targetEnvironment === 'Production' && !args.directDeploy;
        const previewUrl = needsVerification ? this.getPreviewUrl(args.targetEnvironment!, projectId || null) : null;

        // Build structured data for automation tools
        const structuredData = {
            deploymentId: deployment.id,
            status: deployment.status || 'InProgress',
            sourceEnvironment: args.sourceEnvironment,
            targetEnvironment: args.targetEnvironment,
            deploymentType: deploymentType,
            projectId: projectId,
            projectName: projectName,
            startTime: deployment.startTime || new Date().toISOString(),
            percentComplete: deployment.percentComplete || 0,
            needsVerification: needsVerification,
            previewUrl: previewUrl,
            sourceApps: args.sourceApps || [],
            includeBlob: args.includeBlob,
            includeDatabase: args.includeDatabase,
            directDeploy: args.directDeploy,
            useMaintenancePage: args.useMaintenancePage
        };

        // Build human-readable message
        let message = `${STATUS_ICONS.SUCCESS} **Deployment Started`;
        if (projectName) {
            message += ` - ${projectName}**\n\n`;
        } else {
            message += `**\n\n`;
        }

        message += `**Deployment ID**: ${deployment.id}\n`;
        message += `**From**: ${args.sourceEnvironment}\n`;
        message += `**To**: ${args.targetEnvironment}\n`;
        message += `**Type**: ${deploymentType!.charAt(0).toUpperCase() + deploymentType!.slice(1)}`;

        if (deploymentType === 'code' && args.sourceApps) {
            message += ` (${args.sourceApps.join(', ')})`;
        }
        message += '\n';

        if (deployment.status) {
            message += `**Status**: ${deployment.status}\n`;
        }

        // Always show preview URL for deployments that will need verification
        if (needsVerification) {
            if (previewUrl) {
                message += `\n**🔗 Preview URL (Slot)**: ${previewUrl}\n`;
                message += `_Your deployment will be available for preview at this slot URL once it enters verification state_\n`;
            } else {
                message += `\n**🔗 Verification URL Information**:\n`;
                message += `• When the deployment reaches verification state, the slot URL will be available in the DXP portal\n`;
                message += `• Expected format: https://[your-site-name]-slot.dxcloud.episerver.net/\n`;
                message += `• You'll need to check the DXP portal deployment details for the exact URL\n`;
            }
        }

        message += '\n## 🎯 **Monitoring Options**:\n';
        message += `### Option 1: **Continuous Monitoring** (Recommended)\n`;
        message += `Use \`monitor_deployment\` to automatically check progress every 30 seconds:\n`;
        message += `\`\`\`\nmonitor_deployment({ deploymentId: "${deployment.id}" })\n\`\`\`\n`;

        message += `### Option 2: **Manual Status Checks**\n`;
        message += `Use \`get_deployment_status\` to check progress on demand:\n`;
        message += `\`\`\`\nget_deployment_status({ deploymentId: "${deployment.id}" })\n\`\`\`\n`;

        message += '\n**💡 Important**: Use the MCP monitoring tools above instead of bash loops.\n';
        message += 'The \`monitor_deployment\` tool provides intelligent progress tracking and automatic notifications.\n';

        if (needsVerification) {
            message += '\n**📋 Deployment Stages**:\n';
            message += '1. **In Progress** - Deployment is running\n';
            message += '2. **Verification** - Review changes at preview URL\n';
            message += '3. **Complete** - After you run `complete_deployment`\n';
        }

        message = ResponseBuilder.addFooter(message);

        // Return both structured data and message
        return { data: structuredData, message: message };
    }

    /**
     * Format deployment completed response
     */
    static formatDeploymentCompleted(
        deployment: Deployment,
        projectName: string | null = null,
        _projectId: string | null = null
    ): StructuredResult {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME || null;

        // Check if we have environment information
        const targetEnv = deployment.endEnvironment || deployment.targetEnvironment;
        const status = deployment.status || 'Completed';

        // Build structured data for automation tools
        const structuredData = {
            deploymentId: deployment.id,
            status: status,
            targetEnvironment: targetEnv,
            completionTime: deployment.completionTime || new Date().toISOString(),
            isProduction: targetEnv === 'Production' || targetEnv?.toLowerCase() === 'production'
        };

        // Check if status is transitional (Completing) vs final (Succeeded)
        const isCompleting = status === 'Completing';

        if (isCompleting) {
            // DXP-71: Deployment is still completing - provide monitoring instructions
            let message = `${STATUS_ICONS.IN_PROGRESS} **Deployment is Now Completing`;
            if (projectName) {
                message += ` - ${projectName}**\n\n`;
            } else {
                message += `**\n\n`;
            }

            message += `**Deployment ID**: ${deployment.id}\n`;
            message += `**Status**: ${status}\n`;
            if (targetEnv) {
                message += `**Target Environment**: ${targetEnv}\n`;
            }

            message += '\n🔄 **Completion in Progress**\n\n';

            if (targetEnv === 'Production' || targetEnv?.toLowerCase() === 'production') {
                message += 'The deployment is being finalized and promoted from the verification slot to Production.\n';
                message += 'This final step usually takes a few moments.\n\n';
            } else if (targetEnv) {
                message += `The deployment is being finalized to ${targetEnv}.\n`;
                message += 'This usually takes a few moments.\n\n';
            } else {
                message += 'The deployment is being finalized.\n';
                message += 'This usually takes a few moments.\n\n';
            }

            // Add monitoring instructions (transparent pattern like InProgress)
            const monitorInterval = 30; // 30 seconds
            message += `📊 **MONITORING INSTRUCTIONS FOR AI**\n\n`;
            message += `To monitor until completion, use get_deployment_status with:\n`;
            message += `• deploymentId: "${deployment.id}"\n`;
            message += `• waitBeforeCheck: ${monitorInterval} (waits ${monitorInterval} seconds then checks)\n`;
            message += `• monitor: true (enables monitoring prompts)\n`;
            if (projectName) {
                message += `• projectName: "${projectName}"\n`;
            }
            message += `\n`;
            message += `**MONITORING PATTERN:**\n`;
            message += `1. Wait ${monitorInterval} seconds\n`;
            message += `2. Check status with get_deployment_status\n`;
            message += `3. If still Completing, repeat\n`;
            message += `4. When Succeeded, inform user deployment is live\n`;
            message += `5. If Failed, alert user to check logs\n\n`;
            message += `**Note:** Completion typically takes 2-15 minutes. Be patient.`;

            message = ResponseBuilder.addFooter(message);
            return { data: structuredData, message: message };
        }

        // Status is final (Succeeded, Failed, etc) - show completion message
        let message = `${STATUS_ICONS.SUCCESS} **Deployment Completed Successfully`;
        if (projectName) {
            message += ` - ${projectName}**\n\n`;
        } else {
            message += `**\n\n`;
        }

        message += `**Deployment ID**: ${deployment.id}\n`;

        if (deployment.status) {
            message += `**Final Status**: ${deployment.status}\n`;
        }

        if (deployment.completionTime) {
            message += `**Completed At**: ${this.formatLocalDateTime(deployment.completionTime)}\n`;
        }

        if (targetEnv === 'Production' || targetEnv?.toLowerCase() === 'production') {
            message += '\n✅ **Deployment Completed**\n\n';
            message += 'The deployment has been successfully promoted from the verification slot to production.\n';
            message += 'Your changes are now live on the production environment.';
        } else if (targetEnv) {
            message += `\n✅ The deployment to **${targetEnv}** has been completed successfully.`;
        } else {
            // Generic message when we don't know the environment
            message += '\n✅ The deployment has been completed successfully.\n\n';
            message += '**Note**: If this was a Production deployment, changes are now live after being promoted from the verification slot.';
        }

        message = ResponseBuilder.addFooter(message);

        // Return both structured data and message
        return { data: structuredData, message: message };
    }

    /**
     * Format deployment reset response
     */
    static formatDeploymentReset(
        deployment: Deployment,
        includeDbRollback: boolean,
        projectName: string | null = null
    ): StructuredResult {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        projectName = projectName || process.env.OPTIMIZELY_PROJECT_NAME || null;

        // Get deployment details if available
        const sourceEnv = deployment.parameters?.sourceEnvironment;
        const targetEnv = deployment.parameters?.targetEnvironment;
        const status = deployment.status || 'Resetting';

        // Build structured data for automation tools
        const structuredData = {
            deploymentId: deployment.id,
            status: status,
            sourceEnvironment: sourceEnv,
            targetEnvironment: targetEnv,
            includeDbRollback: includeDbRollback,
            resetInitiatedAt: new Date().toISOString()
        };

        // DXP-71: Check if status is transitional (Resetting) vs final (Reset)
        const isResetting = status === 'Resetting';

        if (isResetting) {
            // Deployment is still resetting - provide monitoring instructions
            let message = `${STATUS_ICONS.WARNING} **Deployment Reset in Progress`;
            if (projectName) {
                message += ` - ${projectName}**\n\n`;
            } else {
                message += `**\n\n`;
            }

            message += `**Deployment ID**: ${deployment.id}\n`;
            message += `**Status**: ${status}\n`;

            if (deployment.parameters && sourceEnv && targetEnv) {
                message += `**Original Deployment**: ${sourceEnv} → ${targetEnv}\n`;
            }

            message += '\n🔄 **Rollback in Progress**\n\n';
            message += 'The deployment is being rolled back. This typically takes 2-5 minutes.\n';

            if (includeDbRollback) {
                message += '\n⚠️ **Database Rollback**: Database changes are also being reverted.\n';
            }

            // Add monitoring instructions (transparent pattern)
            const monitorInterval = 30; // 30 seconds
            message += `\n📊 **MONITORING INSTRUCTIONS FOR AI**\n\n`;
            message += `To monitor until reset completes, use get_deployment_status with:\n`;
            message += `• deploymentId: "${deployment.id}"\n`;
            message += `• waitBeforeCheck: ${monitorInterval} (waits ${monitorInterval} seconds then checks)\n`;
            message += `• monitor: true (enables monitoring prompts)\n`;
            if (projectName) {
                message += `• projectName: "${projectName}"\n`;
            }
            message += `\n`;
            message += `**MONITORING PATTERN:**\n`;
            message += `1. Wait ${monitorInterval} seconds\n`;
            message += `2. Check status with get_deployment_status\n`;
            message += `3. If still Resetting, repeat\n`;
            message += `4. When Reset, inform user rollback is complete\n`;
            message += `5. If Failed, alert user to check logs\n\n`;
            message += `**Note:** Reset typically takes 2-5 minutes.`;

            message = ResponseBuilder.addFooter(message);
            return { data: structuredData, message: message };
        }

        // Status is final (Reset, Failed, etc) - show completion message
        let message = `${STATUS_ICONS.SUCCESS} **Deployment Reset Complete`;
        if (projectName) {
            message += ` - ${projectName}**\n\n`;
        } else {
            message += `**\n\n`;
        }

        message += `**Deployment ID**: ${deployment.id}\n`;
        message += `**Final Status**: ${status}\n`;

        if (deployment.parameters && sourceEnv && targetEnv) {
            message += `**Original Deployment**: ${sourceEnv} → ${targetEnv}\n`;
        }

        message += '\n✅ **Rollback Completed**\n\n';
        message += 'The deployment has been successfully rolled back.\n';

        if (targetEnv) {
            message += `The ${targetEnv} environment has been restored to its previous state.\n`;
        }

        if (includeDbRollback) {
            message += '\n✅ **Database Rollback**: Database changes have been reverted.\n';
        }

        message = ResponseBuilder.addFooter(message);

        // Return both structured data and message
        return { data: structuredData, message: message };
    }

    /**
     * Helper to check if deployment is upward (code flow)
     */
    static isUpwardDeployment(source: string | undefined, target: string | undefined): boolean {
        const envOrder = ['Integration', 'Preproduction', 'Production'];
        const sourceIndex = envOrder.indexOf(source || '');
        const targetIndex = envOrder.indexOf(target || '');
        return targetIndex > sourceIndex;
    }

    /**
     * Get preview URL for an environment
     */
    static getPreviewUrl(environment: string, projectId: string | null): string | null {
        if (!projectId) return null;

        // Remove any @ prefix from project ID if present
        const cleanProjectId = projectId.replace(/^@/, '');

        // For Production deployments in verification, we cannot generate the slot URL
        // The actual URL needs to come from the DXP API response
        if (environment === 'Production') {
            // The slot URL format is: https://{short-name}-slot.dxcloud.episerver.net/
            // But we cannot determine the short name from the project ID alone
            // This should be retrieved from the deployment API response
            return null;
        }

        const envMap: Record<string, string> = {
            'Integration': 'integration',
            'Preproduction': 'preproduction'
        };

        const envSlug = envMap[environment];
        if (!envSlug) return null;

        // For Int/Pre environments, use standard environment URL
        return `https://${cleanProjectId}.${envSlug}.dxp.optimizely.com/`;
    }
}

export default DeploymentFormatters;

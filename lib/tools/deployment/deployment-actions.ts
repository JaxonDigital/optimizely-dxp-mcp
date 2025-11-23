/**
 * Deployment Action Operations
 * Handles start, complete, and reset operations for deployments
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import { ResponseBuilder, ErrorHandler, Config } from '../../index';
import DeploymentFormatters from './deployment-formatters';
import DeploymentValidator from '../../deployment-validator';
import { getGlobalMonitor } from '../../deployment-monitor';
import PermissionChecker from '../permission-checker';
import { StructuredLogger } from '../../structured-logger';
import { DEPLOYMENT_STATUS, isAwaitingVerification, isInProgress, isSucceeded, isFailed } from '../../deployment-status-constants';
import DXPRestClient from '../../dxp-rest-client';
import DeploymentResourceHandler from '../../resources/deployment-resource';
import { getGlobalWebhookManager } from '../../webhooks/webhook-manager';

/**
 * Start deployment arguments
 */
interface StartDeploymentArgs {
    apiKey?: string;
    apiSecret?: string;
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
    isSelfHosted?: boolean;
    connectionString?: string;
    apiUrl?: string;
    webhookUrl?: string;
    webhookHeaders?: Record<string, string>;
}

/**
 * Complete deployment arguments
 */
interface CompleteDeploymentArgs {
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
    projectName?: string;
    deploymentId?: string;
    monitor?: boolean;
    isSelfHosted?: boolean;
    connectionString?: string;
    apiUrl?: string;
}

/**
 * Reset deployment arguments
 */
interface ResetDeploymentArgs {
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
    projectName?: string;
    deploymentId?: string;
    isSelfHosted?: boolean;
    connectionString?: string;
    apiUrl?: string;
}

/**
 * Monitor deployment arguments
 */
interface MonitorDeploymentArgs {
    deploymentId?: string;
    interval?: number;
    maxDuration?: number;
    autoComplete?: boolean;
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
    projectName?: string;
}

/**
 * Project configuration for permissions
 */
interface ProjectConfig {
    apiKey: string;
    apiSecret: string;
    projectId: string;
    id: string;
    name: string;
}

/**
 * Permissions result
 */
interface Permissions {
    accessible: string[];
    inaccessible: string[];
    [key: string]: any;
}

/**
 * Path validation result
 */
interface PathValidation {
    valid: boolean;
    error?: string;
    suggestion?: string;
    warnings?: Warning[];
    isUpward?: boolean;
}

/**
 * Validation warning
 */
interface Warning {
    message: string;
    suggestion?: string;
}

/**
 * Parameter validation result
 */
interface ParamValidation {
    valid: boolean;
    errors?: string[];
    sanitized?: any;
}

/**
 * Timing validation result
 */
interface TimingCheck {
    warnings?: Warning[];
}

/**
 * Deployment parameters for REST API
 */
interface DeploymentParams {
    sourceEnvironment: string;
    targetEnvironment: string;
    sourceApps?: string[];
    includeBlob?: boolean;
    includeDB?: boolean;
    directDeploy?: boolean;
    maintenancePage?: boolean;
}

/**
 * Deployment result from API
 */
interface DeploymentResult {
    id: string;
    status?: string;
    startTime?: string;
    percentComplete?: number;
    parameters?: any;
    [key: string]: any;
}

/**
 * Structured result with data and message
 */
// interface StructuredResult {
//     data: any;
//     message: string;
// }

class DeploymentActionOperations {
    /**
     * Start a new deployment
     */
    static async handleStartDeployment(args: StartDeploymentArgs): Promise<any> {
        // Check if this is a self-hosted project
        if (args.isSelfHosted || args.connectionString) {
            return ResponseBuilder.invalidParams('Deployments are not available for self-hosted projects. Self-hosted projects can only download existing backups and blobs.');
        }

        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.startDeployment(args);

            // Check if result is already a structured response with data and message
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            // Fallback for legacy string responses
            return ResponseBuilder.success(result);
        } catch (error: any) {
            console.error('Start deployment error:', error);
            return ResponseBuilder.internalError('Failed to start deployment', error.message);
        }
    }

    static async startDeployment(args: StartDeploymentArgs): Promise<any> {
        const {
            apiKey, apiSecret, projectId, projectName,
            sourceEnvironment, targetEnvironment,
            deploymentType, sourceApps,
            includeBlob, includeDatabase,
            directDeploy, useMaintenancePage,
            webhookUrl, webhookHeaders
        } = args;

        // DXP-67: Defensive check for useMaintenancePage to prevent accidental production downtime
        if (useMaintenancePage === true) {
            console.error('⚠️  WARNING: useMaintenancePage is set to TRUE');
            console.error(`    This will show a maintenance page during deployment to ${targetEnvironment}`);

            if (targetEnvironment === 'Production' || targetEnvironment === 'Preproduction') {
                console.error('    ⚠️  CAUTION: Deploying to Production/Preproduction with maintenance page!');
                console.error('    This will cause site downtime for end users.');
            }
        }

        console.error(`Starting deployment from ${sourceEnvironment} to ${targetEnvironment} for project ${projectId}`);

        // Check permissions for both environments first
        const projectConfig: ProjectConfig = {
            apiKey: apiKey!,
            apiSecret: apiSecret!,
            projectId: projectId!,
            id: projectId!,
            name: projectName || 'Project'
        };

        const permissions: Permissions = await PermissionChecker.getOrCheckPermissionsSafe(projectConfig);

        // Check if user has access to both source and target
        const missingAccess: string[] = [];
        if (!permissions.accessible.includes(sourceEnvironment!)) {
            missingAccess.push(sourceEnvironment!);
        }
        if (!permissions.accessible.includes(targetEnvironment!)) {
            missingAccess.push(targetEnvironment!);
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

            // Return as structured response
            return {
                data: {
                    error: 'insufficient_permissions',
                    missingAccess: missingAccess,
                    availableEnvironments: permissions.accessible
                },
                message: response
            };
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
        } catch (checkError: any) {
            // Don't fail the deployment if we can't check status
            console.error('Warning: Could not check for active deployments:', checkError.message);
        }

        // Validate deployment path
        const pathValidation: PathValidation = DeploymentValidator.validateDeploymentPath(sourceEnvironment!, targetEnvironment!);
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

                // Return as structured response
                return {
                    data: {
                        error: 'invalid_deployment_direction',
                        sourceEnvironment: sourceEnvironment,
                        targetEnvironment: targetEnvironment,
                        suggestion: 'use_copy_content'
                    },
                    message: response
                };
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
        const paramValidation: ParamValidation = DeploymentValidator.validateDeploymentParams(args);
        if (!paramValidation.valid) {
            return ResponseBuilder.error(
                `❌ Invalid Parameters\n\n${paramValidation.errors!.join('\n')}`
            );
        }

        // Use sanitized parameters
        const sanitizedArgs = paramValidation.sanitized;

        // Check deployment timing
        const timingCheck: TimingCheck = DeploymentValidator.validateDeploymentTiming({
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

        // DXP-101: Build deployment parameters for REST API (replacing PowerShell)
        // Based on EpiCloud.psm1 Start-EpiDeployment SourceEnvironment parameter set
        const deploymentParams: DeploymentParams = {
            sourceEnvironment: sourceEnvironment!,  // Lowercase per PowerShell source
            targetEnvironment: targetEnvironment!   // Lowercase per PowerShell source
        };

        // Add deployment type parameters
        if (deployCode) {
            // SourceApp is required for code deployments
            const appsToUse = sourceApps && sourceApps.length > 0
                ? sourceApps
                : ['cms']; // Default to CMS app
            deploymentParams.sourceApps = appsToUse;  // Plural 'sourceApps' per PowerShell source

            console.error(`Deploying code with apps: ${appsToUse.join(', ')}`);
        }

        if (deployContent) {
            // Add content deployment flags - always include (per PowerShell source)
            deploymentParams.includeBlob = includeBlob !== false;
            deploymentParams.includeDB = includeDatabase !== false;

            console.error(`Deploying content with includeBlob=${deploymentParams.includeBlob}, includeDB=${deploymentParams.includeDB}`);
        }

        // Add optional parameters - only if explicitly set to true
        if (directDeploy === true) {
            deploymentParams.directDeploy = true;  // Lowercase per PowerShell source
        }
        if (useMaintenancePage === true) {
            deploymentParams.maintenancePage = true;  // 'maintenancePage' not 'UseMaintenancePage' per PowerShell source
        }

        console.error(`Starting deployment via REST API with payload:`);
        console.error(JSON.stringify(deploymentParams, null, 2));

        // DXP-101: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
        try {
            const result: DeploymentResult = await DXPRestClient.startDeployment(
                projectId!,
                apiKey!,
                apiSecret!,
                deploymentParams as any,
                { apiUrl: args.apiUrl } // Support custom API URLs
            );

            // Format response
            if (result) {
                const formatted = DeploymentFormatters.formatDeploymentStarted(result, args);

                // Extract deployment ID from result and start monitoring
                if (result.id) {
                    // DXP-136: Emit deployment started event
                    try {
                        DeploymentResourceHandler.emitStarted(result.id, {
                            project: projectName,
                            environment: targetEnvironment,
                            sourceEnvironment: sourceEnvironment,
                            targetEnvironment: targetEnvironment,
                            deploymentType: deploymentType,
                            status: result.status
                        });
                    } catch (eventError: any) {
                        console.error(`Failed to emit deployment event: ${eventError.message}`);
                        // Don't fail the deployment if event emission fails
                    }

                    // DXP-140: Register webhook if provided
                    if (webhookUrl) {
                        try {
                            const webhookManager = getGlobalWebhookManager();
                            const registrationResult = webhookManager.register(
                                result.id, // operationId (deploymentId)
                                webhookUrl,
                                {
                                    headers: webhookHeaders || {},
                                    project: projectName,
                                    environment: targetEnvironment
                                }
                            );

                            const logger = new StructuredLogger({
                                context: {
                                    tool: 'start_deployment',
                                    deployment_id: result.id,
                                    project: projectName,
                                    environment: targetEnvironment
                                }
                            });

                            if (registrationResult.success) {
                                logger.info('Webhook registered for deployment', {
                                    webhook_url: webhookUrl,
                                    deployment_id: result.id
                                });
                                console.log(`🔔 Webhook registered for deployment ${result.id}`);
                            } else {
                                logger.warn('Webhook registration failed', {
                                    error: registrationResult.error,
                                    deployment_id: result.id
                                });
                                console.log(`⚠️ Webhook registration failed: ${registrationResult.error}`);
                            }
                        } catch (webhookError: any) {
                            console.error(`Failed to register webhook: ${webhookError.message}`);
                            // Don't fail the deployment if webhook registration fails
                        }
                    }

                    try {
                        const monitor = getGlobalMonitor();
                        monitor.startMonitoring({
                            deploymentId: result.id,
                            projectId: args.projectId!,
                            apiKey: args.apiKey!,
                            apiSecret: args.apiSecret!,
                            interval: 60 * 1000 // 1 minute default
                        });

                        const logger = new StructuredLogger({
                            context: {
                                tool: 'start_deployment',
                                deployment_id: result.id
                            }
                        });
                        logger.info('Auto-monitoring started for deployment', {
                            deployment_id: result.id,
                            interval_ms: 60 * 1000
                        });
                        console.log(`🔄 Auto-monitoring started for deployment ${result.id}`);
                    } catch (monitorError: any) {
                        console.error(`Failed to start monitoring: ${monitorError.message}`);
                        // Don't fail the deployment if monitoring fails
                    }
                }

                // Return structured response with both data and message
                return formatted;
            }

            return { data: null, message: ResponseBuilder.addFooter('Deployment started but no details available') };

        } catch (error: any) {
            // Handle REST API errors
            const errorDetails = {
                operation: 'Start Deployment',
                projectId,
                projectName: args.projectName,
                sourceEnvironment,
                targetEnvironment,
                apiKey
            };

            // Check if this is an access denied error
            if (error.statusCode === 401 || error.statusCode === 403) {
                return ErrorHandler.formatError({
                    type: 'ACCESS_DENIED',
                    message: 'Access denied to deployment API',
                    statusCode: error.statusCode
                } as any, errorDetails);
            }

            // Generic error handling
            return ErrorHandler.formatError({
                type: 'API_ERROR',
                message: error.message,
                statusCode: error.statusCode
            } as any, errorDetails);
        }
    }

    /**
     * Complete a deployment in verification state
     */
    static async handleCompleteDeployment(args: CompleteDeploymentArgs): Promise<any> {
        // Check if this is a self-hosted project
        if (args.isSelfHosted || args.connectionString) {
            return ResponseBuilder.invalidParams('Deployment completion is not available for self-hosted projects. Self-hosted projects can only download existing backups and blobs.');
        }

        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.deploymentId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.completeDeployment(args);

            // Check if result is already a structured response with data and message
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                // DXP-68: If result contains an error field, return as error response
                if (result.data.error) {
                    return {
                        error: result.message,
                        data: result.data
                    };
                }

                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            // Fallback for legacy string responses
            return ResponseBuilder.success(result);
        } catch (error: any) {
            console.error('Complete deployment error:', error);
            return ResponseBuilder.internalError('Failed to complete deployment', error.message);
        }
    }

    static async completeDeployment(args: CompleteDeploymentArgs): Promise<any> {
        const { apiKey, apiSecret, projectId, deploymentId } = args;

        console.error(`Completing deployment ${deploymentId} for project ${projectId}`);

        // DXP-68: Validate deployment state before attempting completion
        console.error('Checking deployment state before completion...');
        const DeploymentListOperations = require('./deployment-list');

        try {
            const statusResult = await DeploymentListOperations.getDeploymentStatus({
                apiKey,
                apiSecret,
                projectId,
                deploymentId
            });

            // Extract current status from the response
            let currentStatus = 'Unknown';

            // Check if this is a structured response (new format from DXP-66)
            if (statusResult && typeof statusResult === 'object' && 'data' in statusResult && 'message' in statusResult) {
                currentStatus = statusResult.data.status || 'Unknown';
            } else if (typeof statusResult === 'string' && statusResult.includes('Status:')) {
                const statusMatch = statusResult.match(/Status:\s*\*\*([^*]+)\*\*/);
                if (statusMatch) {
                    currentStatus = statusMatch[1].trim();
                }
            }

            console.error(`Current deployment status: ${currentStatus}`);

            // Check if deployment is in the correct state for completion (DXP-69: Use status constants)
            if (!isAwaitingVerification(currentStatus)) {
                // Return structured error response
                const errorMessage = `❌ **Cannot Complete Deployment**\n\n` +
                    `Deployment must be in **${DEPLOYMENT_STATUS.AWAITING_VERIFICATION}** state to complete.\n\n` +
                    `**Current State**: ${currentStatus}\n` +
                    `**Deployment ID**: ${deploymentId}\n\n` +
                    `**Next Steps:**\n` +
                    (isInProgress(currentStatus)
                        ? `• Wait for deployment to reach verification state\n` +
                          `• Use \`get_deployment_status\` to check progress\n` +
                          `• Use \`monitor_deployment\` for continuous updates`
                        : isSucceeded(currentStatus)
                        ? `• Deployment is already completed - no action needed`
                        : isFailed(currentStatus)
                        ? `• Deployment has failed - use \`reset_deployment\` to rollback`
                        : `• Check deployment status with \`get_deployment_status\``
                    );

                return {
                    data: {
                        error: 'INVALID_STATE',
                        deploymentId: deploymentId,
                        currentStatus: currentStatus,
                        requiredStatus: DEPLOYMENT_STATUS.AWAITING_VERIFICATION,
                        canComplete: false
                    },
                    message: ResponseBuilder.addFooter(errorMessage)
                };
            }

            console.error('✓ Deployment is in valid state for completion');

        } catch (statusError: any) {
            console.error('Warning: Could not check deployment status before completion:', statusError.message);
            // Continue with completion attempt even if status check fails
            // The REST API itself will fail if state is wrong
        }

        // DXP-101: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
        try {
            const result: DeploymentResult = await DXPRestClient.completeDeployment(
                projectId!,
                apiKey!,
                apiSecret!,
                deploymentId!,
                { apiUrl: args.apiUrl } // Support custom API URLs
            );

            // DXP-47: The completion API returns immediately with status "Completing" (transitional),
            // not "Succeeded" (final). Format the response with the ACTUAL current status.
            if (result) {
                // DXP-136: Emit deployment completing event
                try {
                    if (result.status === 'Completing') {
                        DeploymentResourceHandler.emitCompleting(deploymentId!, {
                            project: args.projectName,
                            status: result.status,
                            slotUrl: result.deploymentSlotUrl || result.DeploymentSlotUrl
                        });
                    } else if (result.status === 'Succeeded') {
                        DeploymentResourceHandler.emitSucceeded(deploymentId!, {
                            project: args.projectName,
                            status: result.status,
                            slotUrl: result.deploymentSlotUrl || result.DeploymentSlotUrl
                        });
                    }
                } catch (eventError: any) {
                    console.error(`Failed to emit deployment completion event: ${eventError.message}`);
                    // Don't fail the operation if event emission fails
                }

                // DXP-121: Auto-start background monitoring if enabled (default true)
                if (args.monitor !== false && result && result.id) {
                    try {
                        const monitor = getGlobalMonitor();
                        monitor.startMonitoring({
                            deploymentId: result.id || deploymentId!,
                            projectId: args.projectId!,
                            apiKey: args.apiKey!,
                            apiSecret: args.apiSecret!,
                            interval: 30 * 1000 // 30 seconds (faster polling for completion phase)
                        });
                        const logger = new StructuredLogger({
                            context: {
                                tool: 'complete_deployment',
                                deployment_id: result.id || deploymentId!
                            }
                        });
                        logger.info('Auto-monitoring started for deployment completion', {
                            deployment_id: result.id || deploymentId!,
                            interval_ms: 30 * 1000
                        });
                        console.log('🔄 Auto-monitoring started for deployment completion');
                    } catch (monitorError: any) {
                        console.error(`Failed to start monitoring: ${monitorError.message}`);
                        // Don't fail the operation if monitoring fails
                    }
                }

                return DeploymentFormatters.formatDeploymentCompleted(result, args.projectName, projectId);
            } else {
                // Fallback if no result returned
                return {
                    data: { deploymentId: deploymentId, status: 'Unknown' },
                    message: ResponseBuilder.addFooter('Deployment completion initiated but status unavailable')
                };
            }

        } catch (error: any) {
            // Handle REST API errors
            const errorDetails = {
                operation: 'Complete Deployment',
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
                } as any, errorDetails);
            }

            // Generic error handling
            return ErrorHandler.formatError({
                type: 'API_ERROR',
                message: error.message,
                statusCode: error.statusCode
            } as any, errorDetails);
        }
    }

    /**
     * Reset/rollback a deployment
     */
    static async handleResetDeployment(args: ResetDeploymentArgs): Promise<any> {
        // Check if this is a self-hosted project
        if (args.isSelfHosted || args.connectionString) {
            return ResponseBuilder.invalidParams('Deployment reset is not available for self-hosted projects. Self-hosted projects can only download existing backups and blobs.');
        }

        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.deploymentId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.resetDeployment(args);

            // Check if result is already a structured response with data and message
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            // Fallback for legacy string responses
            return ResponseBuilder.success(result);
        } catch (error: any) {
            console.error('Reset deployment error:', error);
            return ResponseBuilder.internalError('Failed to reset deployment', error.message);
        }
    }

    static async resetDeployment(args: ResetDeploymentArgs): Promise<any> {
        const { apiKey, apiSecret, projectId, deploymentId, projectName } = args;

        console.error(`Resetting deployment ${deploymentId} for project ${projectId}`);

        // DXP-101: Get deployment details to determine if DB rollback is needed (using REST API)
        let includeDbRollback = false;
        let deploymentData: DeploymentResult | null = null;

        try {
            const statusResult: DeploymentResult = await DXPRestClient.getDeployments(
                projectId!,
                apiKey!,
                apiSecret!,
                deploymentId!,
                { apiUrl: args.apiUrl }
            );

            if (statusResult) {
                // Check if this deployment included database changes
                deploymentData = statusResult;
                includeDbRollback = (deploymentData as any).includeDatabase === true;
            }
        } catch (error: any) {
            console.error('Warning: Could not check deployment details before reset:', error.message);
            // Continue with reset even if we can't check details
        }

        // DXP-101: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
        let resetData: DeploymentResult = {} as DeploymentResult;
        try {
            const result: DeploymentResult = await DXPRestClient.resetDeployment(
                projectId!,
                apiKey!,
                apiSecret!,
                deploymentId!,
                {}, // No additional reset options needed
                { apiUrl: args.apiUrl } // Support custom API URLs
            );

            resetData = result || ({} as DeploymentResult);

            // Merge deployment data if available
            if (deploymentData && deploymentData.parameters) {
                resetData.parameters = deploymentData.parameters;
            }

            // DXP-136: Emit deployment reset event
            try {
                DeploymentResourceHandler.emitReset(deploymentId!, {
                    project: projectName,
                    includeDbRollback: includeDbRollback
                });
            } catch (eventError: any) {
                console.error(`Failed to emit deployment reset event: ${eventError.message}`);
                // Don't fail the operation if event emission fails
            }

            // Start monitoring the reset in the background
            this.monitorResetProgress(deploymentId!, projectId!, apiKey!, apiSecret!, projectName, args.apiUrl);

            // Format response
            return DeploymentFormatters.formatDeploymentReset(resetData, includeDbRollback, projectName);

        } catch (error: any) {
            // Handle REST API errors
            const errorDetails = {
                operation: 'Reset Deployment',
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
                } as any, errorDetails);
            }

            // Generic error handling
            return ErrorHandler.formatError({
                type: 'API_ERROR',
                message: error.message,
                statusCode: error.statusCode
            } as any, errorDetails);
        }
    }

    /**
     * Monitor reset progress in the background
     * DXP-101: Updated to use REST API instead of PowerShell
     */
    static async monitorResetProgress(
        deploymentId: string,
        projectId: string,
        apiKey: string,
        apiSecret: string,
        projectName?: string | null,
        apiUrl: string | null = null
    ): Promise<void> {
        const checkInterval = 30000; // Check every 30 seconds
        const maxChecks = 20; // Maximum 10 minutes
        let checkCount = 0;

        const checkStatus = async (): Promise<void> => {
            checkCount++;

            try {
                // DXP-101: Use REST API instead of PowerShell
                const result: DeploymentResult = await DXPRestClient.getDeployments(
                    projectId,
                    apiKey,
                    apiSecret,
                    deploymentId,
                    { apiUrl: apiUrl || undefined }
                );

                if (result) {
                    const status = result.status;

                    // Check if reset is complete
                    if (status === 'Reset' || status === 'Completed' || status === 'Failed') {
                        const message = this.formatResetCompleteMessage(
                            deploymentId,
                            status!,
                            result,
                            projectName
                        );
                        console.error('\n' + message);
                        return; // Stop monitoring
                    }
                }
            } catch (error: any) {
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
    static formatResetCompleteMessage(
        deploymentId: string,
        status: string,
        _deployment: DeploymentResult,
        projectName?: string | null
    ): string {
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

    /**
     * Handle continuous monitoring of a deployment
     */
    static async handleMonitorDeployment(args: MonitorDeploymentArgs): Promise<any> {
        const {
            deploymentId,
            interval = 30,
            maxDuration = 30,
            autoComplete = false,
            apiKey, apiSecret, projectId, projectName
        } = args;

        if (!deploymentId) {
            return ResponseBuilder.invalidParams('Deployment ID is required for monitoring');
        }

        try {
            // Initial status check
            const statusResponse = await this.handleGetDeploymentStatus({
                deploymentId,
                apiKey, apiSecret, projectId, projectName
            });

            // Extract structured data from the response if available
            let currentStatus = 'Unknown';
            let progress = 0;
            let deploymentData = null;

            // Try to parse structured data from MCP response
            if (statusResponse && statusResponse.result && statusResponse.result.content && statusResponse.result.content[0]) {
                const text = statusResponse.result.content[0].text;
                try {
                    // Try parsing as JSON first (new structured format)
                    const parsed = JSON.parse(text);
                    if (parsed.data) {
                        deploymentData = parsed.data;
                        currentStatus = deploymentData.status || 'Unknown';
                        progress = deploymentData.percentComplete || 0;
                    }
                } catch (e) {
                    // Fallback: parse from markdown text (legacy format)
                    const statusMatch = text.match(/Status:\*\*\s*([^\n]+)/);
                    if (statusMatch) {
                        currentStatus = statusMatch[1].trim();
                    }

                    const progressMatch = text.match(/Progress:\*\*\s*(\d+)%/);
                    if (progressMatch) {
                        progress = parseInt(progressMatch[1]);
                    }
                }
            }

            // Build structured data for automation tools
            const structuredData = {
                deploymentId: deploymentId,
                monitoringActive: true,
                interval: interval,
                maxDuration: maxDuration,
                autoComplete: autoComplete,
                initialStatus: currentStatus,
                initialProgress: progress,
                deploymentData: deploymentData
            };

            // Build transparent monitoring message with AI instructions
            let message: string[] = [];
            message.push(`## 🔄 **Deployment Monitoring**\n`);
            message.push(`**Deployment ID:** ${deploymentId}`);
            message.push(`**Initial Status:** ${currentStatus}`);
            message.push(`**Progress:** ${progress}%\n`);

            // Check if deployment needs monitoring
            // DXP-71: Added 'Completing' as transitional state
            const inProgressStatuses = ['InProgress', 'Resetting', 'Completing'];
            const awaitingVerificationStatuses = ['AwaitingVerification'];
            const completeStatuses = ['Succeeded', 'Failed', 'Reset'];

            if (completeStatuses.includes(currentStatus)) {
                // Deployment already complete - no monitoring needed
                message.push(`✅ **Deployment Already Complete**\n`);
                message.push(`Status: **${currentStatus}**\n`);
                if (currentStatus === 'Succeeded') {
                    message.push(`🎉 Deployment completed successfully!\n`);
                } else if (currentStatus === 'Failed') {
                    message.push(`⚠️ Deployment failed. Review logs for details.\n`);
                }
                message.push(`**AI: No monitoring needed - deployment is already complete.**`);

            } else if (awaitingVerificationStatuses.includes(currentStatus)) {
                // Deployment awaiting verification
                message.push(`🔍 **Deployment Awaiting Verification**\n`);
                message.push(`The deployment has completed and is ready for review.\n\n`);
                message.push(`**Next Steps:**\n`);
                message.push(`1. Review the deployment at verification URLs\n`);
                message.push(`2. Use \`complete_deployment\` to finalize if everything looks good\n`);
                message.push(`3. Use \`reset_deployment\` to rollback if issues are found\n\n`);
                message.push(`**AI: No monitoring needed - deployment awaits user verification.**`);

            } else if (inProgressStatuses.includes(currentStatus)) {
                // Deployment in progress - provide transparent monitoring instructions
                message.push(`📊 **MONITORING INSTRUCTIONS FOR AI**\n\n`);
                message.push(`Deployment is in progress and requires monitoring.\n`);
                message.push(`Current Status: ${currentStatus}\n`);
                message.push(`Progress: ${progress}%\n\n`);

                const monitorInterval = interval || 30; // Use provided interval or default to 30 seconds

                message.push(`**To monitor this deployment, use get_deployment_status with:**\n`);
                message.push(`• deploymentId: "${deploymentId}"\n`);
                message.push(`• waitBeforeCheck: ${monitorInterval} (waits ${monitorInterval} seconds then checks)\n`);
                message.push(`• monitor: true (enables monitoring prompts)\n`);
                if (projectName) {
                    message.push(`• projectName: "${projectName}"\n`);
                }
                message.push(`\n`);
                message.push(`**RECOMMENDED MONITORING PATTERN:**\n`);
                message.push(`1. Call get_deployment_status with:\n`);
                message.push(`   - deploymentId="${deploymentId}"\n`);
                message.push(`   - waitBeforeCheck=${monitorInterval}\n`);
                message.push(`   - monitor=true\n`);
                message.push(`2. If still InProgress, repeat with same interval\n`);
                message.push(`3. When AwaitingVerification, prompt user to verify\n`);
                message.push(`4. When Succeeded/Failed, stop monitoring\n\n`);

                if (autoComplete) {
                    message.push(`**Auto-Complete:** Enabled - will auto-complete when verification reached\n\n`);
                }

                message.push(`**Note:** Tool will wait ${monitorInterval} seconds then check automatically.\n`);
                message.push(`Deployments can take 30-90 minutes depending on complexity and size. Be patient.`);
            } else {
                // Unknown status - provide basic instructions
                message.push(`⚠️ **Unknown Status: ${currentStatus}**\n\n`);
                message.push(`**AI: Check status manually using get_deployment_status.**`);
            }

            return ResponseBuilder.successWithStructuredData(structuredData, message.join('\n'));

        } catch (error: any) {
            console.error('Monitor deployment error:', error);
            return ResponseBuilder.error(
                'Failed to start deployment monitoring',
                { error: error.message }
            );
        }
    }

    /**
     * Get deployment status (required for handleMonitorDeployment)
     */
    static async handleGetDeploymentStatus(args: any): Promise<any> {
        const DeploymentListOperations = require('./deployment-list');
        return DeploymentListOperations.handleGetDeploymentStatus(args);
    }
}

export default DeploymentActionOperations;

/**
 * Simple Tools - Dead Simple Commands for Common Operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 * 
 * These tools wrap complex operations with smart defaults and natural language
 */

const { DeploymentTools } = require('./deployment');
const ProjectTools = require('./project-tools');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const OutputLogger = require('../output-logger');

class SimpleTools {
    /**
     * Deploy - The simplest possible deployment command
     * Handles 80% of use cases with zero friction
     */
    static async handleDeploy(args) {
        try {
            const { target, source, project, dryRun } = args;
            
            // Get project configuration
            const projectConfig = await this.getProjectConfig(project);
            
            // Smart target environment detection
            const targetEnv = this.parseTargetEnvironment(target);
            
            // Smart source detection (if not specified)
            let sourceEnv = source;
            if (!sourceEnv) {
                sourceEnv = this.inferSourceEnvironment(targetEnv);
            } else {
                sourceEnv = this.parseSourceEnvironment(source);
            }
            
            // Validate environment names
            const validEnvironments = ['Integration', 'Preproduction', 'Production'];
            if (!validEnvironments.includes(sourceEnv)) {
                throw new Error(`Invalid source environment: ${sourceEnv}. Valid: ${validEnvironments.join(', ')}`);
            }
            if (!validEnvironments.includes(targetEnv)) {
                throw new Error(`Invalid target environment: ${targetEnv}. Valid: ${validEnvironments.join(', ')}`);
            }
            
            // Prevent same environment deployment
            if (sourceEnv === targetEnv) {
                throw new Error(`Source and target environments cannot be the same (${sourceEnv})`);
            }
            
            // Smart deployment type detection
            const deploymentType = this.inferDeploymentType(sourceEnv, targetEnv);
            
            const deploymentArgs = {
                projectId: projectConfig.projectId,
                projectName: projectConfig.name,
                sourceEnvironment: sourceEnv,
                targetEnvironment: targetEnv,
                deploymentType: deploymentType
            };
            
            // Dry run mode - show what would happen
            if (dryRun) {
                const preview = `🧪 **Dry Run Preview**

**Project**: ${projectConfig.name}
**Source**: ${sourceEnv}
**Target**: ${targetEnv}  
**Type**: ${deploymentType}
**Project ID**: ${projectConfig.projectId}

**What would happen**:
1. Check for active deployments in ${targetEnv}
2. Start ${deploymentType} deployment from ${sourceEnv} to ${targetEnv}
3. Monitor deployment progress
4. Notify when complete

**To execute**: Run the same command without --dry-run`;

                return ResponseBuilder.success(preview, 'deploy', { 
                    dryRun: true,
                    project: projectConfig.name,
                    source: sourceEnv,
                    target: targetEnv
                });
            }
            
            OutputLogger.deploy(`Smart Deploy: ${sourceEnv} → ${targetEnv} (${deploymentType})`);
            
            // Execute deployment with smart retry
            return await this.executeWithRetry(
                () => DeploymentTools.handleStartDeployment(deploymentArgs),
                `deployment from ${sourceEnv} to ${targetEnv}`,
                3 // max retries
            );
            
        } catch (error) {
            OutputLogger.error('Deploy error:', error);
            
            // Get project config if available for better error context
            let projectConfig = null;
            try {
                projectConfig = await this.getProjectConfig(args.project);
            } catch (e) {
                // Ignore project config errors in error handling
            }
            
            const errorContext = {
                operation: 'deploy',
                projectId: projectConfig?.id,
                projectName: projectConfig?.name,
                apiKey: projectConfig?.apiKey
            };
            
            const detectedError = ErrorHandler.detectError(error.message, errorContext);
            if (detectedError) {
                return ErrorHandler.formatError(detectedError, errorContext);
            }
            
            return ResponseBuilder.internalError('Deploy failed', error.message);
        }
    }
    
    /**
     * Status - Show what actually matters right now
     */
    static async handleStatus(args) {
        try {
            const { project, environment } = args;
            
            // Get project configuration
            const projectConfig = await this.getProjectConfig(project);
            
            // Get deployments with retry
            const deploymentsResult = await this.executeWithRetry(
                () => DeploymentTools.handleListDeployments({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    limit: 10
                }),
                `status check for ${projectConfig.name}`,
                2 // fewer retries for status checks
            );
            
            if (!deploymentsResult.isSuccess) {
                return deploymentsResult;
            }
            
            // Parse deployment data safely
            let deployments;
            try {
                deployments = JSON.parse(deploymentsResult.content[0].text);
                if (!Array.isArray(deployments)) {
                    deployments = [];
                }
            } catch (parseError) {
                OutputLogger.warn('Failed to parse deployment data:', parseError.message);
                deployments = [];
            }
            
            // Create intelligent status summary
            const statusSummary = this.formatIntelligentStatus(deployments, environment);
            return ResponseBuilder.successWithVersionCheck(statusSummary, true);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'status', args);
        }
    }
    
    /**
     * Rollback - Emergency panic button
     */
    static async handleRollback(args) {
        try {
            const { environment, project } = args;
            
            // Get project configuration
            const projectConfig = await this.getProjectConfig(project);
            
            // Parse environment
            const targetEnv = environment ? this.parseTargetEnvironment(environment) : 'Production';
            
            // Find latest deployment to rollback with retry
            const deploymentsResult = await this.executeWithRetry(
                () => DeploymentTools.handleListDeployments({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    limit: 5
                }),
                `fetching deployments for rollback`,
                2
            );
            
            if (!deploymentsResult.isSuccess) {
                return deploymentsResult;
            }
            
            let deployments;
            try {
                deployments = JSON.parse(deploymentsResult.content[0].text);
                if (!Array.isArray(deployments)) {
                    deployments = [];
                }
            } catch (parseError) {
                OutputLogger.warn('Failed to parse deployment data:', parseError.message);
                deployments = [];
            }
            const targetDeployment = deployments.find(d => 
                d.targetEnvironment === targetEnv && 
                (d.status === 'InProgress' || d.status === 'AwaitingVerification')
            );
            
            if (!targetDeployment) {
                return ResponseBuilder.error(
                    `❌ No active deployment found to rollback in ${targetEnv}`,
                    'rollback',
                    { environment: targetEnv, project: projectConfig.name }
                );
            }
            
            OutputLogger.error(`Emergency Rollback: ${targetDeployment.id} in ${targetEnv}`);
            
            // Execute rollback with retry
            return await this.executeWithRetry(
                () => DeploymentTools.handleResetDeployment({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    deploymentId: targetDeployment.id
                }),
                `rollback of deployment ${targetDeployment.id}`,
                3
            );
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'rollback', args);
        }
    }
    
    /**
     * Quick - Super fast status check
     */
    static async handleQuick(args) {
        try {
            const { project } = args;
            
            // Get project configuration
            const projectConfig = await this.getProjectConfig(project);
            
            // Get only the most recent deployments with retry
            const deploymentsResult = await this.executeWithRetry(
                () => DeploymentTools.handleListDeployments({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    limit: 3
                }),
                `quick status check`,
                1 // single retry for quick checks
            );
            
            if (!deploymentsResult.isSuccess) {
                return deploymentsResult;
            }
            
            let deployments;
            try {
                deployments = JSON.parse(deploymentsResult.content[0].text);
                if (!Array.isArray(deployments)) {
                    deployments = [];
                }
            } catch (parseError) {
                OutputLogger.warn('Failed to parse deployment data:', parseError.message);
                deployments = [];
            }
            
            // Ultra-condensed status
            const summary = this.createQuickSummary(deployments);
            
            return ResponseBuilder.successWithVersionCheck(summary, true);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'quick', args);
        }
    }
    
    // Helper Methods
    
    /**
     * Validate connection before operations
     */
    static async validateConnection(projectConfig) {
        try {
            // Quick health check to ensure API is reachable
            const testResult = await this.executeWithRetry(
                () => DeploymentTools.handleListDeployments({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    limit: 1
                }),
                `connection validation`,
                1
            );
            
            if (!testResult.isSuccess) {
                throw new Error(`Connection validation failed: ${testResult.content?.[0]?.text || 'Unknown error'}`);
            }
            
            return true;
        } catch (error) {
            throw new Error(`Cannot connect to Optimizely DXP: ${error.message}. Check your credentials and network connection.`);
        }
    }
    
    static async getProjectConfig(projectName) {
        try {
            const projects = ProjectTools.getConfiguredProjects();
            
            // Handle no projects configured
            if (!projects || projects.length === 0) {
                throw new Error('No projects configured. Run "setup_wizard" to configure your first project.');
            }
            
            if (projectName) {
                // CRITICAL: Require exact match (case-insensitive) to prevent wrong project selection
                const project = projects.find(p => 
                    p.name && p.name.toLowerCase() === projectName.toLowerCase()
                );
                
                if (!project) {
                    const availableNames = projects.map(p => p.name).filter(Boolean).join(', ') || 'None';
                    throw new Error(`Project "${projectName}" not found. Available: ${availableNames}`);
                }
                
                return project;
            } else {
                // Use default project
                const defaultProject = projects.find(p => p.isDefault);
                
                if (defaultProject) {
                    return defaultProject;
                }
                
                // If no default but only one project, use it
                if (projects.length === 1) {
                    return projects[0];
                }
                
                // Multiple projects, no default
                const projectNames = projects.map(p => p.name).filter(Boolean).join(', ') || 'None';
                throw new Error(`Multiple projects found but no default set. Available: ${projectNames}. Specify --project or set a default.`);
            }
        } catch (error) {
            // If ProjectTools fails, provide helpful error
            if (error.message.includes('No projects configured')) {
                throw error;
            }
            throw new Error(`Failed to get project configuration: ${error.message}`);
        }
    }
    
    static parseTargetEnvironment(target) {
        if (!target) return 'Production'; // Default to production
        
        const targetLower = target.toLowerCase();
        
        // Handle common aliases
        const aliases = {
            'staging': 'Preproduction',
            'stage': 'Preproduction', 
            'pre': 'Preproduction',
            'prep': 'Preproduction',
            'prod': 'Production',
            'production': 'Production',
            'int': 'Integration',
            'integration': 'Integration',
            'dev': 'Integration',
            'development': 'Integration'
        };
        
        return aliases[targetLower] || target;
    }
    
    static parseSourceEnvironment(source) {
        return this.parseTargetEnvironment(source);
    }
    
    static inferSourceEnvironment(targetEnv) {
        // Smart defaults based on typical workflows
        switch (targetEnv) {
            case 'Production':
                return 'Preproduction'; // Most common: staging to prod
            case 'Preproduction':
                return 'Integration';   // Dev to staging
            case 'Integration':
                return 'Integration';   // Self-deploy (package upload)
            default:
                return 'Integration';
        }
    }
    
    static inferDeploymentType(sourceEnv, targetEnv) {
        // Upward deployments are typically code
        if ((sourceEnv === 'Integration' && targetEnv === 'Preproduction') ||
            (sourceEnv === 'Preproduction' && targetEnv === 'Production') ||
            (sourceEnv === 'Integration' && targetEnv === 'Production')) {
            return 'code';
        }
        
        // Downward deployments are typically content
        if ((sourceEnv === 'Production' && targetEnv === 'Preproduction') ||
            (sourceEnv === 'Production' && targetEnv === 'Integration') ||
            (sourceEnv === 'Preproduction' && targetEnv === 'Integration')) {
            return 'content';
        }
        
        // Default to code for same-environment or unclear cases
        return 'code';
    }
    
    static formatIntelligentStatus(deployments, filterEnvironment) {
        const environments = ['Production', 'Preproduction', 'Integration'];
        let status = "📊 **Current Status**\n\n";
        
        // Group deployments by target environment
        const envDeployments = {};
        environments.forEach(env => {
            envDeployments[env] = deployments
                .filter(d => d.targetEnvironment === env)
                .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];
        });
        
        // Show status for each environment
        environments.forEach(env => {
            if (filterEnvironment && env !== filterEnvironment) return;
            
            const deployment = envDeployments[env];
            const envStatus = this.getEnvironmentStatusIcon(deployment);
            const envDetails = this.getEnvironmentDetails(deployment);
            
            status += `${envStatus} **${env}**: ${envDetails}\n`;
        });
        
        // Add suggestions
        const suggestions = this.generateSuggestions(envDeployments);
        if (suggestions) {
            status += `\n💡 **Suggestions**\n${suggestions}`;
        }
        
        return status;
    }
    
    static getEnvironmentStatusIcon(deployment) {
        if (!deployment) return '⚪';
        
        switch (deployment.status) {
            case 'Succeeded':
                return '✅';
            case 'InProgress':
                return '🔄';
            case 'AwaitingVerification':
                return '⚠️';
            case 'Failed':
                return '❌';
            case 'Reset':
                return '🔙';
            default:
                return '❓';
        }
    }
    
    static getEnvironmentDetails(deployment) {
        if (!deployment) return 'No recent deployments';
        
        const timeAgo = this.getTimeAgo(deployment.startTime);
        const packageInfo = deployment.packageName ? ` (${deployment.packageName})` : '';
        
        switch (deployment.status) {
            case 'Succeeded':
                return `Deployed ${timeAgo}${packageInfo}`;
            case 'InProgress':
                const progress = this.estimateProgress(deployment);
                const eta = this.estimateETA(deployment);
                return `Deploying... ${progress}% complete${packageInfo} (ETA: ${eta})`;
            case 'AwaitingVerification':
                return `✨ Ready to verify${packageInfo} (started ${timeAgo})`;
            case 'Failed':
                const failureReason = deployment.message ? ` - ${deployment.message}` : '';
                return `Failed ${timeAgo}${packageInfo}${failureReason}`;
            case 'Reset':
                return `Rolled back ${timeAgo}${packageInfo}`;
            default:
                return `${deployment.status} ${timeAgo}${packageInfo}`;
        }
    }
    
    static estimateProgress(deployment) {
        if (!deployment.startTime) return 0;
        
        const startTime = new Date(deployment.startTime);
        const now = new Date();
        const elapsedMinutes = (now - startTime) / 60000;
        
        // Typical deployment times by environment
        const typicalMinutes = {
            'Integration': 5,
            'Preproduction': 7,
            'Production': 10
        };
        
        const expectedMinutes = typicalMinutes[deployment.targetEnvironment] || 8;
        const estimatedProgress = Math.min(95, Math.floor((elapsedMinutes / expectedMinutes) * 100));
        
        return estimatedProgress;
    }
    
    static estimateETA(deployment) {
        if (!deployment.startTime) return 'unknown';
        
        const startTime = new Date(deployment.startTime);
        const now = new Date();
        const elapsedMinutes = (now - startTime) / 60000;
        
        // Typical deployment times
        const typicalMinutes = {
            'Integration': 5,
            'Preproduction': 7,
            'Production': 10
        };
        
        const expectedMinutes = typicalMinutes[deployment.targetEnvironment] || 8;
        const remainingMinutes = Math.max(1, expectedMinutes - elapsedMinutes);
        
        if (remainingMinutes < 1) return 'any moment';
        if (remainingMinutes < 2) return '1 minute';
        return `${Math.round(remainingMinutes)} minutes`;
    }
    
    static generateSuggestions(envDeployments) {
        const suggestions = [];
        
        // Check for stuck deployments (running > 20 minutes)
        Object.entries(envDeployments).forEach(([env, deployment]) => {
            if (deployment && deployment.status === 'InProgress') {
                const startTime = new Date(deployment.startTime);
                const now = new Date();
                const elapsedMinutes = (now - startTime) / 60000;
                
                if (elapsedMinutes > 20) {
                    suggestions.push(`⚠️ ${env} deployment may be stuck (running ${Math.round(elapsedMinutes)} minutes): \`claude "rollback ${env.toLowerCase()}"\``);
                }
            }
        });
        
        // Check for deployments ready to verify
        Object.entries(envDeployments).forEach(([env, deployment]) => {
            if (deployment && deployment.status === 'AwaitingVerification') {
                suggestions.push(`• Verify ${env} deployment: \`claude "complete deployment in ${env.toLowerCase()}"\``);
            }
        });
        
        // Check for failed deployments
        Object.entries(envDeployments).forEach(([env, deployment]) => {
            if (deployment && deployment.status === 'Failed') {
                suggestions.push(`• Rollback ${env}: \`claude "rollback ${env.toLowerCase()}"\``);
            }
        });
        
        // Suggest next logical deployment
        if (envDeployments.Integration && envDeployments.Integration.status === 'Succeeded' &&
            (!envDeployments.Preproduction || envDeployments.Preproduction.startTime < envDeployments.Integration.startTime)) {
            suggestions.push(`• Deploy to staging: \`claude "deploy to staging"\``);
        }
        
        if (envDeployments.Preproduction && envDeployments.Preproduction.status === 'Succeeded' &&
            (!envDeployments.Production || envDeployments.Production.startTime < envDeployments.Preproduction.startTime)) {
            suggestions.push(`• Deploy to production: \`claude "deploy to prod"\``);
        }
        
        return suggestions.join('\n');
    }
    
    static createQuickSummary(deployments) {
        if (!deployments || deployments.length === 0) {
            return "🔍 No recent deployments found";
        }
        
        const latest = deployments[0];
        const status = this.getEnvironmentStatusIcon(latest);
        const timeAgo = this.getTimeAgo(latest.startTime);
        
        return `${status} ${latest.targetEnvironment}: ${latest.status} ${timeAgo}`;
    }
    
    static getTimeAgo(dateString) {
        const now = new Date();
        const date = new Date(dateString);
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    }
    
    /**
     * Execute operation with smart retry logic
     */
    static async executeWithRetry(operation, operationName, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const result = await operation();
                
                if (attempt > 1) {
                    OutputLogger.success(`${operationName} succeeded on attempt ${attempt}`);
                }
                
                return result;
                
            } catch (error) {
                lastError = error;
                
                // Check if error is retryable
                const isRetryable = this.isRetryableError(error);
                
                if (!isRetryable) {
                    OutputLogger.error(`${operationName} failed with non-retryable error: ${error.message}`);
                    throw error;
                }
                
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
                    OutputLogger.warn(`${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`);
                    OutputLogger.log(`   Error: ${error.message}`);
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    OutputLogger.error(`${operationName} failed after ${maxRetries} attempts`);
                }
            }
        }
        
        throw lastError;
    }
    
    /**
     * Determine if an error is worth retrying
     */
    static isRetryableError(error) {
        const message = error.message?.toLowerCase() || '';
        
        // Network/connection errors - retry
        if (message.includes('network') || 
            message.includes('timeout') || 
            message.includes('connection') ||
            message.includes('econnreset') ||
            message.includes('enotfound')) {
            return true;
        }
        
        // Rate limiting - retry
        if (message.includes('rate limit') || 
            message.includes('too many requests') ||
            message.includes('429')) {
            return true;
        }
        
        // Temporary server errors - retry
        if (message.includes('502') || 
            message.includes('503') || 
            message.includes('504') ||
            message.includes('bad gateway') ||
            message.includes('service unavailable')) {
            return true;
        }
        
        // Authentication/authorization errors - don't retry
        if (message.includes('unauthorized') || 
            message.includes('forbidden') ||
            message.includes('401') ||
            message.includes('403')) {
            return false;
        }
        
        // Validation errors - don't retry
        if (message.includes('invalid') || 
            message.includes('not found') ||
            message.includes('400')) {
            return false;
        }
        
        // Default: retry for unknown errors (conservative approach)
        return true;
    }
}

module.exports = SimpleTools;
/**
 * Simple Permission Checker - Direct PowerShell execution without cache
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { execSync } = require('child_process');
const PowerShellCommandBuilder = require('../powershell-command-builder');
const ResponseBuilder = require('../response-builder');
const ProjectTools = require('./project-tools');

class SimplePermissionChecker {
    static ENVIRONMENTS = ['Integration', 'Preproduction', 'Production'];
    
    /**
     * Execute PowerShell command directly without caching
     */
    static async executePowerShellDirect(command) {
        try {
            // Get PowerShell command - default to pwsh
            const psCommand = 'pwsh';  // Simplified - we know it works
            
            // Execute directly
            const result = execSync(`${psCommand} -Command "${command.replace(/"/g, '`"')}"`, {
                encoding: 'utf8',
                timeout: 30000, // 30 second timeout
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            return result;
            
        } catch (error) {
            // Parse error to see if it's a permission issue
            const errorText = error.stderr || error.message || error.toString();
            
            if (errorText.includes('403') || errorText.includes('401') || 
                errorText.includes('Forbidden') || errorText.includes('Unauthorized') ||
                errorText.includes('Access denied')) {
                throw new Error('ACCESS_DENIED');
            }
            
            // For any other error, also throw ACCESS_DENIED to be safe
            // Most PowerShell errors in this context indicate permission issues
            throw new Error('ACCESS_DENIED');
        }
    }
    
    /**
     * Test environment access - tries multiple methods for better detection
     */
    static async testEnvironmentAccess(projectId, apiKey, apiSecret, environment) {
        // Method 1: Try storage containers (most reliable for full access)
        try {
            const command = new PowerShellCommandBuilder('Get-EpiStorageContainer')
                .addParam('ProjectId', projectId)
                .addParam('ClientKey', apiKey)
                .addParam('ClientSecret', apiSecret)
                .addParam('Environment', environment)
                .build();
            
            const result = await this.executePowerShellDirect(command);
            
            // If we get here without error, we have access
            return { hasAccess: true, method: 'storage-container-list' };
            
        } catch (error) {
            const errorMsg = error.stderr || error.message || error.toString();
            
            // If storage check fails, try deployment listing as fallback
            // Some keys have deployment permissions but not storage permissions
            try {
                const deployCommand = new PowerShellCommandBuilder('Get-EpiDeployment')
                    .addParam('ProjectId', projectId)
                    .addParam('ClientKey', apiKey)
                    .addParam('ClientSecret', apiSecret)
                    .build() + ` | Where-Object { $_.parameters.sourceEnvironment -eq '${environment}' -or $_.parameters.targetEnvironment -eq '${environment}' } | Select-Object -First 1`;
                
                const deployResult = await this.executePowerShellDirect(deployCommand);
                
                // If we can see deployments for this environment, we likely have some access
                if (deployResult && deployResult.length > 10) {  // Non-empty result
                    return { hasAccess: true, method: 'deployment-history' };
                }
            } catch (deployError) {
                // Deployment check also failed
            }
            
            // Both checks failed - no access
            if (errorMsg.includes('403') || errorMsg.includes('Forbidden') || 
                errorMsg.includes('Access denied')) {
                return { hasAccess: false, reason: 'Access Denied' };
            }
            
            // For other errors, assume no access for safety
            return { hasAccess: false, reason: 'Unable to verify' };
        }
    }
    
    /**
     * Main verification function
     */
    static async verifyAccess(args) {
        try {
            // Get project configuration - simplified approach
            let projectConfig;
            if (args.apiKey && args.apiSecret && args.projectId) {
                projectConfig = {
                    name: args.projectName || 'Unknown',
                    projectId: args.projectId,
                    apiKey: args.apiKey,
                    apiSecret: args.apiSecret
                };
            } else {
                const projects = ProjectTools.getConfiguredProjects();
                if (projects.length === 0) {
                    return ResponseBuilder.error('No projects configured. Run "setup_wizard" to configure your first project.');
                }
                
                const projectName = args.projectName || args.project;
                if (projectName) {
                    projectConfig = projects.find(p => p.name && p.name.toLowerCase() === projectName.toLowerCase());
                    if (!projectConfig) {
                        return ResponseBuilder.error(`Project "${projectName}" not found.`);
                    }
                } else {
                    projectConfig = projects.find(p => p.isDefault) || projects[0];
                }
            }
            
            const { projectId, apiKey, apiSecret } = projectConfig;
            const projectName = projectConfig.name || 'Unknown';
            
            const results = {
                projectName,
                projectId,
                environments: {},
                accessible: [],
                inaccessible: [],
                timestamp: new Date().toISOString()
            };
            
            // Test each environment
            for (const environment of this.ENVIRONMENTS) {
                const accessResult = await this.testEnvironmentAccess(projectId, apiKey, apiSecret, environment);
                
                results.environments[environment] = accessResult;
                
                if (accessResult.hasAccess) {
                    results.accessible.push(environment);
                } else {
                    results.inaccessible.push(environment);
                }
            }
            
            // Format response
            let response = `🔐 **Simple Permission Verification**\n\n`;
            response += `**Project:** ${results.projectName}\n`;
            response += `**Project ID:** ${projectId.substring(0, 8)}...\n`;
            
            // Note if we used fallback detection
            const usedFallback = Object.values(results.environments).some(env => env.method === 'deployment-history');
            if (usedFallback) {
                response += `**Test Method:** Deployment History (Limited API Key)\n\n`;
            } else {
                response += `**Test Method:** Storage Container Access\n\n`;
            }
            
            response += `**Environment Access:**\n`;
            for (const env of this.ENVIRONMENTS) {
                const result = results.environments[env];
                const icon = result.hasAccess ? '✅' : '🔒';
                const status = result.hasAccess ? 'Accessible' : result.reason || 'No Access';
                response += `• ${env}: ${icon} ${status}\n`;
            }
            
            response += `\n**Summary:**\n`;
            
            if (results.accessible.length === 0) {
                response += `❌ **No Environment Access Detected**\n\n`;
                response += `Your API key appears to have no access to any environments.\n`;
                response += `Please check the Optimizely DXP Portal to verify your API key configuration.`;
            } else if (results.accessible.length === 3) {
                response += `✅ **Full Environment Access**\n\n`;
                response += `You have access to all three environments.\n`;
                response += `This allows complete control over deployments and operations.`;
            } else {
                response += `⚠️ **Limited Environment Access**\n\n`;
                response += `**Can Access:** ${results.accessible.join(', ')}\n`;
                response += `**Cannot Access:** ${results.inaccessible.join(', ')}\n\n`;
                
                // What you can do with this access level
                if (results.accessible.length === 1 && results.accessible[0] === 'Integration') {
                    response += `**Available Operations:**\n`;
                    response += `• Full access to Integration environment\n`;
                    response += `• Export Integration databases\n`;
                    response += `• Download Integration media/blobs\n`;
                }
            }
            
            return ResponseBuilder.success(response);
            
        } catch (error) {
            return ResponseBuilder.error(
                `Failed to verify permissions: ${error.message}\n\n` +
                `📧 Need help? Contact us at support@jaxondigital.com`
            );
        }
    }
}

module.exports = SimplePermissionChecker;
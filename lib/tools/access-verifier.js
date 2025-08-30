/**
 * Access Verifier - Standalone permission checker
 * Created to avoid Node.js module caching issues with PermissionChecker
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const PowerShellCommandBuilder = require('../powershell-command-builder');
const PowerShellHelper = require('../powershell-helper');
const ResponseBuilder = require('../response-builder');
const ProjectTools = require('./project-tools');

class AccessVerifier {
    /**
     * Verify environment access for a project
     * This is a clean implementation that doesn't depend on cached modules
     */
    static async verifyAccess(args) {
        try {
            // Get project configuration
            let projectConfig;
            if (args.apiKey && args.apiSecret && args.projectId) {
                projectConfig = args;
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
            
            const environments = ['Integration', 'Preproduction', 'Production'];
            const results = {
                projectName,
                projectId,
                accessible: [],
                inaccessible: [],
                details: {}
            };
            
            // Test each environment
            for (const environment of environments) {
                try {
                    // Try to list database exports for this environment
                    // This is a more reliable test that actually checks environment-specific access
                    const command = new PowerShellCommandBuilder('Get-EpiDatabaseExport')
                        .addParam('ProjectId', projectId)
                        .addParam('ClientKey', apiKey)
                        .addParam('ClientSecret', apiSecret)
                        .addParam('Environment', environment)
                        .addParam('DatabaseName', 'epicms')
                        .build();
                    
                    await PowerShellHelper.executeEpiCommand(command, {
                        projectId,
                        apiKey,
                        apiSecret
                    });
                    
                    // If no error, we have access
                    results.accessible.push(environment);
                    results.details[environment] = { hasAccess: true };
                    
                } catch (error) {
                    const errorMsg = error.message || error.toString();
                    const isAccessDenied = errorMsg.includes('401') || 
                                          errorMsg.includes('403') || 
                                          errorMsg.includes('Unauthorized') ||
                                          errorMsg.includes('Forbidden') ||
                                          errorMsg.includes('Access denied');
                    
                    results.inaccessible.push(environment);
                    results.details[environment] = { 
                        hasAccess: false,
                        reason: isAccessDenied ? 'Access Denied' : 'Error'
                    };
                }
            }
            
            // Format the response
            let response = `🔐 **Environment Access Verification**\n\n`;
            response += `**Project:** ${projectName}\n`;
            response += `**Project ID:** ${projectId.substring(0, 8)}...\n\n`;
            
            response += `**Environment Access:**\n`;
            environments.forEach(env => {
                const detail = results.details[env];
                if (detail.hasAccess) {
                    response += `• ${env}: ✅ Accessible\n`;
                } else {
                    response += `• ${env}: 🔒 ${detail.reason}\n`;
                }
            });
            
            response += `\n**Summary:**\n`;
            
            if (results.accessible.length === 0) {
                response += `❌ No environment access detected.\n`;
                response += `Please verify your API credentials are correct.\n`;
            } else if (results.accessible.length === 3) {
                response += `✅ Full access to all environments.\n`;
                response += `You can perform operations across all environments.\n`;
            } else {
                response += `✅ Accessible: ${results.accessible.join(', ')}\n`;
                if (results.inaccessible.length > 0) {
                    response += `❌ Not accessible: ${results.inaccessible.join(', ')}\n`;
                }
                
                response += `\n**Access Level:**\n`;
                
                // Provide role-specific guidance
                if (results.accessible.length === 1 && results.accessible[0] === 'Integration') {
                    response += `• Developer role - Integration environment only\n`;
                    response += `• Can deploy packages to Integration\n`;
                    response += `• Cannot access Preproduction or Production\n`;
                } else if (results.accessible.includes('Integration') && results.accessible.includes('Preproduction')) {
                    response += `• Tester/QA role - Integration and Preproduction\n`;
                    response += `• Can deploy between Int and Prep\n`;
                    response += `• Cannot access Production\n`;
                } else if (results.accessible.includes('Preproduction') && results.accessible.includes('Production')) {
                    response += `• Release Manager role - Preproduction and Production\n`;
                    response += `• Can deploy from Prep to Prod\n`;
                    response += `• Cannot access Integration\n`;
                }
                
                response += `\n**Important Notes:**\n`;
                response += `• Storage container listing may work for all environments (read-only access)\n`;
                response += `• Actual operations (downloads, deployments) require specific permissions\n`;
            }
            
            return ResponseBuilder.success(response);
            
        } catch (error) {
            return ResponseBuilder.error(
                `Failed to verify access: ${error.message}\n\n` +
                `📧 Need help? Contact us at support@jaxondigital.com`
            );
        }
    }
}

module.exports = AccessVerifier;
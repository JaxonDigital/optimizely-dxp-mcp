/**
 * Reliable Permission Checker - Multi-method permission testing
 * Uses multiple PowerShell commands and validation methods for accurate results
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const PowerShellCommandBuilder = require('../powershell-command-builder');
const PowerShellHelper = require('../powershell-helper');
const ResponseBuilder = require('../response-builder');
const OutputLogger = require('../output-logger');

class ReliablePermissionChecker {
    static ENVIRONMENTS = ['Integration', 'Preproduction', 'Production'];
    
    /**
     * Method 1: Try to create a minimal database export (most reliable)
     * This actually attempts to create an export and will fail with 403 if no access
     */
    static async testWithDatabaseExportCreation(projectId, apiKey, apiSecret, environment) {
        try {
            OutputLogger.debug(`Testing ${environment} with database export creation...`);
            
            // Try to create a database export with 1 hour retention (minimal)
            // This will actually attempt the operation and fail if no permission
            const command = new PowerShellCommandBuilder('New-EpiDatabaseExport')
                .addParam('ProjectId', projectId)
                .addParam('ClientKey', apiKey)
                .addParam('ClientSecret', apiSecret)
                .addParam('Environment', environment)
                .addParam('DatabaseName', 'epicms')
                .addParam('RetentionHours', 1)  // Minimal retention
                .addParam('Wait', false)  // Don't wait for completion
                .build();
            
            const result = await PowerShellHelper.executeEpiCommand(command, {
                projectId,
                apiKey,
                apiSecret
            });
            
            // If we get here, we have access
            // Try to delete the export immediately to clean up
            if (result.parsedData && result.parsedData.id) {
                try {
                    const deleteCommand = new PowerShellCommandBuilder('Remove-EpiDatabaseExport')
                        .addParam('ProjectId', projectId)
                        .addParam('ClientKey', apiKey)
                        .addParam('ClientSecret', apiSecret)
                        .addParam('Id', result.parsedData.id)
                        .build();
                    
                    await PowerShellHelper.executeEpiCommand(deleteCommand, {
                        projectId,
                        apiKey,
                        apiSecret
                    });
                } catch (deleteError) {
                    // Ignore delete errors - not critical
                    OutputLogger.debug(`Could not delete test export: ${deleteError.message}`);
                }
            }
            
            return { hasAccess: true, method: 'database-export-creation' };
            
        } catch (error) {
            const errorMsg = error.message || error.toString();
            
            // Check if it's an access denied error
            if (errorMsg.includes('403') || errorMsg.includes('401') || 
                errorMsg.includes('Forbidden') || errorMsg.includes('Unauthorized') ||
                errorMsg.includes('Access denied')) {
                return { hasAccess: false, reason: 'Access Denied', method: 'database-export-creation' };
            }
            
            // Other error - try next method
            return null;
        }
    }
    
    /**
     * Method 2: List database exports (less reliable but safer)
     */
    static async testWithDatabaseExportList(projectId, apiKey, apiSecret, environment) {
        try {
            OutputLogger.debug(`Testing ${environment} with database export list...`);
            
            const command = new PowerShellCommandBuilder('Get-EpiDatabaseExport')
                .addParam('ProjectId', projectId)
                .addParam('ClientKey', apiKey)
                .addParam('ClientSecret', apiSecret)
                .addParam('Environment', environment)
                .addParam('DatabaseName', 'epicms')
                .build();
            
            const result = await PowerShellHelper.executeEpiCommand(command, {
                projectId,
                apiKey,
                apiSecret
            });
            
            // If we get a result without error, we likely have access
            return { hasAccess: true, method: 'database-export-list', confidence: 'medium' };
            
        } catch (error) {
            const errorMsg = error.message || error.toString();
            
            if (errorMsg.includes('403') || errorMsg.includes('401') || 
                errorMsg.includes('Forbidden') || errorMsg.includes('Unauthorized')) {
                return { hasAccess: false, reason: 'Access Denied', method: 'database-export-list' };
            }
            
            return null;
        }
    }
    
    /**
     * Method 3: Try to get deployment package location
     * This is what we were using but seems unreliable
     */
    static async testWithDeploymentPackageLocation(projectId, apiKey, apiSecret, environment) {
        try {
            OutputLogger.debug(`Testing ${environment} with deployment package location...`);
            
            const command = new PowerShellCommandBuilder('Get-EpiDeploymentPackageLocation')
                .addParam('ProjectId', projectId)
                .addParam('ClientKey', apiKey)
                .addParam('ClientSecret', apiSecret)
                .addParam('Environment', environment)
                .build();
            
            const result = await PowerShellHelper.executeEpiCommand(command, {
                projectId,
                apiKey,
                apiSecret
            });
            
            return { hasAccess: true, method: 'package-location', confidence: 'low' };
            
        } catch (error) {
            const errorMsg = error.message || error.toString();
            
            if (errorMsg.includes('403') || errorMsg.includes('401')) {
                return { hasAccess: false, reason: 'Access Denied', method: 'package-location' };
            }
            
            return null;
        }
    }
    
    /**
     * Test environment access using multiple methods
     */
    static async testEnvironmentAccess(projectId, apiKey, apiSecret, environment) {
        // Try methods in order of reliability
        
        // Method 1: Database export creation (most reliable but creates actual resources)
        const exportResult = await this.testWithDatabaseExportCreation(projectId, apiKey, apiSecret, environment);
        if (exportResult !== null) {
            return exportResult;
        }
        
        // Method 2: Database export list (safer but might not always fail properly)
        const listResult = await this.testWithDatabaseExportList(projectId, apiKey, apiSecret, environment);
        if (listResult !== null) {
            return listResult;
        }
        
        // Method 3: Package location (least reliable)
        const packageResult = await this.testWithDeploymentPackageLocation(projectId, apiKey, apiSecret, environment);
        if (packageResult !== null) {
            return packageResult;
        }
        
        // If all methods fail to give a clear answer, assume no access for safety
        return { hasAccess: false, reason: 'Unable to verify', method: 'none' };
    }
    
    /**
     * Main verification function
     */
    static async verifyAccess(args) {
        try {
            const { projectId, apiKey, apiSecret, projectName } = args;
            
            if (!projectId || !apiKey || !apiSecret) {
                return ResponseBuilder.error('Missing required credentials for permission check');
            }
            
            const results = {
                projectName: projectName || 'Unknown',
                projectId,
                environments: {},
                accessible: [],
                inaccessible: [],
                methods: [],
                timestamp: new Date().toISOString()
            };
            
            // Test each environment
            for (const environment of this.ENVIRONMENTS) {
                const accessResult = await this.testEnvironmentAccess(projectId, apiKey, apiSecret, environment);
                
                results.environments[environment] = accessResult;
                
                if (!results.methods.includes(accessResult.method)) {
                    results.methods.push(accessResult.method);
                }
                
                if (accessResult.hasAccess) {
                    results.accessible.push(environment);
                } else {
                    results.inaccessible.push(environment);
                }
            }
            
            // Format response
            let response = `🔐 **Reliable Permission Verification**\n\n`;
            response += `**Project:** ${results.projectName}\n`;
            response += `**Project ID:** ${projectId.substring(0, 8)}...\n`;
            response += `**Test Methods Used:** ${results.methods.join(', ')}\n\n`;
            
            response += `**Environment Access:**\n`;
            for (const env of this.ENVIRONMENTS) {
                const result = results.environments[env];
                const icon = result.hasAccess ? '✅' : '🔒';
                const status = result.hasAccess ? 'Accessible' : result.reason || 'No Access';
                let confidence = '';
                
                if (result.confidence === 'medium') {
                    confidence = ' (medium confidence)';
                } else if (result.confidence === 'low') {
                    confidence = ' (low confidence)';
                }
                
                response += `• ${env}: ${icon} ${status}${confidence}\n`;
            }
            
            response += `\n**Summary:**\n`;
            
            if (results.accessible.length === 0) {
                response += `❌ **No Environment Access Detected**\n\n`;
                response += `Your API key appears to have no access to any environments.\n`;
                response += `This could mean:\n`;
                response += `• The API credentials are incorrect\n`;
                response += `• The API key has no permissions assigned\n`;
                response += `• The API key is disabled or expired\n\n`;
                response += `Please check the Optimizely DXP Portal to verify your API key configuration.`;
            } else if (results.accessible.length === 3) {
                response += `✅ **Full Environment Access**\n\n`;
                response += `You have access to all three environments.\n`;
                response += `This allows complete control over deployments and operations.`;
            } else {
                response += `⚠️ **Limited Environment Access**\n\n`;
                response += `**Can Access:** ${results.accessible.join(', ')}\n`;
                response += `**Cannot Access:** ${results.inaccessible.join(', ')}\n\n`;
                
                // Role interpretation
                if (results.accessible.length === 1 && results.accessible[0] === 'Integration') {
                    response += `**Typical Role:** Developer\n`;
                    response += `• Full access to Integration environment\n`;
                    response += `• Can develop and test in Integration\n`;
                    response += `• Cannot deploy to Preproduction or Production\n\n`;
                    response += `**Available Operations:**\n`;
                    response += `• Deploy packages to Integration\n`;
                    response += `• Export Integration databases\n`;
                    response += `• Download Integration blobs/media\n`;
                } else if (results.accessible.includes('Integration') && results.accessible.includes('Preproduction')) {
                    response += `**Typical Role:** QA/Tester\n`;
                    response += `• Access to Integration and Preproduction\n`;
                    response += `• Can test deployments between environments\n`;
                    response += `• Cannot access Production\n`;
                } else if (results.accessible.includes('Preproduction') && results.accessible.includes('Production')) {
                    response += `**Typical Role:** Release Manager\n`;
                    response += `• Access to Preproduction and Production\n`;
                    response += `• Can deploy from Prep to Prod\n`;
                    response += `• Cannot access Integration\n`;
                }
            }
            
            // Add confidence note if any tests had low confidence
            const hasLowConfidence = Object.values(results.environments).some(e => e.confidence === 'low');
            if (hasLowConfidence) {
                response += `\n**Note:** Some results have low confidence. `;
                response += `For definitive verification, check the Optimizely DXP Portal.`;
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

module.exports = ReliablePermissionChecker;
/**
 * API Permission Checker - Direct API calls for accurate permission testing
 * Uses actual Optimizely DXP REST API instead of PowerShell commands
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const https = require('https');
const ResponseBuilder = require('../response-builder');

class ApiPermissionChecker {
    static DXP_API_BASE = 'https://paasportal.episerver.net';
    static ENVIRONMENTS = ['Integration', 'Preproduction', 'Production'];
    
    /**
     * Make a direct API call to test permissions
     */
    static async makeApiCall(path, apiKey, apiSecret) {
        return new Promise((resolve, reject) => {
            const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
            
            const options = {
                hostname: 'paasportal.episerver.net',
                path: path,
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            };
            
            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        data: data,
                        headers: res.headers
                    });
                });
            });
            
            req.on('error', (error) => {
                reject(error);
            });
            
            req.end();
        });
    }
    
    /**
     * Test permission for a specific environment using database export list endpoint
     * This endpoint requires actual environment access and reliably returns 403 if no permission
     */
    static async testEnvironmentAccess(projectId, apiKey, apiSecret, environment) {
        try {
            // Try to list database exports for this environment
            // This is a read operation that still requires environment-specific permissions
            const path = `/api/v1.0/projects/${projectId}/environments/${environment}/databases/epicms/exports`;
            
            const response = await this.makeApiCall(path, apiKey, apiSecret);
            
            // Check status code
            if (response.statusCode === 200 || response.statusCode === 204) {
                // Success - we have access
                return { hasAccess: true, method: 'database-exports-list' };
            } else if (response.statusCode === 403 || response.statusCode === 401) {
                // Access denied - no permission for this environment
                return { hasAccess: false, reason: 'Access Denied', statusCode: response.statusCode };
            } else if (response.statusCode === 404) {
                // This might mean the environment exists but has no exports
                // Try an alternative endpoint
                return await this.testEnvironmentAccessAlternative(projectId, apiKey, apiSecret, environment);
            } else {
                // Unexpected status - try alternative method
                return await this.testEnvironmentAccessAlternative(projectId, apiKey, apiSecret, environment);
            }
        } catch (error) {
            // Network error or other issue - try alternative
            return await this.testEnvironmentAccessAlternative(projectId, apiKey, apiSecret, environment);
        }
    }
    
    /**
     * Alternative test using deployment history endpoint
     */
    static async testEnvironmentAccessAlternative(projectId, apiKey, apiSecret, environment) {
        try {
            // Try to get deployments for this environment
            const path = `/api/v1.0/projects/${projectId}/deployments?environment=${environment}&limit=1`;
            
            const response = await this.makeApiCall(path, apiKey, apiSecret);
            
            if (response.statusCode === 200) {
                // We can see deployments - we likely have access
                // But this might show deployments FROM this environment even without access
                // So we need to be careful
                return { hasAccess: true, method: 'deployments-list', confidence: 'medium' };
            } else if (response.statusCode === 403 || response.statusCode === 401) {
                return { hasAccess: false, reason: 'Access Denied', statusCode: response.statusCode };
            } else {
                // Uncertain - default to no access for safety
                return { hasAccess: false, reason: 'Unable to verify', statusCode: response.statusCode };
            }
        } catch (error) {
            return { hasAccess: false, reason: 'Network error', error: error.message };
        }
    }
    
    /**
     * Test access to all environments using direct API calls
     */
    static async checkAllEnvironments(projectId, apiKey, apiSecret, projectName = 'Unknown') {
        const results = {
            projectName,
            projectId,
            environments: {},
            accessible: [],
            inaccessible: [],
            testMethod: 'Direct API Calls',
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
        
        // Determine highest accessible environment
        if (results.accessible.includes('Production')) {
            results.highestEnvironment = 'Production';
        } else if (results.accessible.includes('Preproduction')) {
            results.highestEnvironment = 'Preproduction';
        } else if (results.accessible.includes('Integration')) {
            results.highestEnvironment = 'Integration';
        } else {
            results.highestEnvironment = null;
        }
        
        return results;
    }
    
    /**
     * Main entry point for permission verification
     */
    static async verifyPermissions(args) {
        try {
            const { projectId, apiKey, apiSecret, projectName } = args;
            
            if (!projectId || !apiKey || !apiSecret) {
                return ResponseBuilder.error('Missing required credentials for permission check');
            }
            
            // Perform the check
            const results = await this.checkAllEnvironments(projectId, apiKey, apiSecret, projectName);
            
            // Format the response
            let response = `🔐 **API Permission Verification**\n\n`;
            response += `**Project:** ${results.projectName}\n`;
            response += `**Project ID:** ${projectId.substring(0, 8)}...\n`;
            response += `**Test Method:** Direct API Calls (Most Accurate)\n\n`;
            
            response += `**Environment Access Results:**\n`;
            for (const env of this.ENVIRONMENTS) {
                const result = results.environments[env];
                if (result.hasAccess) {
                    response += `• ${env}: ✅ Accessible`;
                    if (result.confidence === 'medium') {
                        response += ` (medium confidence)`;
                    }
                    response += `\n`;
                } else {
                    response += `• ${env}: 🔒 No Access (${result.reason || 'Unknown'})\n`;
                }
            }
            
            response += `\n**Summary:**\n`;
            
            if (results.accessible.length === 0) {
                response += `❌ **No Environment Access**\n\n`;
                response += `Your API key does not have access to any environments.\n`;
                response += `Please verify:\n`;
                response += `• API credentials are correct\n`;
                response += `• API key has been granted permissions in DXP Portal\n`;
                response += `• API key is not expired or disabled\n`;
            } else if (results.accessible.length === 3) {
                response += `✅ **Full Access**\n\n`;
                response += `You have access to all environments (Integration, Preproduction, Production).\n`;
                response += `This provides complete deployment and management capabilities.\n`;
            } else {
                response += `⚠️ **Limited Access**\n\n`;
                response += `**Accessible:** ${results.accessible.join(', ')}\n`;
                response += `**Not Accessible:** ${results.inaccessible.join(', ')}\n\n`;
                
                // Provide role-specific interpretation
                if (results.accessible.length === 1 && results.accessible[0] === 'Integration') {
                    response += `**Access Level:** Developer\n`;
                    response += `• Can work in Integration environment only\n`;
                    response += `• Cannot deploy to Preproduction or Production\n`;
                    response += `• Typical for development team members\n`;
                } else if (results.accessible.includes('Integration') && results.accessible.includes('Preproduction')) {
                    response += `**Access Level:** Tester/QA\n`;
                    response += `• Can work in Integration and Preproduction\n`;
                    response += `• Can test deployments between Int and Prep\n`;
                    response += `• Cannot access Production\n`;
                } else if (results.accessible.includes('Preproduction') && results.accessible.includes('Production')) {
                    response += `**Access Level:** Release Manager\n`;
                    response += `• Can manage Preproduction and Production\n`;
                    response += `• Can deploy from Prep to Prod\n`;
                    response += `• Cannot access Integration\n`;
                } else if (results.accessible.length === 1 && results.accessible[0] === 'Production') {
                    response += `**Access Level:** Production Monitor\n`;
                    response += `• Read-only access to Production\n`;
                    response += `• Can view logs and exports\n`;
                    response += `• Cannot make changes\n`;
                }
            }
            
            response += `\n**Note:** This test uses direct API calls to the Optimizely DXP API for the most accurate results.\n`;
            response += `Unlike PowerShell commands, these results reflect actual API-level permissions.`;
            
            return ResponseBuilder.success(response);
            
        } catch (error) {
            return ResponseBuilder.error(
                `Failed to verify permissions: ${error.message}\n\n` +
                `This may indicate network issues or invalid credentials.\n` +
                `📧 Need help? Contact us at support@jaxondigital.com`
            );
        }
    }
}

module.exports = ApiPermissionChecker;
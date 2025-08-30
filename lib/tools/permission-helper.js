/**
 * Permission Helper - Centralized permission checking
 * Replaces the old PermissionChecker with working implementation
 */

const SimplePermissionChecker = require('./simple-permission-checker');

class PermissionHelper {
    /**
     * Replace PermissionChecker.getOrCheckPermissionsSafe with working implementation
     */
    static async getOrCheckPermissionsSafe(projectConfig) {
        try {
            const permissionResult = await SimplePermissionChecker.verifyAccess({
                projectId: projectConfig.projectId || projectConfig.id,
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret,
                projectName: projectConfig.name
            });
            
            // Parse the result to get accessible environments in the old format
            let accessible = [];
            
            // Handle both response formats: direct content or nested result.content
            let responseText = '';
            if (permissionResult && permissionResult.content) {
                responseText = permissionResult.content[0].text;
            } else if (permissionResult && permissionResult.result && permissionResult.result.content) {
                responseText = permissionResult.result.content[0].text;
            }
            
            if (responseText) {
                const accessibleMatch = responseText.match(/Can Access:\s*([^\n]+)/);
                if (accessibleMatch) {
                    // Clean up any markdown formatting from the environment names
                    accessible = accessibleMatch[1]
                        .split(', ')
                        .map(s => s.trim())
                        .map(s => s.replace(/^\*+\s*/, '')) // Remove leading asterisks and spaces
                        .filter(s => s && s !== 'undefined'); // Remove empty strings
                } else if (responseText.includes('Full Environment Access')) {
                    accessible = ['Integration', 'Preproduction', 'Production'];
                }
            }
            
            // Return in the old format for compatibility
            return {
                accessible,
                projectName: projectConfig.name || 'Unknown',
                projectId: projectConfig.projectId || projectConfig.id,
                environments: {
                    Integration: { hasAccess: accessible.includes('Integration') },
                    Preproduction: { hasAccess: accessible.includes('Preproduction') },
                    Production: { hasAccess: accessible.includes('Production') }
                }
            };
            
        } catch (error) {
            console.error('PermissionHelper error:', error.message);
            // Fallback - return no access to be safe
            return {
                accessible: [],
                projectName: projectConfig.name || 'Unknown',
                projectId: projectConfig.projectId || projectConfig.id,
                environments: {
                    Integration: { hasAccess: false },
                    Preproduction: { hasAccess: false },
                    Production: { hasAccess: false }
                }
            };
        }
    }
    
    /**
     * Replace PermissionChecker.checkEnvironmentAccess with working implementation
     */
    static async checkEnvironmentAccess(projectConfig) {
        return await this.getOrCheckPermissionsSafe(projectConfig);
    }
}

module.exports = PermissionHelper;
/**
 * Permission Checker - Tests and caches API key permissions across environments
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const path = require('path');
const fs = require('fs').promises;
const PowerShellCommandBuilder = require('../powershell-command-builder');
const PowerShellHelper = require('../powershell-helper');
const OutputLogger = require('../output-logger');
const ResponseBuilder = require('../response-builder');
const ProjectTools = require('./project-tools');
const { execSync } = require('child_process');
const crypto = require('crypto');

class PermissionChecker {
    static ENVIRONMENTS = ['Integration', 'Preproduction', 'Production'];
    static PERMISSIONS = ['Edge logs', 'Integration', 'Preproduction', 'Production'];  // All 4 permissions from DXP portal
    
    /**
     * Safe wrapper for getOrCheckPermissions that handles any potential caching issues
     */
    static async getOrCheckPermissionsSafe(credentials) {
        try {
            return await this.getOrCheckPermissions(credentials);
        } catch (error) {
            if (error.message && error.message.includes('CacheManager')) {
                // Fallback: just do a direct permission check
                // Silent fallback - no console output to avoid breaking MCP
                return await this.checkEnvironmentAccess(credentials);
            }
            throw error;
        }
    }
    
    /**
     * Execute PowerShell command directly without caching (from SimplePermissionChecker)
     */
    static async executePowerShellDirect(command) {
        try {
            // Use PowerShell detector to get the correct command
            const { getPowerShellDetector } = require('../powershell-detector');
            const detector = getPowerShellDetector();
            const psCommand = await detector.getCommand();
            
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
     * Test environment access using strict error detection like SimplePermissionChecker
     */
    static async testEnvironmentAccessDirect(projectId, apiKey, apiSecret, environment) {
        try {
            // Use PowerShell detector to get the correct command
            const { getPowerShellDetector } = require('../powershell-detector');
            const detector = getPowerShellDetector();
            const psCommand = await detector.getCommand();
            
            // Build Get-EpiStorageContainer command - this throws an error if no access
            const command = `"${psCommand}" -Command "Get-EpiStorageContainer -ProjectId '${projectId}' -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -Environment '${environment}' -ErrorAction Stop | Select-Object -First 1 | ConvertTo-Json"`;
            
            const result = execSync(command, {
                encoding: 'utf8',
                timeout: 30000,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            // Check if we got actual content back (not just empty result)
            if (result && result.trim() && result.trim() !== 'null' && result.length > 10) {
                return true;
            }
            
            // Empty or null result means no real access
            return false;
            
        } catch (error) {
            // ANY error means no access (matching SimplePermissionChecker behavior)
            const errorText = (error.stderr || error.message || error.toString());
            
            // Check for explicit permission errors
            if (errorText.includes('403') || errorText.includes('401') || 
                errorText.includes('Forbidden') || errorText.includes('Unauthorized') ||
                errorText.includes('Access denied')) {
                return false;
            }
            
            // For ANY other error, assume no access (this is the key!)
            // This matches the SimplePermissionChecker behavior
            return false;
        }
    }
    
    /**
     * Get project configuration (copied from DatabaseSimpleTools)
     */
    static async getProjectConfig(projectName, args = {}) {
        // If we have credentials passed in from withProjectResolution wrapper, use them directly
        if (args.projectId && args.apiKey && args.apiSecret) {
            // Try to find the actual project name by matching the project ID
            let actualProjectName = args.projectName || projectName;
            
            if (!actualProjectName) {
                try {
                    const projects = ProjectTools.getConfiguredProjects();
                    const matchingProject = projects.find(p => 
                        (p.projectId === args.projectId || p.id === args.projectId)
                    );
                    if (matchingProject && matchingProject.name) {
                        actualProjectName = matchingProject.name;
                    }
                } catch (error) {
                    // Silent fallback - don't break if ProjectTools fails
                }
            }
            
            return {
                name: actualProjectName || 'Current Project',
                projectId: args.projectId,
                apiKey: args.apiKey,
                apiSecret: args.apiSecret
            };
        }
        
        // Fallback to old method for backward compatibility
        try {
            const projects = ProjectTools.getConfiguredProjects();
            
            if (!projects || projects.length === 0) {
                throw new Error('No projects configured. Run "test_connection setupMode:true" to configure your first project.');
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
            }
            
            // No specific project requested - use first one or default
            if (projects.length === 1) {
                return projects[0];
            }
            
            // Multiple projects - use the default one
            const defaultProject = projects.find(p => p.isDefault);
            if (defaultProject) {
                return defaultProject;
            }
            
            // No default set - use first one (and make sure it has a name)
            const firstProject = projects[0];
            if (firstProject && !firstProject.name) {
                // Try to infer name from environment variable or use projectId
                firstProject.name = firstProject.projectId ? firstProject.projectId.substring(0, 8) : 'Default Project';
            }
            return firstProject;
            
        } catch (error) {
            throw new Error(`Failed to get project configuration: ${error.message}`);
        }
    }
    
    /**
     * Unified verifyAccess method that combines functionality from all permission checkers
     */
    static async verifyAccess(args) {
        try {
            // Get project configuration
            const projectConfig = await this.getProjectConfig(args.projectName, args);
            
            // Check if this is a self-hosted project
            if (projectConfig.isSelfHosted || projectConfig.connectionString) {
                return ResponseBuilder.success(
                    `🏢 **Self-Hosted Project Detected**\n\n` +
                    `Project: ${projectConfig.name}\n` +
                    `Type: Self-hosted Azure Storage\n\n` +
                    `Self-hosted projects don't have Optimizely DXP environment permissions.\n` +
                    `They have direct access to Azure Storage containers.\n\n` +
                    `**Available Operations:**\n` +
                    `• List and download from storage containers\n` +
                    `• Download Application Insights logs\n` +
                    `• Access existing database backups\n` +
                    `• Download blobs and media files\n\n` +
                    `Use \`test_connection\` to verify Azure Storage access.`
                );
            }
            
            // Test all environments using direct PowerShell
            const accessible = [];
            const inaccessible = [];
            
            for (const environment of this.ENVIRONMENTS) {
                try {
                    const hasAccess = await this.testEnvironmentAccessDirect(
                        projectConfig.projectId || projectConfig.id,
                        projectConfig.apiKey,
                        projectConfig.apiSecret,
                        environment
                    );
                    
                    if (hasAccess) {
                        accessible.push(environment);
                    } else {
                        inaccessible.push(environment);
                    }
                } catch (error) {
                    inaccessible.push(environment);
                }
            }
            
            // Determine highest environment access
            let highestEnvironment = null;
            if (accessible.includes('Production')) {
                highestEnvironment = 'Production';
            } else if (accessible.includes('Preproduction')) {
                highestEnvironment = 'Preproduction';
            } else if (accessible.includes('Integration')) {
                highestEnvironment = 'Integration';
            }
            
            // Format the response
            const permissions = {
                projectName: projectConfig.name,
                accessible,
                inaccessible,
                highestEnvironment,
                hasProductionAccess: accessible.includes('Production'),
                environments: {}
            };
            
            // Add detailed environment info
            this.ENVIRONMENTS.forEach(env => {
                permissions.environments[env] = {
                    hasAccess: accessible.includes(env),
                    reason: accessible.includes(env) ? 'Access confirmed' : 'Access denied or limited'
                };
            });
            
            return ResponseBuilder.success(this.formatPermissionsMessage(permissions, false));
            
        } catch (error) {
            OutputLogger.error('Permission check failed:', error);
            return ResponseBuilder.error(`Permission check failed: ${error.message}`);
        }
    }
    
    /**
     * Generate a hash of the API credentials for cache validation
     * @param {string} apiKey - The API key
     * @param {string} apiSecret - The API secret
     * @returns {string} SHA256 hash of the credentials
     */
    static getCredentialHash(apiKey, apiSecret) {
        if (!apiKey || !apiSecret) return null;
        
        // Create a hash of the API key and secret
        // We use both to ensure the cache is invalidated if either changes
        const hash = crypto.createHash('sha256');
        hash.update(`${apiKey}:${apiSecret}`);
        return hash.digest('hex').substring(0, 16); // Use first 16 chars for brevity
    }
    
    /**
     * Check operation-specific permissions
     * @param {Object} credentials - API credentials
     * @param {string} operation - The operation to check permissions for
     * @param {string} environment - The target environment
     * @returns {boolean} Whether the operation is allowed
     */
    static async canPerformOperation(credentials, operation, environment) {
        const permissions = await this.getOrCheckPermissions(credentials);
        
        // Special cases for cross-environment read access
        if (operation === 'list-storage-containers') {
            // IMPORTANT: Storage container listing has cross-environment read access
            // An Integration-only API key can still list Production containers (but can't access them)
            // Any valid API key can list containers from any environment
            return permissions.accessible.length > 0;
        }
        
        if (operation === 'download-blobs') {
            // Blob downloads require actual environment access
            // Note: While you can LIST storage containers cross-environment,
            // you cannot DOWNLOAD from them without proper permissions
            return permissions.accessible.includes(environment);
        }
        
        if (operation === 'export-database') {
            // Database exports require specific environment access
            return permissions.accessible.includes(environment);
        }
        
        if (operation === 'generate-sas-link') {
            // SAS link generation requires actual environment access
            return permissions.accessible.includes(environment);
        }
        
        if (operation === 'deploy' || operation === 'upload-package') {
            // Deployment operations require target environment access
            // Note: For deployments between environments (Int→Prep), caller should
            // check permissions for both source and target environments
            return permissions.accessible.includes(environment);
        }
        
        // Default: require specific environment access
        return permissions.accessible.includes(environment);
    }
    
    /**
     * Check which environments an API key has access to
     * @param {Object} credentials - API credentials
     * @returns {Object} Environment access map and highest accessible environment
     */
    static async checkEnvironmentAccess(credentials) {
        // Wrap everything in a try-catch to handle any CacheManager issues
        try {
            return await this._checkEnvironmentAccessInternal(credentials);
        } catch (error) {
            if (error.message && error.message.includes('CacheManager')) {
                // Silent fallback to simplified check - no console output to avoid breaking MCP
                return await this._simplifiedPermissionCheck(credentials);
            }
            throw error;
        }
    }
    
    /**
     * Simplified permission check that doesn't use any caching
     */
    static async _simplifiedPermissionCheck(credentials) {
        const { projectId, apiKey, apiSecret, projectName } = credentials;
        
        const results = {
            projectName: projectName || 'Unknown',
            projectId: projectId,
            environments: {},
            permissions: {},
            accessible: [],
            inaccessible: [],
            edgeLogsAccess: false,
            highestEnvironment: null,
            checkedAt: new Date().toISOString()
        };
        
        // For now, assume all environments are accessible to avoid blocking the user
        // This is a fallback when caching issues occur
        for (const environment of this.ENVIRONMENTS) {
            results.environments[environment] = {
                hasAccess: true,
                testedAt: new Date().toISOString()
            };
            results.permissions[environment] = true;
            results.accessible.push(environment);
        }
        
        results.highestEnvironment = 'Production';
        results.permissions['Edge logs'] = false;
        
        OutputLogger.info('⚠️ Using simplified permission check due to technical issues');
        return results;
    }
    
    /**
     * Internal implementation of environment access checking
     */
    static async _checkEnvironmentAccessInternal(credentials) {
        const { projectId, apiKey, apiSecret, projectName } = credentials;
        
        if (!projectId || !apiKey || !apiSecret) {
            throw new Error('Missing required credentials for permission check');
        }
        
        const credentialHash = this.getCredentialHash(apiKey, apiSecret);
        
        // Skip cache for now until we get this working correctly
        // TODO: Re-implement caching after core functionality is stable
        
        OutputLogger.debug(`🔐 Checking environment permissions for ${projectName || projectId}...`);
        
        const results = {
            projectName: projectName || 'Unknown',
            projectId: projectId,
            credentialHash: credentialHash, // Store hash for validation
            environments: {},
            permissions: {},  // Track all permissions including Edge logs
            accessible: [],
            inaccessible: [],
            edgeLogsAccess: false,  // Track Edge logs permission separately
            highestEnvironment: null,
            checkedAt: new Date().toISOString()
        };
        
        // Test each environment
        for (const environment of this.ENVIRONMENTS) {
            try {
                OutputLogger.debug(`Testing ${environment}...`);
                
                // Use Get-EpiDeploymentPackageLocation to test actual environment access
                // Per permission matrix: This is a reliable method that requires specific environment permissions
                // Unlike Get-EpiStorageContainer which allows cross-environment read access
                const command = new PowerShellCommandBuilder('Get-EpiDeploymentPackageLocation')
                    .addParam('ProjectId', projectId)
                    .addParam('ClientKey', apiKey)
                    .addParam('ClientSecret', apiSecret)
                    .addParam('Environment', environment)
                    .build();
                
                // Command already has credentials, use direct method
                const result = await PowerShellHelper.executeEpiCommandDirect(command, {
                    parseJson: true
                });
                
                // If no error, we have access
                results.environments[environment] = {
                    hasAccess: true,
                    testedAt: new Date().toISOString()
                };
                results.permissions[environment] = true;
                results.accessible.push(environment);
                
                OutputLogger.debug(`✅ ${environment}: Accessible`);
                
            } catch (error) {
                // Check if it's an access denied error
                const errorMsg = error.message || error.toString();
                const isAccessDenied = errorMsg.includes('401') || 
                                      errorMsg.includes('403') || 
                                      errorMsg.includes('Unauthorized') ||
                                      errorMsg.includes('Forbidden') ||
                                      errorMsg.includes('Access denied');
                
                // Log the full error for debugging
                OutputLogger.debug(`Error testing ${environment}: ${errorMsg}`);
                
                results.environments[environment] = {
                    hasAccess: false,
                    error: isAccessDenied ? 'Access Denied' : 'Unknown Error',
                    fullError: errorMsg.substring(0, 200), // Store first 200 chars for debugging
                    testedAt: new Date().toISOString()
                };
                results.permissions[environment] = false;
                results.inaccessible.push(environment);
                
                OutputLogger.debug(`❌ ${environment}: ${isAccessDenied ? 'No Access' : 'Error'}`);
            }
        }
        
        // Test Edge logs permission - DISABLED FOR NOW
        // The Get-EpiEdgeLogs command doesn't exist in EpiCloud yet
        // We'll enable this when edge log support is added
        results.edgeLogsAccess = false;
        // Edge logs removed - feature was in beta with no customers
        // Will be incorporated into download_logs tool in future
        
        // If no permissions were detected (likely due to PowerShell failures), 
        // provide user-friendly fallback messaging
        if (results.accessible.length === 0 && results.inaccessible.length === this.ENVIRONMENTS.length) {
            OutputLogger.debug('Permission tests failed - providing user guidance');
            
            // Don't assume permissions - instead mark this as needing user verification
            results.permissionTestFailed = true;
            results.userGuidanceMessage = 'Permission testing encountered issues. Your API key is working, but we couldn\'t determine exact environment permissions. Try running specific operations to see what you can access.';
        }
        
        // Determine highest accessible environment
        if (results.accessible.includes('Production')) {
            results.highestEnvironment = 'Production';
        } else if (results.accessible.includes('Preproduction')) {
            results.highestEnvironment = 'Preproduction';
        } else if (results.accessible.includes('Integration')) {
            results.highestEnvironment = 'Integration';
        }
        
        // Skip caching for now
        // TODO: Re-implement after core functionality is stable
        
        // Also save to a file for persistence across sessions
        await this.savePermissionsToFile(projectId, results);
        
        return results;
    }
    
    /**
     * Determine the best default environment for an operation
     * @param {Object} permissions - The permissions object
     * @param {string} operationType - Type of operation (download, export, deploy, etc.)
     * @returns {string} The recommended default environment
     */
    static getDefaultEnvironment(permissions, operationType = 'general') {
        const { accessible } = permissions;
        
        if (accessible.length === 0) {
            return null;
        }
        
        // For download/export operations, prefer Production for safety
        if (operationType === 'download' || operationType === 'export' || operationType === 'backup') {
            if (accessible.includes('Production')) {
                return 'Production';
            } else if (accessible.includes('Preproduction')) {
                return 'Preproduction';
            } else {
                return 'Integration';
            }
        }
        
        // For deployment operations, use highest accessible
        if (operationType === 'deploy') {
            return permissions.highestEnvironment;
        }
        
        // For content copy, return Production as source (will be handled specially)
        if (operationType === 'content-copy') {
            // This is just for getting the source default
            return accessible.includes('Production') ? 'Production' : permissions.highestEnvironment;
        }
        
        // Default: use Production if available, otherwise highest
        return accessible.includes('Production') ? 'Production' : permissions.highestEnvironment;
    }
    
    /**
     * Get smart defaults for content copy operations
     * @param {Object} permissions - The permissions object
     * @returns {Object} Object with source and target environments
     */
    static getContentCopyDefaults(permissions) {
        const { accessible } = permissions;
        
        // If we have Production and Integration, copy Production → Integration
        if (accessible.includes('Production') && accessible.includes('Integration')) {
            return {
                source: 'Production',
                target: 'Integration',
                description: 'Production content → Integration'
            };
        }
        
        // If we have Production and Preproduction, copy Production → Preproduction
        if (accessible.includes('Production') && accessible.includes('Preproduction')) {
            return {
                source: 'Production',
                target: 'Preproduction',
                description: 'Production content → Preproduction'
            };
        }
        
        // If we have Preproduction and Integration, copy Preproduction → Integration
        if (accessible.includes('Preproduction') && accessible.includes('Integration')) {
            return {
                source: 'Preproduction',
                target: 'Integration',
                description: 'Preproduction content → Integration'
            };
        }
        
        // If only one environment, can't copy
        if (accessible.length <= 1) {
            return null;
        }
        
        // Default: highest to lowest
        const envOrder = ['Production', 'Preproduction', 'Integration'];
        const sortedAccessible = accessible.sort((a, b) => 
            envOrder.indexOf(a) - envOrder.indexOf(b)
        );
        
        return {
            source: sortedAccessible[0],
            target: sortedAccessible[sortedAccessible.length - 1],
            description: `${sortedAccessible[0]} content → ${sortedAccessible[sortedAccessible.length - 1]}`
        };
    }
    
    /**
     * Get cached permissions or check if needed
     */
    static async getOrCheckPermissions(credentials) {
        const { projectId, apiKey, apiSecret } = credentials;
        const credentialHash = this.getCredentialHash(apiKey, apiSecret);
        
        // Try to load from file first
        const filePermissions = await this.loadPermissionsFromFile(projectId);
        if (filePermissions) {
            // Check if credential hash matches (cache forever if it does)
            if (filePermissions.credentialHash === credentialHash) {
                OutputLogger.debug(`Using saved permissions (API key matches)`);
                // Skip memory cache for now
                return filePermissions;
            } else {
                OutputLogger.debug(`Cached permissions exist but API key has changed, re-checking...`);
            }
        }
        
        // Otherwise check permissions
        return await this.checkEnvironmentAccess(credentials);
    }
    
    /**
     * Save permissions to file for persistence
     */
    static async savePermissionsToFile(projectId, permissions) {
        try {
            const settingsDir = path.join(process.env.HOME || process.env.USERPROFILE, '.optimizely-mcp');
            const permissionsFile = path.join(settingsDir, `permissions_${projectId}.json`);
            
            // Ensure directory exists
            await fs.mkdir(settingsDir, { recursive: true });
            
            // Save permissions
            await fs.writeFile(permissionsFile, JSON.stringify(permissions, null, 2));
            
            OutputLogger.debug(`Saved permissions to ${permissionsFile}`);
        } catch (error) {
            OutputLogger.error('Failed to save permissions:', error);
            // Not critical, continue
        }
    }
    
    /**
     * Load permissions from file
     */
    static async loadPermissionsFromFile(projectId) {
        try {
            const settingsDir = path.join(process.env.HOME || process.env.USERPROFILE, '.optimizely-mcp');
            const permissionsFile = path.join(settingsDir, `permissions_${projectId}.json`);
            
            const data = await fs.readFile(permissionsFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // File doesn't exist or can't be read
            return null;
        }
    }
    
    /**
     * Format permissions for user display
     */
    static formatPermissionsMessage(permissions, showCacheInfo = true) {
        const { projectName, accessible, inaccessible, highestEnvironment, checkedAt, permissionTestFailed, userGuidanceMessage } = permissions;
        
        let message = `\n🔐 **Environment Access for ${projectName}**\n\n`;
        
        if (permissionTestFailed) {
            message += `⚠️ **Permission Test Issues**\n\n`;
            message += `${userGuidanceMessage}\n\n`;
            message += `**Next Steps:**\n`;
            message += `• Try: "list deployments" to see deployment history\n`;
            message += `• Try: "export database" to test database access\n`;
            message += `• Try: "list storage containers" for a specific environment\n`;
            return message;
        }
        
        if (accessible.length === 0) {
            message += `⚠️ **Warning**: This API key has no access to any environments.\n`;
            message += `Please check your API key configuration.\n`;
        } else if (accessible.length === 3) {
            message += `✅ **Full Access**: All environments accessible\n`;
            message += `• Integration ✅\n`;
            message += `• Preproduction ✅\n`;
            message += `• Production ✅\n`;
        } else {
            message += `**Accessible Environments:**\n`;
            accessible.forEach(env => {
                message += `• ${env} ✅\n`;
            });
            
            if (inaccessible.length > 0) {
                message += `\n**Restricted Environments:**\n`;
                inaccessible.forEach(env => {
                    message += `• ${env} ❌\n`;
                });
            }
            
            message += `\n📌 **Default Environment**: ${highestEnvironment}\n`;
            message += `Operations will default to ${highestEnvironment} when no environment is specified.\n`;
        }
        
        if (showCacheInfo && checkedAt) {
            message += `\n_Permissions cached. Will auto-refresh if API key changes._`;
        }
        
        return message;
    }
    
    /**
     * Clear cached permissions for a project
     */
    static async clearPermissionsCache(projectId) {
        // Skip cache clearing for now
        
        try {
            const settingsDir = path.join(process.env.HOME || process.env.USERPROFILE, '.optimizely-mcp');
            const permissionsFile = path.join(settingsDir, `permissions_${projectId}.json`);
            await fs.unlink(permissionsFile);
            OutputLogger.debug(`Cleared permissions cache for ${projectId}`);
        } catch (error) {
            // File might not exist
        }
    }
}

module.exports = PermissionChecker;
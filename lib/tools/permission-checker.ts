/**
 * Permission Checker - Tests and caches API key permissions across environments
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import OutputLogger from '../output-logger';
import ResponseBuilder from '../response-builder';
import ProjectTools from './project-tools';
import DXPRestClient from '../dxp-rest-client';

/**
 * API credentials structure
 */
interface Credentials {
    projectId?: string;
    apiKey?: string;
    apiSecret?: string;
    projectName?: string;
    isSelfHosted?: boolean;
    connectionString?: string;
    id?: string;
}

/**
 * Environment access details
 */
interface EnvironmentAccess {
    hasAccess: boolean;
    testedAt: string;
    error?: string;
    fullError?: string;
}

/**
 * Permission check result
 */
interface PermissionResult {
    projectName: string;
    projectId?: string;
    credentialHash?: string;
    environments: Record<string, EnvironmentAccess>;
    permissions: Record<string, boolean>;
    accessible: string[];
    inaccessible: string[];
    edgeLogsAccess: boolean;
    highestEnvironment: string | null;
    checkedAt: string;
    permissionTestFailed?: boolean;
    userGuidanceMessage?: string;
    hasProductionAccess?: boolean;
}

/**
 * Project configuration
 */
interface ProjectConfig {
    name: string;
    projectId?: string;
    apiKey?: string;
    apiSecret?: string;
    isSelfHosted?: boolean;
    connectionString?: string;
    id?: string;
    isDefault?: boolean;
}

/**
 * Content copy defaults
 */
interface ContentCopyDefaults {
    source: string;
    target: string;
    description: string;
}

/**
 * REST API test options
 */
interface TestOptions {
    timeout?: number;
}

class PermissionChecker {
    static ENVIRONMENTS = ['Integration', 'Preproduction', 'Production'];
    static PERMISSIONS = ['Edge logs', 'Integration', 'Preproduction', 'Production'];  // All 4 permissions from DXP portal

    /**
     * Safe wrapper for getOrCheckPermissions that handles any potential caching issues
     */
    static async getOrCheckPermissionsSafe(credentials: Credentials): Promise<PermissionResult> {
        try {
            return await this.getOrCheckPermissions(credentials);
        } catch (error: any) {
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
     * DXP-101: DISABLED - No longer used after REST API migration
     * @deprecated Replaced by DXPRestClient.testEnvironmentAccess()
     */
    /* DISABLED - PowerShell dependency removed
    static async executePowerShellDirect(command: string): Promise<string> {
        try {
            // Use PowerShell detector to get the correct command
            const { getPowerShellDetector } = require('../powershell-detector');
            const detector = getPowerShellDetector();
            const psCommand = await detector.getCommand();

            // Execute directly
            const result = execSync(`${psCommand} -Command "${command.replace(/"/g, '`"')}"`, {
                encoding: 'utf8',
                timeout: 10000, // 10 second timeout (n8n MCP Client Tool has 120s total timeout)
                stdio: ['pipe', 'pipe', 'pipe']
            });

            return result;

        } catch (error: any) {
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
    */ // End DISABLED executePowerShellDirect

    /**
     * Test environment access using REST API (no PowerShell required!)
     * Replaces PowerShell-based implementation with direct API calls
     */
    static async testEnvironmentAccessDirect(
        projectId: string,
        apiKey: string,
        apiSecret: string,
        environment: string,
        options: TestOptions = {}
    ): Promise<boolean> {
        try {
            // Use DXP REST API client - no PowerShell needed!
            return await DXPRestClient.testEnvironmentAccess(
                projectId,
                apiKey,
                apiSecret,
                environment,
                options  // Pass timeout and other options through
            );
        } catch (error: any) {
            // Log error for debugging
            OutputLogger.debug(`Environment access test failed for ${environment}: ${error.message}`);
            return false;
        }
    }

    /**
     * Get project configuration (copied from DatabaseSimpleTools)
     */
    static async getProjectConfig(projectName?: string, args: any = {}): Promise<ProjectConfig> {
        // If we have credentials passed in from withProjectResolution wrapper, use them directly
        if (args.projectId && args.apiKey && args.apiSecret) {
            // Try to find the actual project name by matching the project ID
            let actualProjectName = args.projectName || projectName;

            if (!actualProjectName) {
                try {
                    const projects = ProjectTools.getConfiguredProjects();
                    const matchingProject = projects.find((p: any) =>
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
                const project = projects.find((p: any) =>
                    p.name && p.name.toLowerCase() === projectName.toLowerCase()
                );

                if (!project) {
                    const availableNames = projects.map((p: any) => p.name).filter(Boolean).join(', ') || 'None';
                    throw new Error(`Project "${projectName}" not found. Available: ${availableNames}`);
                }

                return project;
            }

            // No specific project requested - use first one or default
            if (projects.length === 1) {
                return projects[0];
            }

            // Multiple projects - use the default one
            const defaultProject = projects.find((p: any) => p.isDefault);
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

        } catch (error: any) {
            throw new Error(`Failed to get project configuration: ${error.message}`);
        }
    }

    /**
     * Unified verifyAccess method that combines functionality from all permission checkers
     */
    static async verifyAccess(args: any): Promise<any> {
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

            // Test all environments using direct REST API
            const accessible: string[] = [];
            const inaccessible: string[] = [];

            for (const environment of this.ENVIRONMENTS) {
                try {
                    const hasAccess = await this.testEnvironmentAccessDirect(
                        projectConfig.projectId || projectConfig.id || '',
                        projectConfig.apiKey || '',
                        projectConfig.apiSecret || '',
                        environment,
                        { timeout: 5000 }  // 5 second timeout per environment (3 envs = ~15s total)
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
            let highestEnvironment: string | null = null;
            if (accessible.includes('Production')) {
                highestEnvironment = 'Production';
            } else if (accessible.includes('Preproduction')) {
                highestEnvironment = 'Preproduction';
            } else if (accessible.includes('Integration')) {
                highestEnvironment = 'Integration';
            }

            // Format the response
            const permissions: Partial<PermissionResult> = {
                projectName: projectConfig.name,
                accessible,
                inaccessible,
                highestEnvironment,
                hasProductionAccess: accessible.includes('Production'),
                environments: {}
            };

            // Add detailed environment info
            this.ENVIRONMENTS.forEach(env => {
                permissions.environments![env] = {
                    hasAccess: accessible.includes(env),
                    testedAt: new Date().toISOString()
                } as any;
            });

            return ResponseBuilder.success(this.formatPermissionsMessage(permissions as PermissionResult, false));

        } catch (error: any) {
            OutputLogger.error(`Permission check failed: ${error}`);
            return ResponseBuilder.error(`Permission check failed: ${error.message}`);
        }
    }

    /**
     * Generate a hash of the API credentials for cache validation
     * @param apiKey - The API key
     * @param apiSecret - The API secret
     * @returns SHA256 hash of the credentials
     */
    static getCredentialHash(apiKey?: string, apiSecret?: string): string | null {
        if (!apiKey || !apiSecret) return null;

        // Create a hash of the API key and secret
        // We use both to ensure the cache is invalidated if either changes
        const hash = crypto.createHash('sha256');
        hash.update(`${apiKey}:${apiSecret}`);
        return hash.digest('hex').substring(0, 16); // Use first 16 chars for brevity
    }

    /**
     * Check operation-specific permissions
     * @param credentials - API credentials
     * @param operation - The operation to check permissions for
     * @param environment - The target environment
     * @returns Whether the operation is allowed
     */
    static async canPerformOperation(credentials: Credentials, operation: string, environment: string): Promise<boolean> {
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
     * @param credentials - API credentials
     * @returns Environment access map and highest accessible environment
     */
    static async checkEnvironmentAccess(credentials: Credentials): Promise<PermissionResult> {
        // Wrap everything in a try-catch to handle any CacheManager issues
        try {
            return await this._checkEnvironmentAccessInternal(credentials);
        } catch (error: any) {
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
    static async _simplifiedPermissionCheck(credentials: Credentials): Promise<PermissionResult> {
        const { projectId, projectName } = credentials;

        const results: PermissionResult = {
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
    static async _checkEnvironmentAccessInternal(credentials: Credentials): Promise<PermissionResult> {
        const { projectId, apiKey, apiSecret, projectName } = credentials;

        if (!projectId || !apiKey || !apiSecret) {
            throw new Error('Missing required credentials for permission check');
        }

        const credentialHash = this.getCredentialHash(apiKey, apiSecret);

        // Skip cache for now until we get this working correctly
        // TODO: Re-implement caching after core functionality is stable

        OutputLogger.debug(`🔐 Checking environment permissions for ${projectName || projectId}...`);

        const results: PermissionResult = {
            projectName: projectName || 'Unknown',
            projectId: projectId,
            credentialHash: credentialHash || undefined,
            environments: {},
            permissions: {},  // Track all permissions including Edge logs
            accessible: [],
            inaccessible: [],
            edgeLogsAccess: false,  // Track Edge logs permission separately
            highestEnvironment: null,
            checkedAt: new Date().toISOString()
        };

        // Test each environment using REST API (no PowerShell!)
        for (const environment of this.ENVIRONMENTS) {
            try {
                OutputLogger.debug(`Testing ${environment}...`);

                // Use REST API to test environment access (5s timeout per environment)
                const hasAccess = await DXPRestClient.testEnvironmentAccess(
                    projectId,
                    apiKey,
                    apiSecret,
                    environment,
                    { timeout: 5000 }  // 5 second timeout (3 envs = ~15s total, well under n8n's 120s limit)
                );

                if (hasAccess) {
                    results.environments[environment] = {
                        hasAccess: true,
                        testedAt: new Date().toISOString()
                    };
                    results.permissions[environment] = true;
                    results.accessible.push(environment);
                    OutputLogger.debug(`✅ ${environment}: Accessible`);
                } else {
                    results.environments[environment] = {
                        hasAccess: false,
                        error: 'Access Denied',
                        testedAt: new Date().toISOString()
                    };
                    results.permissions[environment] = false;
                    results.inaccessible.push(environment);
                    OutputLogger.debug(`❌ ${environment}: No Access`);
                }

            } catch (error: any) {
                // Any error means no access
                const errorMsg = error.message || error.toString();
                OutputLogger.debug(`Error testing ${environment}: ${errorMsg}`);

                results.environments[environment] = {
                    hasAccess: false,
                    error: 'Access Denied',
                    fullError: errorMsg.substring(0, 200),
                    testedAt: new Date().toISOString()
                };
                results.permissions[environment] = false;
                results.inaccessible.push(environment);
                OutputLogger.debug(`❌ ${environment}: Error`);
            }
        }

        // Test Edge logs permission - DISABLED FOR NOW
        // The Get-EpiEdgeLogs command doesn't exist in EpiCloud yet
        // We'll enable this when edge log support is added
        results.edgeLogsAccess = false;
        // Edge logs removed - feature was in beta with no customers
        // Will be incorporated into download_logs tool in future

        // If no permissions were detected (likely due to API/network failures),
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
     * @param permissions - The permissions object
     * @param operationType - Type of operation (download, export, deploy, etc.)
     * @returns The recommended default environment
     */
    static getDefaultEnvironment(permissions: PermissionResult, operationType: string = 'general'): string | null {
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
     * @param permissions - The permissions object
     * @returns Object with source and target environments
     */
    static getContentCopyDefaults(permissions: PermissionResult): ContentCopyDefaults | null {
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
    static async getOrCheckPermissions(credentials: Credentials): Promise<PermissionResult> {
        const { projectId, apiKey, apiSecret } = credentials;
        const credentialHash = this.getCredentialHash(apiKey, apiSecret);

        // Try to load from file first
        const filePermissions = await this.loadPermissionsFromFile(projectId || '');
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
    static async savePermissionsToFile(projectId: string, permissions: PermissionResult): Promise<void> {
        try {
            const settingsDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.optimizely-mcp');
            const permissionsFile = path.join(settingsDir, `permissions_${projectId}.json`);

            // Ensure directory exists
            await fs.mkdir(settingsDir, { recursive: true });

            // Save permissions
            await fs.writeFile(permissionsFile, JSON.stringify(permissions, null, 2));

            OutputLogger.debug(`Saved permissions to ${permissionsFile}`);
        } catch (error: any) {
            OutputLogger.error(`Failed to save permissions: ${error}`);
            // Not critical, continue
        }
    }

    /**
     * Load permissions from file
     */
    static async loadPermissionsFromFile(projectId: string): Promise<PermissionResult | null> {
        try {
            const settingsDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.optimizely-mcp');
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
    static formatPermissionsMessage(permissions: PermissionResult, showCacheInfo: boolean = true): string {
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
    static async clearPermissionsCache(projectId: string): Promise<void> {
        // Skip cache clearing for now

        try {
            const settingsDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.optimizely-mcp');
            const permissionsFile = path.join(settingsDir, `permissions_${projectId}.json`);
            await fs.unlink(permissionsFile);
            OutputLogger.debug(`Cleared permissions cache for ${projectId}`);
        } catch (error) {
            // File might not exist
        }
    }
}

export default PermissionChecker;

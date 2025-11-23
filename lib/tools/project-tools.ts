/**
 * Project Management Tools
 * Handles multi-project configuration and switching
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import ResponseBuilder from '../response-builder';
import SecurityHelper from '../security-helper';
import Config from '../config';
import OutputLogger from '../output-logger';

/**
 * Project configuration
 */
interface ProjectConfig {
    name: string;
    projectId: string;
    apiKey?: string;
    apiSecret?: string;
    connectionString?: string;
    isSelfHosted?: boolean;
    isUnknown?: boolean;
    projectType?: string;
    needsConfiguration?: boolean;
    configurationHint?: string;
    environments?: string[];
    configSource?: string;
    blobPath?: string;
    logPath?: string;
    dbPath?: string;
    telemetry?: boolean;
    addedAt?: string;
    lastUsed?: string;
    lastUpdated?: string;
    originalName?: string;
    wasUnknown?: boolean;
    isDefault?: boolean;
}

/**
 * Configuration error
 */
interface ConfigError {
    project: string;
    error: string;
    variable: string;
    hint?: string;
    value?: string;
}

/**
 * Diagnostics result
 */
interface Diagnostics {
    valid: boolean;
    projectCount: number;
    hasDefault: boolean;
    errors: any[];
    warnings: any[];
    projects: ProjectDiag[];
}

/**
 * Project diagnostic
 */
interface ProjectDiag {
    name: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Switch project result
 */
interface SwitchResult {
    success: boolean;
    message: string;
    credentials: Credentials | null;
    project?: ProjectConfig;
}

/**
 * Credentials object
 */
interface Credentials {
    projectId: string | null;
    apiKey?: string | null;
    apiSecret?: string | null;
    name?: string | null;
    projectName?: string | null;
}

/**
 * Credentials resolution result
 */
interface CredentialsResult {
    success: boolean;
    message?: string;
    suggestion?: string;
    credentials?: Credentials;
    project?: ProjectConfig;
}

/**
 * Get/Update project arguments
 */
interface GetProjectArgs {
    projectName?: string;
    projectId?: string;
    apiKey?: string;
    apiSecret?: string;
    connectionString?: string;
    renameTo?: string;
}

/**
 * Update project arguments
 */
interface UpdateProjectArgs {
    projectName?: string;
    projectId?: string;
    renameTo?: string;
    apiKey?: string;
    apiSecret?: string;
    connectionString?: string;
    blobPath?: string;
    dbPath?: string;
    logPath?: string;
    makeDefault?: boolean;
}

/**
 * Debug info
 */
interface DebugInfo {
    totalRelevantVars: number;
    variables: { key: string; value: string }[];
}

class ProjectTools {
    // In-memory storage for dynamically added API key configurations (session only)
    static dynamicConfigurations: ProjectConfig[] = [];

    /**
     * Add or update an API key configuration dynamically (session only)
     */
    static addConfiguration(configInfo: ProjectConfig): ProjectConfig {
        // Check if configuration already exists by ID or name
        // Special handling: If upgrading from Unknown, match by name only
        const existingIndex = this.dynamicConfigurations.findIndex(c => {
            // Match by name (case-insensitive)
            const nameMatch = c.name.toLowerCase() === configInfo.name.toLowerCase();

            // If names match and one is Unknown being upgraded, that's a match
            if (nameMatch && (c.isUnknown || configInfo.wasUnknown)) {
                return true;
            }

            // Otherwise match by projectId or name
            return c.projectId === configInfo.projectId || c.name === configInfo.name;
        });

        if (existingIndex >= 0) {
            // Update existing configuration
            this.dynamicConfigurations[existingIndex] = {
                ...this.dynamicConfigurations[existingIndex],
                ...configInfo,
                lastUsed: new Date().toISOString()
            };
        } else {
            // Add new configuration
            this.dynamicConfigurations.push({
                ...configInfo,
                addedAt: new Date().toISOString(),
                lastUsed: new Date().toISOString()
            });
        }

        return configInfo;
    }

    /**
     * Parse API key configurations from environment and dynamic entries
     */
    static getConfiguredProjects(): ProjectConfig[] {
        // Dynamic configurations are kept in memory only for current session

        const projects: ProjectConfig[] = [];
        const configErrors: ConfigError[] = [];

        // Check ALL environment variables for our specific format
        // Any env var with format: "id=uuid;key=value;secret=value" is treated as an API key configuration
        // Examples:
        //   ACME="id=uuid;key=value;secret=value"
        //   PRODUCTION="id=uuid;key=value;secret=value"
        //   CLIENT_A_STAGING="id=uuid;key=value;secret=value"

        // DEBUG: Log all environment variables that contain our format
        const relevantEnvVars = Object.keys(process.env).filter(key => {
            const value = process.env[key];
            return value && typeof value === 'string' &&
                   ((value.includes('id=') && value.includes('key=') && value.includes('secret=')) ||
                    value.startsWith('DefaultEndpointsProtocol=') ||
                    ((value.includes('blobPath=') || value.includes('logPath=')) &&
                     !value.includes('id=') && !value.includes('key=') && !value.includes('secret=')));
        });
        OutputLogger.debug(`Checking environment variables...`);
        OutputLogger.debug(`Found ${relevantEnvVars.length} relevant env vars (DXP, self-hosted, and unknown):`, relevantEnvVars);

        Object.keys(process.env).forEach(key => {
            const value = process.env[key];

            // Skip if not a string
            if (typeof value !== 'string') {
                return;
            }

            // Check if empty string (placeholder project)
            // Only treat as project if name looks like a project name
            if (value === '') {
                // Skip if this doesn't look like a project name
                // Project names typically follow patterns like:
                // - "ACME-int", "CONTOSO-prod", "FABRIKAM-staging" (project-environment)
                // - "DEMO-self", "TEST-local" (project-type)
                // - Single short words like "zilch", "test", "demo"

                const hasProjectPattern =
                    // Pattern: WORD-env (like ACME-int, CONTOSO-prod)
                    key.match(/^[A-Z0-9]+-(?:int|prod|staging|test|dev|qa|uat|demo|local|self)$/i) ||
                    // Pattern: Short single word (max 10 chars)
                    (key.match(/^[A-Z0-9]+$/i) && key.length <= 10) ||
                    // Explicitly starts with common project prefixes
                    key.match(/^(?:TEST|DEMO|DEV|PROD|STAGING|QA)[-_]/i);

                if (!hasProjectPattern) {
                    return;
                }

                // Create Unknown placeholder project
                const projectName = key.replace(/_/g, ' ');
                const projectConfig: ProjectConfig = {
                    name: projectName,
                    projectId: `unknown-${projectName.toLowerCase().replace(/\s+/g, '-')}`,
                    isUnknown: true,
                    projectType: 'unknown',
                    needsConfiguration: true,
                    configurationHint: 'Empty project - add connectionString for self-hosted or id/key/secret for DXP',
                    environments: ['Unknown'],
                    configSource: 'environment'
                };
                projects.push(projectConfig);
                return;
            }

            // Check if this looks like our API key format OR a connection string OR self-hosted paths
            // Must contain either:
            // 1. DXP format: (id=, key=, secret=)
            // 2. Azure connection string: (DefaultEndpointsProtocol=)
            // 3. Self-hosted with paths only: (blobPath= or logPath=) but no id/key/secret
            const hasDxpFormat = value.includes('id=') && value.includes('key=') && value.includes('secret=');
            const hasConnectionString = value.startsWith('DefaultEndpointsProtocol=');
            const hasSelfHostedPaths = (value.includes('blobPath=') || value.includes('logPath=')) &&
                                       !value.includes('id=') && !value.includes('key=') && !value.includes('secret=');

            const hasCorrectFormat = hasDxpFormat || hasConnectionString || hasSelfHostedPaths;

            if (!hasCorrectFormat) {
                return;
            }

            // Use the environment variable name as the project name (underscores become spaces)
            const projectName = key.replace(/_/g, ' ');

            try {
                // Check if this is a raw Azure connection string (self-hosted mode)
                if (value.startsWith('DefaultEndpointsProtocol=')) {
                    // Extract connection string and any additional parameters
                    // Format: DefaultEndpointsProtocol=...;EndpointSuffix=core.windows.net;blobPath=/path;logPath=/path

                    // Find where the connection string ends (after EndpointSuffix)
                    const endpointMatch = value.match(/EndpointSuffix=[^;]+/);
                    let connectionString = value;
                    let additionalParams: Record<string, string> = {};

                    if (endpointMatch) {
                        const endIndex = value.indexOf(endpointMatch[0]) + endpointMatch[0].length;
                        connectionString = value.substring(0, endIndex);

                        // Parse any additional parameters after the connection string
                        const remaining = value.substring(endIndex);
                        if (remaining) {
                            const extraParts = remaining.split(';').filter(p => p.trim());
                            extraParts.forEach(part => {
                                const [key, val] = part.split('=');
                                if (key && val) {
                                    additionalParams[key] = val;
                                }
                            });
                        }
                    }

                    const projectConfig: ProjectConfig = {
                        name: projectName,
                        projectId: `self-hosted-${projectName.toLowerCase().replace(/\s+/g, '-')}`,
                        apiKey: '',
                        apiSecret: '',
                        connectionString: connectionString,
                        isSelfHosted: true,
                        environments: ['Production'], // Self-hosted typically has one environment
                        configSource: 'environment'
                    };

                    // Add optional paths if provided
                    if (additionalParams.blobPath) {
                        projectConfig.blobPath = additionalParams.blobPath;
                    }
                    if (additionalParams.logPath) {
                        projectConfig.logPath = additionalParams.logPath;
                    }
                    if (additionalParams.dbPath) {
                        projectConfig.dbPath = additionalParams.dbPath;
                    }

                    projects.push(projectConfig);
                    return;
                }

                // Otherwise parse semicolon-separated key=value pairs for DXP projects
                const params: Record<string, string> = {};
                const parts = value.split(';').filter(p => p.trim());

                if (parts.length === 0) {
                    // Empty configuration - treat as Unknown project placeholder
                    const projectConfig: ProjectConfig = {
                        name: projectName,
                        projectId: `unknown-${projectName.toLowerCase().replace(/\s+/g, '-')}`,
                        isUnknown: true,
                        projectType: 'unknown',
                        needsConfiguration: true,
                        configurationHint: 'Empty project - add connectionString for self-hosted or id/key/secret for DXP',
                        environments: ['Unknown'],
                        configSource: 'environment'
                    };
                    projects.push(projectConfig);
                    return;
                }

                parts.forEach(param => {
                    const equalIndex = param.indexOf('=');
                    if (equalIndex === -1) {
                        configErrors.push({
                            project: projectName,
                            error: `Invalid parameter format: "${param}" (expected key=value)`,
                            variable: key
                        });
                        return;
                    }

                    const paramKey = param.substring(0, equalIndex).trim();
                    const paramValue = param.substring(equalIndex + 1).trim();

                    if (!paramKey || !paramValue) {
                        configErrors.push({
                            project: projectName,
                            error: `Empty key or value in parameter: "${param}"`,
                            variable: key
                        });
                        return;
                    }

                    params[paramKey] = paramValue;
                });

                // Extract credentials using standard format
                let projectId = params.id;  // Changed to let to allow reassignment
                const apiKey = params.key;
                const apiSecret = params.secret;
                let connectionString = params.connectionString || params.connStr;

                // Check if this is a path-only project (has paths but no DXP credentials or connection string)
                const isPathOnlyProject = (params.blobPath || params.logPath || params.dbPath) &&
                                          !params.id && !params.key && !params.secret && !connectionString;

                // Determine project type and handle accordingly
                if (connectionString) {
                    // Self-hosted mode with connection string
                    if (!projectId) {
                        // Generate a simple ID from the project name
                        const projectIdBase = projectName.toLowerCase().replace(/\s+/g, '-');
                        projectId = `self-hosted-${projectIdBase}`;
                    }
                } else if (isPathOnlyProject) {
                    // Unknown type - has paths but no clear indication of type
                    if (!projectId) {
                        // Generate a simple ID from the project name
                        const projectIdBase = projectName.toLowerCase().replace(/\s+/g, '-');
                        projectId = `unknown-${projectIdBase}`;
                    }
                    OutputLogger.debug(`Unknown project type "${projectName}" configured with paths only`);
                } else if (!params.id || !params.key || !params.secret) {
                    // DXP mode - needs full API credentials
                    const missingFields: string[] = [];
                    if (!projectId) missingFields.push('id');
                    if (!apiKey) missingFields.push('key');
                    if (!apiSecret) missingFields.push('secret');

                    if (missingFields.length > 0) {
                        configErrors.push({
                            project: projectName,
                            error: `Missing required fields: ${missingFields.join(', ')}`,
                            variable: key,
                            hint: `Format: "id=<uuid>;key=<key>;secret=<secret>"`
                        });
                        return;
                    }
                }

                // Validate UUID format for project ID (skip for self-hosted and unknown)
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                const isSelfHostedId = projectId && projectId.startsWith('self-hosted-');
                const isUnknownId = projectId && projectId.startsWith('unknown-');
                if (!isSelfHostedId && !isUnknownId && !uuidRegex.test(projectId!)) {
                    configErrors.push({
                        project: projectName,
                        error: `Invalid project ID format: "${projectId}"`,
                        variable: key,
                        hint: `Project ID should be a UUID like: abc12345-1234-5678-9abc-def123456789`
                    });
                }

                // Validate environments if specified
                if (params.environments) {
                    const validEnvs = ['Integration', 'Preproduction', 'Production'];
                    const envs = params.environments.split(',').map(e => e.trim());
                    const invalidEnvs = envs.filter(e => !validEnvs.includes(e));

                    if (invalidEnvs.length > 0) {
                        configErrors.push({
                            project: projectName,
                            error: `Invalid environments: ${invalidEnvs.join(', ')}`,
                            variable: key,
                            hint: `Valid environments are: Integration, Preproduction, Production`
                        });
                    }
                }

                // Add project if validation passed
                const projectConfig: ProjectConfig = {
                    name: projectName,
                    projectId: projectId!,
                    apiKey: apiKey || '',
                    apiSecret: apiSecret || '',
                    environments: params.environments
                        ? params.environments.split(',').map(e => e.trim())
                        : ['Integration', 'Preproduction', 'Production'],
                    configSource: 'environment'
                };

                // Determine project type based on available credentials
                if (connectionString) {
                    // Self-hosted with connection string
                    projectConfig.connectionString = connectionString;
                    projectConfig.isSelfHosted = true;
                    projectConfig.projectType = 'self-hosted';
                } else if (isPathOnlyProject) {
                    // Unknown type - has paths but no credentials
                    projectConfig.isUnknown = true;
                    projectConfig.projectType = 'unknown';
                    projectConfig.needsConfiguration = true;
                    // For unknown projects, we need to guide users to add credentials
                    projectConfig.configurationHint = 'Add connectionString for self-hosted or id/key/secret for DXP';
                } else if (apiKey && apiSecret) {
                    // DXP PaaS project
                    projectConfig.projectType = 'dxp-paas';
                }

                // Add compact configuration fields if present
                if (params.blobPath) {
                    projectConfig.blobPath = params.blobPath;
                }
                if (params.dbPath) {
                    projectConfig.dbPath = params.dbPath;
                }
                if (params.logPath) {
                    projectConfig.logPath = params.logPath;
                }
                if (params.telemetry) {
                    projectConfig.telemetry = params.telemetry.toLowerCase() === 'true';
                }

                projects.push(projectConfig);

            } catch (error: any) {
                configErrors.push({
                    project: projectName,
                    error: `Failed to parse configuration: ${error.message}`,
                    variable: key
                });
            }
        });

        // Log configuration errors if any
        if (configErrors.length > 0) {
            console.error('\n⚠️  Configuration Errors Found:');
            configErrors.forEach(err => {
                console.error(`\n  Project: ${err.project}`);
                console.error(`  Variable: ${err.variable}`);
                console.error(`  Error: ${err.error}`);
                if (err.hint) {
                    console.error(`  Hint: ${err.hint}`);
                }
                if (err.value) {
                    console.error(`  Value: ${err.value.substring(0, 50)}...`);
                }
            });
            console.error('\n');
        }

        // Add dynamically added configurations
        this.dynamicConfigurations.forEach(dynConfig => {
            // Check if this dynamic config should replace an existing project
            const existingIndex = projects.findIndex(p => {
                // Match by original name (for renames)
                if (dynConfig.originalName && p.name === dynConfig.originalName) {
                    return true;
                }
                // Match by current name
                if (p.name === dynConfig.name || p.name.toLowerCase() === dynConfig.name.toLowerCase()) {
                    return true;
                }
                // Match by project ID
                if (p.projectId === dynConfig.projectId) {
                    return true;
                }
                return false;
            });

            if (existingIndex >= 0) {
                // Replace existing project with dynamic configuration (upgrade/rename scenario)
                projects[existingIndex] = dynConfig;
            } else if (!projects.find(p => p.projectId === dynConfig.projectId)) {
                // Only add if not already in list (avoid duplicates by ID)
                projects.push(dynConfig);
            }
        });

        // First project is always the default (simplified logic)

        // DEBUG: Log final projects found
        OutputLogger.debug('Final projects found:');
        projects.forEach((p, i) => {
            OutputLogger.debug(`  ${i + 1}. Name: "${p.name}", ID: ${p.projectId || 'undefined'}, Source: ${p.configSource || 'unknown'}`);
        });

        return projects;
    }

    /**
     * Get current active project
     */
    static getCurrentProject(projectId: string | null = null): ProjectConfig | null {
        const projects = this.getConfiguredProjects();

        // If projectId specified, find that project
        if (projectId) {
            const project = projects.find(p => p.projectId === projectId || p.name === projectId);
            if (project) return project;
        }

        // Check for last used project from switch_project
        const lastUsed = process.env.MCP_LAST_USED_PROJECT;
        if (lastUsed) {
            const project = projects.find(p =>
                p.name === lastUsed ||
                p.name.toLowerCase() === lastUsed.toLowerCase()
            );
            if (project) return project;
        }

        // Return first project as default
        return projects[0] || null;
    }

    /**
     * Validate project configuration and return diagnostic info
     */
    static validateConfiguration(): Diagnostics {
        const projects = this.getConfiguredProjects();
        const diagnostics: Diagnostics = {
            valid: true,
            projectCount: projects.length,
            hasDefault: false,
            errors: [],
            warnings: [],
            projects: []
        };

        // First project is always the default
        if (projects.length > 0) {
            diagnostics.hasDefault = true;
        }

        // Validate each project
        projects.forEach(project => {
            const projectDiag: ProjectDiag = {
                name: project.name,
                valid: true,
                errors: [],
                warnings: []
            };

            // Check credentials based on project type
            if (project.isUnknown) {
                // Unknown projects need configuration guidance
                projectDiag.warnings.push('Project type unknown - needs connection string (self-hosted) or API credentials (DXP)');
                projectDiag.warnings.push('Currently using local paths only');
                // Unknown projects are valid but need configuration for full functionality
                projectDiag.valid = true;
            } else if (project.isSelfHosted) {
                // Self-hosted projects use connection strings
                if (!project.connectionString || project.connectionString.length < 50) {
                    projectDiag.errors.push('Connection string appears invalid or too short');
                    projectDiag.valid = false;
                }
            } else {
                // DXP projects use API Key/Secret
                if (!project.apiKey || project.apiKey.length < 20) {
                    projectDiag.errors.push('API Key appears invalid or too short');
                    projectDiag.valid = false;
                }

                if (!project.apiSecret || project.apiSecret.length < 20) {
                    projectDiag.errors.push('API Secret appears invalid or too short');
                    projectDiag.valid = false;
                }

                // Check for common mistakes
                if (project.apiKey && (project.apiKey.includes('REPLACE_WITH') || project.apiKey.includes('PLACEHOLDER') || project.apiKey.includes('SAMPLE'))) {
                    projectDiag.errors.push('API Key is a placeholder value');
                    projectDiag.valid = false;
                }

                if (project.apiSecret && (project.apiSecret.includes('REPLACE_WITH') || project.apiSecret.includes('PLACEHOLDER') || project.apiSecret.includes('SAMPLE'))) {
                    projectDiag.errors.push('API Secret is a placeholder value');
                    projectDiag.valid = false;
                }
            }

            // Removed warning about environment names in project names
            // This is actually a valid use case - some organizations create
            // separate API keys per environment for security reasons

            if (projectDiag.errors.length > 0) {
                diagnostics.valid = false;
            }

            diagnostics.projects.push(projectDiag);
        });

        return diagnostics;
    }

    /**
     * Show the current project
     */
    static async showCurrentProject(): Promise<any> {
        try {
            // Check for last used project first (from switch_project)
            let currentProject: ProjectConfig | null = null;
            const lastUsed = process.env.MCP_LAST_USED_PROJECT;

            if (lastUsed) {
                const projects = this.getConfiguredProjects();
                currentProject = projects.find(p =>
                    p.name === lastUsed ||
                    p.name.toLowerCase() === lastUsed.toLowerCase()
                ) || null;
            }

            // Fall back to default (first project)
            if (!currentProject) {
                currentProject = this.getCurrentProject();
            }

            if (!currentProject) {
                return ResponseBuilder.error('No project currently selected');
            }

            let response = `📌 **Current Project: ${currentProject.name}**\n\n`;
            response += `• Project ID: ${currentProject.projectId}\n`;

            // Show project type
            if (currentProject.isSelfHosted) {
                response += `• Type: Self-hosted Azure\n`;
                response += `• Environment: Production\n`;
            } else if (currentProject.isUnknown) {
                response += `• Type: Unconfigured\n`;
                response += `• Status: Needs API credentials or connection string\n`;
            } else {
                response += `• Type: DXP PaaS\n`;
                response += `• Configured Environments: ${currentProject.environments ? currentProject.environments.join(', ') : 'N/A'}\n`;
                response += `• Note: Use \`test_connection\` to check actual permissions\n`;
            }

            response += `${currentProject.isDefault ? '• Default: Yes ⭐\n' : ''}`;

            return ResponseBuilder.success(response);
        } catch (error: any) {
            return ResponseBuilder.error(`Failed to get current project: ${error.message}`);
        }
    }

    /**
     * List all configured projects
     */
    static async listProjects(_args: any = {}): Promise<any> {
        try {
            // DXP-76-3: Add pagination support
            const { limit = 20, offset = 0 } = _args;

            // List all projects
            const allProjects = this.getConfiguredProjects();
            const diagnostics = this.validateConfiguration();

            // Apply pagination
            const total = allProjects.length;
            const projects = allProjects.slice(offset, offset + limit);

            if (allProjects.length === 0) {
                return ResponseBuilder.formatResponse({
                    success: false,
                    message: 'No projects configured yet',
                    details: [
                        '⚠️ No Optimizely projects found.',
                        '',
                        '**Quick Start - Just provide credentials when using any command:**',
                        '',
                        'Simply include ALL these parameters with your first command:',
                        '• projectName: "Your Project Name" (e.g., "Production", "Staging")',
                        '• projectId: "REPLACE_WITH_UUID"',
                        '• apiKey: "REPLACE_WITH_ACTUAL_KEY"',
                        '• apiSecret: "REPLACE_WITH_ACTUAL_SECRET"',
                        '',
                        '**Example:**',
                        '"List deployments for Production with projectName Production, projectId abc-123, apiKey SAMPLE_API_KEY, apiSecret SAMPLE_API_SECRET"',
                        '',
                        '**After the first use:**',
                        'The project will be auto-registered and you can simply say:',
                        '"List deployments for Production"',
                        '"Deploy on Production"',
                        '',
                        '💡 **Why Project Names Matter:**',
                        'Project names make it easy to reference your projects without remembering UUIDs!',
                        '',
                        '**Alternative: Pre-configure projects:**',
                        'Set environment variables like:',
                        'PRODUCTION="id=uuid;key=value;secret=value"',
                        'STAGING="id=uuid;key=value;secret=value"',
                        'ACME_CORP="id=uuid;key=value;secret=value"'
                    ].join('\n')
                });
            }

            const sections: string[] = [];

            // Header (DXP-76-3: Show pagination info)
            const paginationInfo = total > limit ? ` (showing ${offset + 1}-${Math.min(offset + limit, total)} of ${total})` : '';
            sections.push(`📂 Configured Optimizely Projects${paginationInfo}`);
            sections.push('=' .repeat(50));

            // List each project (name first for easier reference)
            // DXP-76-3: Adjust numbering for pagination offset
            projects.forEach((project, index) => {
                const sanitized = SecurityHelper.sanitizeObject(project);
                const actualIndex = offset + index;
                const defaultLabel = (actualIndex === 0) ? ' ⭐ (Default)' : '';
                const dynamicLabel = project.addedAt ? ' 📝 (Added)' : '';

                // Check for configuration issues for this project
                const projectDiag = diagnostics.projects.find(p => p.name === project.name);
                const hasErrors = projectDiag && projectDiag.errors.length > 0;
                const hasWarnings = projectDiag && projectDiag.warnings.length > 0;

                sections.push('');
                let typeLabel = ' ☁️ (DXP PaaS)';
                if (project.isSelfHosted) {
                    typeLabel = ' 🏠 (Self-Hosted)';
                } else if (project.isUnknown) {
                    typeLabel = ' ❓ (Unknown - Needs Config)';
                }
                sections.push(`${actualIndex + 1}. **${project.name}**${typeLabel}${defaultLabel}${dynamicLabel}${hasErrors ? ' ⚠️' : ''}`);
                sections.push(`   Project ID: ${project.projectId}`);

                if (project.isUnknown) {
                    // Show Unknown project info and guidance
                    sections.push(`   Type: Unknown (Paths Only)`);
                    sections.push(`   Status: ⚠️ Needs Configuration`);
                    if (project.blobPath) sections.push(`   Blob Path: ${project.blobPath}`);
                    if (project.logPath) sections.push(`   Log Path: ${project.logPath}`);
                    if (project.dbPath) sections.push(`   DB Path: ${project.dbPath}`);
                    sections.push(`   💡 To configure: Add connectionString (self-hosted) or id/key/secret (DXP)`);
                } else if (project.isSelfHosted) {
                    // Show connection string status for self-hosted
                    sections.push(`   Type: Self-Hosted Azure`);
                    sections.push(`   Connection String: ${sanitized.connectionString ? '✅ Configured' : '❌ Not configured'}`);
                    if (project.blobPath) sections.push(`   Blob Path: ${project.blobPath}`);
                    if (project.logPath) sections.push(`   Log Path: ${project.logPath}`);
                } else {
                    // Show API credentials for DXP PaaS
                    sections.push(`   Type: DXP PaaS`);
                    sections.push(`   API Key: ${sanitized.apiKey ? sanitized.apiKey : '❌ Not configured'}`);
                    sections.push(`   API Secret: ${sanitized.apiSecret ? '✅ Configured' : '❌ Not configured'}`);
                }

                // Show configuration errors/warnings
                if (hasErrors) {
                    projectDiag!.errors.forEach(err => {
                        sections.push(`   ❌ Error: ${err}`);
                    });
                }

                if (hasWarnings) {
                    projectDiag!.warnings.forEach(warn => {
                        sections.push(`   ⚠️  Warning: ${warn}`);
                    });
                }

                if (project.lastUsed) {
                    const lastUsed = new Date(project.lastUsed);
                    const now = new Date();
                    const diffHours = Math.floor((now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60));
                    if (diffHours < 1) {
                        sections.push(`   Last used: Just now`);
                    } else if (diffHours < 24) {
                        sections.push(`   Last used: ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`);
                    } else {
                        const diffDays = Math.floor(diffHours / 24);
                        sections.push(`   Last used: ${diffDays} day${diffDays > 1 ? 's' : ''} ago`);
                    }
                }
            });

            // Footer with usage instructions
            sections.push('');
            sections.push('=' .repeat(50));
            sections.push('💡 Usage Tips:');
            sections.push('• Use project name or ID in commands');
            sections.push('• Example: "Deploy on Project 1"');
            sections.push('• Example: "List deployments for ' + (projects[0]?.name || 'project-name') + '"');

            // DXP-66: Build structured data for automation tools
            // DXP-76-3: Add pagination metadata
            const structuredData = {
                totalProjects: total,
                projects: projects.map((project, index) => ({
                    name: project.name,
                    projectId: project.projectId,
                    type: project.isSelfHosted ? 'self-hosted' : project.isUnknown ? 'unknown' : 'dxp',
                    isDefault: (offset + index) === 0,
                    isDynamic: !!project.addedAt,
                    hasConnectionString: !!project.connectionString,
                    hasApiCredentials: !!(project.apiKey && project.apiSecret),
                    blobPath: project.blobPath || null,
                    logPath: project.logPath || null,
                    dbPath: project.dbPath || null,
                    lastUsed: project.lastUsed || null
                })),
                pagination: {
                    total,
                    limit,
                    offset,
                    hasMore: (offset + limit) < total
                }
            };

            return ResponseBuilder.successWithStructuredData(
                structuredData,
                sections.join('\n')
            );

        } catch (error: any) {
            return ResponseBuilder.formatResponse({
                success: false,
                message: 'Failed to list projects',
                error: error.message
            });
        }
    }

    /**
     * Get detailed project information
     */
    static async getProjectInfo(args: GetProjectArgs): Promise<any> {
        try {
            // Handle multiple ways connection string might be passed
            let connectionString = args.connectionString;

            // Check if connection string was mistakenly passed as projectId
            if (!connectionString && args.projectId && args.projectId.startsWith('DefaultEndpointsProtocol=')) {
                connectionString = args.projectId;
                args.projectId = undefined; // Clear the misused field
            }

            // Check if connection string was mistakenly passed as apiKey
            if (!connectionString && args.apiKey && args.apiKey.startsWith('DefaultEndpointsProtocol=')) {
                connectionString = args.apiKey;
                args.apiKey = undefined; // Clear the misused field
                args.apiSecret = undefined; // Also clear apiSecret as it's not needed for self-hosted
            }

            // Check if connection string was mistakenly passed as apiSecret
            if (!connectionString && args.apiSecret && args.apiSecret.startsWith('DefaultEndpointsProtocol=')) {
                connectionString = args.apiSecret;
                args.apiSecret = undefined; // Clear the misused field
                args.apiKey = undefined; // Also clear apiKey as it's not needed for self-hosted
            }

            // Handle rename request
            if (args.projectName && args.renameTo) {
                const projects = this.getConfiguredProjects();
                const project = projects.find(p =>
                    p.name === args.projectName ||
                    p.name.toLowerCase() === args.projectName!.toLowerCase()
                );

                if (project) {
                    // Create renamed configuration
                    const renamedConfig: ProjectConfig = {
                        ...project,
                        name: args.renameTo,
                        originalName: project.name,  // Track original name for replacement
                        configSource: 'dynamic',
                        lastUpdated: new Date().toISOString()
                    };

                    // Add to dynamic configurations (will replace by projectId or originalName)
                    this.addConfiguration(renamedConfig);

                    OutputLogger.log(`Project '${project.name}' renamed to '${args.renameTo}'`);

                    // Return renamed project info
                    return this.formatProjectInfo(renamedConfig, projects.length);
                } else {
                    return ResponseBuilder.formatResponse({
                        success: false,
                        message: `Project '${args.projectName}' not found`,
                        details: `Available projects: ${projects.map(p => p.name).join(', ')}`
                    });
                }
            }

            // Check if this is an attempt to upgrade a project with inline connection string
            if (args.projectName && connectionString) {
                // User is providing a connection string for a project
                const projects = this.getConfiguredProjects();
                const project = projects.find(p =>
                    p.name === args.projectName ||
                    p.name.toLowerCase() === args.projectName!.toLowerCase()
                );

                if (project) {
                    // Upgrade or update the existing project to Self-Hosted
                    const upgradedConfig: ProjectConfig = {
                        ...project,
                        connectionString: connectionString,
                        isSelfHosted: true,
                        isUnknown: false,
                        projectType: 'self-hosted',
                        configSource: 'dynamic',
                        lastUpdated: new Date().toISOString()
                    };

                    // Update project ID for unknown projects
                    if (upgradedConfig.projectId.startsWith('unknown-')) {
                        upgradedConfig.projectId = upgradedConfig.projectId.replace('unknown-', 'self-hosted-');
                    }

                    // Remove fields not relevant to self-hosted
                    delete upgradedConfig.needsConfiguration;
                    delete upgradedConfig.configurationHint;
                    delete upgradedConfig.apiKey;
                    delete upgradedConfig.apiSecret;

                    // Add to dynamic configurations
                    this.addConfiguration(upgradedConfig);

                    // DXP-148 FIX: Set as last used project (inline connection string provided)
                    this.setLastUsedProject(upgradedConfig.name);

                    const actionType = project.isUnknown ? 'upgraded' : 'updated';
                    OutputLogger.log(`Project '${project.name}' ${actionType} with connection string`);

                    // Return updated project info
                    return this.formatProjectInfo(upgradedConfig, projects.length);
                } else {
                    // Project doesn't exist yet - create new self-hosted project
                    const newProject: ProjectConfig = {
                        name: args.projectName,
                        projectId: `self-hosted-${args.projectName.toLowerCase().replace(/\s+/g, '-')}`,
                        connectionString: connectionString,
                        isSelfHosted: true,
                        projectType: 'self-hosted',
                        environments: ['Production'],
                        configSource: 'dynamic',
                        addedAt: new Date().toISOString(),
                        lastUsed: new Date().toISOString()
                    };

                    // Add to dynamic configurations
                    this.addConfiguration(newProject);

                    // DXP-148 FIX: Set as last used project (inline connection string provided)
                    this.setLastUsedProject(newProject.name);

                    OutputLogger.log(`New self-hosted project '${newProject.name}' created`);

                    // Return new project info
                    return this.formatProjectInfo(newProject, projects.length + 1);
                }
            }

            // If inline credentials provided, check for existing project to upgrade or create new
            if (args.projectName && args.projectId && args.apiKey && args.apiSecret) {
                const projects = this.getConfiguredProjects();

                // Check if there's ANY existing project with this name (Unknown or otherwise)
                const existingProject = projects.find(p =>
                    p.name === args.projectName ||
                    p.name.toLowerCase() === args.projectName!.toLowerCase()
                );

                if (existingProject) {
                    // Upgrade or update existing project
                    const upgradedConfig: ProjectConfig = {
                        ...existingProject,
                        projectId: args.projectId,
                        apiKey: args.apiKey,
                        apiSecret: args.apiSecret,
                        isUnknown: false,
                        projectType: 'dxp-paas',
                        configSource: 'dynamic',
                        lastUpdated: new Date().toISOString()
                    };

                    // Remove Unknown project specific fields
                    delete upgradedConfig.needsConfiguration;
                    delete upgradedConfig.configurationHint;
                    delete upgradedConfig.isSelfHosted;
                    delete upgradedConfig.connectionString;

                    // Add to dynamic configurations
                    this.addConfiguration(upgradedConfig);

                    // DXP-148 FIX: Set as last used project (inline credentials provided)
                    this.setLastUsedProject(upgradedConfig.name);

                    const actionType = existingProject.isUnknown ? 'upgraded' : 'updated';
                    OutputLogger.log(`Project '${existingProject.name}' ${actionType} with DXP credentials`);

                    // Return upgraded project info
                    return this.formatProjectInfo(upgradedConfig, projects.length);
                } else {
                    // No existing project - create new
                    const project: ProjectConfig = {
                        name: args.projectName,
                        projectId: args.projectId,
                        apiKey: args.apiKey,
                        apiSecret: args.apiSecret,
                        environments: ['Integration', 'Preproduction', 'Production'],
                        projectType: 'dxp-paas',
                        configSource: 'dynamic',
                        addedAt: new Date().toISOString(),
                        lastUsed: new Date().toISOString()
                    };

                    // Add to dynamic configurations
                    this.addConfiguration(project);

                    // DXP-148 FIX: Set as last used project (inline credentials provided)
                    this.setLastUsedProject(project.name);

                    OutputLogger.log(`New DXP project '${project.name}' created`);

                    // Get total projects including this one
                    const totalProjects = projects.find(p => p.projectId === project.projectId) ? projects.length : projects.length + 1;

                    return this.formatProjectInfo(project, totalProjects);
                }
            }

            const requestedProjectId = args.projectId || args.projectName;
            const projects = this.getConfiguredProjects();

            // If no projects configured
            if (projects.length === 0) {
                return ResponseBuilder.formatResponse({
                    success: false,
                    message: 'No projects configured',
                    details: 'Please configure at least one project with API credentials.'
                });
            }

            // If specific project requested
            if (requestedProjectId) {
                const project = projects.find(p =>
                    p.projectId === requestedProjectId ||
                    p.name === requestedProjectId ||
                    p.name.toLowerCase() === requestedProjectId.toLowerCase()
                );

                if (!project) {
                    return ResponseBuilder.formatResponse({
                        success: false,
                        message: `Project '${requestedProjectId}' not found`,
                        details: `Available projects: ${projects.map(p => p.name).join(', ')}`
                    });
                }

                return this.formatProjectInfo(project, projects.length);
            }

            // Show current/default project
            const currentProject = this.getCurrentProject();
            if (currentProject) {
                return this.formatProjectInfo(currentProject, projects.length);
            }

            // Fallback to listing all projects
            return this.listProjects(args);

        } catch (error: any) {
            return ResponseBuilder.formatResponse({
                success: false,
                message: 'Failed to get project information',
                error: error.message
            });
        }
    }

    /**
     * Format project information display
     */
    static formatProjectInfo(project: ProjectConfig, totalProjects: number): any {
        const sections: string[] = [];

        // Header
        sections.push('🏢 **Project Configuration**');
        sections.push('📋 Found ' + totalProjects + ' configured project' + (totalProjects > 1 ? 's' : '') + ':');
        let typeLabel = ' ☁️ (DXP PaaS)';
        if (project.isSelfHosted) {
            typeLabel = ' 🏠 (Self-Hosted)';
        } else if (project.isUnknown) {
            typeLabel = ' ❓ (Unknown - Needs Config)';
        }
        sections.push('   ' + project.name + typeLabel);
        sections.push('');
        sections.push('✅ **Connection Details:**');
        sections.push('   Project ID: ' + project.projectId.substring(0, 8) + '...');

        // Show appropriate credentials based on project type
        let hasCredentials: boolean;
        if (project.isUnknown) {
            sections.push('   Type: Unknown (Paths Only)');
            sections.push('   Status: ⚠️ Needs Configuration');
            if (project.blobPath) sections.push('   Blob Path: ' + project.blobPath);
            if (project.logPath) sections.push('   Log Path: ' + project.logPath);
            if (project.dbPath) sections.push('   DB Path: ' + project.dbPath);
            sections.push('');
            sections.push('   💡 **How to configure this project:**');
            sections.push('   • For self-hosted: Add connectionString=DefaultEndpointsProtocol=...');
            sections.push('   • For DXP PaaS: Add id=UUID;key=...;secret=...');
            hasCredentials = false; // Unknown projects need configuration
        } else if (project.isSelfHosted) {
            sections.push('   Type: Self-Hosted Azure');
            sections.push('   Connection String: ' + (project.connectionString ? '✅ Configured' : '❌ Not configured'));
            if (project.blobPath) sections.push('   Blob Path: ' + project.blobPath);
            if (project.logPath) sections.push('   Log Path: ' + project.logPath);
            hasCredentials = !!project.connectionString;
        } else {
            sections.push('   Type: DXP PaaS');
            sections.push('   API Key: ' + (project.apiKey ? '✅ Configured' : '❌ Not configured'));
            sections.push('   API Secret: ' + (project.apiSecret ? '✅ Configured' : '❌ Not configured'));
            hasCredentials = !!(project.apiKey && project.apiSecret);
        }

        // Show permissions if known
        if (project.environments && project.environments.length > 0) {
            sections.push('');
            sections.push('🔑 **Configured Environments:**');
            project.environments.forEach(env => {
                sections.push('   • ' + env);
            });
        }

        // Status
        sections.push('');
        sections.push(hasCredentials ? '✅ **Ready to Use!**' : '❌ **Missing Credentials**');

        if (hasCredentials) {
            sections.push('');
            sections.push('💡 Run "test connection" to see your exact permissions.');
        }

        // Configuration tips
        sections.push('');
        sections.push('=' .repeat(50));
        sections.push('💡 Tips:');

        if (!hasCredentials) {
            sections.push('• Add API credentials to use this project');
            sections.push('• Get credentials from your DXP Portal');
        } else {
            sections.push('• This project is ready to use');
            sections.push('• All commands will use this project by default');
        }

        if (totalProjects > 1) {
            sections.push('• Switch projects by using project name in commands');
        }

        return ResponseBuilder.formatResponse({
            success: true,
            message: hasCredentials ? 'Project configured and ready' : 'Project needs configuration',
            details: sections.join('\n')
        });
    }

    /**
     * Switch to a different project (returns credentials for use)
     */
    static switchProject(projectIdentifier: string | { projectName?: string; project?: string; projectId?: string }): SwitchResult {
        // Handle both string and object input
        const identifier = typeof projectIdentifier === 'object'
            ? (projectIdentifier.projectName || projectIdentifier.project || projectIdentifier.projectId)
            : projectIdentifier;

        if (!identifier) {
            return {
                success: false,
                message: 'No project identifier provided',
                credentials: null
            };
        }

        const projects = this.getConfiguredProjects();

        const project = projects.find(p =>
            p.projectId === identifier ||
            p.name === identifier ||
            p.name.toLowerCase() === identifier.toLowerCase()
        );

        if (!project) {
            return {
                success: false,
                message: `Project '${projectIdentifier}' not found`,
                credentials: null
            };
        }

        return {
            success: true,
            message: `Switched to project: ${project.name}`,
            credentials: {
                projectId: project.projectId,
                apiKey: project.apiKey,
                apiSecret: project.apiSecret
            },
            project: project
        };
    }

    /**
     * Get credentials for a specific project or default
     */
    static getProjectCredentials(projectIdentifier: string | null = null): Credentials {
        if (projectIdentifier) {
            const result = this.switchProject(projectIdentifier);
            if (result.success) {
                return result.credentials!;
            }
        }

        // Check for last used project in environment (session persistence)
        const lastUsedProject = process.env.MCP_LAST_USED_PROJECT;
        if (lastUsedProject && !projectIdentifier) {
            const result = this.switchProject(lastUsedProject);
            if (result.success) {
                return result.credentials!;
            }
        }

        // Return default/current project credentials
        const current = this.getCurrentProject();
        if (current) {
            return {
                projectId: current.projectId,
                apiKey: current.apiKey,
                apiSecret: current.apiSecret,
                name: current.name
            };
        }

        // No credentials available
        return {
            projectId: null,
            apiKey: null,
            apiSecret: null,
            name: null
        };
    }

    /**
     * Set the last used project (for session persistence)
     */
    static setLastUsedProject(projectName: string): void {
        if (projectName) {
            process.env.MCP_LAST_USED_PROJECT = projectName;
        }
    }

    /**
     * Get support information
     */
    static async handleGetSupport(_args: any): Promise<any> {
        const { FORMATTING: { STATUS_ICONS } } = Config;

        let response = `${STATUS_ICONS.INFO} **Jaxon Digital Support**\n\n`;
        response += `We're here to help with your Optimizely DXP MCP needs!\n\n`;

        response += `**📧 Email Support**\n`;
        response += `support@jaxondigital.com\n\n`;

        response += `**🐛 Report Issues**\n`;
        response += `GitHub: https://github.com/JaxonDigital/optimizely-dxp-mcp/issues\n\n`;

        response += `**💬 Get Help With:**\n`;
        response += `• Configuration and setup\n`;
        response += `• Deployment issues\n`;
        response += `• API authentication\n`;
        response += `• Feature requests\n`;
        response += `• Custom integrations\n\n`;

        response += `**🏢 Enterprise Support**\n`;
        response += `For priority support and SLAs, contact us about enterprise plans.\n\n`;

        response += `**🌐 Learn More**\n`;
        response += `Visit: www.jaxondigital.com\n`;

        return ResponseBuilder.success(ResponseBuilder.addFooter(response));
    }

    /**
     * Resolve credentials from various sources
     * Used by monitoring-tools and other tools that need flexible credential resolution
     *
     * @param {Object} args - Arguments that may contain credentials or project reference
     * @returns {Object} Result object with success status, credentials, and project info
     */
    static resolveCredentials(args: any = {}): CredentialsResult {
        const { projectName, projectId, apiKey, apiSecret } = args;

        // If full credentials are provided directly, use them
        if (apiKey && apiSecret && projectId) {
            // Try to find matching project for additional info
            const projects = this.getConfiguredProjects();
            const project = projects.find(p =>
                p.projectId === projectId ||
                p.apiKey === apiKey
            );

            return {
                success: true,
                credentials: {
                    projectId: projectId,
                    apiKey: apiKey,
                    apiSecret: apiSecret,
                    projectName: projectName || (project ? project.name : 'Direct Credentials')
                },
                project: project || {
                    projectId: projectId,
                    name: projectName || 'Direct Credentials',
                    apiKey: apiKey,
                    apiSecret: apiSecret,
                    environments: ['Integration', 'Preproduction', 'Production']
                }
            };
        }

        // Try to find project by name or ID
        if (projectName || projectId) {
            const result = this.switchProject(projectName || projectId);
            if (result.success) {
                return {
                    success: true,
                    credentials: result.credentials!,
                    project: result.project
                };
            }
            return {
                success: false,
                message: result.message || `Project '${projectName || projectId}' not found`,
                suggestion: 'Check project name or provide full credentials'
            };
        }

        // Try to get default or last used project
        const current = this.getCurrentProject();
        if (current) {
            return {
                success: true,
                credentials: {
                    projectId: current.projectId,
                    apiKey: current.apiKey,
                    apiSecret: current.apiSecret,
                    projectName: current.name
                },
                project: current
            };
        }

        // No credentials available
        return {
            success: false,
            message: 'No project credentials available',
            suggestion: 'Provide project name, project ID, or full API credentials'
        };
    }

    /**
     * Get project information (read-only)
     * Replaces get_api_key_info for reading project details
     */
    static getProject(args: { projectName?: string; projectId?: string }): any {
        const { projectName, projectId } = args;
        const projects = this.getConfiguredProjects();

        // Find the requested project
        let project: ProjectConfig | undefined;
        if (projectName || projectId) {
            project = projects.find(p =>
                p.name === projectName ||
                p.name?.toLowerCase() === projectName?.toLowerCase() ||
                p.projectId === projectId
            );
        } else {
            // Get default/current project
            project = this.getCurrentProject() || undefined;
        }

        if (!project) {
            const availableNames = projects.map(p => p.name).join(', ');
            return ResponseBuilder.formatResponse({
                success: false,
                message: `Project '${projectName || projectId}' not found`,
                details: availableNames ? `Available projects: ${availableNames}` : 'No projects configured'
            });
        }

        return this.formatProjectInfo(project, projects.length);
    }

    /**
     * Update project configuration (handles all modifications)
     * Consolidates: rename, credentials, paths, settings
     */
    static updateProject(args: UpdateProjectArgs): any {
        const {
            projectName,
            projectId,
            // Rename
            renameTo,
            // Credentials
            apiKey,
            apiSecret,
            connectionString,
            // Paths
            blobPath,
            dbPath,
            logPath,
            // Settings
            makeDefault
        } = args;

        // Find the project to update
        const projects = this.getConfiguredProjects();
        const project = projects.find(p =>
            p.name === projectName ||
            p.name?.toLowerCase() === projectName?.toLowerCase() ||
            p.projectId === projectId
        );

        if (!project) {
            // If no existing project, create new one if we have enough info
            if (projectName && (apiKey || connectionString)) {
                return this.getProjectInfo(args as GetProjectArgs); // Use existing creation logic
            }

            return ResponseBuilder.formatResponse({
                success: false,
                message: `Project '${projectName || projectId}' not found`,
                details: 'Specify an existing project to update or provide credentials to create a new one'
            });
        }

        // Build updated configuration
        const updatedConfig: ProjectConfig = { ...project };
        let changes: string[] = [];

        // Handle rename
        if (renameTo && renameTo !== project.name) {
            updatedConfig.name = renameTo;
            updatedConfig.originalName = project.name;
            changes.push(`Renamed from '${project.name}' to '${renameTo}'`);
        }

        // Handle credentials update
        if (apiKey && apiKey !== project.apiKey) {
            updatedConfig.apiKey = apiKey;
            changes.push('Updated API key');
            // If providing API credentials, this becomes a DXP project
            if (apiSecret) {
                if (project.projectType === 'self-hosted' || project.isSelfHosted) {
                    changes.push('Converted from Self-Hosted to DXP PaaS');
                }
                updatedConfig.projectType = 'dxp-paas';
                updatedConfig.isSelfHosted = false;
                delete updatedConfig.connectionString;
                updatedConfig.environments = ['Integration', 'Preproduction', 'Production'];
            }
        }
        if (apiSecret && apiSecret !== project.apiSecret) {
            updatedConfig.apiSecret = apiSecret;
            changes.push('Updated API secret');
            // If providing API credentials, this becomes a DXP project
            if (apiKey || updatedConfig.apiKey) {
                if (project.projectType === 'self-hosted' || project.isSelfHosted) {
                    changes.push('Converted from Self-Hosted to DXP PaaS');
                }
                updatedConfig.projectType = 'dxp-paas';
                updatedConfig.isSelfHosted = false;
                delete updatedConfig.connectionString;
                updatedConfig.environments = ['Integration', 'Preproduction', 'Production'];
            }
        }
        if (connectionString && connectionString !== project.connectionString) {
            updatedConfig.connectionString = connectionString;
            if (project.projectType === 'dxp-paas' || (!project.isSelfHosted && project.apiKey)) {
                changes.push('Converted from DXP PaaS to Self-Hosted');
            }
            updatedConfig.isSelfHosted = true;
            updatedConfig.projectType = 'self-hosted';
            updatedConfig.environments = ['Production'];
            // Remove DXP-specific fields
            delete updatedConfig.apiKey;
            delete updatedConfig.apiSecret;
            changes.push('Updated connection string');
        }

        // Handle project ID update (for DXP projects)
        if (projectId && projectId !== project.projectId && !project.projectId.startsWith('unknown-')) {
            updatedConfig.projectId = projectId;
            changes.push('Updated project ID');
        }

        // Handle paths
        if (blobPath && blobPath !== project.blobPath) {
            updatedConfig.blobPath = blobPath;
            changes.push('Updated blob path');
        }
        if (dbPath && dbPath !== project.dbPath) {
            updatedConfig.dbPath = dbPath;
            changes.push('Updated database path');
        }
        if (logPath && logPath !== project.logPath) {
            updatedConfig.logPath = logPath;
            changes.push('Updated log path');
        }

        // Handle default setting
        if (makeDefault) {
            updatedConfig.isDefault = true;
            // Remove default from other projects
            this.dynamicConfigurations.forEach(c => {
                if (c.name !== updatedConfig.name) {
                    c.isDefault = false;
                }
            });
            // Set as last used project for getCurrentProject() resolution
            this.setLastUsedProject(updatedConfig.name);
            changes.push('Set as default project');
        }

        // If project was Unknown and now has credentials, mark as configured
        if (project.isUnknown && (apiKey || connectionString)) {
            updatedConfig.isUnknown = false;
            updatedConfig.needsConfiguration = false;
            delete updatedConfig.configurationHint;
            if (apiKey) {
                updatedConfig.projectType = 'dxp-paas';
                changes.push('Upgraded from Unknown to DXP PaaS');
            } else if (connectionString) {
                updatedConfig.projectType = 'self-hosted';
                changes.push('Upgraded from Unknown to Self-Hosted');
            }
        }

        if (changes.length === 0) {
            return ResponseBuilder.formatResponse({
                success: true,
                message: 'No changes to apply',
                details: `Project '${project.name}' is already up to date`
            });
        }

        // Update timestamps
        updatedConfig.configSource = 'dynamic';
        updatedConfig.lastUpdated = new Date().toISOString();

        // Save the configuration
        this.addConfiguration(updatedConfig);

        // DXP-148 FIX: When credentials are provided inline, treat as implicit makeDefault
        // This ensures the most recently added/updated project becomes the default
        // Critical for multi-project n8n workflows where projects are added dynamically
        if ((apiKey && apiSecret) || connectionString) {
            this.setLastUsedProject(updatedConfig.name);
            OutputLogger.debug(`[DXP-148] Set '${updatedConfig.name}' as last used project (inline credentials provided)`);
        }

        // Build response
        const sections: string[] = [];
        sections.push(`✅ **Project Updated Successfully**`);
        sections.push('');
        sections.push(`**${updatedConfig.name}**`);
        sections.push(`Type: ${updatedConfig.projectType === 'self-hosted' ? 'Self-Hosted' : 'DXP PaaS'}`);
        sections.push('');
        sections.push('**Changes Applied:**');
        changes.forEach(change => sections.push(`• ${change}`));

        if (updatedConfig.blobPath || updatedConfig.dbPath || updatedConfig.logPath) {
            sections.push('');
            sections.push('**Download Paths:**');
            if (updatedConfig.blobPath) sections.push(`• Blobs: ${updatedConfig.blobPath}`);
            if (updatedConfig.dbPath) sections.push(`• Database: ${updatedConfig.dbPath}`);
            if (updatedConfig.logPath) sections.push(`• Logs: ${updatedConfig.logPath}`);
        }

        return ResponseBuilder.success(sections.join('\n'));
    }

    /**
     * Debug environment variables to understand what's available to the MCP process
     */
    static debugEnvironmentVariables(): DebugInfo {
        // Check for all variables that look like our format
        const relevantVars: { key: string; value: string }[] = [];
        Object.keys(process.env).forEach(key => {
            const value = process.env[key];
            if (value && typeof value === 'string') {
                const hasCorrectFormat = value.includes('id=') && value.includes('key=') && value.includes('secret=');

                if (hasCorrectFormat) {
                    relevantVars.push({
                        key: key,
                        value: value.substring(0, 80) + '...'
                    });
                }
            }
        });

        const debugInfo: DebugInfo = {
            totalRelevantVars: relevantVars.length,
            variables: relevantVars
        };

        return debugInfo;
    }
}

export default ProjectTools;

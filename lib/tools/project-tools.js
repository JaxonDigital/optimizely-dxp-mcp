/**
 * Project Management Tools
 * Handles multi-project configuration and switching
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const ResponseBuilder = require('../response-builder');
const SecurityHelper = require('../security-helper');
const Config = require('../config');

class ProjectTools {
    // In-memory storage for dynamically added API key configurations
    static dynamicConfigurations = [];
    
    /**
     * Add or update an API key configuration dynamically
     */
    static addConfiguration(configInfo) {
        // Check if configuration already exists by ID or name
        const existingIndex = this.dynamicConfigurations.findIndex(c => 
            c.projectId === configInfo.projectId || 
            c.name === configInfo.name
        );
        
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
    static getConfiguredProjects() {
        const projects = [];
        const configErrors = [];
        
        // Check ALL environment variables for our specific format
        // Any env var with format: "id=uuid;key=value;secret=value" is treated as an API key configuration
        // Examples: 
        //   ACME="id=uuid;key=value;secret=value"
        //   PRODUCTION="id=uuid;key=value;secret=value"
        //   CLIENT_A_STAGING="id=uuid;key=value;secret=value"
        
        // DEBUG: Log all environment variables that contain our format
        const OutputLogger = require('../output-logger');
        const relevantEnvVars = Object.keys(process.env).filter(key => {
            const value = process.env[key];
            return value && typeof value === 'string' && 
                   value.includes('id=') && value.includes('key=') && value.includes('secret=');
        });
        OutputLogger.debug(`Checking environment variables...`);
        OutputLogger.debug(`Found ${relevantEnvVars.length} relevant env vars:`, relevantEnvVars);
        
        Object.keys(process.env).forEach(key => {
            const value = process.env[key];
            
            // Skip if not a string or empty
            if (!value || typeof value !== 'string') {
                return;
            }
            
            // Check if this looks like our API key format
            // Must contain either old format (id=, key=, secret=) or new format (projectId=, apiKey=, apiSecret=)
            const hasOldFormat = value.includes('id=') && value.includes('key=') && value.includes('secret=');
            const hasNewFormat = value.includes('projectId=') && value.includes('apiKey=') && value.includes('apiSecret=');
            
            if (!hasOldFormat && !hasNewFormat) {
                return;
            }
            
            // Use the environment variable name as the project name (underscores become spaces)
            const projectName = key.replace(/_/g, ' ');
            
            try {
                // Parse semicolon-separated key=value pairs
                const params = {};
                const parts = value.split(';').filter(p => p.trim());
                
                if (parts.length === 0) {
                    configErrors.push({
                        project: projectName,
                        error: `Empty configuration string`,
                        variable: key,
                        value: value
                    });
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
                
                // Support both naming conventions for backward compatibility
                // Accept either 'id' or 'projectId', 'key' or 'apiKey', 'secret' or 'apiSecret'
                const projectId = params.id || params.projectId;
                const apiKey = params.key || params.apiKey;
                const apiSecret = params.secret || params.apiSecret;
                
                // Validate required fields
                const missingFields = [];
                if (!projectId) missingFields.push('id/projectId');
                if (!apiKey) missingFields.push('key/apiKey');
                if (!apiSecret) missingFields.push('secret/apiSecret');
                
                if (missingFields.length > 0) {
                    configErrors.push({
                        project: projectName,
                        error: `Missing required fields: ${missingFields.join(', ')}`,
                        variable: key,
                        hint: `Format: "projectId=<uuid>;apiKey=<key>;apiSecret=<secret>" or "id=<uuid>;key=<key>;secret=<secret>"`
                    });
                    return;
                }
                
                // Validate UUID format for project ID
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (!uuidRegex.test(projectId)) {
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
                const projectConfig = {
                    name: projectName,
                    projectId: projectId,
                    apiKey: apiKey,
                    apiSecret: apiSecret,
                    environments: params.environments 
                        ? params.environments.split(',').map(e => e.trim())
                        : ['Integration', 'Preproduction', 'Production'],
                    configSource: 'environment'
                };
                
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
                
            } catch (error) {
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
            // Only add if not already in list (avoid duplicates)
            if (!projects.find(p => p.projectId === dynConfig.projectId)) {
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
    static getCurrentProject(projectId = null) {
        const projects = this.getConfiguredProjects();
        
        // If projectId specified, find that project
        if (projectId) {
            const project = projects.find(p => p.projectId === projectId || p.name === projectId);
            if (project) return project;
        }
        
        // Return first project as default
        return projects[0] || null;
    }
    
    /**
     * Validate project configuration and return diagnostic info
     */
    static validateConfiguration() {
        const projects = this.getConfiguredProjects();
        const diagnostics = {
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
            const projectDiag = {
                name: project.name,
                valid: true,
                errors: [],
                warnings: []
            };
            
            // Check credentials
            if (!project.apiKey || project.apiKey.length < 20) {
                projectDiag.errors.push('API Key appears invalid or too short');
                projectDiag.valid = false;
            }
            
            if (!project.apiSecret || project.apiSecret.length < 20) {
                projectDiag.errors.push('API Secret appears invalid or too short');
                projectDiag.valid = false;
            }
            
            // Check for common mistakes
            if (project.apiKey.includes('REPLACE_WITH') || project.apiKey.includes('PLACEHOLDER') || project.apiKey.includes('SAMPLE')) {
                projectDiag.errors.push('API Key is a placeholder value');
                projectDiag.valid = false;
            }
            
            if (project.apiSecret.includes('REPLACE_WITH') || project.apiSecret.includes('PLACEHOLDER') || project.apiSecret.includes('SAMPLE')) {
                projectDiag.errors.push('API Secret is a placeholder value');
                projectDiag.valid = false;
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
     * List all configured projects
     */
    static async listProjects(args) {
        try {
            const projects = this.getConfiguredProjects();
            const diagnostics = this.validateConfiguration();
            
            if (projects.length === 0) {
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
            
            const sections = [];
            
            // Header
            sections.push('📂 Configured Optimizely Projects');
            sections.push('=' .repeat(50));
            
            // List each project (name first for easier reference)
            projects.forEach((project, index) => {
                const sanitized = SecurityHelper.sanitizeObject(project);
                const defaultLabel = (index === 0) ? ' ⭐ (Default)' : '';
                const dynamicLabel = project.addedAt ? ' 📝 (Added)' : '';
                
                // Check for configuration issues for this project
                const projectDiag = diagnostics.projects.find(p => p.name === project.name);
                const hasErrors = projectDiag && projectDiag.errors.length > 0;
                const hasWarnings = projectDiag && projectDiag.warnings.length > 0;
                
                sections.push('');
                sections.push(`${index + 1}. **${project.name}**${defaultLabel}${dynamicLabel}${hasErrors ? ' ⚠️' : ''}`);
                sections.push(`   Project ID: ${project.projectId}`);
                sections.push(`   API Key: ${sanitized.apiKey ? sanitized.apiKey : '❌ Not configured'}`);
                sections.push(`   API Secret: ${sanitized.apiSecret ? '✅ Configured' : '❌ Not configured'}`);
                
                // Show configuration errors/warnings
                if (hasErrors) {
                    projectDiag.errors.forEach(err => {
                        sections.push(`   ❌ Error: ${err}`);
                    });
                }
                
                if (hasWarnings) {
                    projectDiag.warnings.forEach(warn => {
                        sections.push(`   ⚠️  Warning: ${warn}`);
                    });
                }
                
                if (project.lastUsed) {
                    const lastUsed = new Date(project.lastUsed);
                    const now = new Date();
                    const diffHours = Math.floor((now - lastUsed) / (1000 * 60 * 60));
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
            
            return ResponseBuilder.formatResponse({
                success: true,
                message: `Found ${projects.length} configured project${projects.length !== 1 ? 's' : ''}`,
                details: sections.join('\n')
            });
            
        } catch (error) {
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
    static async getProjectInfo(args) {
        try {
            // If inline credentials provided, display that project's info
            if (args.projectName && args.projectId && args.apiKey && args.apiSecret) {
                // This project will be auto-registered by the main handler
                const project = {
                    name: args.projectName,
                    projectId: args.projectId,
                    apiKey: args.apiKey,
                    apiSecret: args.apiSecret,
                    environments: ['Integration', 'Preproduction', 'Production']
                };
                
                // Get total projects including this one
                const projects = this.getConfiguredProjects();
                const totalProjects = projects.find(p => p.projectId === project.projectId) ? projects.length : projects.length + 1;
                
                return this.formatProjectInfo(project, totalProjects);
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
            
        } catch (error) {
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
    static formatProjectInfo(project, totalProjects) {
        const sanitized = SecurityHelper.sanitizeObject(project);
        
        const sections = [];
        
        // Header
        sections.push('🏢 **Project Configuration**');
        sections.push('📋 Found ' + totalProjects + ' configured project' + (totalProjects > 1 ? 's' : '') + ':');
        sections.push('   ' + project.name);
        sections.push('');
        sections.push('✅ **Connection Details:**');
        sections.push('   Project ID: ' + project.projectId.substring(0, 8) + '...');
        sections.push('   API Key: ' + (project.apiKey ? '✅ Configured' : '❌ Not configured'));
        sections.push('   API Secret: ' + (project.apiSecret ? '✅ Configured' : '❌ Not configured'));
        
        // Show permissions if known
        if (project.environments && project.environments.length > 0) {
            sections.push('');
            sections.push('🔑 **Configured Environments:**');
            project.environments.forEach(env => {
                sections.push('   • ' + env);
            });
        }
        
        // Status
        const hasCredentials = project.apiKey && project.apiSecret;
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
    static switchProject(projectIdentifier) {
        const projects = this.getConfiguredProjects();
        
        const project = projects.find(p => 
            p.projectId === projectIdentifier || 
            p.name === projectIdentifier ||
            p.name.toLowerCase() === projectIdentifier.toLowerCase()
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
    static getProjectCredentials(projectIdentifier = null) {
        if (projectIdentifier) {
            const result = this.switchProject(projectIdentifier);
            if (result.success) {
                return result.credentials;
            }
        }
        
        // Check for last used project in environment (session persistence)
        const lastUsedProject = process.env.MCP_LAST_USED_PROJECT;
        if (lastUsedProject && !projectIdentifier) {
            const result = this.switchProject(lastUsedProject);
            if (result.success) {
                return result.credentials;
            }
        }
        
        // Return default/current project credentials
        const current = this.getCurrentProject();
        if (current) {
            return {
                projectId: current.projectId,
                apiKey: current.apiKey,
                apiSecret: current.apiSecret
            };
        }
        
        // No credentials available
        return {
            projectId: null,
            apiKey: null,
            apiSecret: null
        };
    }
    
    /**
     * Set the last used project (for session persistence)
     */
    static setLastUsedProject(projectName) {
        if (projectName) {
            process.env.MCP_LAST_USED_PROJECT = projectName;
        }
    }

    /**
     * Get support information
     */
    static async handleGetSupport(args) {
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
    static resolveCredentials(args = {}) {
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
                    credentials: result.credentials,
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
}

module.exports = ProjectTools;
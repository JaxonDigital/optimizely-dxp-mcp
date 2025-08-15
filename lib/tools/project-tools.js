/**
 * Project Management Tools
 * Handles multi-project configuration and switching
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const ResponseBuilder = require('../response-builder');
const SecurityHelper = require('../security-helper');
const Config = require('../config');

class ProjectTools {
    // In-memory storage for dynamically added projects
    static dynamicProjects = [];
    
    /**
     * Add or update a project dynamically
     */
    static addProject(projectInfo) {
        // Check if project already exists by ID or name
        const existingIndex = this.dynamicProjects.findIndex(p => 
            p.id === projectInfo.id || 
            p.name === projectInfo.name
        );
        
        if (existingIndex >= 0) {
            // Update existing project
            this.dynamicProjects[existingIndex] = {
                ...this.dynamicProjects[existingIndex],
                ...projectInfo,
                lastUsed: new Date().toISOString()
            };
        } else {
            // Add new project
            this.dynamicProjects.push({
                ...projectInfo,
                addedAt: new Date().toISOString(),
                lastUsed: new Date().toISOString()
            });
        }
        
        return projectInfo;
    }
    
    /**
     * Parse project configuration from environment and dynamic projects
     */
    static getConfiguredProjects() {
        const projects = [];
        const configErrors = [];
        
        // Check for OPTIMIZELY_PROJECT_<NAME> environment variables
        // Example: OPTIMIZELY_PROJECT_PRODUCTION="id=xxx;key=yyy;secret=zzz;default=true"
        Object.keys(process.env).forEach(key => {
            if (key.startsWith('OPTIMIZELY_PROJECT_')) {
                const projectName = key.replace('OPTIMIZELY_PROJECT_', '').replace(/_/g, ' ');
                const value = process.env[key];
                
                if (!value || typeof value !== 'string') {
                    configErrors.push({
                        project: projectName,
                        error: `Empty or invalid configuration value`,
                        variable: key
                    });
                    return;
                }
                
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
                    
                    // Validate required fields
                    const missingFields = [];
                    if (!params.id) missingFields.push('id');
                    if (!params.key) missingFields.push('key');
                    if (!params.secret) missingFields.push('secret');
                    
                    if (missingFields.length > 0) {
                        configErrors.push({
                            project: projectName,
                            error: `Missing required fields: ${missingFields.join(', ')}`,
                            variable: key,
                            hint: `Format: "id=<uuid>;key=<apikey>;secret=<apisecret>"`
                        });
                        return;
                    }
                    
                    // Validate UUID format for project ID
                    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                    if (!uuidRegex.test(params.id)) {
                        configErrors.push({
                            project: projectName,
                            error: `Invalid project ID format: "${params.id}"`,
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
                    projects.push({
                        name: projectName,
                        id: params.id,
                        apiKey: params.key,
                        apiSecret: params.secret,
                        environments: params.environments 
                            ? params.environments.split(',').map(e => e.trim())
                            : ['Integration', 'Preproduction', 'Production'],
                        isDefault: params.default === 'true',
                        configSource: 'environment'
                    });
                    
                } catch (error) {
                    configErrors.push({
                        project: projectName,
                        error: `Failed to parse configuration: ${error.message}`,
                        variable: key
                    });
                }
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
        
        // Add dynamically added projects
        this.dynamicProjects.forEach(dynProject => {
            // Only add if not already in list (avoid duplicates)
            if (!projects.find(p => p.id === dynProject.id)) {
                projects.push(dynProject);
            }
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
            const project = projects.find(p => p.id === projectId || p.name === projectId);
            if (project) return project;
        }
        
        // Return default project or first project
        return projects.find(p => p.isDefault) || projects[0] || null;
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
        
        // Check for default project
        const defaultProjects = projects.filter(p => p.isDefault);
        if (defaultProjects.length > 1) {
            diagnostics.warnings.push(`Multiple default projects found: ${defaultProjects.map(p => p.name).join(', ')}`);
        } else if (defaultProjects.length === 1) {
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
            if (project.apiKey === 'your-key' || project.apiKey === 'xxx') {
                projectDiag.errors.push('API Key is a placeholder value');
                projectDiag.valid = false;
            }
            
            if (project.apiSecret === 'your-secret' || project.apiSecret === 'yyy') {
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
                        '• projectId: "your-uuid"',
                        '• apiKey: "your-key"',
                        '• apiSecret: "your-secret"',
                        '',
                        '**Example:**',
                        '"List deployments for Production with projectName Production, projectId abc-123, apiKey xxx, apiSecret yyy"',
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
                        'OPTIMIZELY_PROJECT_PRODUCTION="id=uuid;key=xxx;secret=yyy"',
                        'OPTIMIZELY_PROJECT_STAGING="id=uuid;key=xxx;secret=yyy"'
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
                const defaultLabel = project.isDefault ? ' ⭐ (Default)' : '';
                const dynamicLabel = project.addedAt ? ' 📝 (Added)' : '';
                
                // Check for configuration issues for this project
                const projectDiag = diagnostics.projects.find(p => p.name === project.name);
                const hasErrors = projectDiag && projectDiag.errors.length > 0;
                const hasWarnings = projectDiag && projectDiag.warnings.length > 0;
                
                sections.push('');
                sections.push(`${index + 1}. **${project.name}**${defaultLabel}${dynamicLabel}${hasErrors ? ' ⚠️' : ''}`);
                sections.push(`   Project ID: ${project.id}`);
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
                    id: args.projectId,
                    apiKey: args.apiKey,
                    apiSecret: args.apiSecret,
                    environments: ['Integration', 'Preproduction', 'Production'],
                    isDefault: false
                };
                
                // Get total projects including this one
                const projects = this.getConfiguredProjects();
                const totalProjects = projects.find(p => p.id === project.id) ? projects.length : projects.length + 1;
                
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
                    p.id === requestedProjectId || 
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
        sections.push('🎯 Optimizely Project Configuration');
        sections.push('=' .repeat(50));
        
        // Active project details
        sections.push('');
        sections.push(`📌 Active Project: ${project.name}${project.isDefault ? ' ⭐' : ''}`);
        sections.push(`   Project ID: ${project.id}`);
        sections.push(`   API Key: ${sanitized.apiKey}`);
        sections.push(`   API Secret: ${sanitized.apiSecret}`);
        sections.push(`   Allowed Environments: ${project.environments.join(', ')}`);
        
        // Credentials status
        const hasCredentials = project.apiKey && project.apiSecret;
        sections.push('');
        sections.push(`   Status: ${hasCredentials ? '✅ Configured' : '❌ Missing credentials'}`);
        
        // Other projects summary
        if (totalProjects > 1) {
            sections.push('');
            sections.push('=' .repeat(50));
            sections.push(`📊 Total Projects: ${totalProjects}`);
            sections.push('   Use "list projects" to see all configured projects');
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
            p.id === projectIdentifier || 
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
                projectId: project.id,
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
        
        // Return default/current project credentials
        const current = this.getCurrentProject();
        if (current) {
            return {
                projectId: current.id,
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
}

module.exports = ProjectTools;
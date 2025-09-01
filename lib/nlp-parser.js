/**
 * Natural Language Parser for DXP MCP
 * Interprets human-friendly commands into structured tool calls
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

class NLPParser {
    constructor() {
        // Environment aliases and variations
        this.environmentMap = {
            // Production
            'prod': 'Production',
            'production': 'Production',
            'live': 'Production',
            'prd': 'Production',
            
            // Preproduction
            'preprod': 'Preproduction',
            'preproduction': 'Preproduction',
            'staging': 'Preproduction',
            'stage': 'Preproduction',
            'pre': 'Preproduction',
            'prep': 'Preproduction',
            'uat': 'Preproduction',
            'test': 'Preproduction',
            
            // Integration
            'int': 'Integration',
            'integration': 'Integration',
            'dev': 'Integration',
            'development': 'Integration',
            'inte': 'Integration'
        };

        // Action patterns with their corresponding tools - Order matters! Most specific patterns first
        this.actionPatterns = [
            // Database operations - highest priority due to specificity
            { pattern: /\b(backup|export|dump)\b.*(database|db|epicms|cms)/i, tool: 'export_database', category: 'database' },
            { pattern: /\b(restore|import)\b.*(database|db)/i, tool: 'import_database', category: 'database' },
            { pattern: /\b(check|status)\b.*(backup|export)/i, tool: 'check_export_status', category: 'database' },
            { pattern: /\b(list|show)\b.*(backup|export)/i, tool: 'list_exports', category: 'database' },
            
            // Azure DevOps operations - must come before generic deploy patterns
            { pattern: /\b(deploy|download).*(azure|devops|artifact|ci)/i, tool: 'deploy_azure_artifact', category: 'ci' },
            
            // Deployment monitoring - specific patterns before general ones
            { pattern: /\b(list|show|get)\b.*deploy/i, tool: 'list_deployments', category: 'monitoring' },
            { pattern: /\b(status|check|show|get)\b.*(deploy|status)/i, tool: 'status', category: 'monitoring' },
            
            // General deployment operations - after specific patterns
            { pattern: /\b(deploy|push|promote|move)\b/i, tool: 'deploy', category: 'deployment' },
            { pattern: /\b(start deploy|begin deploy|initiate deploy)\b/i, tool: 'start_deployment', category: 'deployment' },
            { pattern: /\b(complete|finish|approve)\b.*deploy/i, tool: 'complete_deployment', category: 'deployment' },
            { pattern: /\b(rollback|revert|undo|reset)\b/i, tool: 'rollback', category: 'deployment' },
            
            // Content operations
            { pattern: /^(copy|sync|migrate).*(content|media|assets)/i, tool: 'copy_content', category: 'content' },
            { pattern: /^(copy|sync|migrate).*(from|between)/i, tool: 'copy_content', category: 'content' },
            
            // Package operations
            { pattern: /^(upload|push).*(package|artifact|build)/i, tool: 'upload_deployment_package', category: 'package' },
            { pattern: /^(deploy).*(package|artifact|build)/i, tool: 'deploy_package_and_start', category: 'package' },
            
            // Monitoring & health
            { pattern: /^(test|check|verify).*(connection|setup|config)/i, tool: 'test_connection', category: 'health' },
            { pattern: /^(check|status).*(backup|export)/i, tool: 'check_export_status', category: 'database' },
            { pattern: /^(health|ping|alive)/i, tool: 'health_check', category: 'health' },
            { pattern: /^(quick|fast|rapid)/i, tool: 'quick', category: 'monitoring' },
            { pattern: /^(monitor|watch|track)/i, tool: 'monitor_deployment', category: 'monitoring' },
            
            // Storage operations
            { pattern: /^(list|show).*(storage|container|blob)/i, tool: 'list_storage_containers', category: 'storage' },
            { pattern: /^(generate|create|get).*(sas|link|url)/i, tool: 'generate_storage_sas_link', category: 'storage' },
            
            // Blob download operations
            { pattern: /\b(download|get|fetch|pull)\b.*(blob|blobs|media|assets|images|files)/i, tool: 'download_blobs', category: 'storage' },
            { pattern: /\b(sync|copy)\b.*(blob|blobs|media|assets|images).*(local|down)/i, tool: 'download_blobs', category: 'storage' },
            
            // Log download operations
            { pattern: /\b(download|get|fetch|pull)\b.*(log|logs|application\s*insights|app\s*insights)/i, tool: 'download_logs', category: 'storage' },
            { pattern: /\b(export|retrieve)\b.*(log|logs|application\s*insights)/i, tool: 'download_logs', category: 'storage' },
            
            // Setup & configuration
            { pattern: /^(run\s+)?(setup|configure|install|init)(\s+wizard)?/i, tool: 'setup_wizard', category: 'setup' },
            { pattern: /^(switch|change|use).*(project|client|api)/i, tool: 'switch_project', category: 'setup' },
            
            // Information queries
            { pattern: /^(what|which|show).*(project|client|api|current)/i, tool: 'get_api_key_info', category: 'info' },
            { pattern: /^(list|show).*(project|client|api)/i, tool: 'list_api_keys', category: 'info' },
            { pattern: /^(help|support|contact)/i, tool: 'get_support', category: 'info' }
        ];

        // Option patterns
        this.optionPatterns = {
            // Deployment types
            codeOnly: /\b(code[\s-]?only|just[\s-]?code|no[\s-]?content)\b/i,
            contentOnly: /\b(content[\s-]?only|just[\s-]?content|no[\s-]?code)\b/i,
            directDeploy: /\b(direct|immediate|skip[\s-]?warmup|no[\s-]?warmup)\b/i,
            maintenance: /\b(maintenance|maint[\s-]?page|maintenance[\s-]?mode)\b/i,
            
            // Common flags
            dryRun: /\b(dry[\s-]?run|preview|simulate|test[\s-]?run|what[\s-]?if)\b/i,
            force: /\b(force|override|skip[\s-]?checks?|ignore[\s-]?warnings?)\b/i,
            verbose: /\b(verbose|detailed|debug|full[\s-]?output)\b/i,
            autoDownload: /\b(auto[\s-]?download|download[\s-]?when[\s-]?ready|wait[\s-]?and[\s-]?download)\b/i,
            
            // Limits
            limit: /\b(?:last|latest|recent|top|first)\s*(\d+)\b/i,
            latest: /\b(latest|most[\s-]?recent|newest|last)\b/i,
            
            // Time-based
            urgent: /\b(urgent|asap|immediately|now|emergency)\b/i,
            scheduled: /\b(schedule|at|later|defer)\b/i
        };

        // Project name patterns - CRITICAL: Must extract project names correctly to avoid running against wrong project!
        this.projectPatterns = {
            // Pattern for "the ProjectName database/epicms/cms" etc - allows any case
            contextual: /\b(?:the|export|backup|deploy|copy)\s+([a-zA-Z][a-zA-Z0-9_-]*)\s+(?:database|epicms|cms|commerce|project|environment)/i,
            // Common patterns like "for ProjectName" or "using ProjectName"
            explicit: /\b(?:for|using|with|project|client|customer)\s+([a-zA-Z0-9_-]+)\b/i,
            // Quoted project names
            quoted: /["']([^"']+)["']/
        };
    }

    /**
     * Parse natural language input into structured command
     * @param {string} input - Natural language command
     * @returns {Object} Parsed command with tool, arguments, and metadata
     */
    parse(input) {
        if (!input || typeof input !== 'string') {
            return { error: 'Invalid input' };
        }

        const normalizedInput = input.toLowerCase().trim();
        
        // Detect intent/action
        const action = this.detectAction(input);
        if (!action) {
            return this.handleUnknownCommand(input);
        }

        // Extract entities
        const environments = this.extractEnvironments(input);
        const options = this.extractOptions(input);
        const project = this.extractProject(input);
        
        // Build command based on action and entities
        return this.buildCommand(action, environments, options, project, input);
    }

    /**
     * Detect the primary action from input
     */
    detectAction(input) {
        for (const pattern of this.actionPatterns) {
            if (pattern.pattern.test(input)) {
                return pattern;
            }
        }
        
        // Check for single-word commands
        const firstWord = input.split(/\s+/)[0].toLowerCase();
        const singleWordAction = this.actionPatterns.find(p => 
            p.tool === firstWord || p.category === firstWord
        );
        
        return singleWordAction || null;
    }

    /**
     * Extract environment names from input
     */
    extractEnvironments(input) {
        const environments = [];
        const words = input.toLowerCase().split(/\s+/);
        
        // Look for environment names and their aliases
        for (const word of words) {
            const env = this.environmentMap[word];
            if (env && !environments.includes(env)) {
                environments.push(env);
            }
        }
        
        // Look for "from X to Y" pattern
        const fromToPattern = /from\s+(\w+)\s+to\s+(\w+)/i;
        const fromToMatch = input.match(fromToPattern);
        if (fromToMatch) {
            const source = this.environmentMap[fromToMatch[1].toLowerCase()];
            const target = this.environmentMap[fromToMatch[2].toLowerCase()];
            
            if (source && target) {
                return { source, target };
            }
        }
        
        // Look for "X to Y" or "X -> Y" pattern
        const arrowPattern = /(\w+)\s*(?:to|->|→)\s*(\w+)/i;
        const arrowMatch = input.match(arrowPattern);
        if (arrowMatch) {
            const source = this.environmentMap[arrowMatch[1].toLowerCase()];
            const target = this.environmentMap[arrowMatch[2].toLowerCase()];
            
            if (source && target) {
                return { source, target };
            }
        }
        
        return environments;
    }

    /**
     * Extract options and flags from input
     */
    extractOptions(input) {
        const options = {};
        
        for (const [key, pattern] of Object.entries(this.optionPatterns)) {
            const match = input.match(pattern);
            if (match) {
                if (key === 'limit' && match[1]) {
                    options.limit = parseInt(match[1]);
                } else {
                    options[key] = true;
                }
            }
        }
        
        return options;
    }

    /**
     * Extract project name from input
     * CRITICAL: Must correctly identify project names to prevent running against wrong project!
     */
    extractProject(input) {
        // Check for quoted project name first (highest priority)
        const quotedMatch = input.match(this.projectPatterns.quoted);
        if (quotedMatch) {
            return quotedMatch[1];
        }
        
        // Check for contextual patterns like "the ACME database" or "the contoso epicms"
        const contextualMatch = input.match(this.projectPatterns.contextual);
        if (contextualMatch) {
            const potentialProject = contextualMatch[1];
            // Don't filter by case - project names can be any case
            // But exclude common words that are clearly not project names
            const excludedWords = ['the', 'a', 'an', 'this', 'that', 'my', 'our', 'your'];
            if (potentialProject && !excludedWords.includes(potentialProject.toLowerCase())) {
                return potentialProject;
            }
        }
        
        // Check for explicit project patterns like "for ProjectName"
        const explicitMatch = input.match(this.projectPatterns.explicit);
        if (explicitMatch) {
            // Avoid matching option keywords as project names
            const optionKeywords = ['autodownload', 'auto-download', 'force', 'verbose', 'dryrun', 'dry-run'];
            const matched = explicitMatch[1];
            if (!optionKeywords.includes(matched.toLowerCase())) {
                return matched;
            }
        }
        
        return null;
    }

    /**
     * Build structured command from parsed components
     */
    buildCommand(action, environments, options, project, originalInput) {
        const command = {
            tool: action.tool,
            category: action.category,
            arguments: {},
            metadata: {
                originalInput,
                confidence: 'high',
                parsedAt: new Date().toISOString()
            }
        };

        // Add project if specified
        if (project) {
            command.arguments.projectName = project;
        }

        // Handle environment-specific logic based on tool
        switch (action.tool) {
            case 'deploy':
            case 'start_deployment':
                if (environments.source && environments.target) {
                    command.arguments.sourceEnvironment = environments.source;
                    command.arguments.targetEnvironment = environments.target;
                } else if (environments.length === 1) {
                    // Single environment mentioned - infer source
                    command.arguments.targetEnvironment = environments[0];
                    command.arguments.sourceEnvironment = this.inferSourceEnvironment(environments[0]);
                } else if (environments.length === 2) {
                    // Two environments mentioned - first is source, second is target
                    command.arguments.sourceEnvironment = environments[0];
                    command.arguments.targetEnvironment = environments[1];
                }
                
                // Add deployment options
                if (options.codeOnly) {
                    command.arguments.deploymentType = 'Code';
                    command.arguments.includeBlobs = false;
                } else if (options.contentOnly) {
                    command.arguments.deploymentType = 'Content';
                    command.arguments.includeCode = false;
                }
                
                if (options.directDeploy) command.arguments.directDeploy = true;
                if (options.maintenance) command.arguments.useMaintenancePage = true;
                break;

            case 'backup':
            case 'export_database':
                // Default to production if no environment specified
                command.arguments.environment = environments[0] || 'Production';
                if (options.autoDownload) command.arguments.autoDownload = true;
                break;

            case 'rollback':
                command.arguments.environment = environments[0] || 'Production';
                break;

            case 'copy_content':
                if (environments.source && environments.target) {
                    command.arguments.sourceEnvironment = environments.source;
                    command.arguments.targetEnvironment = environments.target;
                } else if (environments.length === 2) {
                    command.arguments.sourceEnvironment = environments[0];
                    command.arguments.targetEnvironment = environments[1];
                }
                break;

            case 'list_deployments':
            case 'status':
                if (options.limit) {
                    command.arguments.limit = options.limit;
                } else if (options.latest) {
                    command.arguments.limit = 1;
                }
                break;
        }

        // Add common options
        if (options.dryRun) command.arguments.dryRun = true;
        if (options.force) command.arguments.force = true;
        if (options.verbose) command.arguments.verbose = true;

        // Validate command
        const validation = this.validateCommand(command);
        if (!validation.valid) {
            command.metadata.confidence = 'low';
            command.metadata.issues = validation.issues;
            command.suggestions = this.generateSuggestions(command, validation);
        }

        return command;
    }

    /**
     * Infer source environment based on target
     */
    inferSourceEnvironment(target) {
        switch (target) {
            case 'Production':
                return 'Preproduction';
            case 'Preproduction':
                return 'Integration';
            case 'Integration':
                return 'Preproduction'; // Or could be Production for content
            default:
                return null;
        }
    }

    /**
     * Validate the built command
     */
    validateCommand(command) {
        const issues = [];
        
        switch (command.tool) {
            case 'deploy':
            case 'start_deployment':
                if (!command.arguments.sourceEnvironment || !command.arguments.targetEnvironment) {
                    issues.push('Missing source or target environment');
                }
                break;
                
            case 'copy_content':
                if (!command.arguments.sourceEnvironment || !command.arguments.targetEnvironment) {
                    issues.push('Both source and target environments required for content copy');
                }
                break;
        }
        
        return {
            valid: issues.length === 0,
            issues
        };
    }

    /**
     * Generate suggestions for incomplete/ambiguous commands
     */
    generateSuggestions(command, validation) {
        const suggestions = [];
        
        if (validation.issues.includes('Missing source or target environment')) {
            suggestions.push('Try: "deploy from staging to production"');
            suggestions.push('Or: "deploy to production" (will use preproduction as source)');
        }
        
        return suggestions;
    }

    /**
     * Handle unknown commands
     */
    handleUnknownCommand(input) {
        const normalizedInput = input.toLowerCase().trim();
        
        // Handle ambiguous "download" command
        if (normalizedInput === 'download' || normalizedInput === 'dowload') {
            return {
                error: 'Ambiguous download command',
                input,
                message: 'Please specify what you want to download',
                suggestions: [
                    'download database - Export and download database backup',
                    'download blobs - Download media files and assets',
                    'download logs - Download application or web server logs',
                    'download all logs from production - Download all available log types'
                ],
                metadata: {
                    confidence: 'none',
                    requiresClarification: true,
                    parsedAt: new Date().toISOString()
                }
            };
        }
        
        // Try to find the closest matching action
        const words = normalizedInput.split(/\s+/);
        const possibleActions = [];
        
        for (const word of words) {
            for (const pattern of this.actionPatterns) {
                if (pattern.tool.includes(word) || word.includes(pattern.tool.substring(0, 3))) {
                    possibleActions.push(pattern.tool);
                }
            }
        }
        
        return {
            error: 'Unknown command',
            input,
            suggestions: possibleActions.length > 0 ? 
                [`Did you mean: ${possibleActions[0]}?`] : 
                ['Try: "deploy to production", "backup database", "check status"'],
            metadata: {
                confidence: 'none',
                parsedAt: new Date().toISOString()
            }
        };
    }

    /**
     * Get example commands for each category
     */
    getExamples() {
        return {
            deployment: [
                'deploy to production',
                'deploy from staging to prod with maintenance page',
                'rollback production immediately',
                'start deployment from int to preprod code only',
                'complete deployment'
            ],
            database: [
                'backup production database',
                'backup staging db and auto-download',
                'check backup status',
                'list recent backups'
            ],
            monitoring: [
                'check deployment status',
                'quick status check',
                'show latest deployments',
                'list last 5 deployments'
            ],
            content: [
                'copy content from production to staging',
                'sync media from prod to preprod',
                'migrate assets from live to test'
            ],
            setup: [
                'test connection',
                'run setup wizard',
                'switch to ACME project',
                'use "ACME Corp" api key'
            ]
        };
    }

    /**
     * Enhanced parsing with context awareness
     */
    parseWithContext(input, context = {}) {
        const baseResult = this.parse(input);
        
        // Apply context (previous commands, current project, etc.)
        if (context.currentProject && !baseResult.arguments.projectName) {
            baseResult.arguments.projectName = context.currentProject;
        }
        
        if (context.lastEnvironment && !baseResult.arguments.environment) {
            baseResult.arguments.environment = context.lastEnvironment;
        }
        
        return baseResult;
    }

    /**
     * Batch parse multiple commands
     */
    parseBatch(commands) {
        if (!Array.isArray(commands)) {
            commands = commands.split(/[,;]\s*/);
        }
        
        return commands.map(cmd => this.parse(cmd.trim()));
    }

    /**
     * Get confidence score for parsed command
     */
    getConfidenceScore(parsedCommand) {
        let score = 100;
        
        // Reduce score for missing required arguments
        if (parsedCommand.metadata?.issues?.length > 0) {
            score -= parsedCommand.metadata.issues.length * 20;
        }
        
        // Reduce score for unknown commands
        if (parsedCommand.error) {
            score = 0;
        }
        
        // Boost score for explicit project specification
        if (parsedCommand.arguments?.projectName) {
            score += 10;
        }
        
        return Math.max(0, Math.min(100, score));
    }
}

// Export for use in MCP server
module.exports = NLPParser;
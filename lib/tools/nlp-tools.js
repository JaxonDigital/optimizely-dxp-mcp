/**
 * Natural Language Processing Tools
 * Provides natural language interface to MCP operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const NLPParser = require('../nlp-parser');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');

class NLPTools {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.parser = new NLPParser();
    }

    /**
     * Parse and execute natural language command
     * @param {Object} args - Command arguments
     * @param {string} args.command - Natural language command
     * @param {string} [args.projectName] - Optional project context
     * @returns {Promise<Object>} Execution result
     */
    async parseAndExecute(args) {
        try {
            const { command, projectName } = args;
            
            if (!command) {
                return ResponseBuilder.error('No command provided', {
                    suggestions: this.parser.getExamples().deployment.slice(0, 3)
                });
            }

            // Parse the natural language command
            const parsed = this.parser.parseWithContext(command, {
                currentProject: projectName
            });

            // Handle parse errors
            if (parsed.error) {
                // Special handling for ambiguous download command
                if (parsed.error === 'Ambiguous download command') {
                    let message = '# 🤔 What Would You Like to Download?\n\n';
                    message += parsed.message + '\n\n';
                    message += '## Available Download Options:\n\n';
                    
                    for (const suggestion of parsed.suggestions) {
                        const [cmd, desc] = suggestion.split(' - ');
                        message += `• **${cmd}** - ${desc}\n`;
                    }
                    
                    message += '\n## 💡 Examples:\n';
                    message += '```bash\n';
                    message += '"download database from production"\n';
                    message += '"download blobs from staging"\n';
                    message += '"download application logs daysBack: 7"\n';
                    message += '```\n\n';
                    message += '**Please specify what you want to download.**';
                    
                    return ResponseBuilder.success(message);
                }
                
                return ResponseBuilder.error(parsed.error, {
                    originalCommand: command,
                    suggestions: parsed.suggestions || this.getDefaultSuggestions()
                });
            }

            // Get confidence score
            const confidence = this.parser.getConfidenceScore(parsed);
            
            // If low confidence, ask for confirmation
            if (confidence < 50) {
                return ResponseBuilder.warning('Low confidence in command interpretation', {
                    interpreted: {
                        tool: parsed.tool,
                        arguments: parsed.arguments
                    },
                    confidence: `${confidence}%`,
                    suggestions: parsed.suggestions || [`Try being more specific, e.g., "deploy from staging to production"`],
                    originalCommand: command
                });
            }

            // Check if tool exists
            const toolExists = this.toolManager.hasToolAsync(parsed.tool);
            if (!toolExists) {
                return ResponseBuilder.error(`Tool '${parsed.tool}' not found`, {
                    availableTools: this.toolManager.getAvailableTools(),
                    originalCommand: command
                });
            }

            // Execute the parsed command
            const result = await this.toolManager.executeToolAsync(parsed.tool, parsed.arguments);
            
            // Add metadata about NLP parsing
            if (result && typeof result === 'object') {
                result.nlpMetadata = {
                    originalCommand: command,
                    interpretedAs: parsed.tool,
                    confidence: `${confidence}%`,
                    parsedAt: parsed.metadata.parsedAt
                };
            }

            return result;

        } catch (error) {
            return ErrorHandler.handleError(error, 'parseAndExecute');
        }
    }

    /**
     * Get suggestions for common commands
     */
    getDefaultSuggestions() {
        return [
            'deploy to production',
            'backup database',
            'check deployment status',
            'test connection',
            'rollback production'
        ];
    }

    /**
     * Batch execute multiple natural language commands
     * @param {Object} args - Arguments
     * @param {string|Array} args.commands - Commands to execute
     * @param {string} [args.projectName] - Optional project context
     * @returns {Promise<Object>} Batch execution results
     */
    async batchExecute(args) {
        try {
            const { commands, projectName } = args;
            
            // Parse batch commands
            const commandList = Array.isArray(commands) ? commands : commands.split(/[,;]\s*/);
            
            const results = [];
            const errors = [];
            
            for (const command of commandList) {
                try {
                    const result = await this.parseAndExecute({
                        command: command.trim(),
                        projectName
                    });
                    
                    results.push({
                        command: command.trim(),
                        success: !result.error,
                        result
                    });
                    
                } catch (error) {
                    errors.push({
                        command: command.trim(),
                        error: error.message
                    });
                }
            }

            return ResponseBuilder.success('Batch execution completed', {
                totalCommands: commandList.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length + errors.length,
                results,
                errors: errors.length > 0 ? errors : undefined
            });

        } catch (error) {
            return ErrorHandler.handleError(error, 'batchExecute');
        }
    }

    /**
     * Get help for natural language commands
     * @param {Object} args - Arguments
     * @param {string} [args.category] - Optional category filter
     * @returns {Object} Help information
     */
    getHelp(args = {}) {
        const { category } = args;
        const examples = this.parser.getExamples();
        
        if (category && examples[category]) {
            return ResponseBuilder.success(`${category} command examples`, {
                category,
                examples: examples[category],
                tip: 'You can combine these with project names, e.g., "deploy to production for ACME"'
            });
        }

        return ResponseBuilder.success('Natural Language Command Help', {
            description: 'You can use natural language to control DXP operations',
            categories: Object.keys(examples),
            examples: {
                basic: [
                    'deploy to production',
                    'backup database',
                    'check status'
                ],
                advanced: [
                    'deploy from staging to prod code only',
                    'backup production database and auto-download',
                    'copy content from prod to staging for ACME'
                ]
            },
            allExamples: examples,
            tips: [
                'Environment aliases work: prod, staging, dev, etc.',
                'Add project context: "for ProjectName" or "using ProjectName"',
                'Combine options: "deploy to prod dry-run with maintenance page"',
                'Batch commands: "deploy to prod, backup database, check status"'
            ]
        });
    }

    /**
     * Analyze natural language command without executing
     * @param {Object} args - Arguments
     * @param {string} args.command - Command to analyze
     * @returns {Object} Analysis result
     */
    analyzeCommand(args) {
        try {
            const { command } = args;
            
            if (!command) {
                return ResponseBuilder.error('No command provided');
            }

            const parsed = this.parser.parse(command);
            const confidence = this.parser.getConfidenceScore(parsed);
            
            return ResponseBuilder.success('Command analysis', {
                originalCommand: command,
                interpretation: {
                    tool: parsed.tool || 'unknown',
                    arguments: parsed.arguments || {},
                    category: parsed.category || 'unknown'
                },
                confidence: {
                    score: confidence,
                    level: confidence >= 80 ? 'high' : confidence >= 50 ? 'medium' : 'low'
                },
                validation: parsed.metadata?.issues || [],
                suggestions: parsed.suggestions || [],
                wouldExecute: parsed.tool && !parsed.error
            });

        } catch (error) {
            return ErrorHandler.handleError(error, 'analyzeCommand');
        }
    }
}

module.exports = NLPTools;
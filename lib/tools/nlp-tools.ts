/**
 * Natural Language Processing Tools
 * Provides natural language interface to MCP operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import NLPParser from '../nlp-parser';
import ResponseBuilder from '../response-builder';
import ErrorHandler from '../error-handler';

/**
 * Tool manager interface (minimal - only methods we use)
 */
interface ToolManager {
    hasToolAsync(toolName: string): boolean;
    getAvailableTools(): string[];
    executeToolAsync(toolName: string, args: any): Promise<any>;
}

/**
 * NLP parser interface (minimal - only methods we use)
 */
interface NLPParserInstance {
    parseWithContext(command: string, context: { currentProject?: string }): NLPParseResult;
    parse(command: string): NLPParseResult;
    getConfidenceScore(parsed: NLPParseResult): number;
    getExamples(): NLPExamples;
}

/**
 * NLP parse result
 */
interface NLPParseResult {
    tool?: string;
    arguments?: any;
    category?: string;
    error?: string;
    message?: string;
    suggestions?: string[];
    metadata?: {
        parsedAt?: string;
        issues?: string[];
    };
}

/**
 * NLP examples by category
 */
interface NLPExamples {
    deployment: string[];
    database: string[];
    download: string[];
    [category: string]: string[];
}

/**
 * Parse and execute arguments
 */
export interface ParseAndExecuteArgs {
    command: string;
    projectName?: string;
}

/**
 * Batch execute arguments
 */
export interface BatchExecuteArgs {
    commands: string | string[];
    projectName?: string;
}

/**
 * Get help arguments
 */
export interface GetHelpArgs {
    category?: string;
}

/**
 * Analyze command arguments
 */
export interface AnalyzeCommandArgs {
    command: string;
}

/**
 * Batch command result
 */
interface BatchCommandResult {
    command: string;
    success: boolean;
    result: any;
}

/**
 * Batch error result
 */
interface BatchErrorResult {
    command: string;
    error: string;
}

/**
 * NLP metadata attached to results
 */
interface NLPMetadata {
    originalCommand: string;
    interpretedAs: string;
    confidence: string;
    parsedAt?: string;
}

class NLPTools {
    private toolManager: ToolManager;
    private parser: NLPParserInstance;

    constructor(toolManager: ToolManager) {
        this.toolManager = toolManager;
        this.parser = new NLPParser() as unknown as NLPParserInstance;
    }

    /**
     * Parse and execute natural language command
     */
    async parseAndExecute(args: ParseAndExecuteArgs): Promise<any> {
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

                    for (const suggestion of parsed.suggestions || []) {
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
                return ResponseBuilder.successWithStructuredData({
                    interpreted: {
                        tool: parsed.tool,
                        arguments: parsed.arguments
                    },
                    confidence: `${confidence}%`,
                    suggestions: parsed.suggestions || [`Try being more specific, e.g., "deploy from staging to production"`],
                    originalCommand: command
                }, '⚠️ Low confidence in command interpretation');
            }

            // Check if tool exists
            const toolExists = this.toolManager.hasToolAsync(parsed.tool!);
            if (!toolExists) {
                return ResponseBuilder.error(`Tool '${parsed.tool}' not found`, {
                    availableTools: this.toolManager.getAvailableTools(),
                    originalCommand: command
                });
            }

            // Execute the parsed command
            const result = await this.toolManager.executeToolAsync(parsed.tool!, parsed.arguments);

            // Add metadata about NLP parsing
            if (result && typeof result === 'object') {
                (result as any).nlpMetadata = {
                    originalCommand: command,
                    interpretedAs: parsed.tool,
                    confidence: `${confidence}%`,
                    parsedAt: parsed.metadata?.parsedAt
                } as NLPMetadata;
            }

            return result;

        } catch (error: any) {
            return ErrorHandler.handleError(error, 'parseAndExecute');
        }
    }

    /**
     * Get suggestions for common commands
     */
    getDefaultSuggestions(): string[] {
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
     */
    async batchExecute(args: BatchExecuteArgs): Promise<any> {
        try {
            const { commands, projectName } = args;

            // Parse batch commands
            const commandList = Array.isArray(commands) ? commands : commands.split(/[,;]\s*/);

            const results: BatchCommandResult[] = [];
            const errors: BatchErrorResult[] = [];

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

                } catch (error: any) {
                    errors.push({
                        command: command.trim(),
                        error: error.message
                    });
                }
            }

            return ResponseBuilder.successWithStructuredData({
                totalCommands: commandList.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length + errors.length,
                results,
                errors: errors.length > 0 ? errors : undefined
            }, 'Batch execution completed');

        } catch (error: any) {
            return ErrorHandler.handleError(error, 'batchExecute');
        }
    }

    /**
     * Get help for natural language commands
     */
    getHelp(args: GetHelpArgs = {}): any {
        const { category } = args;
        const examples = this.parser.getExamples();

        if (category && examples[category]) {
            return ResponseBuilder.successWithStructuredData({
                category,
                examples: examples[category],
                tip: 'You can combine these with project names, e.g., "deploy to production for ACME"'
            }, `${category} command examples`);
        }

        return ResponseBuilder.successWithStructuredData({
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
        }, 'Natural Language Command Help');
    }

    /**
     * Analyze natural language command without executing
     */
    analyzeCommand(args: AnalyzeCommandArgs): any {
        try {
            const { command } = args;

            if (!command) {
                return ResponseBuilder.error('No command provided');
            }

            const parsed = this.parser.parse(command);
            const confidence = this.parser.getConfidenceScore(parsed);

            return ResponseBuilder.successWithStructuredData({
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
            }, 'Command analysis');

        } catch (error: any) {
            return ErrorHandler.handleError(error, 'analyzeCommand');
        }
    }
}

export default NLPTools;

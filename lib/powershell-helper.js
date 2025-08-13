/**
 * PowerShell Helper Module
 * Centralized PowerShell command execution and response handling
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);
const SecurityHelper = require('./security-helper');

class PowerShellHelper {
    /**
     * Execute a PowerShell command with EpiCloud module
     * @param {string} command - The EpiCloud command to execute
     * @param {Object} credentials - API credentials {apiKey, apiSecret, projectId}
     * @param {Object} options - Additional options {timeout, parseJson}
     * @returns {Promise<Object>} Result with stdout, stderr, and parsed data
     */
    static async executeEpiCommand(command, credentials, options = {}) {
        // Use provided credentials or fall back to environment variables
        const apiKey = credentials.apiKey || process.env.OPTIMIZELY_API_KEY;
        const apiSecret = credentials.apiSecret || process.env.OPTIMIZELY_API_SECRET;
        const projectId = credentials.projectId || process.env.OPTIMIZELY_PROJECT_ID;
        
        const { timeout = 120000, parseJson = true } = options;
        
        // Validate credentials
        const validation = SecurityHelper.validateCredentials({ apiKey, apiSecret, projectId });
        if (!validation.valid) {
            console.error('Credential validation failed:', validation.errors.join(', '));
            return {
                stdout: '',
                stderr: `Invalid credentials: ${validation.errors.join(', ')}`,
                parsedData: null,
                success: false
            };
        }

        // Build the full PowerShell script
        const psScript = [
            'Import-Module EpiCloud -Force',
            `Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'`,
            parseJson ? `${command} | ConvertTo-Json -Depth 10 -Compress` : command
        ].join('; ');
        
        // Log sanitized command for debugging (without exposing secrets)
        if (process.env.DEBUG) {
            console.error('Executing command:', SecurityHelper.sanitizeCommand(command));
        }

        let stdout = '';
        let stderr = '';
        
        try {
            const result = await execAsync(`pwsh -Command "${psScript}"`, { timeout });
            stdout = result.stdout;
            stderr = result.stderr;
        } catch (error) {
            stdout = error.stdout || '';
            stderr = error.stderr || '';
        }

        // Parse JSON if requested and possible
        let parsedData = null;
        if (parseJson && stdout) {
            parsedData = this.parseJsonFromOutput(stdout);
        }

        return {
            stdout,
            stderr,
            parsedData,
            success: !stderr || (!stderr.includes('error') && !stderr.includes('Exception'))
        };
    }

    /**
     * Parse JSON from mixed PowerShell output
     * @param {string} output - Raw PowerShell output
     * @returns {Object|null} Parsed JSON object or null
     */
    static parseJsonFromOutput(output) {
        if (!output || !output.trim()) return null;

        try {
            // First try direct parsing
            return JSON.parse(output.trim());
        } catch {
            // Extract JSON from mixed output
            let foundJson = false;
            let jsonLines = [];
            const lines = output.split('\n');
            
            for (const line of lines) {
                if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
                    foundJson = true;
                }
                if (foundJson) {
                    jsonLines.push(line);
                }
            }
            
            if (jsonLines.length > 0) {
                try {
                    return JSON.parse(jsonLines.join('\n'));
                } catch {
                    return null;
                }
            }
        }
        
        return null;
    }

    /**
     * Check for common PowerShell errors
     * @param {string} stderr - Standard error output
     * @returns {Object} Error details {type, message, suggestion}
     */
    static checkForErrors(stderr) {
        if (!stderr) return null;

        // Module not installed
        if (stderr.includes('EpiCloud')) {
            return {
                type: 'MODULE_MISSING',
                message: 'EpiCloud PowerShell Module not found',
                suggestion: 'Install-Module EpiCloud -Force'
            };
        }

        // Authentication failures
        if (stderr.includes('authentication') || stderr.includes('unauthorized') || 
            stderr.includes('403') || stderr.includes('401')) {
            return {
                type: 'AUTH_FAILED',
                message: 'Authentication failed',
                suggestion: 'Verify your API credentials and permissions'
            };
        }

        // Ongoing operation
        if (stderr.includes('on-going') || stderr.includes('already running')) {
            return {
                type: 'OPERATION_IN_PROGRESS',
                message: 'Another operation is already in progress',
                suggestion: 'Wait for the current operation to complete'
            };
        }

        // Invalid state
        if (stderr.includes('invalid state') || stderr.includes('cannot be')) {
            return {
                type: 'INVALID_STATE',
                message: 'Operation not allowed in current state',
                suggestion: 'Check the current status before retrying'
            };
        }

        // Generic error
        if (stderr.includes('error') || stderr.includes('Exception')) {
            // Try to extract error message
            const errorMatch = stderr.match(/"errors":\["(.+?)"/i);
            if (errorMatch) {
                return {
                    type: 'API_ERROR',
                    message: errorMatch[1],
                    suggestion: 'Check the error message for details'
                };
            }
            
            return {
                type: 'GENERIC_ERROR',
                message: 'An error occurred',
                suggestion: 'Check the logs for more details'
            };
        }

        return null;
    }

    /**
     * Format error for user display
     * @param {Object} error - Error object from checkForErrors
     * @param {Object} context - Additional context {operation, projectId, etc}
     * @returns {string} Formatted error message
     */
    static formatError(error, context = {}) {
        let result = '❌ **Error: ' + error.message + '**\n\n';
        
        if (error.type === 'MODULE_MISSING') {
            result += '**Installation Required:**\n';
            result += '```powershell\n';
            result += error.suggestion + '\n';
            result += '```\n';
        } else if (error.type === 'AUTH_FAILED') {
            result += '**Troubleshooting:**\n';
            result += '- ' + error.suggestion + '\n';
            if (context.projectId) {
                result += `- Ensure credentials have access to project ${context.projectId}\n`;
            }
        } else {
            result += '**Suggestion:** ' + error.suggestion + '\n';
        }

        if (context.operation) {
            result += `\n**Operation:** ${context.operation}`;
        }
        if (context.projectId) {
            result += `\n**Project ID:** ${context.projectId}`;
        }

        return result;
    }

    /**
     * Execute PowerShell command without EpiCloud
     * @param {string} command - Raw PowerShell command
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Result with stdout and stderr
     */
    static async executeRawCommand(command, options = {}) {
        const { timeout = 120000 } = options;
        
        try {
            const result = await execAsync(`pwsh -Command "${command}"`, { timeout });
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                success: true
            };
        } catch (error) {
            return {
                stdout: error.stdout || '',
                stderr: error.stderr || error.message,
                success: false
            };
        }
    }
}

module.exports = PowerShellHelper;
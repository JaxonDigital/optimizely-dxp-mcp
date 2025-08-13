/**
 * Error Handler Module
 * Centralized error detection and formatting
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const SecurityHelper = require('./security-helper');

class ErrorHandler {
    /**
     * Common error patterns and their handlers
     */
    static ERROR_PATTERNS = {
        MODULE_MISSING: {
            pattern: /EpiCloud/i,
            type: 'MODULE_MISSING',
            title: 'EpiCloud PowerShell Module Required',
            getMessage: () => 'To use this feature, you need the EpiCloud PowerShell module installed',
            getSolution: () => [
                '**Installation:**',
                '```powershell',
                'Install-Module EpiCloud -Force',
                '```'
            ].join('\n')
        },
        AUTH_FAILED: {
            pattern: /(authentication|unauthorized|403|401)/i,
            type: 'AUTH_FAILED',
            title: 'Authentication Failed',
            getMessage: () => 'The API credentials are invalid or don\'t have permission for this operation',
            getSolution: (context) => [
                '**Troubleshooting:**',
                '- Verify your API key and secret are correct',
                context.projectId ? `- Check that the credentials have permission for project ${context.projectId}` : '',
                '- Ensure the project exists and you have access to it'
            ].filter(Boolean).join('\n')
        },
        OPERATION_IN_PROGRESS: {
            pattern: /(on-going|already running|already an on-going)/i,
            type: 'OPERATION_IN_PROGRESS',
            title: 'Operation Already In Progress',
            getMessage: () => 'Another operation is currently running on this environment',
            getSolution: () => [
                '**Next Steps:**',
                '- Wait for the current operation to complete',
                '- Check deployment status to monitor progress',
                '- Try again once the current operation finishes'
            ].join('\n')
        },
        INVALID_STATE: {
            pattern: /(invalid state|cannot be|not in a valid state)/i,
            type: 'INVALID_STATE',
            title: 'Invalid Operation State',
            getMessage: () => 'This operation cannot be performed in the current state',
            getSolution: (context) => [
                '**Requirements:**',
                context.expectedState ? `- Resource must be in ${context.expectedState} state` : '',
                '- Check the current status before retrying',
                '- Ensure all prerequisites are met'
            ].filter(Boolean).join('\n')
        },
        LARGE_FILE: {
            pattern: /(exceeds GitHub|Large files detected|file size limit)/i,
            type: 'LARGE_FILE',
            title: 'Large File Detected',
            getMessage: () => 'File exceeds size limits',
            getSolution: () => [
                '**Solutions:**',
                '- Remove large files from repository',
                '- Use Git LFS for large files',
                '- Add large files to .gitignore'
            ].join('\n')
        },
        NOT_FOUND: {
            pattern: /(not found|404|does not exist)/i,
            type: 'NOT_FOUND',
            title: 'Resource Not Found',
            getMessage: (context) => `The requested ${context.resourceType || 'resource'} was not found`,
            getSolution: (context) => [
                '**Possible Causes:**',
                '- Incorrect ID or name provided',
                '- Resource has been deleted',
                '- You don\'t have permission to access it',
                context.resourceId ? `- Resource ID: ${context.resourceId}` : ''
            ].filter(Boolean).join('\n')
        },
        TIMEOUT: {
            pattern: /(timeout|timed out)/i,
            type: 'TIMEOUT',
            title: 'Operation Timed Out',
            getMessage: () => 'The operation took too long to complete',
            getSolution: () => [
                '**Suggestions:**',
                '- Try again with a longer timeout',
                '- Check if the service is responsive',
                '- Consider breaking the operation into smaller steps'
            ].join('\n')
        }
    };

    /**
     * Detect error type from stderr output
     * @param {string} stderr - Error output
     * @param {Object} context - Additional context
     * @returns {Object|null} Error details or null
     */
    static detectError(stderr, context = {}) {
        if (!stderr) return null;

        for (const [key, errorDef] of Object.entries(this.ERROR_PATTERNS)) {
            if (errorDef.pattern.test(stderr)) {
                return {
                    type: errorDef.type,
                    title: errorDef.title,
                    message: errorDef.getMessage(context),
                    solution: errorDef.getSolution(context)
                };
            }
        }

        // Generic error if no pattern matches
        if (stderr.includes('error') || stderr.includes('Exception')) {
            // Try to extract specific error message
            const errorMatch = stderr.match(/"errors":\["(.+?)"/i);
            const message = errorMatch ? errorMatch[1] : 'An unexpected error occurred';
            
            return {
                type: 'GENERIC_ERROR',
                title: 'Error',
                message: message,
                solution: '**Troubleshooting:**\n- Check the error message for details\n- Verify all parameters are correct\n- Try again or contact support'
            };
        }

        return null;
    }

    /**
     * Format error for display
     * @param {Object} error - Error object from detectError
     * @param {Object} context - Additional context
     * @returns {string} Formatted error message
     */
    static formatError(error, context = {}) {
        let result = `❌ **${error.title}**\n\n`;
        
        if (error.message) {
            result += error.message + '\n\n';
        }
        
        if (error.solution) {
            result += error.solution + '\n';
        }
        
        // Add context information (sanitized)
        const safeContext = SecurityHelper.createSafeLogContext(context);
        const contextItems = [];
        if (safeContext.operation) contextItems.push(`**Operation:** ${safeContext.operation}`);
        if (safeContext.projectId) contextItems.push(`**Project ID:** ${safeContext.projectId}`);
        if (safeContext.environment) contextItems.push(`**Environment:** ${safeContext.environment}`);
        if (safeContext.deploymentId) contextItems.push(`**Deployment ID:** ${safeContext.deploymentId}`);
        
        if (contextItems.length > 0) {
            result += '\n' + contextItems.join('\n');
        }

        return result;
    }

    /**
     * Extract error message from various formats
     * @param {string} errorText - Error text to parse
     * @returns {string} Extracted error message (sanitized)
     */
    static extractErrorMessage(errorText) {
        let message = '';
        
        // Try JSON error format
        const jsonMatch = errorText.match(/"errors":\["(.+?)"/i);
        if (jsonMatch) {
            message = jsonMatch[1];
        } else {
            // Try exception message
            const exceptionMatch = errorText.match(/Exception: (.+?)$/im);
            if (exceptionMatch) {
                message = exceptionMatch[1];
            } else {
                // Try generic error format
                const errorMatch = errorText.match(/Error: (.+?)$/im);
                if (errorMatch) {
                    message = errorMatch[1];
                } else {
                    // Return first line if nothing else matches
                    const firstLine = errorText.split('\n')[0];
                    message = firstLine || 'An error occurred';
                }
            }
        }
        
        // Sanitize the extracted message to remove any secrets
        return SecurityHelper.sanitizeError(message);
    }

    /**
     * Check if error is retryable
     * @param {Object} error - Error object
     * @returns {boolean} True if operation can be retried
     */
    static isRetryable(error) {
        const retryableTypes = [
            'TIMEOUT',
            'OPERATION_IN_PROGRESS'
        ];
        
        return retryableTypes.includes(error.type);
    }

    /**
     * Get suggested wait time for retry
     * @param {Object} error - Error object
     * @returns {number} Suggested wait time in milliseconds
     */
    static getRetryDelay(error) {
        const delays = {
            'OPERATION_IN_PROGRESS': 30000, // 30 seconds
            'TIMEOUT': 5000, // 5 seconds
            'default': 10000 // 10 seconds
        };
        
        return delays[error.type] || delays.default;
    }
}

module.exports = ErrorHandler;
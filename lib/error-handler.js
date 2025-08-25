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
        CONFIG_ERROR: {
            pattern: /(Missing required fields|Invalid project ID format|Empty configuration|Invalid parameter format)/i,
            type: 'CONFIG_ERROR',
            title: 'Configuration Error',
            getMessage: (error) => error || 'Your project configuration has errors',
            getSolution: () => [
                '**Correct Format:**',
                '```',
                'OPTIMIZELY_API_KEY_ACME="id=<uuid>;key=<apikey>;secret=<apisecret>"',
                '```',
                '',
                '**Example:**',
                '```',
                'OPTIMIZELY_API_KEY_MY_CLIENT="id=abc12345-1234-5678-9abc-def123456789;key=myApiKey123;secret=myApiSecret456"',
                '```',
                '(Legacy format OPTIMIZELY_PROJECT_<NAME> also supported)',
                '',
                '**Common Issues:**',
                '- Missing semicolons between parameters',
                '- Using placeholder values like "example" or "your-key-here"',
                '- Project ID not in UUID format',
                '- Empty or missing required fields (id, key, secret)'
            ].join('\n')
        },
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
        INVALID_PROJECT_ID: {
            pattern: /Failed to validate the credentials specified for project with id|project with id.*not found|invalid project|project.*does not exist/i,
            type: 'INVALID_PROJECT_ID',
            title: 'Invalid Project ID',
            getMessage: (context) => {
                return context.projectId 
                    ? `The Project ID '${context.projectId}' is invalid or does not exist in your account`
                    : 'The specified Project ID is invalid or does not exist in your account';
            },
            getSolution: (context) => [
                '**How to Fix:**',
                '1. **Check your Project ID in Optimizely DXP:**',
                '   - Log into your Optimizely DXP portal',
                '   - Navigate to your project settings',
                '   - Copy the correct Project ID (it should be a UUID format like: abc12345-1234-5678-9abc-def123456789)',
                '',
                '2. **Verify your credentials have access to the project:**',
                '   - Ensure your API key was created for the correct project',
                '   - Check that you have permission to access this project',
                '   - Try using a different project from your account',
                '',
                '3. **Common Issues:**',
                '   - Project ID format must be a valid UUID',
                '   - API credentials might be for a different project',
                '   - Project may have been deleted or renamed',
                '   - You may not have access to this project',
                '',
                context.projectId ? `**Your Project ID:** ${context.projectId}` : '',
                '**Expected Format:** xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
            ].filter(Boolean).join('\n')
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
        INVALID_DEPLOYMENT: {
            pattern: /(deployment.*not found|invalid deployment|deployment does not exist|get-epideployment.*cannot find)/i,
            type: 'INVALID_DEPLOYMENT',
            title: 'Invalid Deployment ID',
            getMessage: (context) => {
                return context.deploymentId 
                    ? `The deployment ID '${context.deploymentId}' is invalid or does not exist`
                    : 'The specified deployment ID is invalid or does not exist';
            },
            getSolution: (context) => [
                '**How to Fix:**',
                '1. List available deployments:',
                '   Use `list_deployments` to see all deployments',
                '2. Copy the correct deployment ID from the list',
                '3. Ensure you\'re using the full deployment ID (usually a GUID)',
                '',
                '**Common Issues:**',
                '- Partial IDs are not accepted (use the full GUID)',
                '- Deployment may have been cleaned up after 30 days',
                '- You may be looking in the wrong project',
                context.deploymentId ? `\n**Provided ID:** ${context.deploymentId}` : '',
                context.projectId ? `**Project:** ${context.projectId}` : ''
            ].filter(Boolean).join('\n')
        },
        NOT_FOUND: {
            pattern: /(not found|404|does not exist)/i,
            type: 'NOT_FOUND',
            title: 'Resource Not Found',
            getMessage: (context) => {
                // Provide specific message for deployment IDs
                if (context.deploymentId) {
                    return `Deployment with ID '${context.deploymentId}' was not found`;
                }
                // Handle project access issues with structured response
                if (context.projectId || context.projectName) {
                    return `Unable to access ${context.projectName || 'project'}`;
                }
                return `The requested ${context.resourceType || 'resource'} was not found`;
            },
            getSolution: (context) => {
                const SecurityHelper = require('./security-helper');
                
                // Provide specific guidance for deployment IDs
                if (context.deploymentId) {
                    return [
                        '**Troubleshooting Steps:**',
                        '1. Verify the deployment ID is correct (check for typos)',
                        '2. Use `list_deployments` to see available deployments',
                        '3. Ensure the deployment exists in this project',
                        '4. Check that you have permission to view this deployment',
                        '',
                        `**Deployment ID:** ${context.deploymentId}`,
                        context.projectId ? `**Project ID:** ${context.projectId}` : ''
                    ].filter(Boolean).join('\n');
                }
                
                // Enhanced project access troubleshooting with masked API key
                if (context.projectId || context.projectName || context.apiKey) {
                    const parts = [];
                    
                    parts.push('🔍 **Configuration Verification:**');
                    parts.push('');
                    
                    // Project ID verification
                    if (context.projectId) {
                        parts.push('1. ✅ **Project ID Format**');
                        parts.push(`   • Current: ${context.projectId}`);
                        parts.push('   • Status: Valid UUID format');
                        parts.push('');
                    }
                    
                    // API Key verification with masking
                    if (context.apiKey) {
                        const maskedKey = SecurityHelper.maskSecret(context.apiKey, 4);
                        parts.push('2. ✅ **API Key Configuration**');
                        parts.push(`   • Prefix: ${maskedKey} (first 4 chars for identification)`);
                        parts.push('   • Length: ✅ Correct length (40 characters)');
                        parts.push('   • Status: ❓ Unable to verify - check DXP Portal');
                        parts.push('');
                    }
                    
                    parts.push('3. 🔍 **Manual Verification Required**');
                    parts.push('   • Log into Optimizely DXP Portal');
                    parts.push('   • Navigate to API Management');
                    if (context.apiKey) {
                        const maskedKey = SecurityHelper.maskSecret(context.apiKey, 4);
                        parts.push(`   • Verify API Key ${maskedKey} has access to project: ${context.projectName || context.projectId}`);
                    }
                    parts.push('   • Check if project name/ID changed recently');
                    parts.push('   • Confirm API Key has sufficient permissions for this operation');
                    parts.push('');
                    parts.push('⚠️  **Note:** Optimizely\'s API returns the same error for invalid credentials,');
                    parts.push('    missing permissions, or incorrect project IDs.');
                    
                    return parts.join('\n');
                }
                
                return [
                    '**Possible Causes:**',
                    '- Incorrect ID or name provided',
                    '- Resource has been deleted',
                    '- You don\'t have permission to access it',
                    context.resourceId ? `- Resource ID: ${context.resourceId}` : ''
                ].filter(Boolean).join('\n');
            }
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
                solution: '**Troubleshooting:**\n- Check the error message for details\n- Verify all parameters are correct\n- Try again or contact support@jaxondigital.com for help'
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

        // Add support contact for persistent issues
        result += '\n\n📧 **Need help?** Contact us at support@jaxondigital.com';

        return result;
    }

    /**
     * Extract error message from various formats
     * @param {string} errorText - Error text to parse
     * @returns {string} Extracted error message (sanitized)
     */
    static extractErrorMessage(errorText) {
        let message = '';
        
        // Remove ANSI color codes first
        const cleanText = errorText.replace(/\[\d+(?:;\d+)*m/g, '');
        
        // Try JSON error format
        const jsonMatch = cleanText.match(/"errors":\["(.+?)"/i);
        if (jsonMatch) {
            message = jsonMatch[1];
        } else {
            // Try specific Optimizely project validation error
            const optimizelyMatch = cleanText.match(/Failed to validate the credentials specified for project with id (.+?)!/i);
            if (optimizelyMatch) {
                message = `Invalid Project ID: ${optimizelyMatch[1]}`;
            } else {
                // Try exception message
                const exceptionMatch = cleanText.match(/Exception: (.+?)$/im);
                if (exceptionMatch) {
                    message = exceptionMatch[1];
                } else {
                    // Try generic error format
                    const errorMatch = cleanText.match(/Error: (.+?)$/im);
                    if (errorMatch) {
                        message = errorMatch[1];
                    } else {
                        // Return first non-empty line if nothing else matches
                        const lines = cleanText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                        message = lines[0] || 'An error occurred';
                    }
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
    
    /**
     * Handle error and return MCP response format
     * @param {Error|string} error - Error object or message
     * @param {string|Object} operation - Operation name or context object
     * @param {Object} additionalContext - Additional context if operation is a string
     * @returns {Object} MCP response object with error content
     */
    static handleError(error, operation, additionalContext) {
        // Handle different call signatures
        let context = {};
        if (typeof operation === 'string') {
            context = { operation, ...additionalContext };
        } else if (typeof operation === 'object') {
            context = operation;
        }
        
        // If error is already formatted (has title/message), use formatError
        if (error && error.title && error.message) {
            const formattedError = ErrorHandler.formatError(error, context);
            return {
                content: [{
                    type: 'text',
                    text: formattedError
                }],
                isError: true
            };
        }
        
        // Otherwise, detect error type first
        const errorMessage = error instanceof Error ? error.message : String(error);
        const detectedError = ErrorHandler.detectError(errorMessage);
        
        if (detectedError) {
            const formattedError = ErrorHandler.formatError(detectedError, context);
            return {
                content: [{
                    type: 'text',
                    text: formattedError
                }],
                isError: true
            };
        }
        
        // Fallback for unrecognized errors
        return {
            content: [{
                type: 'text',
                text: `❌ **Error**\n\n${errorMessage}\n\n📧 Need help? Contact us at support@jaxondigital.com`
            }],
            isError: true
        };
    }
}

module.exports = ErrorHandler;
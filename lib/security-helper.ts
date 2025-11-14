/**
 * Security Helper Module
 * Provides security utilities for protecting sensitive information
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

interface Credentials {
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
}

interface ValidationResult {
    valid: boolean;
    errors: string[];
}

interface SecurityCheckResult {
    secure: boolean;
    warnings: string[];
    issues: string[];
}

class SecurityHelper {
    /**
     * List of patterns that indicate sensitive information
     */
    static SENSITIVE_PATTERNS = [
        /api[-_]?key/i,
        /api[-_]?secret/i,
        /client[-_]?key/i,
        /client[-_]?secret/i,
        /password/i,
        /token/i,
        /bearer/i,
        /authorization/i,
        /x-api-key/i
    ];

    /**
     * Mask a sensitive value for display
     * @param {string} value - The value to mask
     * @param {number} showChars - Number of characters to show at start (default 4)
     * @returns {string} Masked value
     */
    static maskSecret(value: string, showChars: number = 4): string {
        if (!value || typeof value !== 'string') {
            return '***';
        }

        if (value.length <= showChars) {
            return '***';
        }

        const prefix = value.substring(0, showChars);
        const maskedLength = Math.min(value.length - showChars, 20);
        return `${prefix}${'*'.repeat(maskedLength)}`;
    }

    /**
     * Check if a string contains potential secrets
     * @param {string} text - Text to check
     * @returns {boolean} True if potential secrets detected
     */
    static containsSecrets(text: string): boolean {
        if (!text || typeof text !== 'string') {
            return false;
        }

        // Check for patterns that look like API keys or secrets
        const suspiciousPatterns = [
            /[a-zA-Z0-9]{32,}/,  // Long alphanumeric strings
            /sk_[a-zA-Z0-9]{32,}/, // Stripe-like keys
            /ey[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/, // JWT tokens
            /ghp_[a-zA-Z0-9]{36,}/, // GitHub tokens
            /[a-f0-9]{40}/, // SHA1 hashes (common for API keys)
        ];

        return suspiciousPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Sanitize an object by masking sensitive fields
     * @param {Object} obj - Object to sanitize
     * @param {Array<string>} additionalFields - Additional field names to mask
     * @returns {Object} Sanitized copy of the object
     */
    static sanitizeObject(obj: any, additionalFields: string[] = []): any {
        if (!obj || typeof obj !== 'object') {
            return obj;
        }

        const sanitized = JSON.parse(JSON.stringify(obj)); // Deep clone
        const sensitiveFields = [
            'apiKey', 'apiSecret', 'api_key', 'api_secret',
            'clientKey', 'clientSecret', 'client_key', 'client_secret',
            'password', 'token', 'secret', 'authorization',
            ...additionalFields
        ];

        function sanitizeRecursive(obj: any): void {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const lowerKey = key.toLowerCase();

                    // Check if this is a sensitive field
                    if (sensitiveFields.some(field => lowerKey.includes(field.toLowerCase()))) {
                        if (typeof obj[key] === 'string') {
                            obj[key] = SecurityHelper.maskSecret(obj[key]);
                        }
                    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                        sanitizeRecursive(obj[key]);
                    }
                }
            }
        }

        sanitizeRecursive(sanitized);
        return sanitized;
    }

    /**
     * Sanitize error messages to remove sensitive information
     * @param {string|Error} error - Error message or Error object
     * @returns {string} Sanitized error message
     */
    static sanitizeError(error: string | Error): string {
        let message = error instanceof Error ? error.message : String(error);

        // Remove common patterns that might contain secrets
        const patterns = [
            // API keys in URLs
            /api[-_]?key[=:]["']?[a-zA-Z0-9-_]+/gi,
            /client[-_]?key[=:]["']?[a-zA-Z0-9-_]+/gi,
            // Secrets in error messages
            /secret[=:]["']?[a-zA-Z0-9-_]+/gi,
            /password[=:]["']?[a-zA-Z0-9-_]+/gi,
            // Bearer tokens
            /bearer\s+[a-zA-Z0-9-_\.]+/gi,
            // Basic auth
            /basic\s+[a-zA-Z0-9+\/=]+/gi,
            // URLs with credentials
            /https?:\/\/[^:]+:[^@]+@/gi,
        ];

        patterns.forEach(pattern => {
            message = message.replace(pattern, (match) => {
                const type = match.split(/[=:]/)[0];
                return `${type}=***REDACTED***`;
            });
        });

        return message;
    }

    /**
     * Sanitize command strings (for logging)
     * @param {string} command - Command string that might contain secrets
     * @returns {string} Sanitized command
     */
    static sanitizeCommand(command: string): string {
        if (!command || typeof command !== 'string') {
            return command;
        }

        let sanitized = command;

        // Patterns for PowerShell parameters with secrets
        const patterns = [
            /-ClientKey\s+['"]?([^'";\s]+)['"]?/gi,
            /-ClientSecret\s+['"]?([^'";\s]+)['"]?/gi,
            /-ApiKey\s+['"]?([^'";\s]+)['"]?/gi,
            /-ApiSecret\s+['"]?([^'";\s]+)['"]?/gi,
            /-Password\s+['"]?([^'";\s]+)['"]?/gi,
        ];

        patterns.forEach(pattern => {
            sanitized = sanitized.replace(pattern, (match, secret) => {
                const param = match.split(/\s+/)[0];
                return `${param} '${SecurityHelper.maskSecret(secret)}'`;
            });
        });

        return sanitized;
    }

    /**
     * Check if a string is a valid UUID
     * @param {string} str - String to check
     * @param {boolean} strictV4 - Whether to enforce UUID v4 format
     * @returns {boolean} True if valid UUID
     */
    static isValidUuid(str: string, strictV4: boolean = false): boolean {
        if (!str) return false;

        const loosePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
        const strictPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

        if (strictV4) {
            return strictPattern.test(str);
        }
        return loosePattern.test(str);
    }

    /**
     * Validate that required secrets are present and properly formatted
     * @param {Object} credentials - Credentials object
     * @returns {Object} Validation result {valid: boolean, errors: string[]}
     */
    static validateCredentials(credentials: Credentials): ValidationResult {
        const errors: string[] = [];

        if (!credentials) {
            return { valid: false, errors: ['No credentials provided'] };
        }

        // Check API Key
        if (!credentials.apiKey) {
            errors.push('API Key is missing');
        } else if (credentials.apiKey.length < 20) {
            errors.push('API Key appears to be invalid (too short)');
        } else if (credentials.apiKey.includes(' ')) {
            errors.push('API Key contains spaces (likely invalid)');
        }

        // Check API Secret
        if (!credentials.apiSecret) {
            errors.push('API Secret is missing');
        } else if (credentials.apiSecret.length < 20) {
            errors.push('API Secret appears to be invalid (too short)');
        } else if (credentials.apiSecret.includes(' ')) {
            errors.push('API Secret contains spaces (likely invalid)');
        }

        // Check Project ID - enforce strict UUID v4 format
        if (!credentials.projectId) {
            errors.push('Project ID is missing');
        } else {
            // Strict UUID v4 pattern: 8-4-4-4-12 hexadecimal digits
            const strictUuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
            const looseUuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

            if (!credentials.projectId.match(looseUuidPattern)) {
                errors.push(`Project ID has invalid format. Expected UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (Got: ${credentials.projectId})`);
            } else if (!credentials.projectId.match(strictUuidPattern)) {
                // It's a valid UUID format but not v4 - add warning but don't fail
                console.warn(`⚠️  Project ID '${credentials.projectId}' is not a standard UUID v4. This may work but could indicate an issue.`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Create a safe logging context
     * @param {Object} context - Context object that might contain secrets
     * @returns {Object} Safe context for logging
     */
    static createSafeLogContext(context: any): any {
        const safe: any = {};

        for (const key in context) {
            if (context.hasOwnProperty(key)) {
                const lowerKey = key.toLowerCase();

                if (lowerKey.includes('secret') ||
                    lowerKey.includes('key') ||
                    lowerKey.includes('token') ||
                    lowerKey.includes('password')) {
                    safe[key] = '***REDACTED***';
                } else if (typeof context[key] === 'object') {
                    safe[key] = SecurityHelper.sanitizeObject(context[key]);
                } else {
                    safe[key] = context[key];
                }
            }
        }

        return safe;
    }

    /**
     * Check environment variables for exposed secrets
     * @returns {Object} Security check result
     */
    static checkEnvironmentSecurity(): SecurityCheckResult {
        const warnings: string[] = [];
        const securityIssues: string[] = [];

        // Check if secrets are in environment
        const envVars = process.env;
        const secretVars = [
            'OPTIMIZELY_API_KEY',
            'OPTIMIZELY_API_SECRET'
        ];

        secretVars.forEach(varName => {
            if (envVars[varName]) {
                // Check if the value looks exposed
                const value = envVars[varName]!;

                // Check for common mistakes
                if (value.startsWith('$')) {
                    securityIssues.push(`${varName} appears to be a variable reference, not the actual value`);
                } else if (value.includes('\\') || value.includes('/')) {
                    warnings.push(`${varName} contains path characters - verify it's not a file path`);
                } else if (value.length < 20) {
                    warnings.push(`${varName} seems unusually short - verify it's correct`);
                }
            }
        });

        return {
            secure: securityIssues.length === 0,
            warnings,
            issues: securityIssues
        };
    }
}

export default SecurityHelper;

/**
 * Retry Helper Module
 * Provides retry logic for transient failures
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const ErrorHandler = require('./error-handler');

class RetryHelper {
    /**
     * Default retry configuration
     */
    static DEFAULT_CONFIG = {
        maxAttempts: 3,
        initialDelay: 1000,  // 1 second
        maxDelay: 30000,     // 30 seconds
        backoffMultiplier: 2,
        jitter: true,        // Add random jitter to prevent thundering herd
        retryableErrors: [
            'TIMEOUT',
            'ECONNREFUSED',
            'ECONNRESET',
            'ETIMEDOUT',
            'ENOTFOUND',
            'ENETUNREACH',
            'EAI_AGAIN',
            'OPERATION_IN_PROGRESS',
            '429',  // Too Many Requests
            '502',  // Bad Gateway
            '503',  // Service Unavailable
            '504',  // Gateway Timeout
        ]
    };

    /**
     * Execute a function with retry logic
     * @param {Function} fn - The async function to execute
     * @param {Object} options - Retry configuration options
     * @returns {Promise<*>} Result from the function
     */
    static async withRetry(fn, options = {}) {
        const config = { ...this.DEFAULT_CONFIG, ...options };
        let lastError;
        let delay = config.initialDelay;

        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                // Log attempt if verbose
                if (config.verbose) {
                    console.error(`Attempt ${attempt}/${config.maxAttempts}...`);
                }

                // Execute the function
                const result = await fn();
                
                // Success - return the result
                return result;

            } catch (error) {
                lastError = error;

                // Check if this error is retryable
                if (!this.isRetryableError(error, config.retryableErrors)) {
                    // Not retryable - throw immediately
                    throw error;
                }

                // Check if we have more attempts
                if (attempt >= config.maxAttempts) {
                    // No more attempts - throw the error
                    const enhancedError = new Error(
                        `Operation failed after ${config.maxAttempts} attempts: ${error.message}`
                    );
                    enhancedError.originalError = error;
                    enhancedError.attempts = attempt;
                    throw enhancedError;
                }

                // Calculate delay for next attempt
                let nextDelay = this.calculateDelay(delay, config);
                
                // If it's a rate limit error with retryAfter, respect that timing
                if (error.rateLimited && error.retryAfter) {
                    const retryAfterDelay = error.retryAfter - Date.now();
                    if (retryAfterDelay > 0) {
                        nextDelay = Math.max(nextDelay, retryAfterDelay);
                    }
                }
                
                // Log retry information
                const errorType = error.rateLimited ? 'Rate limit' : 'Retryable error';
                console.error(`⚠️  ${errorType} on attempt ${attempt}/${config.maxAttempts}: ${error.message || error}`);
                console.error(`   Retrying in ${Math.round(nextDelay / 1000)} seconds...`);

                // Wait before retrying
                await this.sleep(nextDelay);

                // Update delay for next iteration
                delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
            }
        }

        // Should never reach here, but just in case
        throw lastError;
    }

    /**
     * Check if an error is retryable
     * @param {Error|Object} error - The error to check
     * @param {Array<string>} retryableErrors - List of retryable error codes/messages
     * @returns {boolean} True if the error is retryable
     */
    static isRetryableError(error, retryableErrors) {
        if (!error) return false;

        // Check error code
        if (error.code && retryableErrors.includes(error.code)) {
            return true;
        }

        // Check error message for patterns
        const errorMessage = error.message || error.toString();
        for (const pattern of retryableErrors) {
            if (errorMessage.includes(pattern)) {
                return true;
            }
        }

        // Check for specific PowerShell/DXP errors
        if (errorMessage.includes('on-going') || 
            errorMessage.includes('already running') ||
            errorMessage.includes('timeout') ||
            errorMessage.includes('timed out') ||
            errorMessage.includes('rate limit') ||
            errorMessage.includes('throttled') ||
            errorMessage.includes('429') ||
            errorMessage.includes('Too Many Requests')) {
            return true;
        }
        
        // Check for rate limiting in result object
        if (error.rateLimited) {
            return true;
        }

        // Check stderr if available
        if (error.stderr) {
            for (const pattern of retryableErrors) {
                if (error.stderr.includes(pattern)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Calculate delay with optional jitter
     * @param {number} baseDelay - Base delay in milliseconds
     * @param {Object} config - Configuration object
     * @returns {number} Delay with jitter applied
     */
    static calculateDelay(baseDelay, config) {
        if (!config.jitter) {
            return baseDelay;
        }

        // Add random jitter (±25% of base delay)
        const jitterRange = baseDelay * 0.25;
        const jitter = Math.random() * jitterRange * 2 - jitterRange;
        return Math.max(0, baseDelay + jitter);
    }

    /**
     * Sleep for specified milliseconds
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Wrap a PowerShell execution with retry logic
     * @param {Function} executeFn - The PowerShell execution function
     * @param {Object} context - Context for error messages
     * @param {Object} retryOptions - Retry configuration
     * @returns {Promise<*>} Result from PowerShell execution
     */
    static async retryPowerShell(executeFn, context = {}, retryOptions = {}) {
        // Add PowerShell-specific retry configuration
        const options = {
            ...retryOptions,
            retryableErrors: [
                ...this.DEFAULT_CONFIG.retryableErrors,
                'Connect-EpiCloud',
                'Get-EpiDeployment',
                'cannot be run',
                'service is temporarily unavailable',
                'rate limit',
                'throttled'
            ]
        };

        try {
            return await this.withRetry(executeFn, options);
        } catch (error) {
            // Enhance error with context
            if (context.operation) {
                error.message = `${context.operation} failed: ${error.message}`;
            }
            
            // Check if ErrorHandler can provide better formatting
            const detectedError = ErrorHandler.detectError(error.message || error.stderr, context);
            if (detectedError) {
                const formattedError = ErrorHandler.formatError(detectedError, context);
                const enhancedError = new Error(formattedError);
                enhancedError.originalError = error;
                throw enhancedError;
            }

            throw error;
        }
    }

    /**
     * Create a retry wrapper for a specific operation
     * @param {string} operationName - Name of the operation
     * @param {Object} defaultOptions - Default retry options
     * @returns {Function} Wrapped function with retry logic
     */
    static createRetryWrapper(operationName, defaultOptions = {}) {
        return async (fn, context = {}) => {
            const enhancedContext = {
                ...context,
                operation: operationName
            };

            return this.retryPowerShell(fn, enhancedContext, defaultOptions);
        };
    }
}

module.exports = RetryHelper;
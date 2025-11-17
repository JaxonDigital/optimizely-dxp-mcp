/**
 * Retry Helper Module
 * Provides retry logic for transient failures
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import ErrorHandler from './error-handler';

// Type definitions
interface RetryConfig {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    jitter?: boolean;
    retryableErrors?: string[];
    verbose?: boolean;
}

interface RetryableError extends Error {
    code?: string;
    stderr?: string;
    rateLimited?: boolean;
    retryAfter?: number;
}

interface EnhancedError extends Error {
    originalError?: Error;
    attempts?: number;
}

interface OperationContext {
    operation?: string;
    [key: string]: any;
}

class RetryHelper {
    /**
     * Default retry configuration
     */
    static DEFAULT_CONFIG: Required<RetryConfig> = {
        maxAttempts: 3,
        initialDelay: 1000,  // 1 second
        maxDelay: 30000,     // 30 seconds
        backoffMultiplier: 2,
        jitter: true,        // Add random jitter to prevent thundering herd
        verbose: false,
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
     * @param fn - The async function to execute
     * @param options - Retry configuration options
     * @returns Result from the function
     */
    static async withRetry<T>(fn: () => Promise<T>, options: RetryConfig = {}): Promise<T> {
        const config: Required<RetryConfig> = { ...this.DEFAULT_CONFIG, ...options };
        let lastError: RetryableError | undefined;
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
                lastError = error as RetryableError;

                // Check if this error is retryable
                if (!this.isRetryableError(lastError, config.retryableErrors)) {
                    // Not retryable - throw immediately
                    throw error;
                }

                // Check if we have more attempts
                if (attempt >= config.maxAttempts) {
                    // No more attempts - throw the error
                    const enhancedError = new Error(
                        `Operation failed after ${config.maxAttempts} attempts: ${lastError.message}`
                    ) as EnhancedError;
                    enhancedError.originalError = lastError;
                    enhancedError.attempts = attempt;
                    throw enhancedError;
                }

                // Calculate delay for next attempt
                let nextDelay = this.calculateDelay(delay, config);

                // If it's a rate limit error with retryAfter, respect that timing
                if (lastError.rateLimited && lastError.retryAfter) {
                    const retryAfterDelay = lastError.retryAfter - Date.now();
                    if (retryAfterDelay > 0) {
                        nextDelay = Math.max(nextDelay, retryAfterDelay);
                    }
                }

                // Log retry information
                const errorType = lastError.rateLimited ? 'Rate limit' : 'Retryable error';
                console.error(`⚠️  ${errorType} on attempt ${attempt}/${config.maxAttempts}: ${lastError.message || lastError}`);
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
     * @param error - The error to check
     * @param retryableErrors - List of retryable error codes/messages
     * @returns True if the error is retryable
     */
    static isRetryableError(error: RetryableError | null | undefined, retryableErrors: string[]): boolean {
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

        // Check for specific API/DXP errors
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
     * @param baseDelay - Base delay in milliseconds
     * @param config - Configuration object
     * @returns Delay with jitter applied
     */
    static calculateDelay(baseDelay: number, config: RetryConfig): number {
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
     * @param ms - Milliseconds to sleep
     * @returns Promise that resolves after delay
     */
    static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Wrap an API operation with retry logic
     * @param executeFn - The API operation function
     * @param context - Context for error messages
     * @param retryOptions - Retry configuration
     * @returns Result from API operation
     */
    static async retryOperation<T>(
        executeFn: () => Promise<T>,
        context: OperationContext = {},
        retryOptions: RetryConfig = {}
    ): Promise<T> {
        // Add API-specific retry configuration
        const options: RetryConfig = {
            ...retryOptions,
            retryableErrors: [
                ...(this.DEFAULT_CONFIG.retryableErrors || []),
                'deployment',
                'cannot be run',
                'service is temporarily unavailable',
                'rate limit',
                'throttled'
            ]
        };

        try {
            return await this.withRetry(executeFn, options);
        } catch (error) {
            const err = error as RetryableError;

            // Enhance error with context
            if (context.operation) {
                err.message = `${context.operation} failed: ${err.message}`;
            }

            // Check if ErrorHandler can provide better formatting
            const detectedError = ErrorHandler.detectError(err.message || err.stderr || '', context);
            if (detectedError) {
                const formattedError = ErrorHandler.formatError(detectedError, context);
                const enhancedError = new Error(formattedError) as EnhancedError;
                enhancedError.originalError = err;
                throw enhancedError;
            }

            throw error;
        }
    }

    /**
     * Create a retry wrapper for a specific operation
     * @param operationName - Name of the operation
     * @param defaultOptions - Default retry options
     * @returns Wrapped function with retry logic
     */
    static createRetryWrapper(
        operationName: string,
        defaultOptions: RetryConfig = {}
    ): <T>(fn: () => Promise<T>, context?: OperationContext) => Promise<T> {
        return async <T>(fn: () => Promise<T>, context: OperationContext = {}): Promise<T> => {
            const enhancedContext: OperationContext = {
                ...context,
                operation: operationName
            };

            return this.retryOperation(fn, enhancedContext, defaultOptions);
        };
    }

    /**
     * Legacy alias for backward compatibility
     * @deprecated Use retryOperation() instead
     */
    static async retryPowerShell<T>(
        executeFn: () => Promise<T>,
        context: OperationContext = {},
        retryOptions: RetryConfig = {}
    ): Promise<T> {
        return this.retryOperation(executeFn, context, retryOptions);
    }
}

export default RetryHelper;

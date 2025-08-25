/**
 * Smart Executor Module
 * Provides intelligent command execution with automatic retry, caching, and error handling
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const PowerShellHelper = require('./powershell-helper');
const RetryHelper = require('./retry-helper');
const ErrorHandler = require('./error-handler');

class SmartExecutor {
    /**
     * Execute an EpiCloud command with all enterprise features
     * Includes: retry logic, caching, rate limiting, enhanced errors
     * 
     * @param {string} command - The EpiCloud command to execute
     * @param {Object} credentials - API credentials {apiKey, apiSecret, projectId}
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Enhanced result object
     */
    static async execute(command, credentials, options = {}) {
        const {
            operation = 'api_call',
            useCache = true,
            useRetry = true,
            maxAttempts = 3,
            parseJson = true,
            timeout = 120000,
            cacheArgs = {},
            verbose = false
        } = options;

        // Build context for error messages
        const context = {
            operation: operation,
            projectId: credentials.projectId,
            projectName: credentials.projectName
        };

        try {
            // Determine if we should use caching
            const shouldCache = useCache && !PowerShellHelper.isWriteOperation(operation);
            
            // Create the execution function
            const executeFn = async () => {
                // Try with cache if applicable
                if (shouldCache) {
                    const result = await PowerShellHelper.executeEpiCommand(
                        command, 
                        credentials, 
                        {
                            timeout,
                            parseJson,
                            operation,
                            cacheArgs
                        }
                    );
                    
                    if (result.fromCache && verbose) {
                        console.error(`📦 Using cached result (age: ${Math.round(result.cacheAge / 1000)}s)`);
                    }
                    
                    return result;
                } else {
                    // Write operations use invalidation
                    return await PowerShellHelper.executeEpiCommandWithInvalidation(
                        command,
                        credentials,
                        {
                            timeout,
                            parseJson,
                            operation,
                            cacheArgs
                        }
                    );
                }
            };

            // Execute with or without retry
            let result;
            if (useRetry) {
                result = await RetryHelper.retryPowerShell(
                    executeFn,
                    context,
                    {
                        maxAttempts,
                        verbose,
                        initialDelay: 2000,
                        maxDelay: 30000,
                        backoffMultiplier: 2,
                        jitter: true
                    }
                );
            } else {
                result = await executeFn();
            }

            // Enhance successful result
            if (result.success) {
                return {
                    ...result,
                    operation,
                    projectId: credentials.projectId,
                    projectName: credentials.projectName,
                    timestamp: new Date().toISOString()
                };
            }

            // Handle failures with enhanced error messages
            const error = ErrorHandler.detectError(result.stderr, context);
            if (error) {
                result.formattedError = ErrorHandler.formatError(error, context);
                result.errorType = error.type;
                result.suggestion = error.suggestion;
            }

            return result;

        } catch (error) {
            // Handle exceptions with comprehensive error information
            const detectedError = ErrorHandler.detectError(
                error.message || error.stderr || error.toString(),
                context
            );

            if (detectedError) {
                return {
                    success: false,
                    error: error.message,
                    stderr: error.stderr || '',
                    formattedError: ErrorHandler.formatError(detectedError, context),
                    errorType: detectedError.type,
                    suggestion: detectedError.suggestion,
                    operation,
                    projectId: credentials.projectId,
                    timestamp: new Date().toISOString()
                };
            }

            // Fallback for unknown errors
            return {
                success: false,
                error: error.message || error.toString(),
                stderr: error.stderr || '',
                operation,
                projectId: credentials.projectId,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Execute a batch of commands with optimized handling
     * @param {Array<Object>} commands - Array of {command, credentials, options}
     * @param {Object} batchOptions - Batch execution options
     * @returns {Promise<Array<Object>>} Array of results
     */
    static async executeBatch(commands, batchOptions = {}) {
        const {
            parallel = true,
            maxConcurrency = 3,
            stopOnError = false,
            verbose = false
        } = batchOptions;

        if (parallel) {
            // Execute in parallel with concurrency limit
            const results = [];
            const executing = [];
            
            for (const cmd of commands) {
                const promise = this.execute(cmd.command, cmd.credentials, cmd.options)
                    .then(result => {
                        if (verbose) {
                            const status = result.success ? '✅' : '❌';
                            console.error(`${status} ${cmd.options?.operation || 'Command'} completed`);
                        }
                        return result;
                    });
                
                executing.push(promise);
                
                if (executing.length >= maxConcurrency) {
                    const result = await Promise.race(executing);
                    results.push(result);
                    executing.splice(executing.indexOf(promise), 1);
                    
                    if (stopOnError && !result.success) {
                        throw new Error(`Batch execution stopped: ${result.error || result.stderr}`);
                    }
                }
            }
            
            // Wait for remaining operations
            const remaining = await Promise.all(executing);
            results.push(...remaining);
            
            return results;
        } else {
            // Execute sequentially
            const results = [];
            
            for (const cmd of commands) {
                if (verbose) {
                    console.error(`⏳ Executing ${cmd.options?.operation || 'command'}...`);
                }
                
                const result = await this.execute(cmd.command, cmd.credentials, cmd.options);
                results.push(result);
                
                if (stopOnError && !result.success) {
                    throw new Error(`Batch execution stopped: ${result.error || result.stderr}`);
                }
            }
            
            return results;
        }
    }

    /**
     * Execute with streaming progress updates
     * @param {string} command - The EpiCloud command to execute
     * @param {Object} credentials - API credentials
     * @param {Object} options - Execution options including onProgress callback
     * @returns {Promise<Object>} Result object
     */
    static async executeWithProgress(command, credentials, options = {}) {
        const { onProgress, ...execOptions } = options;
        
        // If no progress callback, use regular execution
        if (!onProgress) {
            return this.execute(command, credentials, execOptions);
        }

        try {
            // Use streaming execution from PowerShellHelper
            const result = await PowerShellHelper.executeEpiCommandStreaming(
                command,
                credentials,
                {
                    ...execOptions,
                    onProgress
                }
            );

            // Enhance the result
            return {
                ...result,
                operation: execOptions.operation,
                projectId: credentials.projectId,
                projectName: credentials.projectName,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            const context = {
                operation: execOptions.operation,
                projectId: credentials.projectId,
                projectName: credentials.projectName
            };

            const detectedError = ErrorHandler.detectError(error.message, context);
            if (detectedError) {
                error.formattedError = ErrorHandler.formatError(detectedError, context);
            }

            throw error;
        }
    }

    /**
     * Get cache statistics for monitoring
     * @returns {Object} Cache statistics
     */
    static getCacheStats() {
        return PowerShellHelper.getCacheStats();
    }

    /**
     * Clear cache for a project or all projects
     * @param {string} projectId - Optional project ID
     */
    static clearCache(projectId) {
        PowerShellHelper.clearCache(projectId);
    }
}

module.exports = SmartExecutor;
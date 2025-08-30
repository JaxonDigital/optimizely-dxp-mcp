/**
 * PowerShell Helper Module
 * Centralized PowerShell command execution and response handling
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { promisify } = require('util');
const { exec, spawn } = require('child_process');
const execAsync = promisify(exec);
const SecurityHelper = require('./security-helper');
const RetryHelper = require('./retry-helper');
const RateLimiter = require('./rate-limiter');
const CacheManager = require('./cache-manager');
const { getPowerShellDetector } = require('./powershell-detector');
const OutputLogger = require('./output-logger');

// Global instances
let rateLimiter = null;
let cacheManager = null;
let powerShellCommand = null;

class PowerShellHelper {
    /**
     * Get or create rate limiter instance
     */
    static getRateLimiter() {
        if (!rateLimiter) {
            rateLimiter = new RateLimiter({
                maxRequestsPerMinute: 30, // Conservative limit
                maxRequestsPerHour: 500,
                burstAllowance: 5,
                debug: process.env.DEBUG === 'true'
            });
        }
        return rateLimiter;
    }

    /**
     * Get or create cache manager instance
     */
    static getCacheManager() {
        if (!cacheManager) {
            cacheManager = new CacheManager({
                debug: process.env.DEBUG === 'true'
            });
        }
        return cacheManager;
    }

    /**
     * Get PowerShell command to use
     */
    static async getPowerShellCommand() {
        if (!powerShellCommand) {
            // Skip detection to avoid hangs - just use pwsh directly
            // The npm package works, so we know pwsh is available
            powerShellCommand = 'pwsh';
            OutputLogger.info('Using PowerShell Core (pwsh)');
        }
        return powerShellCommand;
    }
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
        
        const { timeout = 120000, parseJson = true, operation = 'api_call' } = options;
        
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

        // Check cache first (if operation supports caching)
        const cache = this.getCacheManager();
        const cachedResult = cache.get(operation, options.cacheArgs || {}, projectId);
        if (cachedResult) {
            // Return cached result with cache metadata
            return {
                ...cachedResult,
                fromCache: true,
                cacheAge: Date.now() - (cachedResult.cachedAt || Date.now())
            };
        }

        // Check rate limits
        const limiter = this.getRateLimiter();
        const rateLimitCheck = limiter.checkRateLimit(projectId, operation);
        
        if (!rateLimitCheck.allowed) {
            const waitTime = Math.ceil(rateLimitCheck.waitTime / 1000);
            let errorMessage = '';
            
            switch (rateLimitCheck.reason) {
                case 'rate_limit_minute':
                    errorMessage = `Rate limit exceeded: Too many requests per minute. Wait ${waitTime} seconds.`;
                    break;
                case 'rate_limit_hour':
                    errorMessage = `Rate limit exceeded: Too many requests per hour. Wait ${waitTime} seconds.`;
                    break;
                case 'throttled':
                    errorMessage = `API throttled: Server returned 429. Wait ${waitTime} seconds.`;
                    break;
                case 'backoff':
                    errorMessage = `Backing off due to repeated failures. Wait ${waitTime} seconds.`;
                    break;
                case 'burst_protection':
                    errorMessage = `Burst protection: Too many rapid requests. Wait ${waitTime} seconds.`;
                    break;
                default:
                    errorMessage = `Request blocked: ${rateLimitCheck.reason}. Wait ${waitTime} seconds.`;
            }
            
            console.error(`Rate limit: ${errorMessage}`);
            return {
                stdout: '',
                stderr: errorMessage,
                parsedData: null,
                success: false,
                rateLimited: true,
                retryAfter: rateLimitCheck.retryAfter
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
            OutputLogger.info(`Executing command: ${SecurityHelper.sanitizeCommand(command)}`);
        }

        let stdout = '';
        let stderr = '';
        
        try {
            const psCommand = await this.getPowerShellCommand();
            const result = await execAsync(`${psCommand} -Command "${psScript}"`, { timeout });
            stdout = result.stdout;
            stderr = result.stderr;
            
            // Record successful request
            limiter.recordRequest(projectId, operation);
            
        } catch (error) {
            stdout = error.stdout || '';
            stderr = error.stderr || error.message || '';
            
            // Enhanced error detection and messaging
            if (stderr.includes('Import-Module : The specified module \'EpiCloud\' was not loaded')) {
                stderr = '❌ EpiCloud PowerShell module not installed!\n\n' +
                         '**To install:**\n' +
                         '```powershell\n' +
                         'Install-Module -Name EpiCloud -Force -Scope CurrentUser\n' +
                         '```\n\n' +
                         'Original error: ' + stderr;
            } else if (stderr.includes('Connect-EpiCloud : ') && stderr.includes('401')) {
                stderr = '❌ Authentication failed!\n\n' +
                         '**Possible causes:**\n' +
                         '• Invalid API key or secret\n' +
                         '• API key doesn\'t have access to this project\n' +
                         '• Credentials have expired\n\n' +
                         '**To fix:**\n' +
                         '1. Verify your API credentials in Optimizely DXP portal\n' +
                         '2. Ensure the API key has the necessary permissions\n' +
                         '3. Try regenerating your API credentials\n\n' +
                         'Original error: ' + stderr;
            } else if (stderr.includes('429') || stderr.includes('Too Many Requests') || stderr.includes('rate limit')) {
                // Parse retry-after if available
                const retryMatch = stderr.match(/retry[- ]?after[:\s]*(\d+)/i);
                const retryAfter = retryMatch ? parseInt(retryMatch[1]) * 1000 : undefined;
                
                limiter.recordRateLimit(projectId, { retryAfter });
                
                const waitTime = retryAfter ? Math.ceil(retryAfter / 1000) : 60;
                stderr = `⏱️ Rate limit exceeded!\n\n` +
                         `**Please wait ${waitTime} seconds before retrying.**\n\n` +
                         `The API has temporary limits to prevent overload.\n` +
                         `This is normal and will automatically resolve.\n\n` +
                         'Original error: ' + stderr;
            } else {
                // Record other failures for backoff calculation
                limiter.recordFailure(projectId, error);
            }
        }

        // Parse JSON if requested and possible
        let parsedData = null;
        if (parseJson && stdout) {
            parsedData = this.parseJsonFromOutput(stdout);
        }

        const success = !stderr || (!stderr.includes('error') && !stderr.includes('Exception'));
        
        // Check for rate limit indicators in response
        if (stderr.includes('429') || stderr.includes('Too Many Requests') || stderr.includes('rate limit')) {
            return {
                stdout,
                stderr,
                parsedData,
                success: false,
                rateLimited: true
            };
        }

        const result = {
            stdout,
            stderr,
            parsedData,
            success,
            cachedAt: Date.now()
        };

        // Cache successful results
        if (success && parsedData) {
            cache.set(operation, options.cacheArgs || {}, projectId, result);
        }

        return result;
    }

    /**
     * Execute PowerShell command with cache invalidation for write operations
     * @param {string} command - The EpiCloud command to execute
     * @param {Object} credentials - API credentials
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Result with stdout, stderr, and parsed data
     */
    static async executeEpiCommandWithInvalidation(command, credentials, options = {}) {
        const result = await this.executeEpiCommand(command, credentials, options);
        
        // If it's a write operation and successful, invalidate related cache
        if (result.success && options.operation && this.isWriteOperation(options.operation)) {
            const cache = this.getCacheManager();
            const projectId = credentials.projectId || process.env.OPTIMIZELY_PROJECT_ID;
            cache.invalidateRelated(options.operation, projectId);
        }
        
        return result;
    }

    /**
     * Check if operation is a write operation that should invalidate cache
     * @param {string} operation - Operation name
     * @returns {boolean} Whether operation is a write operation
     */
    static isWriteOperation(operation) {
        const writeOperations = new Set([
            'start_deployment',
            'complete_deployment', 
            'reset_deployment',
            'upload_deployment_package',
            'deploy_package_and_start',
            'copy_content',
            'export_database'
        ]);
        
        return writeOperations.has(operation);
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    static getCacheStats() {
        const cache = this.getCacheManager();
        return cache.getStats();
    }

    /**
     * Clear cache for a specific project or all projects
     * @param {string} projectId - Optional project ID to clear specific project cache
     */
    static clearCache(projectId) {
        const cache = this.getCacheManager();
        cache.clear(projectId);
    }

    /**
     * Execute a raw PowerShell script (not EpiCloud specific)
     * @param {string} script - The PowerShell script to execute
     * @param {Object} options - Additional options {timeout, parseJson}
     * @returns {Promise<Object>} Result with stdout, stderr, and parsed data
     */
    static async executePowerShell(script, options = {}) {
        const { timeout = 120000, parseJson = false } = options;
        
        try {
            // PowerShell -EncodedCommand expects UTF-16LE base64
            const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
            const psCommand = await this.getPowerShellCommand();
            const { stdout, stderr } = await execAsync(`${psCommand} -EncodedCommand ${encodedScript}`, {
                timeout,
                maxBuffer: 1024 * 1024 * 10 // 10MB buffer
            });
            
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
        } catch (error) {
            console.error('PowerShell execution error:', error.message);
            return {
                stdout: '',
                stderr: error.message,
                parsedData: null,
                success: false
            };
        }
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
     * Execute an EpiCloud command with retry logic
     * @param {string} command - The EpiCloud command to execute
     * @param {Object} credentials - API credentials
     * @param {Object} options - Execution options
     * @param {Object} retryOptions - Retry configuration
     * @returns {Promise<Object>} Result with stdout, stderr, and parsed data
     */
    static async executeWithRetry(command, credentials, options = {}, retryOptions = {}) {
        const context = {
            operation: options.operation || 'PowerShell command',
            projectId: credentials.projectId
        };

        // Create the execution function
        const executeFn = async () => {
            return await this.executeEpiCommand(command, credentials, options);
        };

        // Execute with retry logic
        return await RetryHelper.retryPowerShell(executeFn, context, retryOptions);
    }

    /**
     * Execute PowerShell command with streaming support
     * @param {string} command - The EpiCloud command to execute
     * @param {Object} credentials - API credentials
     * @param {Object} options - Execution options including onProgress callback
     * @returns {Promise<Object>} Result with stdout, stderr, and parsed data
     */
    static async executeEpiCommandStreaming(command, credentials, options = {}) {
        // Use provided credentials or fall back to environment variables
        const apiKey = credentials.apiKey || process.env.OPTIMIZELY_API_KEY;
        const apiSecret = credentials.apiSecret || process.env.OPTIMIZELY_API_SECRET;
        const projectId = credentials.projectId || process.env.OPTIMIZELY_PROJECT_ID;
        
        const { timeout = 120000, parseJson = true, onProgress } = options;
        
        // Validate credentials
        const validation = SecurityHelper.validateCredentials({ apiKey, apiSecret, projectId });
        if (!validation.valid) {
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

        return new Promise(async (resolve, reject) => {
            let stdout = '';
            let stderr = '';
            
            // Spawn PowerShell process
            const psCommand = await this.getPowerShellCommand();
            const ps = spawn(psCommand, ['-Command', psScript]);
            
            // Set timeout
            const timer = setTimeout(() => {
                ps.kill();
                reject(new Error(`Command timed out after ${timeout}ms`));
            }, timeout);
            
            // Handle stdout
            ps.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                
                // Call progress callback if provided
                if (onProgress) {
                    onProgress(chunk);
                }
            });
            
            // Handle stderr
            ps.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                
                // Also send verbose output to progress
                if (onProgress && chunk.includes('VERBOSE:')) {
                    onProgress(chunk);
                }
            });
            
            // Handle process exit
            ps.on('close', (code) => {
                clearTimeout(timer);
                
                // Parse JSON if needed
                let parsedData = null;
                if (parseJson && stdout) {
                    parsedData = this.parseJsonFromOutput(stdout);
                }
                
                resolve({
                    stdout,
                    stderr,
                    parsedData,
                    success: !stderr || (!stderr.includes('error') && !stderr.includes('Exception'))
                });
            });
            
            ps.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
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
            const psCommand = await this.getPowerShellCommand();
            const result = await execAsync(`${psCommand} -Command "${command}"`, { timeout });
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
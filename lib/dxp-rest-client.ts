/**
 * DXP REST API Client
 * Direct REST API calls to Optimizely DXP without PowerShell dependency
 * Implements HMAC-SHA256 authentication as used by EpiCloud PowerShell module
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import * as crypto from 'crypto';
import * as https from 'https';
import { URL } from 'url';
import OutputLogger from './output-logger';
import RateLimiter from './rate-limiter';

interface RequestOptions {
    apiUrl?: string;
    projectId?: string;
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
}

interface DeploymentParams {
    TargetEnvironment: string;
    SourceEnvironment?: string;
    PackageUrl?: string;
    ZeroDowntimeMode?: string;
    DirectDeploy?: boolean;
    IncludeBlob?: boolean;
    IncludeDb?: boolean;
    SourceApp?: string;
}

interface ResetOptions {
    RollbackDatabase?: boolean;
    ValidateBeforeSwap?: boolean;
    Complete?: boolean;
}

interface SasOptions {
    retentionHours?: number;
    RetentionHours?: number;
    writable?: boolean;
    Writable?: boolean;
}

interface APIError extends Error {
    statusCode?: number;
    response?: string;
    retryAfter?: string | number;
    code?: string;
}

interface RateCheckResult {
    allowed: boolean;
    reason?: string;
    waitTime?: number;
}

class DXPRestClient {
    /**
     * Default API endpoint
     */
    static DEFAULT_ENDPOINT = 'https://paasportal.episerver.net/api/v1.0/';

    /**
     * Shared rate limiter instance for all API calls
     * Tracks rate limits per project ID
     */
    static rateLimiter = new RateLimiter({
        maxRequestsPerMinute: 30,  // Conservative limit for Optimizely API
        maxRequestsPerHour: 500,   // Hourly limit
        burstAllowance: 5,         // Allow small bursts
        debug: process.env.DEBUG === 'true'
    });

    /**
     * Generate HMAC-SHA256 signature for API request
     * Based on SetApiAuthorizationHeader from EpiCloud.psm1 (lines 533-608)
     *
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret (base64 encoded)
     * @param {string} method - HTTP method (GET, POST, etc.)
     * @param {string} pathAndQuery - URL path and query string
     * @param {string} body - Request body (JSON string)
     * @returns {string} Authorization header value
     */
    static generateAuthHeader(
        clientKey: string,
        clientSecret: string,
        method: string,
        pathAndQuery: string,
        body: string = ''
    ): string {
        try {
            // Generate timestamp (Unix milliseconds)
            const timestamp = Date.now().toString();

            // Generate nonce (UUID without hyphens)
            const nonce = crypto.randomUUID().replace(/-/g, '');

            // Calculate MD5 hash of body
            const bodyBytes = Buffer.from(body, 'utf8');
            const bodyHash = crypto.createHash('md5').update(bodyBytes).digest('base64');

            // Combine message components (line 596 in EpiCloud.psm1)
            // Format: {ClientKey}{Method}{Path}{Timestamp}{Nonce}{BodyHash}
            const message = `${clientKey}${method.toUpperCase()}${pathAndQuery}${timestamp}${nonce}${bodyHash}`;

            // Create HMAC-SHA256 signature
            const secretBuffer = Buffer.from(clientSecret, 'base64');
            const signature = crypto
                .createHmac('sha256', secretBuffer)
                .update(message, 'utf8')
                .digest('base64');

            // Format authorization header (line 604 in EpiCloud.psm1)
            // Format: "epi-hmac {ClientKey}:{Timestamp}:{Nonce}:{Signature}"
            return `epi-hmac ${clientKey}:${timestamp}:${nonce}:${signature}`;

        } catch (error) {
            throw new Error(`Failed to generate auth header: ${(error as Error).message}`);
        }
    }

    /**
     * Make authenticated API request with rate limiting and automatic retry
     * Based on InvokeApiRequest from EpiCloud.psm1 (lines 369-440)
     *
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} uriEnding - API endpoint path
     * @param {string} method - HTTP method (default: GET)
     * @param {Object} payload - Request payload (optional)
     * @param {Object|string} options - Options object with apiUrl, projectId, or legacy baseUrl string
     * @returns {Promise<Object>} API response
     */
    static async makeRequest(
        clientKey: string,
        clientSecret: string,
        uriEnding: string,
        method: string = 'GET',
        payload: any = null,
        options: RequestOptions | string | null = null
    ): Promise<any> {
        // Extract project ID for rate limiting (from URI or options)
        let projectId = 'unknown';
        if (options && typeof options === 'object' && options.projectId) {
            projectId = options.projectId;
        } else {
            // Try to extract from URI (format: projects/{projectId}/...)
            const match = uriEnding.match(/^projects\/([^\/]+)/);
            if (match) {
                projectId = match[1];
            }
        }

        // Configure retry parameters
        const maxRetries = (options && typeof options === 'object' && options.maxRetries) || 3;
        const retryDelay = (options && typeof options === 'object' && options.retryDelay) || 1000;

        let lastError: APIError | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Check rate limit BEFORE making request
                const rateCheck: RateCheckResult = this.rateLimiter.checkRateLimit(projectId, 'api_call');

                if (!rateCheck.allowed) {
                    const waitMs = rateCheck.waitTime || 1000;
                    OutputLogger.debug(`Rate limit: waiting ${waitMs}ms (${rateCheck.reason}) before retry ${attempt}/${maxRetries}`);

                    // Wait for rate limit to clear
                    await this._sleep(waitMs);

                    // Try again after waiting
                    continue;
                }

                // Handle legacy baseUrl parameter (for backward compatibility)
                let apiUrl: string | null = null;
                if (typeof options === 'string') {
                    // Legacy: options was baseUrl string
                    apiUrl = options;
                } else if (options && typeof options === 'object') {
                    // New: options object with apiUrl
                    apiUrl = options.apiUrl || null;
                }

                // Priority order for API endpoint:
                // 1. Directly passed apiUrl (via options)
                // 2. Global environment variable OPTIMIZELY_API_URL
                // 3. DEFAULT_ENDPOINT
                const endpoint = apiUrl ||
                               process.env.OPTIMIZELY_API_URL ||
                               this.DEFAULT_ENDPOINT;
                const fullUrl = new URL(uriEnding, endpoint);

                // Prepare request body
                let body = '';
                if (payload) {
                    body = JSON.stringify(payload);
                }

                // Generate authentication header
                const pathAndQuery = fullUrl.pathname + fullUrl.search;
                const authHeader = this.generateAuthHeader(clientKey, clientSecret, method, pathAndQuery, body);

                // Extract timeout from options (default: 120s for most operations, can be overridden)
                const timeout = (options && typeof options === 'object' && options.timeout) || 120000;

                // Prepare request options
                const requestOptions: https.RequestOptions = {
                    hostname: fullUrl.hostname,
                    port: fullUrl.port || 443,
                    path: pathAndQuery,
                    method: method,
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'User-Agent': 'Jaxon-Optimizely-DXP-MCP/3.0'
                    },
                    timeout: timeout // Configurable timeout (default: 120s)
                };

                if (body) {
                    (requestOptions.headers as any)['Content-Length'] = Buffer.byteLength(body).toString();
                }

                OutputLogger.debug(`API Request: ${method} ${fullUrl.href} (attempt ${attempt}/${maxRetries})`);

                // Make the request
                const result = await this._executeRequest(requestOptions, body);

                // Success - record the request and return
                this.rateLimiter.recordRequest(projectId, 'api_call');
                return result;

            } catch (error) {
                lastError = error as APIError;

                // Check if it's a 429 rate limit error
                if (lastError.statusCode === 429) {
                    // Parse Retry-After header from response
                    const retryAfter = this._parseRetryAfter(lastError.retryAfter) || retryDelay * attempt;

                    // Record the rate limit in our tracker
                    this.rateLimiter.recordRateLimit(projectId, { retryAfter });

                    // If we have more attempts, wait and retry
                    if (attempt < maxRetries) {
                        const waitMs = Math.min(retryAfter, 30000); // Cap at 30 seconds
                        OutputLogger.debug(`HTTP 429: Rate limit exceeded, waiting ${Math.round(waitMs/1000)}s before retry ${attempt + 1}/${maxRetries}`);
                        await this._sleep(waitMs);
                        continue;
                    }

                    // No more retries - throw with helpful message
                    throw new Error(`Rate limit exceeded after ${maxRetries} attempts. Please retry after ${Math.round(retryAfter/1000)} seconds.`);
                }

                // Check for other retryable errors (503, 502, network errors)
                if (this._isRetryableError(lastError) && attempt < maxRetries) {
                    const waitMs = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
                    OutputLogger.debug(`Retryable error (${lastError.message}), waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`);
                    await this._sleep(waitMs);
                    continue;
                }

                // Not retryable or out of retries - throw the error
                throw new Error(`API request failed: ${lastError.message}`);
            }
        }

        // Should never reach here, but just in case
        throw new Error(`API request failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
    }

    /**
     * Execute HTTP request and parse response
     *
     * @private
     * @param {Object} options - Request options
     * @param {string} body - Request body
     * @returns {Promise<Object>} Parsed response
     */
    static _executeRequest(options: https.RequestOptions, body: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        // Check HTTP status
                        if (res.statusCode! < 200 || res.statusCode! >= 300) {
                            // Try to parse error response
                            let errorMessage = `HTTP ${res.statusCode}`;
                            try {
                                const errorData = JSON.parse(data);
                                if (errorData.errors) {
                                    errorMessage += `: ${errorData.errors.join(', ')}`;
                                } else if (errorData.message) {
                                    errorMessage += `: ${errorData.message}`;
                                }
                            } catch {
                                errorMessage += `: ${data.substring(0, 200)}`;
                            }

                            const error = new Error(errorMessage) as APIError;
                            error.statusCode = res.statusCode;
                            error.response = data;
                            // Capture Retry-After header for rate limiting
                            error.retryAfter = res.headers['retry-after'];
                            reject(error);
                            return;
                        }

                        // Parse successful response
                        if (data) {
                            const parsed = JSON.parse(data);

                            // Check API success flag (from EpiCloud.psm1 line 430-432)
                            if (parsed.success === false) {
                                const errorMsg = parsed.errors ? parsed.errors.join(', ') : 'Unknown error';
                                reject(new Error(`API call failed: ${errorMsg}`));
                                return;
                            }

                            // Return result if present, otherwise full response
                            resolve(parsed.result || parsed);
                        } else {
                            resolve({});
                        }

                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${(error as Error).message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request error: ${error.message}`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (body) {
                req.write(body);
            }

            req.end();
        });
    }

    /**
     * Check if error is retryable (network/temporary errors)
     * @private
     * @param {Error} error - Error object
     * @returns {boolean} True if retryable
     */
    static _isRetryableError(error: APIError): boolean {
        if (!error) return false;

        // Check status codes
        if (error.statusCode === 502 || // Bad Gateway
            error.statusCode === 503 || // Service Unavailable
            error.statusCode === 504) { // Gateway Timeout
            return true;
        }

        // Check error codes
        const retryableCodes = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH'];
        if (error.code && retryableCodes.includes(error.code)) {
            return true;
        }

        // Check message patterns
        const message = (error.message || '').toLowerCase();
        if (message.includes('timeout') ||
            message.includes('network') ||
            message.includes('connection')) {
            return true;
        }

        return false;
    }

    /**
     * Parse Retry-After header
     * @private
     * @param {string|number} retryAfter - Retry-After header value
     * @returns {number} Milliseconds to wait
     */
    static _parseRetryAfter(retryAfter: string | number | undefined): number | null {
        if (!retryAfter) return null;

        // If it's a number, treat as seconds
        if (typeof retryAfter === 'number') {
            return retryAfter * 1000;
        }

        // If it's a string, could be seconds or HTTP date
        if (typeof retryAfter === 'string') {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
                return seconds * 1000;
            }

            // Try parsing as date
            const date = new Date(retryAfter);
            if (!isNaN(date.getTime())) {
                return Math.max(0, date.getTime() - Date.now());
            }
        }

        return null;
    }

    /**
     * Sleep helper
     * @private
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    static _sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Test environment access by listing storage containers
     * Equivalent to: Get-EpiStorageContainer -ProjectId $id -Environment $env
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} environment - Environment name (Integration, Preproduction, Production)
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<boolean>} True if access granted
     */
    static async testEnvironmentAccess(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        environment: string,
        options: RequestOptions = {}
    ): Promise<boolean> {
        try {
            const uriEnding = `projects/${projectId}/environments/${environment}/storagecontainers`;
            const result = await this.makeRequest(clientKey, clientSecret, uriEnding, 'GET', null, options);

            // If we got a result, we have access
            return result && (Array.isArray(result) ? result.length >= 0 : true);

        } catch (error) {
            const apiError = error as APIError;
            // Check for access denied errors
            if (apiError.statusCode === 401 || apiError.statusCode === 403) {
                return false;
            }

            // Check message for access denied
            const errorMsg = apiError.message.toLowerCase();
            if (errorMsg.includes('unauthorized') ||
                errorMsg.includes('forbidden') ||
                errorMsg.includes('access denied')) {
                return false;
            }

            // Any other error, assume no access
            OutputLogger.debug(`Environment access test error (${environment}): ${apiError.message}`);
            return false;
        }
    }

    /**
     * Get list of deployments
     * Equivalent to: Get-EpiDeployment -ProjectId $id
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} deploymentId - Optional deployment ID
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Object>} Deployment(s)
     */
    static async getDeployments(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        deploymentId: string | null = null,
        options: RequestOptions = {}
    ): Promise<any> {
        const uriEnding = deploymentId
            ? `projects/${projectId}/deployments/${deploymentId}`
            : `projects/${projectId}/deployments`;

        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'GET', null, options);
    }

    /**
     * Get storage containers for an environment
     * Equivalent to: Get-EpiStorageContainer -ProjectId $id -Environment $env
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} environment - Environment name
     * @param {boolean} writable - Only return writable containers
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Array>} List of storage containers
     */
    static async getStorageContainers(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        environment: string,
        writable: boolean = false,
        options: RequestOptions = {}
    ): Promise<any[]> {
        const uriEnding = `projects/${projectId}/environments/${environment}/storagecontainers${writable ? '?writable=true' : ''}`;
        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'GET', null, options);
    }

    /**
     * Start a deployment
     * Equivalent to: Start-EpiDeployment
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {Object} deploymentParams - Deployment parameters
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Object>} Deployment details
     */
    static async startDeployment(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        deploymentParams: DeploymentParams,
        options: RequestOptions = {}
    ): Promise<any> {
        const uriEnding = `projects/${projectId}/deployments`;
        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'POST', deploymentParams, options);
    }

    /**
     * Complete a deployment
     * Equivalent to: Complete-EpiDeployment
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} deploymentId - Deployment ID to complete
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Object>} Deployment details
     */
    static async completeDeployment(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        deploymentId: string,
        options: RequestOptions = {}
    ): Promise<any> {
        const uriEnding = `projects/${projectId}/deployments/${deploymentId}/complete`;
        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'POST', {}, options);
    }

    /**
     * Reset a deployment
     * Equivalent to: Reset-EpiDeployment
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} deploymentId - Deployment ID to reset
     * @param {Object} resetOptions - Reset options (RollbackDatabase, ValidateBeforeSwap, Complete)
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Object>} Deployment details
     */
    static async resetDeployment(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        deploymentId: string,
        resetOptions: ResetOptions = {},
        options: RequestOptions = {}
    ): Promise<any> {
        const uriEnding = `projects/${projectId}/deployments/${deploymentId}/reset`;
        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'POST', resetOptions, options);
    }

    /**
     * Get package upload location (SAS URL)
     * Equivalent to: Get-EpiDeploymentPackageLocation
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<string>} SAS URL for package upload
     */
    static async getPackageLocation(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        options: RequestOptions = {}
    ): Promise<string> {
        const uriEnding = `projects/${projectId}/packages/location`;
        const result = await this.makeRequest(clientKey, clientSecret, uriEnding, 'GET', null, options);
        // API returns { location: "sas-url" } - return just the URL
        return result.location || result;
    }

    /**
     * Get SAS link for storage container
     * Equivalent to: Get-EpiStorageContainerSasLink
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} environment - Environment name
     * @param {string} containerName - Storage container name
     * @param {Object} sasOptions - SAS link options (RetentionHours, Writable)
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Object>} SAS link details
     */
    static async getContainerSasLink(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        environment: string,
        containerName: string,
        sasOptions: SasOptions = {},
        options: RequestOptions = {}
    ): Promise<any> {
        const uriEnding = `projects/${projectId}/environments/${environment}/storagecontainers/${containerName}/saslink`;
        const payload = {
            RetentionHours: sasOptions.retentionHours || sasOptions.RetentionHours || 24,
            Writable: sasOptions.writable || sasOptions.Writable || false
        };
        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'POST', payload, options);
    }

    /**
     * Start database export
     * Equivalent to: Start-EpiDatabaseExport
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} environment - Environment name
     * @param {string} databaseName - Database name (epicms or epicommerce)
     * @param {number} retentionHours - Retention hours for export (default: 24)
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Object>} Export details with ID
     */
    static async startDatabaseExport(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        environment: string,
        databaseName: string,
        retentionHours: number = 24,
        options: RequestOptions = {}
    ): Promise<any> {
        const uriEnding = `projects/${projectId}/environments/${environment}/databases/${databaseName}/exports`;
        const payload = { RetentionHours: retentionHours };
        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'POST', payload, options);
    }

    /**
     * Get database export status
     * Equivalent to: Get-EpiDatabaseExport
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} environment - Environment name
     * @param {string} databaseName - Database name
     * @param {string} exportId - Export ID
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Object>} Export status and download URL
     */
    static async getDatabaseExportStatus(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        environment: string,
        databaseName: string,
        exportId: string,
        options: RequestOptions = {}
    ): Promise<any> {
        const uriEnding = `projects/${projectId}/environments/${environment}/databases/${databaseName}/exports/${exportId}`;
        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'GET', null, options);
    }

    /**
     * Get all database exports for an environment
     * DXP-76-2: List all exports with filtering support
     *
     * @param {string} projectId - Project ID
     * @param {string} clientKey - API client key
     * @param {string} clientSecret - API client secret
     * @param {string} environment - Environment name
     * @param {string} databaseName - Database name
     * @param {Object} options - Options (apiUrl, etc.)
     * @returns {Promise<Array>} Array of exports
     */
    static async getDatabaseExports(
        projectId: string,
        clientKey: string,
        clientSecret: string,
        environment: string,
        databaseName: string,
        options: RequestOptions = {}
    ): Promise<any> {
        const uriEnding = `projects/${projectId}/environments/${environment}/databases/${databaseName}/exports`;
        return await this.makeRequest(clientKey, clientSecret, uriEnding, 'GET', null, options);
    }

}

export default DXPRestClient;

/**
 * Webhook Validator
 * Security validation for webhook URLs and payloads
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 2
 */

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
    url?: string;
}

/**
 * URL validation options
 */
export interface ValidateUrlOptions {
    allowHttp?: boolean;
    allowLocalhost?: boolean;
}

/**
 * Webhook Validator Class
 * Validates webhook URLs and configurations for security
 */
class WebhookValidator {
    /**
     * Validate a webhook URL
     * @param url - Webhook URL to validate
     * @param options - Validation options
     * @returns { valid: boolean, error?: string }
     */
    static validateUrl(url: string, options: ValidateUrlOptions = {}): ValidationResult {
        const { allowHttp = false, allowLocalhost = process.env.NODE_ENV === 'development' } = options;

        // Check if URL is provided
        if (!url || typeof url !== 'string') {
            return { valid: false, error: 'Webhook URL must be a non-empty string' };
        }

        // Trim whitespace
        url = url.trim();

        // Check URL format using URL constructor
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch (error: any) {
            return { valid: false, error: `Invalid URL format: ${error.message}` };
        }

        // Check protocol (HTTPS required unless explicitly allowed)
        if (parsedUrl.protocol !== 'https:' && !allowHttp) {
            if (parsedUrl.protocol === 'http:') {
                return { valid: false, error: 'HTTPS required for webhook URLs (http:// not allowed)' };
            }
            return { valid: false, error: `Invalid protocol: ${parsedUrl.protocol} (must be https://)` };
        }

        // Check for localhost/private IPs (not allowed in production)
        if (!allowLocalhost) {
            const hostname = parsedUrl.hostname.toLowerCase();

            // Check for localhost variants
            if (hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '0.0.0.0' ||
                hostname === '::1' ||
                hostname.startsWith('127.') ||
                hostname.startsWith('192.168.') ||
                hostname.startsWith('10.') ||
                hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
                return { valid: false, error: 'Localhost and private IP addresses not allowed for webhooks in production' };
            }
        }

        // Check for reasonable hostname
        if (parsedUrl.hostname.length === 0) {
            return { valid: false, error: 'Webhook URL must have a valid hostname' };
        }

        // URL is valid
        return { valid: true, url: url };
    }

    /**
     * Validate webhook headers
     * @param headers - Headers object
     * @returns { valid: boolean, error?: string }
     */
    static validateHeaders(headers: Record<string, string> | null | undefined): ValidationResult {
        if (!headers) {
            return { valid: true }; // Headers are optional
        }

        if (typeof headers !== 'object' || Array.isArray(headers)) {
            return { valid: false, error: 'Webhook headers must be an object' };
        }

        // Check for suspicious headers
        const suspiciousHeaders = ['host', 'connection', 'transfer-encoding', 'upgrade'];
        for (const key of Object.keys(headers)) {
            const lowerKey = key.toLowerCase();
            if (suspiciousHeaders.includes(lowerKey)) {
                return { valid: false, error: `Header '${key}' is not allowed (reserved header)` };
            }

            // Validate header values are strings
            if (typeof headers[key] !== 'string') {
                return { valid: false, error: `Header '${key}' value must be a string` };
            }

            // Check header value length (max 1KB per header)
            if (headers[key].length > 1024) {
                return { valid: false, error: `Header '${key}' value is too long (max 1KB)` };
            }
        }

        // Check total headers size (max 8KB)
        const totalSize = JSON.stringify(headers).length;
        if (totalSize > 8192) {
            return { valid: false, error: 'Total headers size exceeds 8KB limit' };
        }

        return { valid: true };
    }

    /**
     * Validate webhook payload
     * @param payload - Payload object
     * @returns { valid: boolean, error?: string }
     */
    static validatePayload(payload: any): ValidationResult {
        if (!payload || typeof payload !== 'object') {
            return { valid: false, error: 'Webhook payload must be an object' };
        }

        // Check payload size (max 1MB)
        const payloadSize = JSON.stringify(payload).length;
        if (payloadSize > 1048576) {
            return { valid: false, error: `Payload size (${payloadSize} bytes) exceeds 1MB limit` };
        }

        // Validate required fields from event schema
        if (!payload.eventType || typeof payload.eventType !== 'string') {
            return { valid: false, error: 'Payload must have eventType field' };
        }

        if (!payload.timestamp || typeof payload.timestamp !== 'string') {
            return { valid: false, error: 'Payload must have timestamp field' };
        }

        if (!payload.operationId || typeof payload.operationId !== 'string') {
            return { valid: false, error: 'Payload must have operationId field' };
        }

        return { valid: true };
    }

    /**
     * Validate complete webhook configuration
     * @param config - Webhook configuration
     * @returns { valid: boolean, error?: string }
     */
    static validateConfig(config: any): ValidationResult {
        if (!config || typeof config !== 'object') {
            return { valid: false, error: 'Webhook configuration must be an object' };
        }

        // Validate URL
        const urlValidation = this.validateUrl(config.url, config.options);
        if (!urlValidation.valid) {
            return urlValidation;
        }

        // Validate headers if provided
        if (config.headers) {
            const headersValidation = this.validateHeaders(config.headers);
            if (!headersValidation.valid) {
                return headersValidation;
            }
        }

        return { valid: true };
    }
}

export default WebhookValidator;

/**
 * Webhook Sender
 * HTTP client for delivering webhook events
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 2
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import WebhookTransformer from './webhook-transformer';

/**
 * Send options
 */
export interface SendOptions {
    headers?: Record<string, string>;
    timeout?: number;
    webhookId?: string;
}

/**
 * Send result
 */
export interface SendResult {
    success: boolean;
    statusCode?: number;
    error?: string;
    responseTime: number;
    retryable?: boolean;
    body?: string;
    errorCode?: string;
}

/**
 * Test options
 */
export interface TestOptions extends SendOptions {
    // Inherits all SendOptions
}

/**
 * Webhook Sender Class
 * Sends HTTP POST requests to webhook URLs
 */
class WebhookSender {
    /**
     * Send a webhook
     * @param url - Webhook URL
     * @param payload - Event payload
     * @param options - Send options
     * @returns { success: boolean, statusCode?: number, error?: string, responseTime: number }
     */
    static async send(url: string, payload: any, options: SendOptions = {}): Promise<SendResult> {
        const startTime = Date.now();
        const {
            headers = {},
            timeout = 10000, // 10 second timeout
            webhookId = crypto.randomUUID()
        } = options;

        return new Promise((resolve) => {
            try {
                const parsedUrl = new URL(url);
                const isHttps = parsedUrl.protocol === 'https:';
                const httpModule = isHttps ? https : http;

                // Transform payload to flat format (industry-standard)
                const transformedPayload = WebhookTransformer.transform(payload);

                // Prepare payload
                const payloadStr = JSON.stringify(transformedPayload);

                // Prepare headers
                const requestHeaders: Record<string, string | number> = {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payloadStr),
                    'User-Agent': 'Jaxon-DXP-MCP-Webhook/1.0',
                    'X-Webhook-Event': transformedPayload.eventType || 'unknown',
                    'X-Webhook-ID': webhookId,
                    'X-Webhook-Timestamp': new Date().toISOString(),
                    ...headers // Custom headers last (can override defaults except reserved ones)
                };

                // Prepare request options
                const requestOptions: http.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || (isHttps ? 443 : 80),
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: 'POST',
                    headers: requestHeaders,
                    timeout: timeout
                };

                // Create request
                const req = httpModule.request(requestOptions, (res) => {
                    let responseBody = '';

                    res.on('data', (chunk) => {
                        responseBody += chunk.toString();
                    });

                    res.on('end', () => {
                        const responseTime = Date.now() - startTime;
                        const statusCode = res.statusCode;

                        // Consider 2xx status codes as success
                        if (statusCode && statusCode >= 200 && statusCode < 300) {
                            resolve({
                                success: true,
                                statusCode: statusCode,
                                responseTime: responseTime,
                                body: responseBody
                            });
                        } else {
                            // Non-2xx status codes are failures
                            resolve({
                                success: false,
                                statusCode: statusCode,
                                error: `HTTP ${statusCode}: ${res.statusMessage}`,
                                responseTime: responseTime,
                                retryable: this.isRetryableStatusCode(statusCode || 0),
                                body: responseBody
                            });
                        }
                    });
                });

                // Handle request errors
                req.on('error', (error: NodeJS.ErrnoException) => {
                    const responseTime = Date.now() - startTime;
                    resolve({
                        success: false,
                        error: error.message,
                        errorCode: error.code,
                        responseTime: responseTime,
                        retryable: this.isRetryableError(error)
                    });
                });

                // Handle timeout
                req.on('timeout', () => {
                    req.destroy();
                    const responseTime = Date.now() - startTime;
                    resolve({
                        success: false,
                        error: `Request timeout after ${timeout}ms`,
                        responseTime: responseTime,
                        retryable: true // Timeouts are retryable
                    });
                });

                // Send the request
                req.write(payloadStr);
                req.end();

            } catch (error: any) {
                const responseTime = Date.now() - startTime;
                resolve({
                    success: false,
                    error: error.message,
                    responseTime: responseTime,
                    retryable: false // Unexpected errors are not retryable
                });
            }
        });
    }

    /**
     * Determine if an HTTP status code is retryable
     * @param statusCode - HTTP status code
     * @returns True if retryable
     */
    static isRetryableStatusCode(statusCode: number): boolean {
        // Retry on server errors (5xx) and specific client errors
        if (statusCode >= 500) return true; // 5xx - Server errors
        if (statusCode === 408) return true; // Request Timeout
        if (statusCode === 429) return true; // Too Many Requests
        if (statusCode === 425) return true; // Too Early
        if (statusCode === 502) return true; // Bad Gateway
        if (statusCode === 503) return true; // Service Unavailable
        if (statusCode === 504) return true; // Gateway Timeout

        return false; // 4xx client errors are generally not retryable
    }

    /**
     * Determine if a network error is retryable
     * @param error - Error object
     * @returns True if retryable
     */
    static isRetryableError(error: NodeJS.ErrnoException): boolean {
        // Network errors that are worth retrying
        const retryableErrors = [
            'ECONNREFUSED', // Connection refused
            'ECONNRESET',   // Connection reset
            'ETIMEDOUT',    // Connection timeout
            'ENOTFOUND',    // DNS lookup failed (temporary)
            'EAI_AGAIN',    // DNS lookup failed (temporary)
            'EHOSTUNREACH', // Host unreachable
            'ENETUNREACH',  // Network unreachable
            'EPIPE'         // Broken pipe
        ];

        return error.code ? retryableErrors.includes(error.code) : false;
    }

    /**
     * Test a webhook URL (send test event)
     * @param url - Webhook URL
     * @param options - Test options
     * @returns Test result
     */
    static async test(url: string, options: TestOptions = {}): Promise<SendResult> {
        const testPayload = {
            eventType: 'test.ping',
            timestamp: new Date().toISOString(),
            operationId: 'test',
            data: {
                message: 'This is a test webhook from Jaxon DXP MCP Server'
            },
            metadata: {
                operation: 'webhook_test',
                user: 'system'
            }
        };

        return await this.send(url, testPayload, options);
    }
}

export default WebhookSender;

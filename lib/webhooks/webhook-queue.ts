/**
 * Webhook Queue
 * Retry queue for webhook deliveries
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 2
 */

import WebhookSender from './webhook-sender';
import WebhookLogger from './webhook-logger';
import { SendResult } from './webhook-sender';

/**
 * Queue options
 */
export interface QueueOptions {
    maxRetries?: number;
    retryDelays?: number[];
    maxQueueSize?: number;
    debug?: boolean;
}

/**
 * Queued webhook error
 */
export interface QueueError {
    attempt: number;
    error: string;
    statusCode?: number;
    timestamp: number;
}

/**
 * Queued webhook
 */
export interface QueuedWebhook {
    id: string;
    url: string;
    payload: any;
    headers: Record<string, string>;
    attempts: number;
    maxRetries: number;
    queuedAt: number;
    lastAttempt: number | null;
    nextRetry: number;
    errors: QueueError[];
}

/**
 * Queue statistics
 */
export interface QueueStats {
    queued: number;
    sent: number;
    failed: number;
    retrying: number;
    queueSize: number;
    activeDeliveries: number;
    queuesCount: number;
}

/**
 * Enqueue options
 */
export interface EnqueueOptions {
    webhookId?: string;
    headers?: Record<string, string>;
}

/**
 * Webhook Queue Class
 * Manages queued webhook deliveries with retry logic
 */
class WebhookQueue {
    private options: Required<QueueOptions>;
    private queues: Map<string, QueuedWebhook[]>;
    private activeDeliveries: Set<string>;
    private stats: {
        queued: number;
        sent: number;
        failed: number;
        retrying: number;
    };

    constructor(options: QueueOptions = {}) {
        this.options = {
            maxRetries: options.maxRetries || 3,
            retryDelays: options.retryDelays || [1000, 2000, 4000], // 1s, 2s, 4s
            maxQueueSize: options.maxQueueSize || 1000,
            debug: options.debug || process.env.DEBUG === 'true'
        };

        // Queue storage: Map<url, Array<QueuedWebhook>>
        this.queues = new Map();

        // Active deliveries: Set<webhookId>
        this.activeDeliveries = new Set();

        // Stats
        this.stats = {
            queued: 0,
            sent: 0,
            failed: 0,
            retrying: 0
        };
    }

    /**
     * Queue a webhook for delivery
     * @param url - Webhook URL
     * @param payload - Event payload
     * @param options - Delivery options
     * @returns Webhook ID
     */
    enqueue(url: string, payload: any, options: EnqueueOptions = {}): string | null {
        const webhookId = options.webhookId || `webhook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Check queue size
        if (this.getTotalQueueSize() >= this.options.maxQueueSize) {
            WebhookLogger.logError(webhookId, url, 'Queue full', {
                currentSize: this.getTotalQueueSize(),
                maxSize: this.options.maxQueueSize
            });
            this.stats.failed++;
            return null;
        }

        // Create queued webhook
        const queuedWebhook: QueuedWebhook = {
            id: webhookId,
            url: url,
            payload: payload,
            headers: options.headers || {},
            attempts: 0,
            maxRetries: this.options.maxRetries,
            queuedAt: Date.now(),
            lastAttempt: null,
            nextRetry: Date.now(), // Immediate first attempt
            errors: []
        };

        // Get or create queue for this URL
        if (!this.queues.has(url)) {
            this.queues.set(url, []);
        }

        this.queues.get(url)!.push(queuedWebhook);
        this.stats.queued++;

        if (this.options.debug) {
            console.error(`[WEBHOOK QUEUE] Queued ${webhookId} for ${url}`);
        }

        // Schedule immediate delivery
        this.scheduleDelivery(queuedWebhook);

        return webhookId;
    }

    /**
     * Schedule delivery attempt
     * @param queuedWebhook - Queued webhook
     */
    private scheduleDelivery(queuedWebhook: QueuedWebhook): void {
        const delay = Math.max(0, queuedWebhook.nextRetry - Date.now());

        setTimeout(async () => {
            await this.attemptDelivery(queuedWebhook);
        }, delay);
    }

    /**
     * Attempt webhook delivery
     * @param queuedWebhook - Queued webhook
     */
    private async attemptDelivery(queuedWebhook: QueuedWebhook): Promise<void> {
        // Check if already being delivered
        if (this.activeDeliveries.has(queuedWebhook.id)) {
            return;
        }

        this.activeDeliveries.add(queuedWebhook.id);
        queuedWebhook.attempts++;
        queuedWebhook.lastAttempt = Date.now();

        if (this.options.debug) {
            console.error(`[WEBHOOK QUEUE] Attempting delivery ${queuedWebhook.id} (attempt ${queuedWebhook.attempts}/${queuedWebhook.maxRetries})`);
        }

        try {
            // Send webhook
            const result: SendResult = await WebhookSender.send(
                queuedWebhook.url,
                queuedWebhook.payload,
                {
                    headers: queuedWebhook.headers,
                    webhookId: queuedWebhook.id
                }
            );

            if (result.success) {
                // Success - remove from queue
                this.removeFromQueue(queuedWebhook);
                this.stats.sent++;

                WebhookLogger.logSuccess(queuedWebhook.id, queuedWebhook.url, {
                    attempts: queuedWebhook.attempts,
                    responseTime: result.responseTime,
                    statusCode: result.statusCode
                });

                if (this.options.debug) {
                    console.error(`[WEBHOOK QUEUE] Successfully delivered ${queuedWebhook.id}`);
                }
            } else {
                // Failure - check if retryable
                queuedWebhook.errors.push({
                    attempt: queuedWebhook.attempts,
                    error: result.error || 'Unknown error',
                    statusCode: result.statusCode,
                    timestamp: Date.now()
                });

                if (result.retryable && queuedWebhook.attempts < queuedWebhook.maxRetries) {
                    // Schedule retry
                    const retryDelay = this.getRetryDelay(queuedWebhook.attempts);
                    queuedWebhook.nextRetry = Date.now() + retryDelay;
                    this.stats.retrying++;

                    WebhookLogger.logRetry(queuedWebhook.id, queuedWebhook.url, queuedWebhook.attempts, retryDelay, result.error || 'Unknown error');

                    if (this.options.debug) {
                        console.error(`[WEBHOOK QUEUE] Retrying ${queuedWebhook.id} in ${retryDelay}ms (attempt ${queuedWebhook.attempts}/${queuedWebhook.maxRetries})`);
                    }

                    // Schedule next retry
                    this.scheduleDelivery(queuedWebhook);
                } else {
                    // Max retries reached or not retryable - remove from queue
                    this.removeFromQueue(queuedWebhook);
                    this.stats.failed++;

                    WebhookLogger.logFailure(queuedWebhook.id, queuedWebhook.url, {
                        attempts: queuedWebhook.attempts,
                        errors: queuedWebhook.errors,
                        finalError: result.error
                    });

                    if (this.options.debug) {
                        console.error(`[WEBHOOK QUEUE] Failed to deliver ${queuedWebhook.id} after ${queuedWebhook.attempts} attempts`);
                    }
                }
            }
        } catch (error: any) {
            // Unexpected error
            this.removeFromQueue(queuedWebhook);
            this.stats.failed++;

            WebhookLogger.logError(queuedWebhook.id, queuedWebhook.url, error.message);

            if (this.options.debug) {
                console.error(`[WEBHOOK QUEUE] Unexpected error delivering ${queuedWebhook.id}:`, error);
            }
        } finally {
            this.activeDeliveries.delete(queuedWebhook.id);
        }
    }

    /**
     * Get retry delay for attempt number
     * @param attemptNumber - Current attempt number
     * @returns Delay in milliseconds
     */
    private getRetryDelay(attemptNumber: number): number {
        const index = attemptNumber - 1;
        if (index < this.options.retryDelays.length) {
            return this.options.retryDelays[index];
        }
        // Use last delay for any attempts beyond configured delays
        return this.options.retryDelays[this.options.retryDelays.length - 1];
    }

    /**
     * Remove webhook from queue
     * @param queuedWebhook - Queued webhook
     */
    private removeFromQueue(queuedWebhook: QueuedWebhook): void {
        const queue = this.queues.get(queuedWebhook.url);
        if (queue) {
            const index = queue.findIndex(w => w.id === queuedWebhook.id);
            if (index !== -1) {
                queue.splice(index, 1);
            }

            // Clean up empty queues
            if (queue.length === 0) {
                this.queues.delete(queuedWebhook.url);
            }
        }
    }

    /**
     * Get total queue size across all URLs
     * @returns Total queued webhooks
     */
    getTotalQueueSize(): number {
        let total = 0;
        for (const queue of this.queues.values()) {
            total += queue.length;
        }
        return total;
    }

    /**
     * Get queue statistics
     * @returns Queue stats
     */
    getStats(): QueueStats {
        return {
            ...this.stats,
            queueSize: this.getTotalQueueSize(),
            activeDeliveries: this.activeDeliveries.size,
            queuesCount: this.queues.size
        };
    }

    /**
     * Clear all queues
     */
    clear(): void {
        this.queues.clear();
        this.activeDeliveries.clear();
        this.stats = {
            queued: 0,
            sent: 0,
            failed: 0,
            retrying: 0
        };
    }
}

// Singleton instance
let globalQueue: WebhookQueue | null = null;

/**
 * Get the global webhook queue instance
 * @returns Global queue
 */
export function getGlobalWebhookQueue(): WebhookQueue {
    if (!globalQueue) {
        globalQueue = new WebhookQueue();
    }
    return globalQueue;
}

/**
 * Reset the global queue (for testing)
 */
export function resetGlobalWebhookQueue(): void {
    if (globalQueue) {
        globalQueue.clear();
    }
    globalQueue = null;
}

export { WebhookQueue };

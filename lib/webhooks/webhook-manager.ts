/**
 * Webhook Manager
 * Central coordinator for webhook delivery system
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 2
 */

import { getGlobalEmitter } from '../events/event-emitter';
import { getGlobalWebhookQueue } from './webhook-queue';
import WebhookValidator from './webhook-validator';
import WebhookLogger from './webhook-logger';
import { DXPEvent, isTerminalEvent } from '../events/event-types';
import { DXPEventEmitter } from '../events/event-emitter';
import { WebhookQueue } from './webhook-queue';

/**
 * Webhook configuration
 */
export interface WebhookConfig {
    url: string;
    headers: Record<string, string>;
    registeredAt: number;
    project: string;
    environment: string;
}

/**
 * Webhook statistics
 */
export interface WebhookStats {
    registrations: number;
    deliveries: number;
    errors: number;
    activeWebhooks: number;
    queueStats: any;
    deliveryStats: any;
}

/**
 * Register result
 */
export interface RegisterResult {
    success: boolean;
    error?: string;
}

/**
 * Register options
 */
export interface RegisterOptions {
    headers?: Record<string, string>;
    project?: string;
    environment?: string;
}

/**
 * Active webhook info
 */
export interface ActiveWebhook {
    operationId: string;
    url: string;
    project: string;
    environment: string;
    registeredAt: number;
}

/**
 * Webhook Manager Class
 * Manages webhook registrations and event-to-webhook routing
 */
class WebhookManager {
    private webhooks: Map<string, WebhookConfig>;
    private emitter: DXPEventEmitter;
    private queue: WebhookQueue;
    private stats: {
        registrations: number;
        deliveries: number;
        errors: number;
    };
    private initialized: boolean;

    constructor() {
        // Map of operationId → webhook config
        this.webhooks = new Map();

        // Event emitter and queue
        this.emitter = getGlobalEmitter();
        this.queue = getGlobalWebhookQueue();

        // Stats
        this.stats = {
            registrations: 0,
            deliveries: 0,
            errors: 0
        };

        // Initialize event listener
        this.initialized = false;
    }

    /**
     * Initialize webhook manager
     * Sets up event listener
     */
    initialize(): void {
        if (this.initialized) {
            return;
        }

        // Listen to all events via wildcard
        this.emitter.on('*', (event: DXPEvent) => {
            this.handleEvent(event);
        });

        this.initialized = true;

        if (process.env.DEBUG === 'true') {
            console.error('[WEBHOOK MANAGER] Initialized');
        }
    }

    /**
     * Register a webhook for an operation
     * @param operationId - Operation ID (deploymentId, exportId, etc.)
     * @param webhookUrl - Webhook URL
     * @param options - Webhook options
     * @returns { success: boolean, error?: string }
     */
    register(operationId: string, webhookUrl: string, options: RegisterOptions = {}): RegisterResult {
        if (!operationId || !webhookUrl) {
            return { success: false, error: 'operationId and webhookUrl are required' };
        }

        // Validate webhook URL
        const validation = WebhookValidator.validateUrl(webhookUrl, {
            allowHttp: process.env.NODE_ENV === 'development',
            allowLocalhost: process.env.NODE_ENV === 'development'
        });

        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Validate headers if provided
        if (options.headers) {
            const headersValidation = WebhookValidator.validateHeaders(options.headers);
            if (!headersValidation.valid) {
                return { success: false, error: headersValidation.error };
            }
        }

        // Register webhook
        this.webhooks.set(operationId, {
            url: webhookUrl,
            headers: options.headers || {},
            registeredAt: Date.now(),
            project: options.project || 'unknown',
            environment: options.environment || 'unknown'
        });

        this.stats.registrations++;

        if (process.env.DEBUG === 'true') {
            console.error(`[WEBHOOK MANAGER] Registered webhook for operation ${operationId}: ${WebhookLogger.sanitizeUrl(webhookUrl)}`);
        }

        return { success: true };
    }

    /**
     * Unregister a webhook
     * @param operationId - Operation ID
     * @returns True if unregistered
     */
    unregister(operationId: string): boolean {
        const removed = this.webhooks.delete(operationId);

        if (removed && process.env.DEBUG === 'true') {
            console.error(`[WEBHOOK MANAGER] Unregistered webhook for operation ${operationId}`);
        }

        return removed;
    }

    /**
     * Handle an event from the event emitter
     * @param event - Event object
     */
    private handleEvent(event: DXPEvent): void {
        const { operationId } = event;

        // Check if there's a webhook registered for this operation
        const webhookConfig = this.webhooks.get(operationId);
        if (!webhookConfig) {
            return; // No webhook registered for this operation
        }

        // Validate event payload
        const validation = WebhookValidator.validatePayload(event);
        if (!validation.valid) {
            WebhookLogger.logError('unknown', webhookConfig.url, `Invalid event payload: ${validation.error}`);
            this.stats.errors++;
            return;
        }

        // Enrich event with project/environment context
        const enrichedEvent: DXPEvent = {
            ...event,
            metadata: {
                ...event.metadata,
                project: webhookConfig.project,
                environment: webhookConfig.environment
            }
        };

        // Queue webhook delivery
        const webhookId = this.queue.enqueue(
            webhookConfig.url,
            enrichedEvent,
            {
                headers: webhookConfig.headers
            }
        );

        if (webhookId) {
            this.stats.deliveries++;

            if (process.env.DEBUG === 'true') {
                console.error(`[WEBHOOK MANAGER] Queued webhook ${webhookId} for ${event.eventType} (operation: ${operationId})`);
            }
        } else {
            this.stats.errors++;
            WebhookLogger.logError('unknown', webhookConfig.url, 'Failed to queue webhook (queue full?)');
        }

        // Auto-cleanup: unregister webhook after terminal event
        if (isTerminalEvent(event.eventType)) {
            // Wait a bit to ensure all events are processed
            setTimeout(() => {
                this.unregister(operationId);
            }, 5000); // 5 second delay
        }
    }

    /**
     * Get webhook statistics
     * @returns Statistics
     */
    getStats(): WebhookStats {
        return {
            ...this.stats,
            activeWebhooks: this.webhooks.size,
            queueStats: this.queue.getStats(),
            deliveryStats: WebhookLogger.getStats()
        };
    }

    /**
     * Get active webhooks
     * @returns Array of active webhooks
     */
    getActiveWebhooks(): ActiveWebhook[] {
        const active: ActiveWebhook[] = [];
        for (const [operationId, config] of this.webhooks.entries()) {
            active.push({
                operationId,
                url: WebhookLogger.sanitizeUrl(config.url),
                project: config.project,
                environment: config.environment,
                registeredAt: config.registeredAt
            });
        }
        return active;
    }

    /**
     * Clear all webhooks
     */
    clear(): void {
        this.webhooks.clear();
        this.queue.clear();
        this.stats = {
            registrations: 0,
            deliveries: 0,
            errors: 0
        };
    }
}

// Singleton instance
let globalManager: WebhookManager | null = null;

/**
 * Get the global webhook manager instance
 * @returns Global manager
 */
export function getGlobalWebhookManager(): WebhookManager {
    if (!globalManager) {
        globalManager = new WebhookManager();
    }
    return globalManager;
}

/**
 * Reset the global manager (for testing)
 */
export function resetGlobalWebhookManager(): void {
    if (globalManager) {
        globalManager.clear();
    }
    globalManager = null;
}

export { WebhookManager };

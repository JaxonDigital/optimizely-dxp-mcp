/**
 * In-Memory Event Bus
 * Default/fallback event bus implementation using Node.js EventEmitter
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 3
 */

import { EventEmitter } from 'events';
import { EventBusInterface, EventBusConfig, HistoryOptions, HealthStatus, BusStats } from './event-bus-interface';
import { DXPEvent, validateEvent, isTerminalEvent } from './event-types';

/**
 * Active operation tracking
 */
interface ActiveOperation {
    type: string;
    startTime: number;
    lastEvent: DXPEvent;
}

/**
 * Subscription tracking
 */
interface Subscription {
    pattern: string;
    callback: (event: DXPEvent) => void;
    listener: (event: DXPEvent) => void;
}

/**
 * Event with internal timestamp
 */
interface HistoricalEvent extends DXPEvent {
    _timestamp: number;
}

/**
 * In-Memory Event Bus Implementation
 * Uses Node.js EventEmitter for local pub/sub
 * Provides event history for replay capability
 */
export class InMemoryEventBus extends EventBusInterface {
    private emitter: EventEmitter;
    private activeOperations: Map<string, ActiveOperation>;
    private eventHistory: HistoricalEvent[];
    private maxHistoryAge: number;
    private maxHistorySize: number;
    private subscriptions: Map<string, Subscription>;
    private nextSubscriptionId: number;
    private stats: {
        totalEvents: number;
        eventsByType: Record<string, number>;
        activeOperationsCount: number;
        subscriptionCount: number;
    };
    private cleanupInterval: NodeJS.Timeout | null;

    constructor() {
        super();
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(100); // Allow many listeners for monitoring

        // Track active operations
        this.activeOperations = new Map<string, ActiveOperation>();

        // Event history for replay (last 24 hours)
        this.eventHistory = [];
        this.maxHistoryAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        this.maxHistorySize = 10000; // Max events to keep

        // Subscription tracking
        this.subscriptions = new Map<string, Subscription>();
        this.nextSubscriptionId = 1;

        // Stats for monitoring
        this.stats = {
            totalEvents: 0,
            eventsByType: {},
            activeOperationsCount: 0,
            subscriptionCount: 0
        };

        // Start cleanup interval
        this.cleanupInterval = setInterval(() => this.cleanupHistory(), 60 * 60 * 1000); // Every hour
    }

    /**
     * Initialize the event bus
     */
    async initialize(_config: EventBusConfig = {}): Promise<void> {
        // In-memory bus needs no initialization
        if (process.env.DEBUG === 'true') {
            console.error('[EVENT BUS] In-memory event bus initialized');
        }
        return Promise.resolve();
    }

    /**
     * Publish an event to the bus
     */
    async publish(event: DXPEvent): Promise<boolean> {
        try {
            // Validate event structure
            validateEvent(event);

            // Add to history
            this.addToHistory(event);

            // Update stats
            this.stats.totalEvents++;
            this.stats.eventsByType[event.eventType] = (this.stats.eventsByType[event.eventType] || 0) + 1;

            // Track active operation
            this.trackOperation(event);

            // Emit on both specific event type and wildcard
            this.emitter.emit(event.eventType, event);
            this.emitter.emit('*', event); // Wildcard listener for all events

            // Debug logging
            if (process.env.DEBUG === 'true') {
                console.error(`[EVENT BUS] Published ${event.eventType} for ${event.operationId}`);
            }

            return true;

        } catch (error) {
            console.error('[EVENT BUS] Failed to publish event:', (error as Error).message);
            console.error('[EVENT BUS] Event:', event);
            return false;
        }
    }

    /**
     * Subscribe to events matching a pattern
     */
    async subscribe(pattern: string, callback: (event: DXPEvent) => void): Promise<string> {
        const subscriptionId = `sub-${this.nextSubscriptionId++}`;

        // Create listener that matches pattern
        const listener = (event: DXPEvent) => {
            if (this.matchesPattern(event.eventType, pattern)) {
                try {
                    callback(event);
                } catch (error) {
                    console.error(`[EVENT BUS] Error in subscription callback (${subscriptionId}):`, error);
                }
            }
        };

        // Subscribe to wildcard to get all events
        this.emitter.on('*', listener);

        // Track subscription
        this.subscriptions.set(subscriptionId, { pattern, callback, listener });
        this.stats.subscriptionCount++;

        if (process.env.DEBUG === 'true') {
            console.error(`[EVENT BUS] Subscribed to pattern: ${pattern} (${subscriptionId})`);
        }

        return subscriptionId;
    }

    /**
     * Unsubscribe from events
     */
    async unsubscribe(subscriptionId: string): Promise<void> {
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) {
            throw new Error(`Subscription not found: ${subscriptionId}`);
        }

        // Remove listener
        this.emitter.off('*', subscription.listener);

        // Remove from tracking
        this.subscriptions.delete(subscriptionId);
        this.stats.subscriptionCount--;

        if (process.env.DEBUG === 'true') {
            console.error(`[EVENT BUS] Unsubscribed: ${subscriptionId}`);
        }
    }

    /**
     * Get event history (for replay)
     */
    async getHistory(options: HistoryOptions = {}): Promise<DXPEvent[]> {
        const {
            pattern = '*',
            limit = 100,
            since = null
        } = options;

        let events: HistoricalEvent[] = this.eventHistory;

        // Filter by timestamp
        if (since) {
            const sinceTime = since instanceof Date ? since.getTime() : new Date(since).getTime();
            events = events.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
        }

        // Filter by pattern
        if (pattern !== '*') {
            events = events.filter(e => this.matchesPattern(e.eventType, pattern));
        }

        // Limit results
        return events.slice(-limit);
    }

    /**
     * Get bus health status
     */
    async getHealth(): Promise<HealthStatus> {
        return {
            healthy: true,
            type: 'in-memory',
            details: {
                activeOperations: this.activeOperations.size,
                subscriptions: this.subscriptions.size,
                historySize: this.eventHistory.length
            }
        };
    }

    /**
     * Get bus statistics
     */
    async getStats(): Promise<BusStats> {
        return {
            ...this.stats,
            activeOperations: Array.from(this.activeOperations.keys()),
            historySize: this.eventHistory.length
        };
    }

    /**
     * Close/cleanup the event bus
     */
    async close(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.emitter.removeAllListeners();
        this.subscriptions.clear();
        this.activeOperations.clear();
        this.eventHistory = [];

        if (process.env.DEBUG === 'true') {
            console.error('[EVENT BUS] In-memory event bus closed');
        }
    }

    // Internal helper methods

    /**
     * Track operation lifecycle
     */
    private trackOperation(event: DXPEvent): void {
        const { operationId, eventType } = event;

        if (!this.activeOperations.has(operationId)) {
            // New operation
            this.activeOperations.set(operationId, {
                type: event.eventType.split('.')[0], // deployment, export, download
                startTime: Date.now(),
                lastEvent: event
            });
            this.stats.activeOperationsCount++;
        } else {
            // Update existing operation
            const op = this.activeOperations.get(operationId)!;
            op.lastEvent = event;

            // Remove if terminal state
            if (isTerminalEvent(eventType)) {
                this.activeOperations.delete(operationId);
                this.stats.activeOperationsCount--;
            }
        }
    }

    /**
     * Add event to history
     */
    private addToHistory(event: DXPEvent): void {
        this.eventHistory.push({
            ...event,
            _timestamp: Date.now() // Internal tracking
        });

        // Limit history size
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
    }

    /**
     * Clean up old events from history
     */
    private cleanupHistory(): void {
        const cutoff = Date.now() - this.maxHistoryAge;
        this.eventHistory = this.eventHistory.filter(e => e._timestamp >= cutoff);

        if (process.env.DEBUG === 'true') {
            console.error(`[EVENT BUS] Cleaned history, ${this.eventHistory.length} events remaining`);
        }
    }

    /**
     * Match event type against pattern
     * Supports wildcards: deployment.* matches deployment.started, deployment.failed, etc.
     */
    private matchesPattern(eventType: string, pattern: string): boolean {
        // Exact match
        if (pattern === eventType || pattern === '*') {
            return true;
        }

        // Wildcard match (e.g., deployment.*)
        if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -2); // Remove .*
            return eventType.startsWith(prefix + '.');
        }

        // Prefix match (e.g., deployment)
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1); // Remove *
            return eventType.startsWith(prefix);
        }

        return false;
    }

    /**
     * Reset the event bus (for testing)
     */
    reset(): void {
        this.emitter.removeAllListeners();
        this.activeOperations.clear();
        this.eventHistory = [];
        this.subscriptions.clear();
        this.stats = {
            totalEvents: 0,
            eventsByType: {},
            activeOperationsCount: 0,
            subscriptionCount: 0
        };
    }
}

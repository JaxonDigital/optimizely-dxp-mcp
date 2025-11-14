/**
 * Central Event Emitter
 * Core event bus for all async operations in the MCP server
 * Now uses pluggable event bus implementations (in-memory or Redis)
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 3
 */

import { getEventBus, getConfigFromEnvironment } from './event-bus-factory';
import { validateEvent } from './event-types';
import { EventBusInterface, HistoryOptions, HealthStatus, BusStats } from './event-bus-interface';
import { DXPEvent } from './event-types';

/**
 * Pending subscription for lazy initialization
 */
interface PendingSubscription {
    eventType: string;
    callback: (event: DXPEvent) => void;
}

/**
 * DXP Event Emitter Wrapper
 * Maintains backward compatibility with Phase 1/2 code
 * Delegates to pluggable event bus implementation
 */
export class DXPEventEmitter {
    private eventBus: EventBusInterface | null;
    private initialized: boolean;
    private _pendingSubscriptions: PendingSubscription[];
    private initializationPromise: Promise<void> | null;

    constructor() {
        this.eventBus = null; // Will be initialized lazily
        this.initialized = false;
        this._pendingSubscriptions = [];
        this.initializationPromise = null;
    }

    /**
     * Initialize the event bus (lazy initialization with mutex pattern)
     * Prevents race condition when multiple calls happen concurrently
     * DXP-144: Fixed race condition with Promise-based mutex
     */
    private async _ensureInitialized(): Promise<void> {
        // Fast path: already initialized
        if (this.initialized) {
            return;
        }

        // Initialization in progress - wait for it
        if (this.initializationPromise) {
            await this.initializationPromise;
            return;
        }

        // Start initialization (only first caller gets here)
        this.initializationPromise = this._initialize();
        await this.initializationPromise;
    }

    /**
     * Internal initialization method (separated for mutex pattern)
     * DXP-144: Extracted from _ensureInitialized for thread-safe initialization
     */
    private async _initialize(): Promise<void> {
        const config = getConfigFromEnvironment();
        this.eventBus = await getEventBus(config);
        this.initialized = true;
    }

    /**
     * Emit a validated event (backward compatible API)
     * @param event - Event object
     */
    async emitEvent(event: DXPEvent): Promise<void> {
        try {
            // Validate event structure
            validateEvent(event);

            // Ensure bus is initialized
            await this._ensureInitialized();

            // Publish to event bus
            if (this.eventBus) {
                await this.eventBus.publish(event);
            }

        } catch (error) {
            console.error('[EVENT EMITTER] Failed to emit event:', (error as Error).message);
            console.error('[EVENT EMITTER] Event:', event);
        }
    }

    /**
     * Get active operations (backward compatible)
     */
    async getActiveOperations(): Promise<string[]> {
        await this._ensureInitialized();
        if (!this.eventBus) return [];

        const stats = await this.eventBus.getStats();
        return stats.activeOperations || [];
    }

    /**
     * Get statistics (backward compatible)
     */
    async getStats(): Promise<BusStats> {
        await this._ensureInitialized();
        if (!this.eventBus) {
            return {
                totalEvents: 0,
                eventsByType: {},
                activeOperations: [],
                subscriptionCount: 0
            };
        }
        return await this.eventBus.getStats();
    }

    /**
     * Subscribe to events (new in Phase 3)
     * @param pattern - Event pattern (e.g., 'deployment.*')
     * @param callback - Callback function
     * @returns Subscription ID
     */
    async subscribe(pattern: string, callback: (event: DXPEvent) => void): Promise<string> {
        await this._ensureInitialized();
        if (!this.eventBus) {
            throw new Error('Event bus not initialized');
        }
        return await this.eventBus.subscribe(pattern, callback);
    }

    /**
     * Unsubscribe from events (new in Phase 3)
     * @param subscriptionId - Subscription ID
     */
    async unsubscribe(subscriptionId: string): Promise<void> {
        await this._ensureInitialized();
        if (!this.eventBus) {
            throw new Error('Event bus not initialized');
        }
        return await this.eventBus.unsubscribe(subscriptionId);
    }

    /**
     * Get event history (new in Phase 3)
     * @param options - Query options
     * @returns Array of events
     */
    async getHistory(options: HistoryOptions = {}): Promise<DXPEvent[]> {
        await this._ensureInitialized();
        if (!this.eventBus) return [];
        return await this.eventBus.getHistory(options);
    }

    /**
     * Get bus health status (new in Phase 3)
     */
    async getHealth(): Promise<HealthStatus> {
        await this._ensureInitialized();
        if (!this.eventBus) {
            return { healthy: false, details: { error: 'Event bus not initialized' } };
        }
        return await this.eventBus.getHealth();
    }

    /**
     * On (backward compatible with EventEmitter API)
     * Used by resource handlers that call emitter.on('event', callback)
     * @param eventType - Event type or pattern
     * @param callback - Callback function
     */
    on(eventType: string, callback: (event: DXPEvent) => void): void {
        // Store callback for lazy initialization
        if (!this._pendingSubscriptions) {
            this._pendingSubscriptions = [];
        }
        this._pendingSubscriptions.push({ eventType, callback });

        // Try to initialize immediately if not already done
        this._ensureInitialized().then(() => {
            // Subscribe to events
            if (this.eventBus) {
                this.eventBus.subscribe(eventType, callback).catch(err => {
                    console.error('[EVENT EMITTER] Failed to subscribe:', err);
                });
            }
        }).catch(err => {
            console.error('[EVENT EMITTER] Failed to initialize for subscription:', err);
        });
    }

    /**
     * Reset the emitter (for testing)
     * DXP-144: Also clears initialization promise to prevent reuse
     */
    async reset(): Promise<void> {
        if (this.eventBus) {
            await this.eventBus.close();
        }
        this.eventBus = null;
        this.initialized = false;
        this._pendingSubscriptions = [];
        this.initializationPromise = null;
    }
}

// Singleton instance
let globalEmitter: DXPEventEmitter | null = null;

/**
 * Get the global event emitter instance
 * @returns Global emitter
 */
export function getGlobalEmitter(): DXPEventEmitter {
    if (!globalEmitter) {
        globalEmitter = new DXPEventEmitter();
    }
    return globalEmitter;
}

/**
 * Reset the global emitter (for testing)
 */
export async function resetGlobalEmitter(): Promise<void> {
    if (globalEmitter) {
        await globalEmitter.reset();
    }
    globalEmitter = null;
}

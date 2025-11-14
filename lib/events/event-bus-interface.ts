/**
 * Event Bus Interface
 * Abstract interface for event bus implementations
 * Allows swapping between in-memory, Redis, EventBridge without changing consumer code
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 3
 */

import { DXPEvent } from './event-types';

/**
 * Event bus initialization configuration
 */
export interface EventBusConfig {
    redisUrl?: string;
    projectId?: string;
    fallbackToMemory?: boolean;
    [key: string]: any;
}

/**
 * Event history query options
 */
export interface HistoryOptions {
    pattern?: string;
    limit?: number;
    since?: Date | string;
}

/**
 * Health status response
 */
export interface HealthStatus {
    healthy: boolean;
    type?: string;
    details?: Record<string, any>;
}

/**
 * Bus statistics
 */
export interface BusStats {
    totalEvents: number;
    eventsByType: Record<string, number>;
    activeOperations?: string[];
    subscriptionCount?: number;
    historySize?: number;
    [key: string]: any;
}

/**
 * Abstract Event Bus Interface
 * All event bus implementations must implement this interface
 */
export abstract class EventBusInterface {
    /**
     * Initialize the event bus
     * @param config - Configuration object
     */
    abstract initialize(config?: EventBusConfig): Promise<void>;

    /**
     * Publish an event to the bus
     * @param event - Event object (must match event-types.js schema)
     * @returns True if published successfully
     */
    abstract publish(event: DXPEvent): Promise<boolean>;

    /**
     * Subscribe to events matching a pattern
     * @param pattern - Event pattern (e.g., 'deployment.*', 'dxp.PROJECT123.deployment.*')
     * @param callback - Callback function (event) => void
     * @returns Subscription ID for later unsubscribe
     */
    abstract subscribe(pattern: string, callback: (event: DXPEvent) => void): Promise<string>;

    /**
     * Unsubscribe from events
     * @param subscriptionId - Subscription ID from subscribe()
     */
    abstract unsubscribe(subscriptionId: string): Promise<void>;

    /**
     * Get event history (for replay)
     * @param options - Query options
     * @returns Array of events
     */
    abstract getHistory(options?: HistoryOptions): Promise<DXPEvent[]>;

    /**
     * Get bus health status
     * @returns Health status { healthy: boolean, details: {} }
     */
    abstract getHealth(): Promise<HealthStatus>;

    /**
     * Get bus statistics
     * @returns Statistics { totalEvents, eventsByType, etc. }
     */
    abstract getStats(): Promise<BusStats>;

    /**
     * Close/cleanup the event bus
     */
    abstract close(): Promise<void>;
}

/**
 * Helper function to create topic name for multi-tenant routing
 * @param projectId - Project identifier
 * @param eventType - Event type
 * @returns Topic name (e.g., 'dxp.PROJECT123.deployment.started')
 */
export function createTopicName(projectId: string, eventType: string): string {
    if (!projectId || !eventType) {
        throw new Error('projectId and eventType are required for topic name');
    }
    // Normalize projectId (remove special chars, uppercase)
    const normalizedProject = projectId.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return `dxp.${normalizedProject}.${eventType}`;
}

/**
 * Helper function to create pattern for topic subscription
 * @param projectId - Project identifier (optional, * for all)
 * @param eventPattern - Event pattern (e.g., 'deployment.*')
 * @returns Topic pattern (e.g., 'dxp.PROJECT123.deployment.*' or 'dxp.*.deployment.*')
 */
export function createTopicPattern(projectId: string | null, eventPattern: string): string {
    const project = projectId || '*';
    const normalizedProject = project === '*' ? '*' : project.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return `dxp.${normalizedProject}.${eventPattern}`;
}

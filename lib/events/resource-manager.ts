/**
 * MCP Resource Manager
 * Manages lifecycle of MCP resources (register, update, cleanup)
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 1
 */

import { DXPEvent, getResourceTypeFromEvent, isTerminalEvent } from './event-types';
import { getGlobalNotificationSender } from './notification-sender';

/**
 * Resource metadata
 */
export interface ResourceMetadata {
    operationId: string;
    resourceType: string;
    project: string;
    environment: string;
    createdAt: number;
    updatedAt: number;
    isTerminal: boolean;
    completedAt: number | null;
}

/**
 * Resource state
 */
export interface ResourceState extends Record<string, any> {
    eventType: string;
    lastUpdated: string;
}

/**
 * MCP Resource
 */
export interface Resource {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    state: ResourceState;
    metadata: ResourceMetadata;
}

/**
 * Resource filter options
 */
export interface ResourceFilters {
    type?: string;
    terminal?: boolean;
    project?: string;
}

/**
 * Resource statistics
 */
export interface ResourceStats {
    total: number;
    active: number;
    terminal: number;
    byType: {
        deployment: number;
        export: number;
        download: number;
    };
}

/**
 * Resource Manager
 * Tracks all active MCP resources and their state
 */
export class ResourceManager {
    private resources: Map<string, Resource>;
    private subscriptions: Map<string, Set<string>>;
    private cleanupTTL: number;
    private cleanupInterval: NodeJS.Timeout | null;

    constructor() {
        // Map of resourceUri -> resource data
        this.resources = new Map<string, Resource>();

        // Map of resourceUri -> set of subscriber client IDs (DXP-134)
        this.subscriptions = new Map<string, Set<string>>();

        // Cleanup configuration
        this.cleanupTTL = 5 * 60 * 1000; // 5 minutes after completion
        this.cleanupInterval = null;
    }

    /**
     * Start automatic cleanup timer
     */
    startCleanup(): void {
        if (this.cleanupInterval) return;

        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredResources();
        }, 60 * 1000); // Check every minute
    }

    /**
     * Stop automatic cleanup timer
     */
    stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Register or update a resource based on an event
     * @param event - Event object
     * @returns Resource URI
     */
    registerOrUpdateResource(event: DXPEvent): string {
        const resourceType = getResourceTypeFromEvent(event.eventType);
        const resourceUri = `${resourceType}://${event.operationId}`;

        const existingResource = this.resources.get(resourceUri);
        const now = Date.now();

        const resource: Resource = {
            uri: resourceUri,
            name: this.generateResourceName(event),
            description: this.generateResourceDescription(event),
            mimeType: 'application/json',

            // Resource state
            state: {
                ...(event.data || {}),
                eventType: event.eventType,
                lastUpdated: event.timestamp
            },

            // Metadata
            metadata: {
                operationId: event.operationId,
                resourceType,
                project: event.project || 'unknown',
                environment: event.environment || 'unknown',
                createdAt: existingResource ? existingResource.metadata.createdAt : now,
                updatedAt: now,
                isTerminal: isTerminalEvent(event.eventType),
                completedAt: isTerminalEvent(event.eventType) ? now : null
            }
        };

        this.resources.set(resourceUri, resource);

        if (process.env.DEBUG === 'true') {
            console.error(`[RESOURCE] ${existingResource ? 'Updated' : 'Registered'}: ${resourceUri}`);
        }

        // DXP-134: Auto-notify subscribers when resource is updated
        if (existingResource && this.hasSubscribers(resourceUri)) {
            const notificationSender = getGlobalNotificationSender();
            if (notificationSender) {
                // Send notification asynchronously (non-blocking)
                setImmediate(() => {
                    notificationSender.sendResourceUpdated(resourceUri).catch(err => {
                        console.error(`[RESOURCE] Failed to notify subscribers for ${resourceUri}:`, err.message);
                    });
                });

                if (process.env.DEBUG === 'true') {
                    const subscriberCount = this.getSubscribers(resourceUri).length;
                    console.error(`[RESOURCE] Notifying ${subscriberCount} subscriber(s) for ${resourceUri}`);
                }
            }
        }

        return resourceUri;
    }

    /**
     * Generate human-readable resource name
     * @param event - Event object
     * @returns Resource name
     */
    private generateResourceName(event: DXPEvent): string {
        const type = getResourceTypeFromEvent(event.eventType);

        let name = `${type} ${event.operationId}`;

        if (event.project) {
            name = `${event.project} ${name}`;
        }

        if (event.environment) {
            name = `${name} (${event.environment})`;
        }

        return name;
    }

    /**
     * Generate resource description with current status
     * @param event - Event object
     * @returns Resource description
     */
    private generateResourceDescription(event: DXPEvent): string {
        const type = getResourceTypeFromEvent(event.eventType);
        const status = event.eventType.split('.')[1] || 'unknown';

        let desc = `${type} operation status: ${status}`;

        if (event.data && event.data.progress !== undefined) {
            desc += ` (${event.data.progress}% complete)`;
        }

        return desc;
    }

    /**
     * Get a resource by URI
     * @param resourceUri - Resource URI
     * @returns Resource data or null
     */
    getResource(resourceUri: string): Resource | null {
        return this.resources.get(resourceUri) || null;
    }

    /**
     * Get all resources, optionally filtered
     * @param filters - Filter options
     * @returns Array of resources
     */
    listResources(filters: ResourceFilters = {}): Resource[] {
        let resources = Array.from(this.resources.values());

        // Filter by resource type
        if (filters.type) {
            resources = resources.filter(r => r.metadata.resourceType === filters.type);
        }

        // Filter by terminal state
        if (filters.terminal !== undefined) {
            resources = resources.filter(r => r.metadata.isTerminal === filters.terminal);
        }

        // Filter by project
        if (filters.project) {
            resources = resources.filter(r => r.metadata.project === filters.project);
        }

        return resources;
    }

    /**
     * Read resource contents (returns current state as JSON)
     * @param resourceUri - Resource URI
     * @returns Resource contents as JSON string
     */
    readResource(resourceUri: string): string {
        const resource = this.getResource(resourceUri);
        if (!resource) {
            throw new Error(`Resource not found: ${resourceUri}`);
        }

        return JSON.stringify({
            uri: resource.uri,
            state: resource.state,
            metadata: resource.metadata,
            lastUpdated: resource.state.lastUpdated
        }, null, 2);
    }

    /**
     * Remove a resource
     * @param resourceUri - Resource URI
     * @returns True if removed
     */
    removeResource(resourceUri: string): boolean {
        const removed = this.resources.delete(resourceUri);

        // Also remove any subscriptions for this resource (DXP-134)
        this.subscriptions.delete(resourceUri);

        if (removed && process.env.DEBUG === 'true') {
            console.error(`[RESOURCE] Removed: ${resourceUri}`);
        }

        return removed;
    }

    /**
     * Cleanup expired terminal resources
     * @returns Number of resources cleaned up
     */
    cleanupExpiredResources(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [uri, resource] of this.resources.entries()) {
            if (resource.metadata.isTerminal && resource.metadata.completedAt) {
                const age = now - resource.metadata.completedAt;
                if (age > this.cleanupTTL) {
                    this.removeResource(uri);
                    cleaned++;
                }
            }
        }

        if (cleaned > 0 && process.env.DEBUG === 'true') {
            console.error(`[RESOURCE] Cleaned up ${cleaned} expired resources`);
        }

        return cleaned;
    }

    /**
     * Subscribe to a resource (DXP-134)
     * @param resourceUri - Resource URI to subscribe to
     * @param clientId - Optional client identifier (defaults to 'default')
     * @returns True if subscription was added
     */
    subscribe(resourceUri: string, clientId: string = 'default'): boolean {
        // Verify resource exists
        if (!this.resources.has(resourceUri)) {
            return false;
        }

        // Get or create subscriber set for this resource
        if (!this.subscriptions.has(resourceUri)) {
            this.subscriptions.set(resourceUri, new Set<string>());
        }

        const subscribers = this.subscriptions.get(resourceUri)!;
        const wasNew = !subscribers.has(clientId);
        subscribers.add(clientId);

        if (wasNew && process.env.DEBUG === 'true') {
            console.error(`[RESOURCE] Client ${clientId} subscribed to ${resourceUri}`);
        }

        return wasNew;
    }

    /**
     * Unsubscribe from a resource (DXP-134)
     * @param resourceUri - Resource URI to unsubscribe from
     * @param clientId - Optional client identifier (defaults to 'default')
     * @returns True if subscription was removed
     */
    unsubscribe(resourceUri: string, clientId: string = 'default'): boolean {
        const subscribers = this.subscriptions.get(resourceUri);
        if (!subscribers) {
            return false;
        }

        const removed = subscribers.delete(clientId);

        // Clean up empty subscription sets
        if (subscribers.size === 0) {
            this.subscriptions.delete(resourceUri);
        }

        if (removed && process.env.DEBUG === 'true') {
            console.error(`[RESOURCE] Client ${clientId} unsubscribed from ${resourceUri}`);
        }

        return removed;
    }

    /**
     * Get subscribers for a resource (DXP-134)
     * @param resourceUri - Resource URI
     * @returns Array of subscriber client IDs
     */
    getSubscribers(resourceUri: string): string[] {
        const subscribers = this.subscriptions.get(resourceUri);
        return subscribers ? Array.from(subscribers) : [];
    }

    /**
     * Check if a resource has any subscribers (DXP-134)
     * @param resourceUri - Resource URI
     * @returns True if resource has subscribers
     */
    hasSubscribers(resourceUri: string): boolean {
        const subscribers = this.subscriptions.get(resourceUri);
        return subscribers ? subscribers.size > 0 : false;
    }

    /**
     * Get statistics about managed resources
     * @returns Resource statistics
     */
    getStats(): ResourceStats {
        const resources = Array.from(this.resources.values());

        return {
            total: resources.length,
            active: resources.filter(r => !r.metadata.isTerminal).length,
            terminal: resources.filter(r => r.metadata.isTerminal).length,
            byType: {
                deployment: resources.filter(r => r.metadata.resourceType === 'deployment').length,
                export: resources.filter(r => r.metadata.resourceType === 'export').length,
                download: resources.filter(r => r.metadata.resourceType === 'download').length
            }
        };
    }

    /**
     * Reset all resources (for testing)
     */
    reset(): void {
        this.stopCleanup();
        this.resources.clear();
        this.subscriptions.clear(); // DXP-134: Also clear subscriptions
    }
}

// Singleton instance
let globalManager: ResourceManager | null = null;

/**
 * Get the global resource manager instance
 * @returns Global manager
 */
export function getGlobalResourceManager(): ResourceManager {
    if (!globalManager) {
        globalManager = new ResourceManager();
        globalManager.startCleanup();
    }
    return globalManager;
}

/**
 * Reset the global manager (for testing)
 */
export function resetGlobalResourceManager(): void {
    if (globalManager) {
        globalManager.reset();
    }
    globalManager = null;
}

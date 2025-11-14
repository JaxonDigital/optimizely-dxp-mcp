/**
 * Event Type Definitions
 * Defines all event types and their schemas for the MCP Resources system
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 1
 */

/**
 * Event Types - All supported event types in the system
 */
export const EVENT_TYPES = {
    // Deployment Events
    DEPLOYMENT_STARTED: 'deployment.started',
    DEPLOYMENT_IN_PROGRESS: 'deployment.inProgress',
    DEPLOYMENT_AWAITING_VERIFICATION: 'deployment.awaitingVerification',
    DEPLOYMENT_COMPLETING: 'deployment.completing',
    DEPLOYMENT_SUCCEEDED: 'deployment.succeeded',
    DEPLOYMENT_FAILED: 'deployment.failed',
    DEPLOYMENT_RESET: 'deployment.reset',

    // Database Export Events
    EXPORT_STARTED: 'export.started',
    EXPORT_IN_PROGRESS: 'export.inProgress',
    EXPORT_SUCCEEDED: 'export.succeeded',
    EXPORT_FAILED: 'export.failed',

    // Log Download Events
    DOWNLOAD_STARTED: 'download.started',
    DOWNLOAD_IN_PROGRESS: 'download.inProgress',
    DOWNLOAD_SUCCEEDED: 'download.succeeded',
    DOWNLOAD_FAILED: 'download.failed',
    DOWNLOAD_CANCELLED: 'download.cancelled'
} as const;

/**
 * Event type literal type
 */
export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

/**
 * Event object structure
 */
export interface DXPEvent {
    eventType: string;
    timestamp: string;
    operationId: string;
    data?: Record<string, any>;
    metadata?: Record<string, any>;
    project?: string;
    environment?: string;
}

/**
 * Validate event structure
 * @param event - Event object to validate
 * @returns True if valid, throws error if invalid
 */
export function validateEvent(event: any): boolean {
    if (!event || typeof event !== 'object') {
        throw new Error('Event must be an object');
    }

    // Required fields
    if (!event.eventType || typeof event.eventType !== 'string') {
        throw new Error('Event must have a valid eventType string');
    }

    if (!event.timestamp || typeof event.timestamp !== 'string') {
        throw new Error('Event must have a valid timestamp string (ISO 8601)');
    }

    if (!event.operationId || typeof event.operationId !== 'string') {
        throw new Error('Event must have a valid operationId string');
    }

    // Validate eventType is one of the known types
    const validTypes = Object.values(EVENT_TYPES);
    if (!validTypes.includes(event.eventType)) {
        throw new Error(`Invalid eventType: ${event.eventType}. Must be one of: ${validTypes.join(', ')}`);
    }

    // Optional but recommended fields
    if (event.data && typeof event.data !== 'object') {
        throw new Error('Event data must be an object if provided');
    }

    if (event.metadata && typeof event.metadata !== 'object') {
        throw new Error('Event metadata must be an object if provided');
    }

    return true;
}

/**
 * Create a standardized event object
 * @param eventType - Event type from EVENT_TYPES
 * @param operationId - Unique operation identifier
 * @param data - Event-specific data
 * @param metadata - Additional metadata
 * @returns Standardized event object
 */
export function createEvent(
    eventType: string,
    operationId: string,
    data: Record<string, any> = {},
    metadata: Record<string, any> = {}
): DXPEvent {
    const event: DXPEvent = {
        eventType,
        timestamp: new Date().toISOString(),
        operationId,
        data,
        metadata
    };

    validateEvent(event);
    return event;
}

/**
 * Get resource type from event type
 * Maps event types to their corresponding resource types
 * @param eventType - Event type
 * @returns Resource type (deployment, export, download)
 */
export function getResourceTypeFromEvent(eventType: string): string {
    if (eventType.startsWith('deployment.')) return 'deployment';
    if (eventType.startsWith('export.')) return 'export';
    if (eventType.startsWith('download.')) return 'download';
    throw new Error(`Cannot determine resource type from event type: ${eventType}`);
}

/**
 * Check if event represents a terminal state (operation complete/failed)
 * @param eventType - Event type
 * @returns True if terminal state
 */
export function isTerminalEvent(eventType: string): boolean {
    return eventType.endsWith('.succeeded') ||
           eventType.endsWith('.failed') ||
           eventType.endsWith('.cancelled') ||
           eventType === EVENT_TYPES.DEPLOYMENT_RESET;
}

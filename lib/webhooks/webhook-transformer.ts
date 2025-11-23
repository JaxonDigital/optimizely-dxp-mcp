/**
 * Webhook Transformer
 * Transforms DXPEvent to flat V2 webhook format (industry-standard)
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-158
 */

import { DXPEvent } from '../events/event-types';

/**
 * Webhook Payload (Flat Structure)
 * Industry-standard format matching Stripe, GitHub, Shopify patterns
 */
export interface WebhookPayload {
    // Core identifiers (always present)
    eventType: string;
    timestamp: string;

    // Operation-specific ID (renamed from operationId for clarity)
    deploymentId?: string;
    exportId?: string;
    downloadId?: string;

    // Flattened data fields (promoted from nested data object)
    status?: string;
    progress?: number;
    percentComplete?: number;
    slotUrl?: string;
    error?: string;

    // Context fields (promoted from nested metadata object)
    project?: string;
    environment?: string;
    sourceEnvironment?: string;
    targetEnvironment?: string;
    operation?: string;
    user?: string;

    // Additional fields from data or metadata
    [key: string]: any;
}

/**
 * Webhook Transformer Class
 * Converts DXPEvent to flat webhook format
 */
class WebhookTransformer {
    /**
     * Transform DXPEvent to webhook payload
     * @param event - DXPEvent object
     * @returns Flat webhook payload
     */
    static transform(event: DXPEvent): WebhookPayload {
        const { eventType, timestamp, operationId, data = {}, metadata = {} } = event;

        // Determine resource type from event type
        const resourceType = this.getResourceType(eventType);

        // Build base payload with core fields
        const payload: WebhookPayload = {
            eventType,
            timestamp
        };

        // Map operationId to resource-specific ID field
        switch (resourceType) {
            case 'deployment':
                payload.deploymentId = operationId;
                break;
            case 'export':
                payload.exportId = operationId;
                break;
            case 'download':
                payload.downloadId = operationId;
                break;
            default:
                // Fallback: use operationId if resource type unknown
                payload[`${resourceType}Id`] = operationId;
        }

        // Flatten data fields (promote from nested data object)
        // Common fields across all event types
        const commonDataFields = [
            'status',
            'progress',
            'percentComplete',
            'slotUrl',
            'error',
            'message',
            'deploymentId', // May be duplicated from operationId mapping above
            'exportId',
            'downloadId'
        ];

        for (const field of commonDataFields) {
            if (data[field] !== undefined) {
                payload[field] = data[field];
            }
        }

        // Include any other data fields not in common list
        for (const [key, value] of Object.entries(data)) {
            if (!commonDataFields.includes(key) && payload[key] === undefined) {
                payload[key] = value;
            }
        }

        // Flatten metadata fields (promote from nested metadata object)
        const commonMetadataFields = [
            'project',
            'environment',
            'sourceEnvironment',
            'targetEnvironment',
            'operation',
            'user'
        ];

        for (const field of commonMetadataFields) {
            if (metadata[field] !== undefined) {
                payload[field] = metadata[field];
            }
        }

        // Include any other metadata fields not in common list
        for (const [key, value] of Object.entries(metadata)) {
            if (!commonMetadataFields.includes(key) && payload[key] === undefined) {
                payload[key] = value;
            }
        }

        return payload;
    }

    /**
     * Get resource type from event type
     * @param eventType - Event type string (e.g., "deployment.started")
     * @returns Resource type (e.g., "deployment")
     */
    private static getResourceType(eventType: string): string {
        const parts = eventType.split('.');
        return parts[0] || 'unknown';
    }
}

export default WebhookTransformer;

/**
 * Export Resource Handler
 * Handles resource://export/{id} resources
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 1
 */

import { getGlobalEmitter } from '../events/event-emitter';
import { getGlobalResourceManager } from '../events/resource-manager';
import { getGlobalNotificationSender } from '../events/notification-sender';
import { createEvent, EVENT_TYPES, DXPEvent } from '../events/event-types';

/**
 * Export details for event emission
 */
export interface ExportDetails {
    exportId?: string;
    status?: string;
    progress?: number;
    downloadUrl?: string;
    error?: string;
    [key: string]: any;
}

/**
 * Export Resource Handler
 * Manages database export operation resources
 */
class ExportResourceHandler {
    /**
     * Initialize export event listeners
     */
    static initialize(): void {
        const emitter = getGlobalEmitter();
        const resourceManager = getGlobalResourceManager();
        const notificationSender = getGlobalNotificationSender();

        // Listen for all export events via wildcard
        emitter.on('*', async (event: DXPEvent) => {
            if (event.eventType.startsWith('export.')) {
                // Register or update resource
                const resourceUri = resourceManager.registerOrUpdateResource(event);

                // Send notification to MCP clients
                if (notificationSender) {
                    await notificationSender.sendResourceUpdated(resourceUri);
                }
            }
        });

        if (process.env.DEBUG === 'true') {
            console.error('[EXPORT RESOURCE] Initialized');
        }
    }

    /**
     * Emit export started event
     * @param exportId - Export ID
     * @param details - Export details
     */
    static emitStarted(exportId: string, details: ExportDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.EXPORT_STARTED,
            exportId,
            {
                exportId,
                status: 'InProgress',
                progress: 0,
                ...details
            },
            {
                operation: 'db_export',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit export in progress event
     * @param exportId - Export ID
     * @param details - Progress details
     */
    static emitInProgress(exportId: string, details: ExportDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.EXPORT_IN_PROGRESS,
            exportId,
            {
                exportId,
                status: 'InProgress',
                progress: details.progress || 50,
                ...details
            },
            {
                operation: 'db_export_status',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit export succeeded event
     * @param exportId - Export ID
     * @param details - Export details
     */
    static emitSucceeded(exportId: string, details: ExportDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.EXPORT_SUCCEEDED,
            exportId,
            {
                exportId,
                status: 'Succeeded',
                progress: 100,
                downloadUrl: details.downloadUrl,
                ...details
            },
            {
                operation: 'db_export_status',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit export failed event
     * @param exportId - Export ID
     * @param details - Failure details
     */
    static emitFailed(exportId: string, details: ExportDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.EXPORT_FAILED,
            exportId,
            {
                exportId,
                status: 'Failed',
                error: details.error || 'Unknown error',
                ...details
            },
            {
                operation: 'db_export',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }
}

export default ExportResourceHandler;

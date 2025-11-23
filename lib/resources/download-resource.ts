/**
 * Download Resource Handler
 * Handles resource://download/{id} resources
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 1
 */

import { getGlobalEmitter } from '../events/event-emitter';
import { getGlobalResourceManager } from '../events/resource-manager';
import { getGlobalNotificationSender } from '../events/notification-sender';
import { createEvent, EVENT_TYPES, DXPEvent } from '../events/event-types';

/**
 * Download details for event emission
 */
export interface DownloadDetails {
    downloadId?: string;
    status?: string;
    progress?: number;
    filesDownloaded?: number;
    totalFiles?: number;
    downloadPath?: string;
    error?: string;
    [key: string]: any;
}

/**
 * Download Resource Handler
 * Manages log download operation resources
 */
class DownloadResourceHandler {
    /**
     * Initialize download event listeners
     */
    static initialize(): void {
        const emitter = getGlobalEmitter();
        const resourceManager = getGlobalResourceManager();
        const notificationSender = getGlobalNotificationSender();

        // Listen for all download events via wildcard
        emitter.on('*', async (event: DXPEvent) => {
            if (event.eventType.startsWith('download.')) {
                // Register or update resource
                const resourceUri = resourceManager.registerOrUpdateResource(event);

                // Send notification to MCP clients
                if (notificationSender) {
                    await notificationSender.sendResourceUpdated(resourceUri);
                }
            }
        });

        if (process.env.DEBUG === 'true') {
            console.error('[DOWNLOAD RESOURCE] Initialized');
        }
    }

    /**
     * Emit download started event
     * @param downloadId - Download ID
     * @param details - Download details
     */
    static emitStarted(downloadId: string, details: DownloadDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DOWNLOAD_STARTED,
            downloadId,
            {
                downloadId,
                status: 'InProgress',
                progress: 0,
                ...details
            },
            {
                operation: 'download_logs',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit download in progress event
     * @param downloadId - Download ID
     * @param details - Progress details
     */
    static emitInProgress(downloadId: string, details: DownloadDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DOWNLOAD_IN_PROGRESS,
            downloadId,
            {
                downloadId,
                status: 'InProgress',
                progress: details.progress || 50,
                filesDownloaded: details.filesDownloaded,
                totalFiles: details.totalFiles,
                ...details
            },
            {
                operation: 'download_logs',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit download succeeded event
     * @param downloadId - Download ID
     * @param details - Download details
     */
    static emitSucceeded(downloadId: string, details: DownloadDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DOWNLOAD_SUCCEEDED,
            downloadId,
            {
                downloadId,
                status: 'Succeeded',
                progress: 100,
                filesDownloaded: details.filesDownloaded,
                downloadPath: details.downloadPath,
                ...details
            },
            {
                operation: 'download_logs',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit download failed event
     * @param downloadId - Download ID
     * @param details - Failure details
     */
    static emitFailed(downloadId: string, details: DownloadDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DOWNLOAD_FAILED,
            downloadId,
            {
                downloadId,
                status: 'Failed',
                error: details.error || 'Unknown error',
                ...details
            },
            {
                operation: 'download_logs',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit download cancelled event
     * @param downloadId - Download ID
     * @param details - Cancellation details
     */
    static emitCancelled(downloadId: string, details: DownloadDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DOWNLOAD_CANCELLED,
            downloadId,
            {
                downloadId,
                status: 'Cancelled',
                ...details
            },
            {
                operation: 'download_cancel',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }
}

export default DownloadResourceHandler;

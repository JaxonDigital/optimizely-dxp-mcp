/**
 * Deployment Resource Handler
 * Handles resource://deployment/{id} resources
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 1
 */

import { getGlobalEmitter } from '../events/event-emitter';
import { getGlobalResourceManager } from '../events/resource-manager';
import { getGlobalNotificationSender } from '../events/notification-sender';
import { createEvent, EVENT_TYPES, DXPEvent } from '../events/event-types';

/**
 * Deployment details for event emission
 */
export interface DeploymentDetails {
    deploymentId?: string;
    status?: string;
    progress?: number;
    slotUrl?: string;
    error?: string;
    [key: string]: any;
}

/**
 * Deployment Resource Handler
 * Manages deployment operation resources
 */
class DeploymentResourceHandler {
    /**
     * Initialize deployment event listeners
     */
    static initialize(): void {
        const emitter = getGlobalEmitter();
        const resourceManager = getGlobalResourceManager();
        const notificationSender = getGlobalNotificationSender();

        // Listen for all deployment events
        emitter.on('deployment.*', async (event: DXPEvent) => {
            // Register or update resource
            const resourceUri = resourceManager.registerOrUpdateResource(event);

            // Send notification to MCP clients
            if (notificationSender) {
                await notificationSender.sendResourceUpdated(resourceUri);
            }
        });

        // Also listen via wildcard to catch all deployment events
        emitter.on('*', async (event: DXPEvent) => {
            if (event.eventType.startsWith('deployment.')) {
                // Already handled by specific listener above
                return;
            }
        });

        if (process.env.DEBUG === 'true') {
            console.error('[DEPLOYMENT RESOURCE] Initialized');
        }
    }

    /**
     * Emit deployment started event
     * @param deploymentId - Deployment ID
     * @param details - Deployment details
     */
    static emitStarted(deploymentId: string, details: DeploymentDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DEPLOYMENT_STARTED,
            deploymentId,
            {
                deploymentId,
                status: 'InProgress',
                progress: 0,
                ...details
            },
            {
                operation: 'start_deployment',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit deployment in progress event
     * @param deploymentId - Deployment ID
     * @param details - Progress details
     */
    static emitInProgress(deploymentId: string, details: DeploymentDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DEPLOYMENT_IN_PROGRESS,
            deploymentId,
            {
                deploymentId,
                status: 'InProgress',
                progress: details.progress || 0,
                ...details
            },
            {
                operation: 'monitor_deployment',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit deployment awaiting verification event
     * @param deploymentId - Deployment ID
     * @param details - Deployment details
     */
    static emitAwaitingVerification(deploymentId: string, details: DeploymentDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DEPLOYMENT_AWAITING_VERIFICATION,
            deploymentId,
            {
                deploymentId,
                status: 'AwaitingVerification',
                progress: 60,
                slotUrl: details.slotUrl,
                ...details
            },
            {
                operation: 'monitor_deployment',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit deployment completing event
     * @param deploymentId - Deployment ID
     * @param details - Deployment details
     */
    static emitCompleting(deploymentId: string, details: DeploymentDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DEPLOYMENT_COMPLETING,
            deploymentId,
            {
                deploymentId,
                status: 'Completing',
                progress: 80,
                ...details
            },
            {
                operation: 'complete_deployment',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit deployment succeeded event
     * @param deploymentId - Deployment ID
     * @param details - Deployment details
     */
    static emitSucceeded(deploymentId: string, details: DeploymentDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DEPLOYMENT_SUCCEEDED,
            deploymentId,
            {
                deploymentId,
                status: 'Succeeded',
                progress: 100,
                ...details
            },
            {
                operation: 'complete_deployment',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit deployment failed event
     * @param deploymentId - Deployment ID
     * @param details - Failure details
     */
    static emitFailed(deploymentId: string, details: DeploymentDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DEPLOYMENT_FAILED,
            deploymentId,
            {
                deploymentId,
                status: 'Failed',
                error: details.error || 'Unknown error',
                ...details
            },
            {
                operation: 'deployment',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }

    /**
     * Emit deployment reset event
     * @param deploymentId - Deployment ID
     * @param details - Reset details
     */
    static emitReset(deploymentId: string, details: DeploymentDetails = {}): DXPEvent {
        const emitter = getGlobalEmitter();
        const event = createEvent(
            EVENT_TYPES.DEPLOYMENT_RESET,
            deploymentId,
            {
                deploymentId,
                status: 'Reset',
                ...details
            },
            {
                operation: 'reset_deployment',
                user: 'system'
            }
        );

        emitter.emitEvent(event);
        return event;
    }
}

export default DeploymentResourceHandler;

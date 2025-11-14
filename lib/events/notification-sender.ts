/**
 * MCP Notification Sender
 * Sends MCP notifications via the configured transport (stdio or HTTP/SSE)
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 1
 */

/**
 * MCP Server interface (simplified)
 */
export interface MCPServer {
    notification?: (params: {
        method: string;
        params: Record<string, any>;
    }) => Promise<void>;
}

/**
 * Notification Sender
 * Handles sending MCP resource notifications to clients
 */
export class NotificationSender {
    private server: MCPServer | null;
    private enabled: boolean;

    constructor(mcpServer: MCPServer | null) {
        this.server = mcpServer;
        this.enabled = true;
    }

    /**
     * Send a resource updated notification
     * @param resourceUri - Resource URI that was updated
     */
    async sendResourceUpdated(resourceUri: string): Promise<void> {
        if (!this.enabled || !this.server) {
            return;
        }

        try {
            // MCP SDK provides notification method
            if (this.server.notification) {
                await this.server.notification({
                    method: 'notifications/resources/updated',
                    params: {
                        uri: resourceUri
                    }
                });

                if (process.env.DEBUG === 'true') {
                    console.error(`[NOTIFICATION] Sent resource update: ${resourceUri}`);
                }
            }
        } catch (error) {
            // Don't fail operations if notifications fail
            console.error('Failed to send resource notification:', (error as Error).message);
        }
    }

    /**
     * Send a resource list changed notification
     */
    async sendResourceListChanged(): Promise<void> {
        if (!this.enabled || !this.server) {
            return;
        }

        try {
            if (this.server.notification) {
                await this.server.notification({
                    method: 'notifications/resources/list_changed',
                    params: {}
                });

                if (process.env.DEBUG === 'true') {
                    console.error('[NOTIFICATION] Sent resource list changed');
                }
            }
        } catch (error) {
            console.error('Failed to send resource list notification:', (error as Error).message);
        }
    }

    /**
     * Enable notifications
     */
    enable(): void {
        this.enabled = true;
    }

    /**
     * Disable notifications (for testing or manual control)
     */
    disable(): void {
        this.enabled = false;
    }
}

// Global notification sender instance
let globalSender: NotificationSender | null = null;

/**
 * Initialize the global notification sender
 * @param mcpServer - MCP server instance
 * @returns Initialized sender
 */
export function initializeNotificationSender(mcpServer: MCPServer): NotificationSender {
    if (!globalSender) {
        globalSender = new NotificationSender(mcpServer);
    }
    return globalSender;
}

/**
 * Get the global notification sender
 * @returns Sender or null if not initialized
 */
export function getGlobalNotificationSender(): NotificationSender | null {
    return globalSender;
}

/**
 * Reset the global sender (for testing)
 */
export function resetGlobalNotificationSender(): void {
    if (globalSender) {
        globalSender.disable();
    }
    globalSender = null;
}

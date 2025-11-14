/**
 * Event Bus Factory
 * Creates appropriate event bus implementation based on configuration
 * Handles fallback from Redis to in-memory on connection failures
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 3
 */

import { InMemoryEventBus } from './in-memory-bus';
import { RedisEventBus } from './redis-event-bus';
import { EventBusInterface, EventBusConfig } from './event-bus-interface';

/**
 * Event Bus Types
 */
export const BUS_TYPES = {
    MEMORY: 'memory',
    REDIS: 'redis'
} as const;

/**
 * Bus type literal type
 */
export type BusType = typeof BUS_TYPES[keyof typeof BUS_TYPES];

/**
 * Factory configuration
 */
export interface FactoryConfig extends EventBusConfig {
    type?: string;
    fallbackToMemory?: boolean;
}

/**
 * Singleton event bus instance
 */
let eventBusInstance: EventBusInterface | null = null;

/**
 * Create event bus instance based on configuration
 * @param config - Configuration object
 * @returns Event bus instance
 */
export async function createEventBus(config: FactoryConfig = {}): Promise<EventBusInterface> {
    const {
        type = process.env.EVENT_BUS_TYPE || BUS_TYPES.MEMORY,
        redisUrl = process.env.REDIS_URL,
        projectId = process.env.PROJECT_NAME || 'default',
        fallbackToMemory = true
    } = config;

    // Normalize type
    const busType = type.toLowerCase();

    try {
        if (busType === BUS_TYPES.REDIS) {
            // Attempt Redis connection
            if (!redisUrl) {
                throw new Error('REDIS_URL is required when EVENT_BUS_TYPE=redis');
            }

            if (process.env.DEBUG === 'true') {
                console.error('[EVENT BUS FACTORY] Creating Redis event bus...');
            }

            const redisBus = new RedisEventBus();
            await redisBus.initialize({ redisUrl, projectId });

            console.error('[EVENT BUS] Redis event bus initialized successfully');
            return redisBus;

        } else if (busType === BUS_TYPES.MEMORY) {
            // In-memory event bus (default)
            if (process.env.DEBUG === 'true') {
                console.error('[EVENT BUS FACTORY] Creating in-memory event bus...');
            }

            const memoryBus = new InMemoryEventBus();
            await memoryBus.initialize({ projectId });

            return memoryBus;

        } else {
            throw new Error(`Unknown event bus type: ${busType}. Must be 'memory' or 'redis'`);
        }

    } catch (error) {
        console.error('[EVENT BUS FACTORY] Failed to create event bus:', (error as Error).message);

        // Fallback to in-memory if Redis fails
        if (busType === BUS_TYPES.REDIS && fallbackToMemory) {
            console.error('[EVENT BUS FACTORY] Falling back to in-memory event bus...');

            const memoryBus = new InMemoryEventBus();
            await memoryBus.initialize({ projectId });

            console.error('[EVENT BUS] In-memory event bus initialized (fallback mode)');
            return memoryBus;
        }

        throw error;
    }
}

/**
 * Get or create singleton event bus instance
 * @param config - Configuration object (only used on first call)
 * @returns Event bus instance
 */
export async function getEventBus(config: FactoryConfig = {}): Promise<EventBusInterface> {
    if (!eventBusInstance) {
        eventBusInstance = await createEventBus(config);
    }
    return eventBusInstance;
}

/**
 * Reset event bus instance (for testing)
 */
export async function resetEventBus(): Promise<void> {
    if (eventBusInstance) {
        await eventBusInstance.close();
        eventBusInstance = null;
    }
}

/**
 * Get event bus configuration from environment
 * @returns Configuration object
 */
export function getConfigFromEnvironment(): FactoryConfig {
    return {
        type: process.env.EVENT_BUS_TYPE || BUS_TYPES.MEMORY,
        redisUrl: process.env.REDIS_URL,
        projectId: process.env.PROJECT_NAME || 'default',
        fallbackToMemory: process.env.EVENT_BUS_FALLBACK !== 'false' // Default true
    };
}

/**
 * Redis Event Bus
 * Redis Pub/Sub implementation for multi-tenant event routing
 * Enables enterprise customers to route DXP events to monitoring systems
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 3
 */

import Redis from 'ioredis';
import { EventBusInterface, EventBusConfig, HistoryOptions, HealthStatus, BusStats, createTopicName } from './event-bus-interface';
import { DXPEvent, validateEvent, isTerminalEvent } from './event-types';

/**
 * Active operation tracking
 */
interface ActiveOperation {
    type: string;
    startTime: number;
    lastEvent: DXPEvent;
}

/**
 * Subscription tracking
 */
interface RedisSubscription {
    pattern: string;
    callback: (event: DXPEvent) => void;
    redisPattern: string;
}

/**
 * Reconnection state tracking
 * DXP-143: Added for automatic reconnection with circuit breaker
 */
interface ReconnectionState {
    isReconnecting: boolean;
    attempts: number;
    maxAttempts: number;
    backoffDelay: number;
    circuitOpen: boolean;
    lastDisconnect: number | null;
}

/**
 * Redis Event Bus Implementation
 * Uses Redis Pub/Sub for distributed event routing
 * Supports multi-tenant event isolation via topic naming
 */
export class RedisEventBus extends EventBusInterface {
    private publisher: Redis | null;
    private subscriber: Redis | null;
    private subscriptions: Map<string, RedisSubscription>;
    private nextSubscriptionId: number;
    private isConnected: boolean;
    private historyKey: string;
    private maxHistoryAge: number;
    private projectId: string;
    private stats: {
        totalEvents: number;
        eventsByType: Record<string, number>;
        subscriptionCount: number;
        connectionErrors: number;
    };
    private activeOperations: Map<string, ActiveOperation>;
    private reconnectionState: ReconnectionState; // DXP-143

    constructor() {
        super();
        this.publisher = null;
        this.subscriber = null;
        this.subscriptions = new Map<string, RedisSubscription>();
        this.nextSubscriptionId = 1;
        this.isConnected = false;

        // Event history (stored in Redis with TTL)
        this.historyKey = 'dxp:events:history';
        this.maxHistoryAge = 24 * 60 * 60; // 24 hours in seconds

        this.projectId = 'default';

        // Stats
        this.stats = {
            totalEvents: 0,
            eventsByType: {},
            subscriptionCount: 0,
            connectionErrors: 0
        };

        // Track active operations (in-memory, not persisted to Redis)
        this.activeOperations = new Map<string, ActiveOperation>();

        // DXP-143: Reconnection state with circuit breaker
        this.reconnectionState = {
            isReconnecting: false,
            attempts: 0,
            maxAttempts: 10, // Max 10 reconnection attempts
            backoffDelay: 50, // Start with 50ms, exponential backoff
            circuitOpen: false,
            lastDisconnect: null
        };
    }

    /**
     * Initialize the Redis event bus
     * DXP-143: Resets reconnection state on initialization
     */
    async initialize(config: EventBusConfig = {}): Promise<void> {
        const {
            redisUrl = process.env.REDIS_URL || 'redis://localhost:6379',
            projectId = process.env.PROJECT_NAME || 'default'
        } = config;

        this.projectId = projectId;

        // DXP-143: Reset reconnection state
        this.reconnectionState = {
            isReconnecting: false,
            attempts: 0,
            maxAttempts: 10,
            backoffDelay: 50,
            circuitOpen: false,
            lastDisconnect: null
        };

        try {
            // Create publisher connection
            this.publisher = new Redis(redisUrl, {
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: 3,
                lazyConnect: true
            });

            // Create subscriber connection (must be separate for pub/sub)
            this.subscriber = new Redis(redisUrl, {
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: 3,
                lazyConnect: true
            });

            // Setup event handlers
            this.setupEventHandlers();

            // Connect to Redis
            await this.publisher.connect();
            await this.subscriber.connect();

            this.isConnected = true;

            if (process.env.DEBUG === 'true') {
                console.error('[REDIS BUS] Connected to Redis at', redisUrl);
            }

        } catch (error) {
            this.stats.connectionErrors++;
            console.error('[REDIS BUS] Failed to connect to Redis:', (error as Error).message);
            throw new Error(`Redis connection failed: ${(error as Error).message}`);
        }
    }

    /**
     * Setup Redis event handlers
     * DXP-143: Enhanced with reconnection handlers
     */
    private setupEventHandlers(): void {
        if (!this.publisher || !this.subscriber) return;

        // Publisher error handling
        this.publisher.on('error', (error: Error) => {
            this.stats.connectionErrors++;
            console.error('[REDIS BUS] Publisher error:', error.message);
        });

        this.publisher.on('connect', () => {
            if (process.env.DEBUG === 'true') {
                console.error('[REDIS BUS] Publisher connected');
            }
            this.handleReconnected('publisher');
        });

        // DXP-143: Publisher disconnect/close handlers
        this.publisher.on('close', () => {
            this.handleDisconnect('publisher');
        });

        this.publisher.on('end', () => {
            this.handleDisconnect('publisher');
        });

        this.publisher.on('reconnecting', () => {
            this.handleReconnecting('publisher');
        });

        // Subscriber error handling
        this.subscriber.on('error', (error: Error) => {
            this.stats.connectionErrors++;
            console.error('[REDIS BUS] Subscriber error:', error.message);
        });

        this.subscriber.on('connect', () => {
            if (process.env.DEBUG === 'true') {
                console.error('[REDIS BUS] Subscriber connected');
            }
            this.handleReconnected('subscriber');
        });

        // DXP-143: Subscriber disconnect/close handlers
        this.subscriber.on('close', () => {
            this.handleDisconnect('subscriber');
        });

        this.subscriber.on('end', () => {
            this.handleDisconnect('subscriber');
        });

        this.subscriber.on('reconnecting', () => {
            this.handleReconnecting('subscriber');
        });

        // Handle incoming messages
        this.subscriber.on('pmessage', (pattern: string, _channel: string, message: string) => {
            try {
                const event = JSON.parse(message) as DXPEvent;

                // Find matching subscriptions
                for (const [subscriptionId, subscription] of this.subscriptions) {
                    if (subscription.redisPattern === pattern) {
                        try {
                            subscription.callback(event);
                        } catch (error) {
                            console.error(`[REDIS BUS] Error in subscription callback (${subscriptionId}):`, error);
                        }
                    }
                }
            } catch (error) {
                console.error('[REDIS BUS] Failed to parse message:', (error as Error).message);
            }
        });
    }

    /**
     * Publish an event to Redis
     */
    async publish(event: DXPEvent): Promise<boolean> {
        if (!this.isConnected || !this.publisher) {
            console.error('[REDIS BUS] Cannot publish - not connected to Redis');
            return false;
        }

        try {
            // Validate event
            validateEvent(event);

            // Track active operation (in-memory)
            this.trackOperation(event);

            // Create topic name with project isolation
            const topicName = createTopicName(this.projectId, event.eventType);

            // Publish to Redis
            const eventJson = JSON.stringify(event);
            await this.publisher.publish(topicName, eventJson);

            // Add to history (with TTL)
            await this.addToHistory(event);

            // Update stats
            this.stats.totalEvents++;
            this.stats.eventsByType[event.eventType] = (this.stats.eventsByType[event.eventType] || 0) + 1;

            if (process.env.DEBUG === 'true') {
                console.error(`[REDIS BUS] Published ${event.eventType} to ${topicName}`);
            }

            return true;

        } catch (error) {
            console.error('[REDIS BUS] Failed to publish event:', (error as Error).message);
            return false;
        }
    }

    /**
     * Subscribe to events matching a pattern
     */
    async subscribe(pattern: string, callback: (event: DXPEvent) => void): Promise<string> {
        if (!this.isConnected || !this.subscriber) {
            throw new Error('Redis not connected');
        }

        const subscriptionId = `redis-sub-${this.nextSubscriptionId++}`;

        try {
            // Convert pattern to Redis pub/sub pattern
            // Example: 'deployment.*' -> 'dxp.PROJECT123.deployment.*'
            const redisPattern = createTopicName(this.projectId, pattern).replace(/\*/g, '*');

            // Subscribe using pattern matching (psubscribe)
            await this.subscriber.psubscribe(redisPattern);

            // Track subscription
            this.subscriptions.set(subscriptionId, {
                pattern,
                callback,
                redisPattern
            });
            this.stats.subscriptionCount++;

            if (process.env.DEBUG === 'true') {
                console.error(`[REDIS BUS] Subscribed to pattern: ${redisPattern} (${subscriptionId})`);
            }

            return subscriptionId;

        } catch (error) {
            console.error('[REDIS BUS] Subscribe failed:', (error as Error).message);
            throw error;
        }
    }

    /**
     * Unsubscribe from events
     */
    async unsubscribe(subscriptionId: string): Promise<void> {
        const subscription = this.subscriptions.get(subscriptionId);
        if (!subscription) {
            throw new Error(`Subscription not found: ${subscriptionId}`);
        }

        if (!this.subscriber) {
            throw new Error('Redis subscriber not initialized');
        }

        try {
            // Unsubscribe from Redis pattern
            await this.subscriber.punsubscribe(subscription.redisPattern);

            // Remove from tracking
            this.subscriptions.delete(subscriptionId);
            this.stats.subscriptionCount--;

            if (process.env.DEBUG === 'true') {
                console.error(`[REDIS BUS] Unsubscribed: ${subscriptionId}`);
            }

        } catch (error) {
            console.error('[REDIS BUS] Unsubscribe failed:', (error as Error).message);
            throw error;
        }
    }

    /**
     * Get event history from Redis
     */
    async getHistory(options: HistoryOptions = {}): Promise<DXPEvent[]> {
        if (!this.isConnected || !this.publisher) {
            return [];
        }

        const {
            pattern = '*',
            limit = 100,
            since = null
        } = options;

        try {
            // Get events from Redis sorted set (by timestamp)
            const cutoff = since ? new Date(since).getTime() : 0;
            const events = await this.publisher.zrangebyscore(
                this.historyKey,
                cutoff,
                '+inf',
                'LIMIT', 0, limit
            );

            // Parse events
            const parsedEvents = events.map(e => JSON.parse(e) as DXPEvent);

            // Filter by pattern
            if (pattern !== '*') {
                return parsedEvents.filter(e => this.matchesPattern(e.eventType, pattern));
            }

            return parsedEvents;

        } catch (error) {
            console.error('[REDIS BUS] Failed to get history:', (error as Error).message);
            return [];
        }
    }

    /**
     * Get bus health status
     * DXP-143: Enhanced with reconnection status
     */
    async getHealth(): Promise<HealthStatus> {
        const publisherStatus = this.publisher?.status || 'disconnected';
        const subscriberStatus = this.subscriber?.status || 'disconnected';

        return {
            healthy: this.isConnected &&
                     publisherStatus === 'ready' &&
                     subscriberStatus === 'ready' &&
                     !this.reconnectionState.circuitOpen,
            type: 'redis',
            details: {
                publisher: publisherStatus,
                subscriber: subscriberStatus,
                activeOperations: this.activeOperations.size,
                subscriptions: this.subscriptions.size,
                connectionErrors: this.stats.connectionErrors,
                // DXP-143: Reconnection status
                reconnecting: this.reconnectionState.isReconnecting,
                reconnectionAttempts: this.reconnectionState.attempts,
                circuitBreakerOpen: this.reconnectionState.circuitOpen,
                lastDisconnect: this.reconnectionState.lastDisconnect,
                maxReconnectionAttempts: this.reconnectionState.maxAttempts
            }
        };
    }

    /**
     * Get bus statistics
     */
    async getStats(): Promise<BusStats> {
        return {
            ...this.stats,
            activeOperations: Array.from(this.activeOperations.keys())
        };
    }

    /**
     * Close/cleanup the Redis connections
     * DXP-143: Also resets reconnection state
     */
    async close(): Promise<void> {
        if (this.publisher) {
            await this.publisher.quit();
        }
        if (this.subscriber) {
            await this.subscriber.quit();
        }

        this.isConnected = false;
        this.subscriptions.clear();
        this.activeOperations.clear();

        // DXP-143: Reset reconnection state
        this.reconnectionState = {
            isReconnecting: false,
            attempts: 0,
            maxAttempts: 10,
            backoffDelay: 50,
            circuitOpen: false,
            lastDisconnect: null
        };

        if (process.env.DEBUG === 'true') {
            console.error('[REDIS BUS] Redis event bus closed');
        }
    }

    // DXP-143: Reconnection handlers

    /**
     * Handle Redis disconnect
     * DXP-143: Automatic reconnection with circuit breaker
     */
    private handleDisconnect(client: 'publisher' | 'subscriber'): void {
        // Circuit breaker open - don't attempt reconnection
        if (this.reconnectionState.circuitOpen) {
            if (process.env.DEBUG === 'true') {
                console.error(`[REDIS BUS] ${client} disconnected (circuit breaker OPEN)`);
            }
            return;
        }

        this.isConnected = false;
        this.reconnectionState.isReconnecting = true;
        this.reconnectionState.lastDisconnect = Date.now();

        console.error(`[REDIS BUS] ${client} disconnected, attempting reconnection...`);

        // Check if max attempts reached
        if (this.reconnectionState.attempts >= this.reconnectionState.maxAttempts) {
            this.reconnectionState.circuitOpen = true;
            this.stats.connectionErrors++;

            console.error('[REDIS BUS] Max reconnection attempts reached, circuit breaker OPEN');
            console.error('[REDIS BUS] Manual intervention required or restart server');

            // Emit event for monitoring systems (optional)
            if (process.env.DEBUG === 'true') {
                console.error('[REDIS BUS] Reconnection state:', this.reconnectionState);
            }
        }
    }

    /**
     * Handle Redis reconnecting event
     * DXP-143: Tracks reconnection attempts and logs status
     */
    private handleReconnecting(client: 'publisher' | 'subscriber'): void {
        this.reconnectionState.attempts++;

        const delay = Math.min(
            this.reconnectionState.backoffDelay * this.reconnectionState.attempts,
            2000
        );

        if (process.env.DEBUG === 'true') {
            console.error(
                `[REDIS BUS] ${client} reconnection attempt ${this.reconnectionState.attempts}/${this.reconnectionState.maxAttempts}, delay: ${delay}ms`
            );
        }
    }

    /**
     * Handle successful reconnection
     * DXP-143: Resets reconnection state after successful connect
     */
    private handleReconnected(_client: 'publisher' | 'subscriber'): void {
        // Check if both clients are ready
        const publisherReady = this.publisher?.status === 'ready';
        const subscriberReady = this.subscriber?.status === 'ready';

        if (publisherReady && subscriberReady) {
            // Both connected - reset reconnection state
            const wasReconnecting = this.reconnectionState.isReconnecting;

            this.isConnected = true;
            this.reconnectionState.isReconnecting = false;
            this.reconnectionState.attempts = 0;
            this.reconnectionState.circuitOpen = false;
            this.reconnectionState.lastDisconnect = null;

            if (wasReconnecting && process.env.DEBUG === 'true') {
                console.error('[REDIS BUS] Reconnection successful, both clients ready');
            }
        }
    }

    // Internal helper methods

    /**
     * Track operation lifecycle (in-memory)
     */
    private trackOperation(event: DXPEvent): void {
        const { operationId, eventType } = event;

        if (!this.activeOperations.has(operationId)) {
            this.activeOperations.set(operationId, {
                type: event.eventType.split('.')[0],
                startTime: Date.now(),
                lastEvent: event
            });
        } else {
            const op = this.activeOperations.get(operationId)!;
            op.lastEvent = event;

            if (isTerminalEvent(eventType)) {
                this.activeOperations.delete(operationId);
            }
        }
    }

    /**
     * Add event to Redis history (sorted set with TTL)
     */
    private async addToHistory(event: DXPEvent): Promise<void> {
        if (!this.publisher) return;

        try {
            const eventJson = JSON.stringify(event);
            const score = new Date(event.timestamp).getTime();

            // Add to sorted set (score = timestamp)
            await this.publisher.zadd(this.historyKey, score, eventJson);

            // Set TTL on the key (24 hours)
            await this.publisher.expire(this.historyKey, this.maxHistoryAge);

            // Clean up old events (beyond 24 hours)
            const cutoff = Date.now() - (this.maxHistoryAge * 1000);
            await this.publisher.zremrangebyscore(this.historyKey, '-inf', cutoff);

        } catch (error) {
            console.error('[REDIS BUS] Failed to add event to history:', (error as Error).message);
        }
    }

    /**
     * Match event type against pattern
     */
    private matchesPattern(eventType: string, pattern: string): boolean {
        if (pattern === eventType || pattern === '*') {
            return true;
        }

        if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -2);
            return eventType.startsWith(prefix + '.');
        }

        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            return eventType.startsWith(prefix);
        }

        return false;
    }
}

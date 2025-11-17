/**
 * Cache Manager Module
 * Intelligent caching for frequently used operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// Type definitions
interface OperationTtl {
    [operation: string]: number;
}

interface CacheManagerOptions {
    defaultTtl?: number;
    maxCacheSize?: number;
    maxEntries?: number;
    operationTtl?: OperationTtl;
    noCacheOperations?: Set<string> | string[];
    persistCache?: boolean;
    storageDir?: string;
    debug?: boolean;
}

interface CacheEntry {
    data: any;
    createdAt: number;
    expiresAt: number;
    lastAccessed: number;
    accessCount: number;
    size: number;
    operation: string;
    projectId: string;
}

interface CacheStats {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    size: number;
}

interface CacheStatsReport extends CacheStats {
    entries: number;
    hitRate: string;
    sizeMB: string;
    maxSizeMB: string;
}

interface PersistedCacheData {
    entries: Record<string, CacheEntry>;
    stats: CacheStats;
    savedAt: number;
}

class CacheManager {
    private options: Required<Omit<CacheManagerOptions, 'operationTtl' | 'noCacheOperations'>> & {
        operationTtl: OperationTtl;
        noCacheOperations: Set<string>;
    };
    private cache: Map<string, CacheEntry>;
    private cacheStats: CacheStats;
    private cleanupInterval: NodeJS.Timeout | null;

    constructor(options: CacheManagerOptions = {}) {
        this.options = {
            // Cache TTL (time to live) settings
            defaultTtl: options.defaultTtl || 5 * 60 * 1000, // 5 minutes
            maxCacheSize: options.maxCacheSize || 50 * 1024 * 1024, // 50MB
            maxEntries: options.maxEntries || 1000,

            // Operation-specific TTL (milliseconds)
            operationTtl: {
                list_deployments: 10 * 1000,            // 10 seconds (deployments change frequently)
                list_storage_containers: 10 * 60 * 1000, // 10 minutes (containers rarely change)
                get_api_key_info: 15 * 60 * 1000,       // 15 minutes (API key info rarely changes)
                get_edge_logs: 30 * 1000,               // 30 seconds (logs are time-sensitive)
                ...options.operationTtl
            },

            // Operations that should not be cached
            noCacheOperations: new Set([
                // Deployment operations (always need fresh data)
                'list_deployments',
                'get_deployment_status',
                'start_deployment',
                'complete_deployment',
                'reset_deployment',
                'upload_deployment_package',
                'deploy_package_and_start',
                'copy_content',
                // Status checking operations (always need real-time data)
                'db_export_status',  // Export status changes frequently
                'db_export',  // Export initiates a new operation
                'get_monitoring_stats',
                'get_rate_limit_status',
                ...(Array.isArray(options.noCacheOperations)
                    ? options.noCacheOperations
                    : options.noCacheOperations || [])
            ]),

            // Storage settings
            persistCache: options.persistCache !== false,
            storageDir: options.storageDir || path.join(os.tmpdir(), 'optimizely-mcp-cache'),

            // Debug
            debug: options.debug || process.env.DEBUG === 'true'
        };

        // In-memory cache
        this.cache = new Map();
        this.cacheStats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            size: 0
        };

        this.cleanupInterval = null;

        // Initialize storage
        this.initializeStorage();

        // Load persisted cache
        if (this.options.persistCache) {
            this.loadPersistedCache();
        }

        // Periodic cleanup
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000); // Every minute
    }

    /**
     * Initialize cache storage directory
     */
    private initializeStorage(): void {
        if (!this.options.persistCache) return;

        try {
            if (!fs.existsSync(this.options.storageDir)) {
                fs.mkdirSync(this.options.storageDir, { recursive: true });
            }
        } catch (error) {
            if (this.options.debug) {
                console.error('Cache storage init failed:', (error as Error).message);
            }
        }
    }

    /**
     * Generate cache key for operation
     * @param operation - Operation name
     * @param args - Operation arguments
     * @param projectId - Project identifier
     * @returns Cache key
     */
    generateCacheKey(operation: string, args: any = {}, projectId: string): string {
        // Create a stable key from operation and arguments
        const keyData = {
            operation,
            projectId,
            // Sort args to ensure consistent keys regardless of argument order
            args: this.sortObject(this.sanitizeArgs(args))
        };

        const keyString = JSON.stringify(keyData);
        return crypto.createHash('md5').update(keyString).digest('hex');
    }

    /**
     * Sanitize arguments for cache key generation
     * @param args - Arguments to sanitize
     * @returns Sanitized arguments
     */
    private sanitizeArgs(args: any): any {
        const sanitized: any = {};

        // Only include arguments that affect the result
        const relevantKeys = [
            'environment', 'databaseName', 'deploymentId', 'exportId',
            'limit', 'offset', 'containerName', 'permissions', 'hours'
        ];

        relevantKeys.forEach(key => {
            if (args[key] !== undefined) {
                sanitized[key] = args[key];
            }
        });

        return sanitized;
    }

    /**
     * Sort object keys recursively for consistent cache keys
     * @param obj - Object to sort
     * @returns Sorted object
     */
    private sortObject(obj: any): any {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => this.sortObject(item));
        }

        const sorted: any = {};
        Object.keys(obj).sort().forEach(key => {
            sorted[key] = this.sortObject(obj[key]);
        });

        return sorted;
    }

    /**
     * Get cached result
     * @param operation - Operation name
     * @param args - Operation arguments
     * @param projectId - Project identifier
     * @returns Cached result or null
     */
    get(operation: string, args: any, projectId: string): any {
        // Check if caching is disabled via environment variables
        if (process.env.DISABLE_CACHE === 'true' || process.env.NODE_ENV === 'development') {
            return null;
        }

        // Check if operation should not be cached
        if (this.options.noCacheOperations.has(operation)) {
            return null;
        }

        const key = this.generateCacheKey(operation, args, projectId);
        const entry = this.cache.get(key);

        if (!entry) {
            this.cacheStats.misses++;
            if (this.options.debug) {
                console.error(`Cache MISS: ${operation} for ${projectId}`);
            }
            return null;
        }

        // Check if entry has expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.cacheStats.misses++;
            this.cacheStats.deletes++;
            if (this.options.debug) {
                console.error(`Cache EXPIRED: ${operation} for ${projectId}`);
            }
            return null;
        }

        this.cacheStats.hits++;
        entry.lastAccessed = Date.now();
        entry.accessCount++;

        if (this.options.debug) {
            console.error(`Cache HIT: ${operation} for ${projectId} (age: ${Math.round((Date.now() - entry.createdAt) / 1000)}s)`);
        }

        return entry.data;
    }

    /**
     * Set cached result
     * @param operation - Operation name
     * @param args - Operation arguments
     * @param projectId - Project identifier
     * @param data - Data to cache
     * @returns Whether data was cached
     */
    set(operation: string, args: any, projectId: string, data: any): boolean {
        // Check if caching is disabled via environment variables
        if (process.env.DISABLE_CACHE === 'true' || process.env.NODE_ENV === 'development') {
            return false;
        }

        // Check if operation should not be cached
        if (this.options.noCacheOperations.has(operation)) {
            return false;
        }

        // Don't cache error results
        if (data && (data.error || data.isError)) {
            return false;
        }

        // Don't cache empty results
        if (!data || (Array.isArray(data) && data.length === 0)) {
            return false;
        }

        const key = this.generateCacheKey(operation, args, projectId);
        const ttl = this.options.operationTtl[operation] || this.options.defaultTtl;
        const now = Date.now();

        // Check cache size limits before adding
        if (this.cache.size >= this.options.maxEntries) {
            this.evictOldest();
        }

        const dataSize = this.estimateSize(data);
        if (this.cacheStats.size + dataSize > this.options.maxCacheSize) {
            this.evictLargest();
        }

        const entry: CacheEntry = {
            data,
            createdAt: now,
            expiresAt: now + ttl,
            lastAccessed: now,
            accessCount: 1,
            size: dataSize,
            operation,
            projectId
        };

        // Remove existing entry if it exists
        const existingEntry = this.cache.get(key);
        if (existingEntry) {
            this.cacheStats.size -= existingEntry.size;
        }

        this.cache.set(key, entry);
        this.cacheStats.sets++;
        this.cacheStats.size += dataSize;

        if (this.options.debug) {
            console.error(`Cache SET: ${operation} for ${projectId} (TTL: ${Math.round(ttl / 1000)}s, Size: ${Math.round(dataSize / 1024)}KB)`);
        }

        // Persist if enabled
        if (this.options.persistCache) {
            this.persistEntry(key, entry);
        }

        return true;
    }

    /**
     * Estimate size of data in bytes
     * @param data - Data to estimate
     * @returns Estimated size in bytes
     */
    private estimateSize(data: any): number {
        if (!data) return 0;

        try {
            return Buffer.byteLength(JSON.stringify(data), 'utf8');
        } catch {
            // Fallback estimation
            return 1024; // 1KB default
        }
    }

    /**
     * Invalidate cache entries by pattern
     * @param operation - Operation to invalidate
     * @param projectId - Project identifier
     */
    invalidate(operation: string, projectId: string): void {
        const keysToDelete: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (entry.operation === operation && entry.projectId === projectId) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => {
            const entry = this.cache.get(key);
            if (entry) {
                this.cacheStats.size -= entry.size;
                this.cacheStats.deletes++;
            }
            this.cache.delete(key);
        });

        if (this.options.debug && keysToDelete.length > 0) {
            console.error(`Cache INVALIDATE: ${keysToDelete.length} entries for ${operation}/${projectId}`);
        }
    }

    /**
     * Invalidate related cache entries after write operations
     * @param operation - Operation that was performed
     * @param projectId - Project identifier
     */
    invalidateRelated(operation: string, projectId: string): void {
        const invalidationMap: Record<string, string[]> = {
            'start_deployment': ['list_deployments', 'get_deployment_status'],
            'complete_deployment': ['list_deployments', 'get_deployment_status'],
            'reset_deployment': ['list_deployments', 'get_deployment_status'],
            'upload_deployment_package': ['list_storage_containers'],
            'copy_content': ['list_deployments', 'get_deployment_status'],
            'db_export': ['db_export_status']
        };

        const relatedOperations = invalidationMap[operation] || [];
        relatedOperations.forEach(relatedOp => {
            this.invalidate(relatedOp, projectId);
        });
    }

    /**
     * Evict oldest entries when cache is full
     */
    private evictOldest(): void {
        const entries = Array.from(this.cache.entries());
        entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

        const entriesToRemove = Math.max(1, Math.floor(entries.length * 0.1)); // Remove 10%

        for (let i = 0; i < entriesToRemove && entries[i]; i++) {
            const [key, entry] = entries[i];
            this.cacheStats.size -= entry.size;
            this.cacheStats.deletes++;
            this.cache.delete(key);
        }

        if (this.options.debug) {
            console.error(`Cache EVICT: Removed ${entriesToRemove} oldest entries`);
        }
    }

    /**
     * Evict largest entries when cache size limit reached
     */
    private evictLargest(): void {
        const entries = Array.from(this.cache.entries());
        entries.sort((a, b) => b[1].size - a[1].size);

        const entriesToRemove = Math.max(1, Math.floor(entries.length * 0.1)); // Remove 10%

        for (let i = 0; i < entriesToRemove && entries[i]; i++) {
            const [key, entry] = entries[i];
            this.cacheStats.size -= entry.size;
            this.cacheStats.deletes++;
            this.cache.delete(key);
        }

        if (this.options.debug) {
            console.error(`Cache EVICT: Removed ${entriesToRemove} largest entries`);
        }
    }

    /**
     * Clean up expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        const keysToDelete: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => {
            const entry = this.cache.get(key);
            if (entry) {
                this.cacheStats.size -= entry.size;
                this.cacheStats.deletes++;
            }
            this.cache.delete(key);
        });

        if (this.options.debug && keysToDelete.length > 0) {
            console.error(`Cache CLEANUP: Removed ${keysToDelete.length} expired entries`);
        }

        // Persist stats
        if (this.options.persistCache) {
            this.persistStats();
        }
    }

    /**
     * Load persisted cache from disk
     */
    private loadPersistedCache(): void {
        try {
            const cacheFile = path.join(this.options.storageDir, 'cache.json');
            if (!fs.existsSync(cacheFile)) return;

            const data: PersistedCacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            const now = Date.now();

            // Load entries that haven't expired
            let loadedCount = 0;
            Object.entries(data.entries || {}).forEach(([key, entry]) => {
                if (entry.expiresAt > now && loadedCount < this.options.maxEntries) {
                    this.cache.set(key, entry);
                    this.cacheStats.size += entry.size || 1024;
                    loadedCount++;
                }
            });

            // Load stats
            if (data.stats) {
                this.cacheStats = { ...this.cacheStats, ...data.stats };
            }

            if (this.options.debug && loadedCount > 0) {
                console.error(`Cache LOAD: Restored ${loadedCount} entries from disk`);
            }
        } catch (error) {
            if (this.options.debug) {
                console.error('Failed to load persisted cache:', (error as Error).message);
            }
        }
    }

    /**
     * Persist single cache entry
     */
    private persistEntry(_key: string, _entry: CacheEntry): void {
        // For performance, we only persist periodically in cleanup()
        // Individual entries are not immediately persisted
    }

    /**
     * Persist cache stats
     */
    private persistStats(): void {
        if (!this.options.persistCache) return;

        try {
            const cacheFile = path.join(this.options.storageDir, 'cache.json');
            const data: PersistedCacheData = {
                entries: Object.fromEntries(this.cache.entries()),
                stats: this.cacheStats,
                savedAt: Date.now()
            };

            fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
        } catch (error) {
            if (this.options.debug) {
                console.error('Failed to persist cache:', (error as Error).message);
            }
        }
    }

    /**
     * Get cache statistics
     * @returns Cache statistics
     */
    getStats(): CacheStatsReport {
        const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0
            ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100).toFixed(1)
            : '0.0';

        return {
            ...this.cacheStats,
            entries: this.cache.size,
            hitRate: `${hitRate}%`,
            sizeMB: (this.cacheStats.size / (1024 * 1024)).toFixed(2),
            maxSizeMB: (this.options.maxCacheSize / (1024 * 1024)).toFixed(2)
        };
    }

    /**
     * Clear all cache entries
     * @param projectId - Optional project ID to clear specific project cache
     */
    clear(projectId?: string): void {
        if (projectId) {
            // Clear cache for specific project
            const keysToDelete: string[] = [];
            for (const [key, entry] of this.cache.entries()) {
                if (entry.projectId === projectId) {
                    keysToDelete.push(key);
                }
            }

            keysToDelete.forEach(key => {
                const entry = this.cache.get(key);
                if (entry) {
                    this.cacheStats.size -= entry.size;
                    this.cacheStats.deletes++;
                }
                this.cache.delete(key);
            });

            // If this was the only project or we cleared all remaining entries, reset stats
            if (this.cache.size === 0) {
                this.cacheStats = {
                    hits: 0,
                    misses: 0,
                    sets: 0,
                    deletes: 0,
                    size: 0
                };
            }

            if (this.options.debug) {
                console.error(`Cache CLEAR: Removed ${keysToDelete.length} entries for project ${projectId}`);
            }
        } else {
            // Clear all cache
            this.cache.clear();
            this.cacheStats = {
                hits: 0,
                misses: 0,
                sets: 0,
                deletes: 0,
                size: 0
            };

            if (this.options.debug) {
                console.error('Cache CLEAR: All entries removed');
            }
        }
    }

    /**
     * Destroy cache manager and clean up
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        // Final persistence
        if (this.options.persistCache) {
            this.persistStats();
        }

        this.cache.clear();
    }
}

export default CacheManager;

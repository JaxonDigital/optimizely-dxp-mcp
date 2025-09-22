/**
 * Cache Manager Module
 * Intelligent caching for frequently used operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class CacheManager {
    constructor(options = {}) {
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
                'check_export_status',  // Export status changes frequently
                'export_database',  // Export initiates a new operation
                'get_monitoring_stats',
                'get_rate_limit_status',
                ...options.noCacheOperations || []
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
    initializeStorage() {
        if (!this.options.persistCache) return;
        
        try {
            if (!fs.existsSync(this.options.storageDir)) {
                fs.mkdirSync(this.options.storageDir, { recursive: true });
            }
        } catch (error) {
            if (this.options.debug) {
                console.error('Cache storage init failed:', error.message);
            }
        }
    }

    /**
     * Generate cache key for operation
     * @param {string} operation - Operation name
     * @param {Object} args - Operation arguments
     * @param {string} projectId - Project identifier
     * @returns {string} Cache key
     */
    generateCacheKey(operation, args = {}, projectId) {
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
     * @param {Object} args - Arguments to sanitize
     * @returns {Object} Sanitized arguments
     */
    sanitizeArgs(args) {
        const sanitized = {};
        
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
     * @param {*} obj - Object to sort
     * @returns {*} Sorted object
     */
    sortObject(obj) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => this.sortObject(item));
        }
        
        const sorted = {};
        Object.keys(obj).sort().forEach(key => {
            sorted[key] = this.sortObject(obj[key]);
        });
        
        return sorted;
    }

    /**
     * Get cached result
     * @param {string} operation - Operation name
     * @param {Object} args - Operation arguments
     * @param {string} projectId - Project identifier
     * @returns {*} Cached result or null
     */
    get(operation, args, projectId) {
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
     * @param {string} operation - Operation name
     * @param {Object} args - Operation arguments
     * @param {string} projectId - Project identifier
     * @param {*} data - Data to cache
     * @returns {boolean} Whether data was cached
     */
    set(operation, args, projectId, data) {
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
        
        const entry = {
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
     * @param {*} data - Data to estimate
     * @returns {number} Estimated size in bytes
     */
    estimateSize(data) {
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
     * @param {string} operation - Operation to invalidate
     * @param {string} projectId - Project identifier
     */
    invalidate(operation, projectId) {
        const keysToDelete = [];
        
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
     * @param {string} operation - Operation that was performed
     * @param {string} projectId - Project identifier
     */
    invalidateRelated(operation, projectId) {
        const invalidationMap = {
            'start_deployment': ['list_deployments', 'get_deployment_status'],
            'complete_deployment': ['list_deployments', 'get_deployment_status'],
            'reset_deployment': ['list_deployments', 'get_deployment_status'],
            'upload_deployment_package': ['list_storage_containers'],
            'copy_content': ['list_deployments', 'get_deployment_status'],
            'export_database': ['check_export_status']
        };
        
        const relatedOperations = invalidationMap[operation] || [];
        relatedOperations.forEach(relatedOp => {
            this.invalidate(relatedOp, projectId);
        });
    }

    /**
     * Evict oldest entries when cache is full
     */
    evictOldest() {
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
    evictLargest() {
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
    cleanup() {
        const now = Date.now();
        const keysToDelete = [];
        
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
    loadPersistedCache() {
        try {
            const cacheFile = path.join(this.options.storageDir, 'cache.json');
            if (!fs.existsSync(cacheFile)) return;
            
            const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
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
                console.error('Failed to load persisted cache:', error.message);
            }
        }
    }

    /**
     * Persist single cache entry
     */
    persistEntry(key, entry) {
        // For performance, we only persist periodically in cleanup()
        // Individual entries are not immediately persisted
    }

    /**
     * Persist cache stats
     */
    persistStats() {
        if (!this.options.persistCache) return;
        
        try {
            const cacheFile = path.join(this.options.storageDir, 'cache.json');
            const data = {
                entries: Object.fromEntries(this.cache.entries()),
                stats: this.cacheStats,
                savedAt: Date.now()
            };
            
            fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
        } catch (error) {
            if (this.options.debug) {
                console.error('Failed to persist cache:', error.message);
            }
        }
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
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
     * @param {string} projectId - Optional project ID to clear specific project cache
     */
    clear(projectId) {
        if (projectId) {
            // Clear cache for specific project
            const keysToDelete = [];
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
    destroy() {
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

module.exports = CacheManager;
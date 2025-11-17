/**
 * Audit Logger - Records MCP tool invocations to immutable audit trail
 * Implements schema from DXP-124-1
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');

class AuditLogger {
    constructor(options = {}) {
        this.auditDir = options.auditDir || './audit-logs';
        this.version = options.version || this.getVersion();
        this.enabled = options.enabled !== false; // Default: enabled
        this.context = options.context || {};
    }

    /**
     * Get MCP server version from package.json
     */
    getVersion() {
        try {
            const pkg = require('../package.json');
            return pkg.version;
        } catch (error) {
            return 'unknown';
        }
    }

    /**
     * Log a tool invocation with complete audit trail
     * Follows DXP-124-1 schema
     *
     * @param {Object} entry - Audit log entry
     * @param {string} entry.operation - Tool name
     * @param {string} entry.operation_type - Category (deployment, log, database, storage, config)
     * @param {string} entry.status - Operation status (started, success, failure, error)
     * @param {Object} entry.user - User who invoked the tool
     * @param {Object} entry.environment - DXP environment details
     * @param {Object} entry.request - Request details
     * @param {Object} entry.response - Response details
     * @param {string} entry.parent_operation - Optional parent correlation ID
     * @param {Array} entry.tags - Optional tags
     * @param {Object} entry.metadata - Optional metadata
     */
    async logOperation(entry) {
        if (!this.enabled) return null;

        // Build complete audit entry following DXP-124-1 schema
        const auditEntry = {
            timestamp: entry.timestamp || new Date().toISOString(),
            operation: entry.operation,
            operation_type: entry.operation_type,
            status: entry.status,
            user: entry.user || { id: 'system' },
            environment: entry.environment || {},
            request: {
                tool: entry.request?.tool || entry.operation,
                parameters: this.sanitize(entry.request?.parameters || {}),
                correlation_id: entry.request?.correlation_id
            },
            response: {
                result: entry.response?.result || (entry.status === 'success' ? 'success' : 'failure'),
                duration_ms: entry.response?.duration_ms || 0,
                error: entry.response?.error
            }
        };

        // Add optional fields
        if (entry.parent_operation) {
            auditEntry.parent_operation = entry.parent_operation;
        }

        if (entry.tags && entry.tags.length > 0) {
            auditEntry.tags = entry.tags.slice(0, 10); // Max 10 tags per DXP-124-1
        }

        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
            const metadataKeys = Object.keys(entry.metadata);
            auditEntry.metadata = {};
            // Max 20 keys per DXP-124-1
            for (let i = 0; i < Math.min(metadataKeys.length, 20); i++) {
                const key = metadataKeys[i];
                auditEntry.metadata[key] = entry.metadata[key];
            }
        }

        if (entry.sanitized_headers) {
            auditEntry.sanitized_headers = this.sanitizeHeaders(entry.sanitized_headers);
        }

        await this.writeEntry(auditEntry);
        return auditEntry;
    }

    /**
     * Sanitize sensitive data from parameters/responses
     * Implements security rules from DXP-124-1
     */
    sanitize(obj) {
        if (!obj || typeof obj !== 'object') return obj;

        const sanitized = Array.isArray(obj) ? [] : {};

        for (const [key, value] of Object.entries(obj)) {
            // Redact sensitive keys
            if (this.isSensitiveKey(key)) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'string' && this.isSASUrl(value)) {
                // Redact SAS URLs
                sanitized[key] = value.split('?')[0] + '?[SAS_REDACTED]';
            } else if (typeof value === 'object' && value !== null) {
                // Recursively sanitize nested objects
                sanitized[key] = this.sanitize(value);
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Check if a key is sensitive and should be redacted
     */
    isSensitiveKey(key) {
        const lower = key.toLowerCase();
        return (
            lower.includes('password') ||
            lower.includes('secret') ||
            lower.includes('token') ||
            lower.includes('key') && (lower.includes('api') || lower.includes('auth')) ||
            lower.includes('authorization')
        );
    }

    /**
     * Check if a string is a SAS URL
     */
    isSASUrl(str) {
        return typeof str === 'string' &&
               str.includes('blob.core.windows.net') &&
               (str.includes('?sv=') || str.includes('?sig='));
    }

    /**
     * Sanitize HTTP headers
     * Implements header sanitization from DXP-124-1
     */
    sanitizeHeaders(headers) {
        if (!headers || typeof headers !== 'object') {
            return {};
        }

        const safe = { ...headers };

        // Delete known sensitive headers
        delete safe['Authorization'];
        delete safe['authorization'];
        delete safe['X-Api-Key'];
        delete safe['x-api-key'];
        delete safe['X-Auth-Token'];
        delete safe['x-auth-token'];

        // Check for auth-related keys case-insensitively
        Object.keys(safe).forEach(key => {
            const lowerKey = key.toLowerCase();
            if (lowerKey.includes('auth') ||
                lowerKey.includes('token') ||
                lowerKey.includes('key') ||
                lowerKey.includes('secret') ||
                lowerKey.includes('password')) {
                safe[key] = '[REDACTED]';
            }
        });

        return safe;
    }

    /**
     * Write audit entry to JSON Lines file
     * Format: ./audit-logs/audit-YYYY-MM-DD.jsonl
     */
    async writeEntry(entry) {
        try {
            // Create audit directory if it doesn't exist
            await fs.mkdir(this.auditDir, { recursive: true });

            // Generate filename with current date
            const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const filename = path.join(this.auditDir, `audit-${date}.jsonl`);

            // Append entry as single JSON line
            const line = JSON.stringify(entry) + '\n';
            await fs.appendFile(filename, line, 'utf8');
        } catch (error) {
            // Don't fail tool operations if audit logging fails
            console.error(`[AuditLogger] Failed to write audit entry: ${error.message}`);
        }
    }

    /**
     * Helper: Wrap tool execution with automatic audit logging
     * Measures duration and logs success/failure automatically
     *
     * @param {string} operation - Tool name
     * @param {string} operation_type - Tool category
     * @param {Object} params - Tool parameters
     * @param {Function} asyncOperation - Async function to execute
     * @param {Object} context - User/environment context
     */
    async wrapTool(operation, operation_type, params, asyncOperation, context = {}) {
        const startTime = Date.now();
        const correlationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        try {
            const result = await asyncOperation();
            const duration = Date.now() - startTime;

            await this.logOperation({
                operation,
                operation_type,
                status: 'success',
                user: context.user || { id: 'system' },
                environment: context.environment || {},
                request: {
                    tool: operation,
                    parameters: params,
                    correlation_id: correlationId
                },
                response: {
                    result: 'success',
                    duration_ms: duration
                },
                tags: context.tags || [],
                metadata: context.metadata || {}
            });

            return result;
        } catch (error) {
            const duration = Date.now() - startTime;

            await this.logOperation({
                operation,
                operation_type,
                status: 'failure',
                user: context.user || { id: 'system' },
                environment: context.environment || {},
                request: {
                    tool: operation,
                    parameters: params,
                    correlation_id: correlationId
                },
                response: {
                    result: 'failure',
                    duration_ms: duration,
                    error: error.message
                },
                tags: context.tags || [],
                metadata: {
                    ...context.metadata,
                    error_stack: error.stack
                }
            });

            throw error; // Re-throw to maintain original behavior
        }
    }

    /**
     * Query audit logs with filters
     *
     * @param {Object} options - Query options
     * @param {string} options.startTime - Start time (ISO 8601 timestamp)
     * @param {string} options.endTime - End time (ISO 8601 timestamp)
     * @param {string} options.toolName - Filter by tool name
     * @param {string} options.status - Filter by status ('success' or 'error')
     * @param {number} options.limit - Max entries to return (default: 100)
     * @param {number} options.offset - Offset for pagination (default: 0)
     * @returns {Promise<{total: number, entries: Array, hasMore: boolean}>}
     */
    async query(options = {}) {
        const {
            startTime,
            endTime,
            toolName,
            status,
            limit = 100,
            offset = 0
        } = options;

        const entries = [];

        try {
            // Ensure audit directory exists
            await fs.mkdir(this.auditDir, { recursive: true });

            // Read all JSONL files in audit directory
            const files = await fs.readdir(this.auditDir);
            const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort();

            for (const file of jsonlFiles) {
                const filePath = path.join(this.auditDir, file);
                const content = await fs.readFile(filePath, 'utf8');

                for (const line of content.trim().split('\n')) {
                    if (!line) continue;

                    try {
                        const entry = JSON.parse(line);

                        // Apply filters
                        if (startTime && entry.timestamp < startTime) continue;
                        if (endTime && entry.timestamp > endTime) continue;
                        if (toolName && entry.operation !== toolName) continue;
                        if (status && entry.status !== status) continue;

                        entries.push(entry);
                    } catch (err) {
                        // Skip malformed lines
                        console.error(`[AuditLogger] Malformed audit log line in ${file}:`, err.message);
                    }
                }
            }
        } catch (error) {
            // If directory doesn't exist or other error, return empty results
            console.error(`[AuditLogger] Query error: ${error.message}`);
            return {
                total: 0,
                entries: [],
                hasMore: false
            };
        }

        // Sort by timestamp (newest first)
        entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        // Apply pagination
        const paginated = entries.slice(offset, offset + limit);

        return {
            total: entries.length,
            entries: paginated,
            hasMore: entries.length > offset + limit
        };
    }

    /**
     * Disable audit logging (for testing or opt-out)
     */
    disable() {
        this.enabled = false;
    }

    /**
     * Enable audit logging
     */
    enable() {
        this.enabled = true;
    }
}

module.exports = { AuditLogger };

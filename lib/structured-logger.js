/**
 * Structured JSON Logger for machine-parseable logs
 *
 * Provides structured logging with JSON output for observability tools
 * (CloudWatch, Datadog, Splunk, etc.)
 */

class StructuredLogger {
  /**
   * Create a structured logger instance
   * @param {Object} options - Logger configuration
   * @param {string} options.level - Minimum log level (debug, info, warn, error)
   * @param {Object} options.context - Default context to include in all log entries
   * @param {string} options.correlationId - Correlation ID for tracking related operations
   */
  constructor(options = {}) {
    this.level = options.level || 'info';
    this.context = options.context || {};
    this.correlationId = options.correlationId || this.generateCorrelationId();
    this.levels = { debug: 0, info: 1, warn: 2, error: 3 };
    this.timers = new Map(); // Track active timers
  }

  /**
   * Generate a unique correlation ID for tracking related operations
   * Format: timestamp-random (e.g., "1699564800000-abc123xyz")
   * @returns {string} Unique correlation ID
   */
  generateCorrelationId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Core logging method - outputs single-line JSON
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata to include
   */
  log(level, message, metadata = {}) {
    // Check if this level should be logged
    if (this.levels[level] < this.levels[this.level]) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlation_id: this.correlationId,
      ...this.context,
      ...metadata
    };

    console.log(JSON.stringify(entry));
  }

  /**
   * Create a child logger that shares the same correlation ID
   * Useful for tracking related operations across different contexts
   * @param {Object} context - Additional context for the child logger
   * @returns {StructuredLogger} New logger instance with shared correlation ID
   */
  createChild(context = {}) {
    return new StructuredLogger({
      level: this.level,
      context: { ...this.context, ...context },
      correlationId: this.correlationId
    });
  }

  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  debug(message, metadata) {
    this.log('debug', message, metadata);
  }

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  info(message, metadata) {
    this.log('info', message, metadata);
  }

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  warn(message, metadata) {
    this.log('warn', message, metadata);
  }

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  error(message, metadata) {
    this.log('error', message, metadata);
  }

  /**
   * Sanitize HTTP headers by removing sensitive authentication data
   * @param {Object} headers - HTTP headers object
   * @returns {Object} Sanitized headers with secrets removed/redacted
   */
  sanitizeHeaders(headers) {
    if (!headers || typeof headers !== 'object') {
      return {};
    }

    const safe = { ...headers };

    // Delete known sensitive headers
    delete safe['Authorization'];
    delete safe['X-Api-Key'];
    delete safe['X-Auth-Token'];

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
   * Log an API request with sanitized headers
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} url - Request URL
   * @param {Object} options - Request options
   * @param {Object} options.headers - Request headers
   * @param {string|Object} options.body - Request body
   */
  logAPIRequest(method, url, options = {}) {
    this.debug('API request', {
      method,
      url,
      headers: this.sanitizeHeaders(options.headers || {}),
      bodyLength: options.body ?
        (typeof options.body === 'string' ? options.body.length : JSON.stringify(options.body).length) :
        0
    });
  }

  /**
   * Log an API response with status and timing
   * @param {string} url - Request URL
   * @param {number} status - HTTP status code
   * @param {number} duration - Request duration in milliseconds
   */
  logAPIResponse(url, status, duration) {
    const level = status >= 400 ? 'error' : 'info';
    this.log(level, 'API response', {
      url,
      status,
      duration_ms: duration
    });
  }

  /**
   * Start a named timer for performance tracking
   * @param {string} name - Timer name
   * @returns {string} Timer name (for method chaining)
   */
  startTimer(name) {
    this.timers.set(name, Date.now());
    this.debug('Timer started', { timer: name });
    return name;
  }

  /**
   * End a named timer and log the duration
   * @param {string} name - Timer name
   * @param {Object} metadata - Additional metadata to include in log
   * @returns {number|null} Duration in milliseconds, or null if timer not found
   */
  endTimer(name, metadata = {}) {
    const startTime = this.timers.get(name);
    if (!startTime) {
      this.warn('Timer not found', { timer: name });
      return null;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(name);

    this.info('Timer completed', {
      timer: name,
      duration_ms: duration,
      ...metadata
    });

    return duration;
  }

  /**
   * Wrap an async operation with automatic timing
   * @param {string} name - Timer name
   * @param {Function} operation - Async function to execute
   * @returns {Promise<any>} Result of the operation
   */
  async timed(name, operation) {
    this.startTimer(name);
    try {
      const result = await operation();
      this.endTimer(name, { status: 'success' });
      return result;
    } catch (error) {
      this.endTimer(name, { status: 'error', error: error.message });
      throw error;
    }
  }
}

module.exports = { StructuredLogger };

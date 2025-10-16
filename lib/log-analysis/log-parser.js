/**
 * Log Parser Module
 * Parses Azure Application Insights logs (HTTP and Console)
 * Ported from log-analyzer-mcp for DXP-110
 */

/**
 * Parse a single log entry from Azure logs
 * @param {string} logLine - JSON log line
 * @returns {Object|null} Parsed log entry or null if invalid
 */
function parseLogEntry(logLine) {
    if (!logLine || typeof logLine !== 'string') {
        return null;
    }

    // Skip empty lines and comments
    if (logLine.trim() === '' || logLine.trim().startsWith('#')) {
        return null;
    }

    try {
        const log = JSON.parse(logLine);

        // Detect log format
        if (log.category === 'AppServiceConsoleLogs') {
            return parseAzureConsoleLog(log);
        }

        if (log.category === 'AppServiceHTTPLogs' || log.category === 'AppServiceHttpLogs') {
            return parseAzureHttpLog(log);
        }

        // Fallback to generic parsing
        return parseGenericLog(log);
    } catch (error) {
        // Not JSON, skip
        return null;
    }
}

/**
 * Parse Azure Console Log
 */
function parseAzureConsoleLog(log) {
    const message = log.resultDescription || log.message || '';

    // Try to extract HTTP-like data from the message if present
    const methodMatch = message.match(/(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/i);
    const statusMatch = message.match(/\b([2-5]\d{2})\b/);
    const pathMatch = message.match(/\/[^\s"']*/);
    const errorCodeMatch = message.match(/\b(4\d{2}|5\d{2})\b/);

    return {
        timestamp: new Date(log.time),
        type: 'console',
        method: methodMatch ? methodMatch[1].toUpperCase() : 'LOG',
        path: pathMatch ? pathMatch[0] : '/console',
        statusCode: errorCodeMatch ? parseInt(errorCodeMatch[1]) : (statusMatch ? parseInt(statusMatch[1]) : 200),
        userAgent: '',
        ip: log.EventIpAddress || '',
        message: message.substring(0, 500), // Truncate long messages
        resourceId: log.resourceId,
        host: log.Host
    };
}

/**
 * Parse Azure HTTP Log
 */
function parseAzureHttpLog(log) {
    // Check if properties field contains IIS log data (embedded JSON format)
    if (log.properties && typeof log.properties === 'string') {
        try {
            const props = JSON.parse(log.properties);
            return {
                timestamp: new Date(log.time || log.EventTime),
                type: 'http',
                method: props.CsMethod || 'GET',
                path: props.CsUriStem || '/',
                statusCode: parseInt(props.ScStatus || '200'),
                userAgent: props.UserAgent || '',
                ip: props.CIp || log.EventIpAddress || '',
                responseTime: parseInt(props.TimeTaken || '0') || undefined,
                size: parseInt(props.ScBytes || '0') || undefined,
                referrer: props.Referer || undefined,
                resourceId: log.resourceId,
                host: props.CsHost || log.Host
            };
        } catch {
            // If properties parsing fails, fall through to regular parsing
        }
    }

    // Azure HTTP logs - try multiple field patterns
    return {
        timestamp: new Date(log.time || log.timestamp),
        type: 'http',
        method: log.method || log.cs_method || log.httpMethod || 'GET',
        path: log.uri || log.cs_uri_stem || log.path || '/',
        statusCode: parseInt(log.sc_status || log.statusCode || log.status || '200'),
        userAgent: log.cs_User_Agent || log.userAgent || log.cs_user_agent || '',
        ip: log.c_ip || log.clientIp || log.EventIpAddress || '',
        responseTime: parseInt(log.time_taken || log.timeTaken || log.duration || '0') || undefined,
        size: parseInt(log.sc_bytes || log.bytes || log.responseSize || '0') || undefined,
        referrer: log.cs_Referer || log.referer || log.referrer || undefined,
        resourceId: log.resourceId,
        host: log.host || log.Host
    };
}

/**
 * Parse generic log (fallback)
 */
function parseGenericLog(log) {
    const methodMatch = JSON.stringify(log).match(/(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/i);
    const statusMatch = JSON.stringify(log).match(/\b([2-5]\d{2})\b/);
    const pathMatch = JSON.stringify(log).match(/\/[^\s"']*/);

    return {
        timestamp: log.timestamp ? new Date(log.timestamp) : (log.time ? new Date(log.time) : new Date()),
        type: 'unknown',
        method: methodMatch ? methodMatch[1].toUpperCase() : 'GET',
        path: pathMatch ? pathMatch[0] : '/',
        statusCode: statusMatch ? parseInt(statusMatch[1]) : 200,
        userAgent: '',
        ip: '0.0.0.0'
    };
}

/**
 * Parse multiple log lines
 * @param {string[]} logLines - Array of JSON log lines
 * @returns {Object[]} Array of parsed log entries
 */
function parseMultipleFormats(logLines) {
    const parsed = [];

    for (const line of logLines) {
        const entry = parseLogEntry(line);
        if (entry) {
            parsed.push(entry);
        }
    }

    return parsed;
}

module.exports = {
    parseLogEntry,
    parseMultipleFormats
};

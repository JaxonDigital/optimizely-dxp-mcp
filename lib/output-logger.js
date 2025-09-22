/**
 * Output Logger Module
 * Wrapper for console.error to avoid JSON parsing issues in MCP servers
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

class OutputLogger {
    /**
     * Log output message (uses console.error to avoid MCP JSON parsing issues)
     * @param {string} message - Message to log
     */
    static log(message) {
        console.error(message);
    }

    /**
     * Log info with emoji
     * @param {string} message - Message to log
     */
    static info(message) {
        console.error(`ℹ️ ${message}`);
    }

    /**
     * Log success with emoji
     * @param {string} message - Message to log
     */
    static success(message) {
        console.error(`✅ ${message}`);
    }

    /**
     * Log warning with emoji
     * @param {string} message - Message to log
     */
    static warn(message) {
        console.error(`⚠️ ${message}`);
    }

    /**
     * Log error with emoji
     * @param {string} message - Message to log
     */
    static error(message) {
        console.error(`❌ ${message}`);
    }

    /**
     * Log progress with emoji
     * @param {string} message - Message to log
     */
    static progress(message) {
        console.error(`🔄 ${message}`);
    }

    /**
     * Log deployment with emoji
     * @param {string} message - Message to log
     */
    static deploy(message) {
        console.error(`🚀 ${message}`);
    }

    /**
     * Log debug information (only when DEBUG environment variable is set)
     * @param {string} message - Message to log
     * @param {*} data - Optional data to log
     */
    static debug(message, data = null) {
        if (process.env.DEBUG) {
            if (data !== null) {
                // Handle objects/arrays by stringifying them
                if (typeof data === 'object') {
                    console.error(`🔍 [DEBUG] ${message}`, JSON.stringify(data, null, 2));
                } else {
                    console.error(`🔍 [DEBUG] ${message}`, data);
                }
            } else {
                console.error(`🔍 [DEBUG] ${message}`);
            }
        }
    }
}

module.exports = OutputLogger;
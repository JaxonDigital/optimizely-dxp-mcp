/**
 * Output Logger Module
 * Wrapper for console.error to avoid JSON parsing issues in MCP servers
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

/**
 * Output Logger Implementation
 * Uses console.error to avoid JSON parsing issues in MCP servers
 * All output goes to stderr to prevent interference with JSON-RPC protocol
 */
class OutputLogger {
    /**
     * Log output message (uses console.error to avoid MCP JSON parsing issues)
     * @param message - Message to log
     */
    static log(message: string): void {
        console.error(message);
    }

    /**
     * Log info with ℹ️ emoji
     * @param message - Info message to log
     */
    static info(message: string): void {
        console.error(`ℹ️ ${message}`);
    }

    /**
     * Log success with ✅ emoji
     * @param message - Success message to log
     */
    static success(message: string): void {
        console.error(`✅ ${message}`);
    }

    /**
     * Log warning with ⚠️ emoji
     * @param message - Warning message to log
     * @note Previously named 'warning()' - use 'warn()' instead
     */
    static warn(message: string): void {
        console.error(`⚠️ ${message}`);
    }

    /**
     * Log error with ❌ emoji
     * @param message - Error message to log
     */
    static error(message: string): void {
        console.error(`❌ ${message}`);
    }

    /**
     * Log progress with 🔄 emoji
     * @param message - Progress message to log
     */
    static progress(message: string): void {
        console.error(`🔄 ${message}`);
    }

    /**
     * Log deployment with 🚀 emoji
     * @param message - Deployment message to log
     */
    static deploy(message: string): void {
        console.error(`🚀 ${message}`);
    }

    /**
     * Log debug information (only when DEBUG environment variable is set)
     * @param message - Debug message to log
     * @param data - Optional data to include (objects will be stringified)
     */
    static debug(message: string, data: any = null): void {
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

export default OutputLogger;
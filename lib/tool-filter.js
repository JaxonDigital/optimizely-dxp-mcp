/**
 * Tool Filter Module
 * Handles filtering of MCP tools based on ENABLED_TOOLS environment variable
 * Part of Jaxon Digital Optimizely DXP MCP Server
 *
 * @module lib/tool-filter
 * @since 3.28.0
 */

class ToolFilter {
    constructor() {
        this.enabledTools = this.parseEnabledTools();
        this.debugMode = process.env.DEBUG === 'true' || process.env.TOOL_FILTER_DEBUG === 'true';

        if (this.debugMode && this.enabledTools) {
            console.error('[ToolFilter] Initialized with patterns:', this.enabledTools);
        }
    }

    /**
     * Parse ENABLED_TOOLS environment variable
     * Supports comma-separated list of tool names and patterns
     *
     * @private
     * @returns {Array<string>|null} Array of patterns or null if not configured
     */
    parseEnabledTools() {
        const enabledToolsEnv = process.env.ENABLED_TOOLS || process.env.OPTIMIZELY_MCP_ENABLED_TOOLS;

        if (!enabledToolsEnv || enabledToolsEnv.trim() === '') {
            return null; // All tools enabled by default
        }

        // Special case: "*" means all tools
        if (enabledToolsEnv.trim() === '*') {
            return null;
        }

        // Parse comma-separated list, trim whitespace
        return enabledToolsEnv
            .split(',')
            .map(tool => tool.trim())
            .filter(tool => tool.length > 0);
    }

    /**
     * Check if a tool should be enabled based on patterns
     *
     * @param {string} toolName - Name of the tool to check
     * @returns {boolean} True if tool should be enabled
     */
    isToolEnabled(toolName) {
        // If no filter configured, all tools are enabled
        if (!this.enabledTools) {
            return true;
        }

        // Check each pattern
        for (const pattern of this.enabledTools) {
            if (this.matchesPattern(toolName, pattern)) {
                if (this.debugMode) {
                    console.error(`[ToolFilter] Tool "${toolName}" matched pattern "${pattern}"`);
                }
                return true;
            }
        }

        if (this.debugMode) {
            console.error(`[ToolFilter] Tool "${toolName}" did not match any pattern`);
        }
        return false;
    }

    /**
     * Check if a tool name matches a pattern
     * Supports wildcards: * for any characters, ? for single character
     *
     * @private
     * @param {string} toolName - Tool name to check
     * @param {string} pattern - Pattern to match against
     * @returns {boolean} True if matches
     */
    matchesPattern(toolName, pattern) {
        // Exact match
        if (pattern === toolName) {
            return true;
        }

        // Check if pattern contains wildcards
        if (!pattern.includes('*') && !pattern.includes('?')) {
            // No wildcards, do case-insensitive exact match
            return pattern.toLowerCase() === toolName.toLowerCase();
        }

        // Convert pattern to regex
        // Build regex pattern character by character
        let regexPattern = '';
        for (let i = 0; i < pattern.length; i++) {
            const char = pattern[i];
            if (char === '*') {
                regexPattern += '.*';  // Match any characters
            } else if (char === '?') {
                regexPattern += '.';   // Match single character
            } else {
                // Escape special regex characters
                regexPattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            }
        }

        // Add anchors to match full string
        regexPattern = '^' + regexPattern + '$';

        try {
            const regex = new RegExp(regexPattern, 'i'); // Case insensitive
            return regex.test(toolName);
        } catch (error) {
            console.error(`[ToolFilter] Invalid pattern "${pattern}":`, error.message);
            return false;
        }
    }

    /**
     * Filter an array of tool definitions based on enabled patterns
     *
     * @param {Array} tools - Array of tool objects with 'name' property
     * @returns {Array} Filtered array of tools
     */
    filterTools(tools) {
        // If no filter configured, return all tools
        if (!this.enabledTools) {
            return tools;
        }

        const filtered = tools.filter(tool => this.isToolEnabled(tool.name));

        if (this.debugMode) {
            const enabledCount = filtered.length;
            const totalCount = tools.length;
            console.error(`[ToolFilter] Enabled ${enabledCount} of ${totalCount} tools`);

            if (enabledCount === 0) {
                console.error('[ToolFilter] WARNING: No tools enabled! Check ENABLED_TOOLS configuration.');
            }
        }

        return filtered;
    }

    /**
     * Get summary of filter configuration
     *
     * @returns {Object} Filter configuration summary
     */
    getFilterSummary() {
        if (!this.enabledTools) {
            return {
                enabled: false,
                patterns: [],
                mode: 'all'
            };
        }

        return {
            enabled: true,
            patterns: this.enabledTools,
            mode: 'filtered'
        };
    }

    /**
     * Get list of tools that would be enabled for given tool list
     *
     * @param {Array<string>} allToolNames - List of all available tool names
     * @returns {Object} Object with enabled and disabled tool lists
     */
    getEnabledDisabledLists(allToolNames) {
        const enabled = [];
        const disabled = [];

        for (const toolName of allToolNames) {
            if (this.isToolEnabled(toolName)) {
                enabled.push(toolName);
            } else {
                disabled.push(toolName);
            }
        }

        return { enabled, disabled };
    }
}

// Export singleton instance
module.exports = new ToolFilter();
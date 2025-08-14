/**
 * Response Builder Module
 * Standardized response formatting for MCP tools
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

class ResponseBuilder {
    /**
     * Create a successful response
     * @param {string} content - The response content
     * @returns {Object} Response object
     */
    static success(content) {
        return {
            result: {
                content: [{
                    type: 'text',
                    text: content
                }]
            }
        };
    }

    /**
     * Create an error response
     * @param {string} message - Error message
     * @param {*} data - Optional error data
     * @returns {Object} Error response
     */
    static error(message, data = undefined) {
        return {
            error: message,
            data: data
        };
    }

    /**
     * Create an invalid parameters error
     * @param {string} message - Error message
     * @returns {Object} Error response
     */
    static invalidParams(message) {
        return this.error(`Invalid parameters: ${message}`);
    }

    /**
     * Create an internal error response
     * @param {string} message - Error message  
     * @param {string} details - Error details
     * @returns {Object} Error response
     */
    static internalError(message, details) {
        return this.error(`${message}: ${details}`);
    }

    /**
     * Add branding footer to response text
     * @param {string} content - The content to add footer to
     * @returns {string} Content with footer
     */
    static addFooter(content) {
        return content + '\n\nBuilt by Jaxon Digital - Optimizely Gold Partner';
    }

    /**
     * Format tips into a bulleted list
     * @param {Array<string>} tips - Array of tip strings
     * @returns {string} Formatted tips
     */
    static formatTips(tips) {
        if (!tips || tips.length === 0) return '';
        
        let formatted = '💡 **Tips:**\n';
        tips.forEach(tip => {
            formatted += `• ${tip}\n`;
        });
        return formatted;
    }

    /**
     * Format a timestamp
     * @param {string|Date} timestamp - The timestamp to format
     * @returns {string} Formatted timestamp
     */
    static formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString();
    }

    /**
     * Format a duration in minutes
     * @param {number} startTime - Start timestamp
     * @param {number} endTime - End timestamp
     * @returns {string} Formatted duration
     */
    static formatDuration(startTime, endTime) {
        const duration = Math.round((endTime - startTime) / 1000 / 60);
        return `${duration} minutes`;
    }

    /**
     * Format a response with standard structure
     * @param {Object} options - Response options
     * @param {boolean} options.success - Whether the operation was successful
     * @param {string} options.message - Main message
     * @param {string} options.details - Additional details
     * @param {string} options.error - Error message if applicable
     * @returns {Object} Formatted response
     */
    static formatResponse(options) {
        const { success, message, details, error } = options;
        
        let responseText = '';
        
        if (!success) {
            responseText = '❌ ';
        }
        
        if (message) {
            responseText += message;
        }
        
        if (details) {
            responseText += '\n\n' + details;
        }
        
        if (error) {
            responseText += '\n\nError: ' + error;
        }
        
        return this.success(responseText);
    }
}

module.exports = ResponseBuilder;
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
        // Add support contact to all error messages
        const enhancedMessage = message + '\n\n📧 Need help? Contact us at support@jaxondigital.com';
        return {
            error: enhancedMessage,
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
     * @param {boolean} includeSupport - Whether to include support info (for errors)
     * @returns {string} Content with footer
     */
    static addFooter(content, includeSupport = false) {
        let footer = '\n\nBuilt by Jaxon Digital - Optimizely Gold Partner';
        
        if (includeSupport) {
            footer += '\n\n📧 Need help? Contact us at support@jaxondigital.com';
        }
        
        return content + footer;
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
     * Format a timestamp with timezone information
     * @param {string|Date} timestamp - The timestamp to format
     * @returns {string} Formatted timestamp with timezone
     */
    static formatTimestamp(timestamp) {
        if (!timestamp) return 'N/A';
        
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return 'Invalid date';
        
        // Format date and time portions separately
        const dateOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };
        
        const timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short'
        };
        
        const datePart = date.toLocaleDateString('en-US', dateOptions);
        const timePart = date.toLocaleTimeString('en-US', timeOptions);
        
        // Format as: Aug 6, 2025 (12:26 PM CDT)
        return `${datePart} (${timePart})`;
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

    /**
     * Format an error with title, message and error code
     * @param {string} title - Error title
     * @param {string} message - Error message
     * @param {string} errorCode - Optional error code
     * @returns {Object} Error response
     */
    static formatError(title, message, errorCode = null) {
        let errorText = `❌ **${title}**\n\n${message}`;
        
        if (errorCode) {
            errorText += `\n\nError Code: ${errorCode}`;
        }
        
        return this.error(errorText);
    }

    /**
     * Add version update warning to response content
     * @param {string} content - Original response content
     * @param {boolean} force - Force check version (for critical tools)
     * @returns {string} Content with optional update warning
     */
    static async addVersionWarning(content, force = false) {
        try {
            const VersionChecker = require('./version-check');
            const warning = await VersionChecker.getInlineUpdateWarning();
            
            if (warning && (force || Math.random() < 0.2)) { // 20% chance unless forced
                return content + '\n\n' + warning;
            }
            
            return content;
        } catch (error) {
            return content; // Silently fail, don't break the response
        }
    }

    /**
     * Create a success response with optional version warning
     * @param {string} content - The response content
     * @param {boolean} includeVersionCheck - Whether to check for updates
     * @returns {Object} Response object
     */
    static async successWithVersionCheck(content, includeVersionCheck = false) {
        if (includeVersionCheck) {
            content = await this.addVersionWarning(content, true);
        }
        return this.success(content);
    }
}

module.exports = ResponseBuilder;
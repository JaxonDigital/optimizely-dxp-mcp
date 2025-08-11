/**
 * Response Builder Module
 * Standardized JSON-RPC response creation
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

class ResponseBuilder {
    /**
     * Create a successful JSON-RPC response
     * @param {string} requestId - The request ID
     * @param {string} content - The response content
     * @returns {Object} JSON-RPC response object
     */
    static success(requestId, content) {
        return {
            jsonrpc: '2.0',
            id: requestId,
            result: {
                content: [{
                    type: 'text',
                    text: content
                }]
            }
        };
    }

    /**
     * Create an error JSON-RPC response
     * @param {string} requestId - The request ID
     * @param {number} code - Error code
     * @param {string} message - Error message
     * @param {*} data - Optional error data
     * @returns {Object} JSON-RPC error response
     */
    static error(requestId, code, message, data = undefined) {
        const response = {
            jsonrpc: '2.0',
            id: requestId,
            error: {
                code,
                message
            }
        };
        
        if (data !== undefined) {
            response.error.data = data;
        }
        
        return response;
    }

    /**
     * Create an invalid params error response
     * @param {string} requestId - The request ID
     * @param {string} message - Specific error message
     * @returns {Object} JSON-RPC error response
     */
    static invalidParams(requestId, message = 'Invalid parameters') {
        return this.error(requestId, -32602, message);
    }

    /**
     * Create an internal error response
     * @param {string} requestId - The request ID
     * @param {string} message - Error message
     * @param {*} data - Optional error details
     * @returns {Object} JSON-RPC error response
     */
    static internalError(requestId, message = 'Internal server error', data = undefined) {
        return this.error(requestId, -32000, message, data);
    }

    /**
     * Create a method not found error response
     * @param {string} requestId - The request ID
     * @param {string} methodName - The unknown method name
     * @returns {Object} JSON-RPC error response
     */
    static methodNotFound(requestId, methodName) {
        return this.error(requestId, -32601, `Unknown tool: ${methodName}`);
    }

    /**
     * Add common footer to response content
     * @param {string} content - The main content
     * @param {boolean} includeJaxon - Include Jaxon Digital branding
     * @returns {string} Content with footer
     */
    static addFooter(content, includeJaxon = true) {
        let footer = '\n\n🔧 **Powered by:** PowerShell EpiCloud module';
        
        if (includeJaxon) {
            footer += '\n🏢 **Built by:** Jaxon Digital - Optimizely Gold Partner';
        }
        
        return content + footer;
    }

    /**
     * Format deployment status consistently
     * @param {Object} deployment - Deployment data
     * @returns {string} Formatted status message
     */
    static formatDeploymentStatus(deployment) {
        const status = deployment.Status || deployment.status || 'Unknown';
        const percentComplete = deployment.PercentComplete || deployment.percentComplete || 0;
        const deploymentId = deployment.Id || deployment.id;
        const startTime = deployment.StartTime || deployment.startTime;
        const endTime = deployment.EndTime || deployment.endTime;
        
        let statusIcon = '📋';
        let statusText = status.toUpperCase();
        
        switch (status.toLowerCase()) {
            case 'succeeded':
            case 'completed':
                statusIcon = '✅';
                break;
            case 'inprogress':
            case 'in progress':
            case 'running':
                statusIcon = '🔄';
                break;
            case 'failed':
            case 'error':
                statusIcon = '❌';
                break;
            case 'awaitingverification':
            case 'awaiting verification':
                statusIcon = '⏳';
                break;
            case 'completing':
                statusIcon = '🔄';
                break;
            case 'resetting':
                statusIcon = '🔄';
                break;
            case 'reset':
                statusIcon = '🔄';
                break;
            default:
                statusIcon = '❓';
        }
        
        let result = `🚀 **Deployment Status**\n\n`;
        result += `${statusIcon} **${statusText}** - ${deploymentId}\n`;
        
        if (startTime) {
            const start = new Date(startTime);
            result += `**Started:** ${start.toLocaleString()}\n`;
            
            if (endTime) {
                const end = new Date(endTime);
                const duration = Math.round((end - start) / 1000 / 60);
                result += `**Completed:** ${end.toLocaleString()}\n`;
                result += `**Duration:** ${duration} minutes\n`;
            } else {
                const now = new Date();
                const elapsed = Math.round((now - start) / 1000 / 60);
                result += `**Current Progress:** ${percentComplete}%\n`;
                result += `**Duration:** ${elapsed} minutes\n`;
            }
        }
        
        return result;
    }

    /**
     * Format a list of items with consistent styling
     * @param {string} title - Section title
     * @param {Array} items - Items to list
     * @param {string} icon - Icon for each item
     * @returns {string} Formatted list
     */
    static formatList(title, items, icon = '•') {
        let result = `**${title}:**\n`;
        items.forEach(item => {
            result += `${icon} ${item}\n`;
        });
        return result;
    }

    /**
     * Format tips/usage section
     * @param {Array} tips - Array of tip strings
     * @returns {string} Formatted tips section
     */
    static formatTips(tips) {
        let result = '\n💡 **Tips:**\n';
        tips.forEach(tip => {
            result += `- ${tip}\n`;
        });
        return result;
    }
}

module.exports = ResponseBuilder;
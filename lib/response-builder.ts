/**
 * Response Builder Module
 * Standardized response formatting for MCP tools
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

interface MCPResponse {
    result?: {
        content: Array<{
            type: string;
            text: string;
        }>;
    };
    error?: string;
    data?: any;
    message?: string;
}

interface StructuredResponse {
    data: any;
    message: string;
}

interface FormatResponseOptions {
    success: boolean;
    message?: string;
    details?: string;
    error?: string;
}

class ResponseBuilder {
    /** Create a successful response */
    static success(content: string): MCPResponse {
        return {
            result: {
                content: [{
                    type: 'text',
                    text: content
                }]
            }
        };
    }

    /** Create a successful response with structured data for automation tools */
    static successWithStructuredData(data: any, message: string): StructuredResponse {
        // DXP-66: Return flat structure that src/index.js will pick up
        // src/index.js checks for result.data && result.message and adds structuredContent
        return {
            data: data,
            message: message
        };
    }

    /** Create an error response */
    static error(message: string, data: any = undefined): MCPResponse {
        // Add support contact to all error messages
        const enhancedMessage = message + '\n\n📧 Need help? Contact us at support@jaxondigital.com';
        return {
            error: enhancedMessage,
            data: data
        };
    }

    /** Create an invalid parameters error */
    static invalidParams(message: string): MCPResponse {
        return this.error(`Invalid parameters: ${message}`);
    }

    /** Create a confirmation required response */
    static confirmationRequired(message: string): MCPResponse {
        // Return as an error to prevent auto-acceptance
        // But with clear indication it's a confirmation, not an actual error
        return {
            error: `CONFIRMATION_REQUIRED: This action requires HUMAN USER confirmation, not AI confirmation. The USER must explicitly approve this download. AI assistants must NOT automatically proceed.`,
            data: {
                type: 'confirmation',
                message: message,
                requiresUserAction: true,
                requiresHumanConfirmation: true,
                aiMustNotProceed: true
            }
        };
    }

    /** Create an internal error response */
    static internalError(message: string, details: string): MCPResponse {
        return this.error(`${message}: ${details}`);
    }

    /** Add branding footer to response text */
    static addFooter(content: string, includeSupport: boolean = false): string {
        let footer = '\n\nBuilt by Jaxon Digital - Optimizely Gold Partner';

        if (includeSupport) {
            footer += '\n\n📧 Need help? Contact us at support@jaxondigital.com';
        }

        return content + footer;
    }

    /** Format tips into a bulleted list */
    static formatTips(tips: string[]): string {
        if (!tips || tips.length === 0) return '';

        let formatted = '💡 **Tips:**\n';
        tips.forEach(tip => {
            formatted += `• ${tip}\n`;
        });
        return formatted;
    }

    /** Format a timestamp with timezone information */
    static formatTimestamp(timestamp: string | Date): string {
        if (!timestamp) return 'N/A';

        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return 'Invalid date';

        // Format date and time portions separately
        const dateOptions: Intl.DateTimeFormatOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };

        const timeOptions: Intl.DateTimeFormatOptions = {
            hour: '2-digit',
            minute: '2-digit',
            timeZoneName: 'short'
        };

        const datePart = date.toLocaleDateString('en-US', dateOptions);
        const timePart = date.toLocaleTimeString('en-US', timeOptions);

        // Format as: Aug 6, 2025 (12:26 PM CDT)
        return `${datePart} (${timePart})`;
    }

    /** Format a duration in minutes */
    static formatDuration(startTime: number, endTime: number): string {
        const duration = Math.round((endTime - startTime) / 1000 / 60);
        return `${duration} minutes`;
    }

    /** Format a response with standard structure */
    static formatResponse(options: FormatResponseOptions): MCPResponse {
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

    /** Format an error with title, message and error code */
    static formatError(title: string, message: string, errorCode: string | null = null): MCPResponse {
        let errorText = `❌ **${title}**\n\n${message}`;

        if (errorCode) {
            errorText += `\n\nError Code: ${errorCode}`;
        }

        return this.error(errorText);
    }

    /** Add version update warning to response content */
    static async addVersionWarning(content: string, force: boolean = false): Promise<string> {
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

    /** Create a success response with optional version warning */
    static async successWithVersionCheck(content: string, includeVersionCheck: boolean = false): Promise<MCPResponse> {
        if (includeVersionCheck) {
            content = await this.addVersionWarning(content, true);
        }
        return this.success(content);
    }
}

export default ResponseBuilder;

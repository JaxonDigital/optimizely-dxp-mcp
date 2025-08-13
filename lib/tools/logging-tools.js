/**
 * Logging Tools Module
 * Handles edge/CDN log retrieval operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');
const PowerShellCommandBuilder = require('../powershell-command-builder');

class LoggingTools {
    /**
     * Get edge log location
     */
    static async handleGetEdgeLogs(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.getEdgeLogs(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Get edge logs error:', error);
            return ResponseBuilder.internalError('Failed to get edge logs', error.message);
        }
    }

    static async getEdgeLogs(args) {
        const { apiKey, apiSecret, projectId, environment, startDate, endDate } = args;
        
        console.error(`Getting edge log location for project ${projectId}`);

        // Build command using the new builder
        // Note: Get-EpiEdgeLogLocation doesn't have Environment parameter
        // It returns logs for the entire project
        const command = PowerShellCommandBuilder.create('Get-EpiEdgeLogLocation')
            .addParam('ClientKey', apiKey)
            .addParam('ClientSecret', apiSecret)
            .addParam('ProjectId', projectId)
            .build();
        // StartDate and EndDate are also not supported by this command
        
        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            // Check for specific edge log errors first
            if (result.stderr.includes('push feature is not enabled') || 
                result.stderr.includes('Cloudflare log push') ||
                result.stderr.includes('push is not enabled')) {
                return this.formatLogsNotEnabled(environment);
            }
            
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Get Edge Logs',
                projectId,
                environment
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            return this.formatEdgeLogLocation(result.parsedData, environment);
        }

        // Check for log not enabled in stdout
        if (result.stdout && result.stdout.includes('not enabled')) {
            return this.formatLogsNotEnabled(environment);
        }

        return ResponseBuilder.addFooter('Edge log query completed');
    }

    static formatEdgeLogLocation(data, environment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.CLIPBOARD} **Edge/CDN Logs**\n\n`;
        
        if (data.logLocation || data.location) {
            response += `${STATUS_ICONS.SUCCESS} **Log Location Found**\n`;
            response += `**URL:** \`${data.logLocation || data.location}\`\n`;
            
            if (data.startDate) {
                response += `**Start Date:** ${data.startDate}\n`;
            }
            if (data.endDate) {
                response += `**End Date:** ${data.endDate}\n`;
            }
            if (data.size) {
                response += `**Size:** ${data.size}\n`;
            }
            
            response += '\n**Log Contents Include:**\n';
            response += '- CDN request/response details\n';
            response += '- Cache hit/miss information\n';
            response += '- Performance metrics\n';
            response += '- Error codes and status\n';
        } else {
            response += 'No log location available.\n';
        }
        
        const tips = [
            'Edge logs contain CDN and Cloudflare data',
            'Logs are typically available within 15 minutes',
            'Use date filters to narrow down log retrieval'
        ];
        
        response += '\n' + ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response);
    }

    static formatLogsNotEnabled(environment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.WARNING} **Edge Logs Not Enabled (Beta Feature)**\n\n`;
        response += `Edge/CDN log push is not enabled for **${environment}**.\n\n`;
        response += '**⚠️ Beta Feature Notice:**\n';
        response += 'Edge logs functionality is currently in BETA and must be explicitly enabled.\n\n';
        response += '**To enable edge logs:**\n';
        response += '1. Contact Optimizely support\n';
        response += '2. Request Cloudflare log push activation (mention it\'s a beta feature)\n';
        response += '3. Specify target environment(s)\n';
        response += '4. Configure log retention settings\n\n';
        response += '**Note:** This is a beta configuration at the DXP project level.\n';
        response += 'Not all projects may be eligible during the beta period.\n';
        
        return ResponseBuilder.addFooter(response);
    }
}

module.exports = LoggingTools;
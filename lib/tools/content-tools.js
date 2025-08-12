/**
 * Content Tools Module
 * Handles content synchronization operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');

class ContentTools {
    /**
     * Copy content between environments handler
     */
    static async handleCopyContent(requestId, args) {
        // Validate parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId || 
            !args.sourceEnvironment || !args.targetEnvironment) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters for content copy');
        }

        // Validate that source and target are different
        if (args.sourceEnvironment === args.targetEnvironment) {
            return ResponseBuilder.invalidParams(requestId, 'Source and target environments must be different');
        }

        try {
            const result = await this.copyContent(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Content copy error:', error);
            return ResponseBuilder.internalError(requestId, 'Content copy failed', error.message);
        }
    }

    /**
     * Copy content implementation
     */
    static async copyContent(args) {
        const { apiKey, apiSecret, projectId, sourceEnvironment, targetEnvironment } = args;
        
        console.error(`Starting content copy from ${sourceEnvironment} to ${targetEnvironment}`);

        // Build PowerShell command for content sync
        // Using Start-EpiDeployment with -IncludeBlob and -IncludeDb flags for content-only deployment
        // Note: Not specifying -SourceApp means only content will be copied, not code
        const command = `Start-EpiDeployment -ProjectId '${projectId}' -SourceEnvironment '${sourceEnvironment}' -TargetEnvironment '${targetEnvironment}' -IncludeBlob -IncludeDb`;
        
        // Execute command
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Content Copy',
                projectId,
                sourceEnvironment,
                targetEnvironment
            });

            if (error) {
                return ErrorHandler.formatError(error, { projectId, sourceEnvironment, targetEnvironment });
            }
        }

        // Parse and format successful response
        if (result.parsedData) {
            return this.formatContentCopyResponse(result.parsedData, sourceEnvironment, targetEnvironment);
        }

        // Fallback to raw output
        return ResponseBuilder.addFooter(
            `Content copy initiated from ${sourceEnvironment} to ${targetEnvironment}.\n${result.stdout}`,
            true
        );
    }

    /**
     * Format content copy response
     */
    static formatContentCopyResponse(data, sourceEnvironment, targetEnvironment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.SUCCESS} **Content Copy Started**\n\n`;
        
        if (data.id) {
            response += `**Deployment ID:** \`${data.id}\`\n`;
        }
        
        response += `**Source:** ${sourceEnvironment}\n`;
        response += `**Target:** ${targetEnvironment}\n`;
        response += `**Type:** Content Only\n`;
        
        if (data.status) {
            response += `**Status:** ${data.status}\n`;
        }
        
        const tips = [
            'Use get_deployment_status to monitor progress',
            'Content sync typically takes 10-30 minutes',
            'Only content and media will be copied (no code changes)'
        ];

        response += '\n' + ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response, true);
    }
}

module.exports = ContentTools;
/**
 * Content Tools Module
 * Handles content synchronization operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');
const PowerShellCommandBuilder = require('../powershell-command-builder');

class ContentTools {
    /**
     * Copy content between environments handler
     */
    static async handleCopyContent(args) {
        // Check if this is a self-hosted project
        if (args.isSelfHosted || args.connectionString) {
            return ResponseBuilder.invalidParams('Content copy is not available for self-hosted projects. Self-hosted projects can only download existing backups and blobs.');
        }
        
        // Validate parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId || 
            !args.sourceEnvironment || !args.targetEnvironment) {
            return ResponseBuilder.invalidParams('Missing required parameters for content copy');
        }

        // Validate that source and target are different
        if (args.sourceEnvironment === args.targetEnvironment) {
            return ResponseBuilder.invalidParams('Source and target environments must be different');
        }

        // Check permissions for both environments
        const PermissionChecker = require('./permission-checker');
        const projectConfig = {
            apiKey: args.apiKey,
            apiSecret: args.apiSecret,
            projectId: args.projectId,
            id: args.projectId,
            name: args.projectName || 'Project'
        };
        
        const permissions = await PermissionChecker.getOrCheckPermissionsSafe(projectConfig);
        
        // Check if user has access to both source and target
        const missingAccess = [];
        if (!permissions.accessible.includes(args.sourceEnvironment)) {
            missingAccess.push(args.sourceEnvironment);
        }
        if (!permissions.accessible.includes(args.targetEnvironment)) {
            missingAccess.push(args.targetEnvironment);
        }
        
        if (missingAccess.length > 0) {
            let response = `ℹ️ **Access Level Check**\n\n`;
            response += `Content copy requires access to both source and target environments.\n\n`;
            response += `**Requested:** ${args.sourceEnvironment} → ${args.targetEnvironment}\n`;
            response += `**Your access level:** ${permissions.accessible.join(', ')} environment${permissions.accessible.length > 1 ? 's' : ''}\n`;
            response += `**Additional access needed:** ${missingAccess.join(', ')}\n\n`;
            
            // Suggest alternatives based on what they have access to
            if (permissions.accessible.length >= 2) {
                response += `**Available Content Copy Options:**\n`;
                
                // Show valid copy directions based on their access
                const copyOptions = PermissionChecker.getContentCopyDefaults(permissions);
                if (copyOptions) {
                    response += `• ${copyOptions.description}: \`copy_content sourceEnvironment: "${copyOptions.source}" targetEnvironment: "${copyOptions.target}"\`\n`;
                }
                
                response += `\n💡 **Tip:** Content typically flows from higher to lower environments (Prod→Pre→Int).`;
            } else if (permissions.accessible.length === 1) {
                response += `⚠️ You need access to at least 2 environments to copy content.\n`;
                response += `Your API key only has access to ${permissions.accessible[0]}.`;
            }
            
            return ResponseBuilder.success(response);
        }

        try {
            const result = await this.copyContent(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Content copy error:', error);
            return ResponseBuilder.internalError('Content copy failed', error.message);
        }
    }

    /**
     * Copy content implementation
     */
    static async copyContent(args) {
        const { apiKey, apiSecret, projectId, sourceEnvironment, targetEnvironment } = args;
        
        console.error(`Starting content copy from ${sourceEnvironment} to ${targetEnvironment}`);

        // Build command using the new builder
        // Using Start-EpiDeployment with -IncludeBlob and -IncludeDb flags for content-only deployment
        // Note: Not specifying -SourceApp means only content will be copied, not code
        const command = PowerShellCommandBuilder.create('Start-EpiDeployment')
            .addParam('ProjectId', projectId)
            .addParam('ClientKey', apiKey)
            .addParam('ClientSecret', apiSecret)
            .addParam('SourceEnvironment', sourceEnvironment)
            .addParam('TargetEnvironment', targetEnvironment)
            .addSwitch('IncludeBlob')
            .addSwitch('IncludeDb')
            .build();
        
        // Execute command using direct method
        const result = await PowerShellHelper.executeEpiCommandDirect(
            command,
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
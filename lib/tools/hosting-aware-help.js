/**
 * Hosting-Aware Help Tools
 * Provides help and support information filtered by hosting type
 *
 * Part of DXP-23: Self-hosted Azure users should be gracefully restricted
 * from DXP-only tools with clear messaging
 */

const Config = require('../config');
const ResponseBuilder = require('../response-builder');
const HostingDetector = require('../utils/hosting-detector');
const ToolAvailabilityMatrix = require('../utils/tool-availability-matrix');

class HostingAwareHelp {
    /**
     * Get hosting-aware help
     */
    static async handleGetHelp(args) {
        const { FORMATTING: { STATUS_ICONS } } = Config;

        // Detect current hosting type
        const hostingName = HostingDetector.getHostingTypeName(args);
        const hostingType = HostingDetector.detectHostingType(args);
        const capabilities = HostingDetector.getHostingCapabilities(args);

        // Get tools grouped by category
        const toolsByCategory = ToolAvailabilityMatrix.getToolsByCategory(args);
        const unavailableTools = ToolAvailabilityMatrix.getUnavailableTools(args);

        let response = `${STATUS_ICONS.SUCCESS} **Optimizely DXP MCP - Help**\n\n`;
        response += `**Hosting Type:** ${hostingName}\n`;
        response += `**Capabilities:** ${capabilities.description}\n\n`;

        // Show available tools by category
        response += `**📋 Available Tools**\n\n`;

        for (const [category, tools] of Object.entries(toolsByCategory)) {
            response += `**${category}**\n`;
            for (const tool of tools) {
                response += `• \`${tool.name}\` - ${tool.description}\n`;
            }
            response += '\n';
        }

        // Show restricted tools for self-hosted users
        if (hostingType === HostingDetector.HOSTING_TYPES.SELF_HOSTED && unavailableTools.length > 0) {
            response += `**🔒 DXP-Only Tools (Not Available)**\n\n`;
            response += `The following tools require DXP hosting:\n\n`;

            // Group unavailable tools by category
            const unavailableByCategory = {};
            for (const tool of unavailableTools) {
                if (!unavailableByCategory[tool.category]) {
                    unavailableByCategory[tool.category] = [];
                }
                unavailableByCategory[tool.category].push(tool);
            }

            for (const [category, tools] of Object.entries(unavailableByCategory)) {
                response += `**${category}**\n`;
                for (const tool of tools) {
                    response += `• ~~${tool.name}~~ - ${tool.description}\n`;
                }
                response += '\n';
            }
        }

        // Hosting-specific tips
        response += `**💡 Tips for ${hostingName}**\n\n`;

        if (hostingType === HostingDetector.HOSTING_TYPES.DXP_PAAS) {
            response += `• You have full access to all DXP PaaS management features\n`;
            response += `• Use \`deploy\` for quick deployments\n`;
            response += `• Use \`backup\` to create database backups\n`;
            response += `• Use \`copy_content\` to sync content between environments\n`;
        } else if (hostingType === HostingDetector.HOSTING_TYPES.DXP_SAAS) {
            response += `• DXP SaaS manages infrastructure automatically\n`;
            response += `• Use \`download_blobs\` for media and assets\n`;
            response += `• Use \`download_logs\` for application logs\n`;
            response += `• Use \`copy_content\` to sync content between environments\n`;
        } else if (hostingType === HostingDetector.HOSTING_TYPES.SELF_HOSTED) {
            response += `• You can download blobs and logs from Azure Storage\n`;
            response += `• Use \`download_blobs\` for media and assets\n`;
            response += `• Use \`download_logs\` for application logs\n`;
            response += `• For deployments, use Azure DevOps or your CI/CD pipeline\n`;
            response += `• For database operations, use Azure SQL tools directly\n`;
        } else {
            response += `• Configure your hosting with \`test_connection setupMode:true\`\n`;
            response += `• Test your connection with \`test_connection\`\n`;
        }

        response += `\n**📧 Need Help?**\n`;
        response += `Contact support@jaxondigital.com for assistance\n`;

        return ResponseBuilder.success(response);
    }

    /**
     * Get hosting status
     */
    static async handleGetHostingStatus(args) {
        const { FORMATTING: { STATUS_ICONS } } = Config;

        const hostingName = HostingDetector.getHostingTypeName(args);
        const hostingType = HostingDetector.detectHostingType(args);
        const capabilities = HostingDetector.getHostingCapabilities(args);

        let response = `${STATUS_ICONS.INFO} **Hosting Status**\n\n`;
        response += `**Type:** ${hostingName}\n`;
        response += `**Internal ID:** ${hostingType}\n\n`;

        response += `**Capabilities:**\n`;
        response += `• Deployments: ${capabilities.canDeploy ? '✅' : '❌'}\n`;
        response += `• Database Exports: ${capabilities.canExportDatabase ? '✅' : '❌'}\n`;
        response += `• Content Copy: ${capabilities.canCopyContent ? '✅' : '❌'}\n`;
        response += `• Slot Management: ${capabilities.canManageSlots ? '✅' : '❌'}\n`;
        response += `• Package Uploads: ${capabilities.canUploadPackages ? '✅' : '❌'}\n`;
        response += `• Log Downloads: ${capabilities.canDownloadLogs ? '✅' : '❌'}\n`;
        response += `• Blob Downloads: ${capabilities.canDownloadBlobs ? '✅' : '❌'}\n`;

        // Show project info if available
        try {
            const ProjectTools = require('./project-tools');
            const project = ProjectTools.getCurrentProject(args.projectId);
            if (project) {
                response += `\n**Project:**\n`;
                response += `• Name: ${project.name || 'N/A'}\n`;
                response += `• ID: ${project.projectId || 'N/A'}\n`;
                if (project.connectionString) {
                    response += `• Storage: Azure Storage (Self-Hosted)\n`;
                } else {
                    response += `• API: DXP Management API\n`;
                }
            }
        } catch (e) {
            // No project configured
            response += `\n**Project:** Not configured\n`;
        }

        return ResponseBuilder.success(response);
    }
}

module.exports = HostingAwareHelp;
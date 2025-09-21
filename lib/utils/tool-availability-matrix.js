/**
 * Tool Availability Matrix
 * Defines which tools are available in which hosting types
 *
 * Part of DXP-23: Self-hosted Azure users should be gracefully restricted
 * from DXP-only tools with clear messaging
 */

const HostingDetector = require('./hosting-detector');

class ToolAvailabilityMatrix {
    /**
     * Tool availability configuration
     * Each tool specifies which hosting types it supports
     */
    static TOOL_MATRIX = {
        // AI Guidance - Available to all
        'get_ai_guidance': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Help & Support',
            description: 'Get AI-specific guidance for using this MCP server'
        },

        // Simple Commands - Note: These are handled by SimpleTools and DatabaseSimpleTools
        // but most don't have direct handlers in dist/index.js
        'status': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Simple Commands',
            description: 'Intelligent status overview'
        },
        'quick': {
            hostingTypes: ['dxp-paas'],
            category: 'Simple Commands',
            description: 'Quick deployment operations',
            restrictedMessage: 'Quick deployments are only available for DXP PaaS hosting.'
        },

        // Connection & Setup - Available to all
        'test_connection': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Setup & Connection',
            description: 'Test your connection and verify credentials'
        },
        'health_check': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Setup & Connection',
            description: 'Comprehensive health check of your setup'
        },

        // Project Management - Available to all configured hosting types
        'list_projects': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Project Management',
            description: 'List all configured projects'
        },
        'current_project': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Project Management',
            description: 'Show current project configuration'
        },
        'get_project': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Project Management',
            description: 'Get project information and configuration details'
        },
        'update_project': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Project Management',
            description: 'Update project configuration: rename, credentials, paths, or settings'
        },
        'switch_project': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Project Management',
            description: 'Switch between configured projects'
        },

        // Deployment Tools - DXP PaaS Only (SaaS handles deployments automatically)
        'start_deployment': {
            hostingTypes: ['dxp-paas'],
            category: 'Deployments',
            description: 'Start a new deployment',
            restrictedMessage: 'Starting deployments is only available for DXP PaaS hosting. DXP SaaS handles deployments automatically.'
        },
        'complete_deployment': {
            hostingTypes: ['dxp-paas'],
            category: 'Deployments',
            description: 'Complete an in-progress deployment',
            restrictedMessage: 'Completing deployments is only available for DXP PaaS hosting.'
        },
        'reset_deployment': {
            hostingTypes: ['dxp-paas'],
            category: 'Deployments',
            description: 'Reset a stuck deployment',
            restrictedMessage: 'Resetting deployments is only available for DXP PaaS hosting.'
        },
        'list_deployments': {
            hostingTypes: ['dxp-paas'],
            category: 'Deployments',
            description: 'List recent deployments',
            restrictedMessage: 'Deployment history is only available for DXP PaaS hosting.'
        },
        'get_deployment_status': {
            hostingTypes: ['dxp-paas'],
            category: 'Deployments',
            description: 'Get detailed deployment status',
            restrictedMessage: 'Deployment status is only available for DXP PaaS hosting.'
        },

        // Package Management - DXP PaaS Only
        'upload_deployment_package': {
            hostingTypes: ['dxp-paas'],
            category: 'Package Management',
            description: 'Upload a deployment package',
            restrictedMessage: 'Package uploads are only available for DXP PaaS hosting. DXP SaaS handles deployments automatically. Self-hosted users should deploy through Azure DevOps.'
        },
        'analyze_package': {
            hostingTypes: ['dxp-paas'],
            category: 'Package Management',
            description: 'Analyze package upload strategy',
            restrictedMessage: 'Package analysis is only available for DXP PaaS hosting.'
        },
        'deploy_package_and_start': {
            hostingTypes: ['dxp-paas'],
            category: 'Package Management',
            description: 'Deploy package and start deployment',
            restrictedMessage: 'Package deployment is only available for DXP PaaS hosting.'
        },
        'deploy_package_enhanced': {
            hostingTypes: ['dxp-paas'],
            category: 'Package Management',
            description: 'Enhanced package deployment',
            restrictedMessage: 'Enhanced package deployment is only available for DXP PaaS hosting.'
        },
        'prepare_deployment_package': {
            hostingTypes: ['dxp-paas'],
            category: 'Package Management',
            description: 'Prepare deployment package',
            restrictedMessage: 'Package preparation is only available for DXP PaaS hosting.'
        },
        'generate_sas_upload_url': {
            hostingTypes: ['dxp-paas'],
            category: 'Package Management',
            description: 'Generate SAS URL for package upload',
            restrictedMessage: 'SAS URL generation is only available for DXP PaaS hosting.'
        },
        'split_package': {
            hostingTypes: ['dxp-paas'],
            category: 'Package Management',
            description: 'Split large package for upload',
            restrictedMessage: 'Package splitting is only available for DXP PaaS hosting.'
        },

        // Database Tools - DXP PaaS Only
        'export_database': {
            hostingTypes: ['dxp-paas'],
            category: 'Database',
            description: 'Export database to local file',
            restrictedMessage: 'Database exports are only available for DXP PaaS hosting. DXP SaaS does not allow direct database access. For self-hosted, use Azure SQL tools or contact your database administrator.'
        },
        'check_export_status': {
            hostingTypes: ['dxp-paas'],
            category: 'Database',
            description: 'Check database export status',
            restrictedMessage: 'Database export status is only available for DXP PaaS hosting.'
        },
        'list_exports': {
            hostingTypes: ['dxp-paas'],
            category: 'Database',
            description: 'List database exports',
            restrictedMessage: 'Database export listing is only available for DXP PaaS hosting.'
        },


        // Content Management - DXP PaaS and potentially SaaS
        'copy_content': {
            hostingTypes: ['dxp-paas', 'dxp-saas'],
            category: 'Content Management',
            description: 'Copy content between environments',
            restrictedMessage: 'Content copy is only available for DXP hosting. Self-hosted users should use database restore operations.'
        },

        // Storage & Downloads - Available to all
        'download_blobs': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Storage & Downloads',
            description: 'Download blob storage content'
        },
        'download_logs': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Storage & Downloads',
            description: 'Download application logs'
        },
        'download_media': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Storage & Downloads',
            description: 'Download media files'
        },
        'download_assets': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Storage & Downloads',
            description: 'Download asset files'
        },
        'list_storage_containers': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Storage & Downloads',
            description: 'List available storage containers'
        },
        'discover_logs': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Storage & Downloads',
            description: 'Discover available log containers'
        },
        'check_download_capabilities': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Storage & Downloads',
            description: 'Check download capabilities'
        },
        'get_download_status': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Storage & Downloads',
            description: 'Get download status'
        },

        // Download Management - Available to all
        'list_active_downloads': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Download Management',
            description: 'List active downloads'
        },
        'cancel_download': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Download Management',
            description: 'Cancel a specific download'
        },
        'cancel_all_downloads': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Download Management',
            description: 'Cancel all active downloads'
        },
        'download_history': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Download Management',
            description: 'View download history'
        },

        // Storage Management - DXP PaaS Only (SAS generation)
        'generate_storage_sas_link': {
            hostingTypes: ['dxp-paas'],
            category: 'Storage Management',
            description: 'Generate SAS link for storage container',
            restrictedMessage: 'SAS link generation through DXP API is only available for DXP PaaS hosting. Self-hosted users can generate SAS tokens directly through Azure Portal or Azure CLI.'
        },

        // Download Configuration
        'show_download_config': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Storage & Downloads',
            description: 'Show download configuration'
        },

        // Monitoring & Telemetry - Available to all
        'list_monitors': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Monitoring',
            description: 'List active monitors'
        },
        'update_monitoring_interval': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Monitoring',
            description: 'Update monitoring interval'
        },
        'stop_monitoring': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Monitoring',
            description: 'Stop monitoring'
        },
        'get_monitoring_stats': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Monitoring',
            description: 'Get monitoring statistics'
        },
        'disable_telemetry': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Monitoring',
            description: 'Disable telemetry'
        },
        'enable_telemetry': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Monitoring',
            description: 'Enable telemetry'
        },
        'get_rate_limit_status': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Monitoring',
            description: 'Get rate limit status'
        },
        'get_cache_status': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Monitoring',
            description: 'Get cache status'
        },

        // Support Tools - Available to all
        'get_version': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Support',
            description: 'Get MCP server version information'
        },
        'get_support': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Support',
            description: 'Get support contact information'
        },
        'verify_access': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted', 'unknown'],
            category: 'Support',
            description: 'Verify access and permissions'
        },

        // Debug Tools - Available to all for troubleshooting
        'debug_containers': {
            hostingTypes: ['dxp-paas', 'dxp-saas', 'self-hosted'],
            category: 'Debug',
            description: 'Debug storage container access'
        },

        // Azure DevOps Integration - DXP PaaS Only
        'deploy_azure_artifact': {
            hostingTypes: ['dxp-paas'],
            category: 'CI/CD Integration',
            description: 'Deploy from Azure DevOps artifacts',
            restrictedMessage: 'Azure artifact deployment is only available for DXP PaaS hosting.'
        }
    };

    /**
     * Check if a tool is available in the current hosting type
     */
    static isToolAvailable(toolName, args = {}) {
        const tool = this.TOOL_MATRIX[toolName];
        if (!tool) {
            return false; // Unknown tool
        }

        const currentHosting = HostingDetector.detectHostingType(args);
        return tool.hostingTypes.includes(currentHosting);
    }

    /**
     * Get available tools for the current hosting type
     */
    static getAvailableTools(args = {}) {
        const currentHosting = HostingDetector.detectHostingType(args);
        const availableTools = [];

        for (const [toolName, toolConfig] of Object.entries(this.TOOL_MATRIX)) {
            if (toolConfig.hostingTypes.includes(currentHosting)) {
                availableTools.push({
                    name: toolName,
                    category: toolConfig.category,
                    description: toolConfig.description
                });
            }
        }

        return availableTools;
    }

    /**
     * Get unavailable tools for the current hosting type with restriction messages
     */
    static getUnavailableTools(args = {}) {
        const currentHosting = HostingDetector.detectHostingType(args);
        const unavailableTools = [];

        for (const [toolName, toolConfig] of Object.entries(this.TOOL_MATRIX)) {
            if (!toolConfig.hostingTypes.includes(currentHosting)) {
                unavailableTools.push({
                    name: toolName,
                    category: toolConfig.category,
                    description: toolConfig.description,
                    restrictedMessage: toolConfig.restrictedMessage ||
                        `This tool is not available in ${HostingDetector.getHostingTypeName(args)}.`
                });
            }
        }

        return unavailableTools;
    }

    /**
     * Get tools grouped by category for the current hosting type
     */
    static getToolsByCategory(args = {}) {
        const availableTools = this.getAvailableTools(args);
        const grouped = {};

        for (const tool of availableTools) {
            if (!grouped[tool.category]) {
                grouped[tool.category] = [];
            }
            grouped[tool.category].push(tool);
        }

        return grouped;
    }

    /**
     * Get restriction message for a tool
     */
    static getRestrictionMessage(toolName, args = {}) {
        const tool = this.TOOL_MATRIX[toolName];
        if (!tool) {
            return 'Unknown tool.';
        }

        if (this.isToolAvailable(toolName, args)) {
            return null; // Tool is available
        }

        const hostingName = HostingDetector.getHostingTypeName(args);
        const availableAlternatives = this.getSuggestedAlternatives(toolName, args);

        let message = tool.restrictedMessage ||
            `This tool is not available in ${hostingName}.`;

        if (availableAlternatives.length > 0) {
            message += '\n\nAlternative tools you can use:\n';
            for (const alt of availableAlternatives) {
                message += `• ${alt.name}: ${alt.description}\n`;
            }
        }

        return message;
    }

    /**
     * Get suggested alternative tools
     */
    static getSuggestedAlternatives(restrictedToolName, args = {}) {
        const tool = this.TOOL_MATRIX[restrictedToolName];
        if (!tool) return [];

        const category = tool.category;
        const availableTools = this.getAvailableTools(args);

        // Find tools in the same category that are available
        return availableTools.filter(t => t.category === category);
    }
}

module.exports = ToolAvailabilityMatrix;
/**
 * Hosting Type Detection Service
 * Centralized logic for detecting hosting type (DXP vs Self-Hosted)
 *
 * Part of DXP-23: Self-hosted Azure users should be gracefully restricted
 * from DXP-only tools with clear messaging
 */

const ProjectTools = require('../tools/project-tools');

class HostingDetector {
    /**
     * Hosting types enum
     */
    static HOSTING_TYPES = {
        DXP_PAAS: 'dxp-paas',      // DXP Platform-as-a-Service (current)
        DXP_SAAS: 'dxp-saas',      // DXP Software-as-a-Service (future support)
        SELF_HOSTED: 'self-hosted', // Self-hosted on Azure IaaS
        UNKNOWN: 'unknown'
    };

    /**
     * Detect the hosting type from project configuration
     * @param {Object} args - Tool arguments
     * @returns {string} Hosting type (dxp, self-hosted, or unknown)
     */
    static detectHostingType(args = {}) {
        // First check if args contains direct self-hosted indicators
        if (args.connectionString || args.storageAccountName) {
            return this.HOSTING_TYPES.SELF_HOSTED;
        }

        // Check for DXP API credentials in args
        if (args.projectId && args.apiKey && args.apiSecret) {
            return this.HOSTING_TYPES.DXP_PAAS;
        }

        // If partial DXP credentials, still consider it DXP PaaS
        if (args.projectId && (args.apiKey || args.apiSecret)) {
            return this.HOSTING_TYPES.DXP_PAAS;
        }

        // Check environment variables as fallback
        if (process.env.AZURE_STORAGE_CONNECTION_STRING ||
            process.env.AZURE_STORAGE_ACCOUNT_NAME) {
            return this.HOSTING_TYPES.SELF_HOSTED;
        }

        // Check for DXP credentials in environment
        if (process.env.DXP_CLIENT_ID || process.env.DXP_CLIENT_KEY) {
            return this.HOSTING_TYPES.DXP_PAAS;
        }

        // Try to get current project if no clear indicators
        try {
            const ProjectTools = require('../tools/project-tools');
            const projectConfig = ProjectTools.getCurrentProject();

            if (projectConfig) {
                // Check for self-hosted indicators
                if (projectConfig.isSelfHosted ||
                    projectConfig.connectionString ||
                    projectConfig.storageAccountName) {
                    return this.HOSTING_TYPES.SELF_HOSTED;
                }

                // Check for DXP indicators
                if (projectConfig.projectId &&
                    projectConfig.apiKey &&
                    projectConfig.apiSecret) {
                    return this.HOSTING_TYPES.DXP_PAAS;
                }

                // Check if the project ID indicates self-hosted
                if (projectConfig.projectId &&
                    projectConfig.projectId.startsWith('self-hosted-')) {
                    return this.HOSTING_TYPES.SELF_HOSTED;
                }

                // Default to DXP PaaS if we have API credentials
                if (projectConfig.projectId && (projectConfig.apiKey || projectConfig.apiSecret)) {
                    return this.HOSTING_TYPES.DXP_PAAS;
                }
            }
        } catch (error) {
            // Unable to get project config
        }

        return this.HOSTING_TYPES.UNKNOWN;
    }

    /**
     * Check if current hosting is DXP
     */
    static isDXP(args = {}) {
        const hosting = this.detectHostingType(args);
        // Both PaaS and SaaS are considered DXP
        return hosting === this.HOSTING_TYPES.DXP_PAAS ||
               hosting === this.HOSTING_TYPES.DXP_SAAS;
    }

    /**
     * Check if current hosting is self-hosted
     */
    static isSelfHosted(args = {}) {
        return this.detectHostingType(args) === this.HOSTING_TYPES.SELF_HOSTED;
    }

    /**
     * Get human-readable hosting type name
     */
    static getHostingTypeName(args = {}) {
        const env = this.detectHostingType(args);
        switch (env) {
            case this.HOSTING_TYPES.DXP_PAAS:
                return 'DXP PaaS';
            case this.HOSTING_TYPES.DXP_SAAS:
                return 'DXP SaaS';
            case this.HOSTING_TYPES.SELF_HOSTED:
                return 'Self-Hosted';
            default:
                return 'Unknown Hosting Type';
        }
    }

    /**
     * Get hosting capabilities description
     */
    static getHostingCapabilities(args = {}) {
        const env = this.detectHostingType(args);

        if (env === this.HOSTING_TYPES.DXP_PAAS) {
            return {
                canDeploy: true,
                canExportDatabase: true,
                canCopyContent: true,
                canManageSlots: true,
                canUploadPackages: true,
                canDownloadLogs: true,
                canDownloadBlobs: true,
                description: 'Full access to all DXP PaaS management features'
            };
        } else if (env === this.HOSTING_TYPES.SELF_HOSTED) {
            return {
                canDeploy: false,
                canExportDatabase: false,
                canCopyContent: false,
                canManageSlots: false,
                canUploadPackages: false,
                canDownloadLogs: true,
                canDownloadBlobs: true,
                description: 'Limited to Azure Storage operations (blob and log downloads)'
            };
        } else {
            return {
                canDeploy: false,
                canExportDatabase: false,
                canCopyContent: false,
                canManageSlots: false,
                canUploadPackages: false,
                canDownloadLogs: false,
                canDownloadBlobs: false,
                description: 'No hosting configured'
            };
        }
    }
}

module.exports = HostingDetector;
/**
 * Configuration Module
 * Centralized constants and settings
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const config = {
    // Company Information
    COMPANY: {
        NAME: 'Jaxon Digital',
        WEBSITE: 'https://www.jaxondigital.com',
        SUPPORT_EMAIL: 'support@jaxondigital.com',
        PARTNER_STATUS: 'Optimizely Gold Partner'
    },

    // Project Information
    PROJECT: {
        NAME: 'Jaxon Digital Optimizely DXP MCP Server',
        VERSION: '1.0.2',
        DESCRIPTION: 'PowerShell-based MCP server for Optimizely DXP deployment operations'
    },

    // Default Values
    DEFAULTS: {
        RETENTION_HOURS: 24,
        TIMEOUT_MS: 120000,
        WAIT_TIMEOUT_MINUTES: 30,
        MAX_RETRY_ATTEMPTS: 3,
        RETRY_DELAY_MS: 10000
    },

    // Environment Names
    ENVIRONMENTS: [
        'Integration',
        'Preproduction', 
        'Production',
        'ADE1',
        'ADE2',
        'ADE3',
        'ADE4',
        'ADE5',
        'ADE6'
    ],

    // Database Names
    DATABASES: {
        CMS: 'epicms',
        COMMERCE: 'epicommerce'
    },

    // Deployment Status Values
    DEPLOYMENT_STATUS: {
        IN_PROGRESS: 'InProgress',
        AWAITING_VERIFICATION: 'AwaitingVerification',
        COMPLETING: 'Completing',
        SUCCEEDED: 'Succeeded',
        FAILED: 'Failed',
        RESETTING: 'Resetting',
        RESET: 'Reset'
    },

    // Zero Downtime Modes
    ZERO_DOWNTIME_MODES: {
        READ_ONLY: 'ReadOnly',
        READ_WRITE: 'ReadWrite'
    },

    // Source Apps
    SOURCE_APPS: {
        CMS: 'cms',
        COMMERCE: 'commerce',
        UTIL: 'util'
    },

    // Error Codes (JSON-RPC)
    ERROR_CODES: {
        PARSE_ERROR: -32700,
        INVALID_REQUEST: -32600,
        METHOD_NOT_FOUND: -32601,
        INVALID_PARAMS: -32602,
        INTERNAL_ERROR: -32603,
        SERVER_ERROR: -32000
    },

    // PowerShell Commands
    POWERSHELL: {
        MODULE: 'EpiCloud',
        INSTALL_COMMAND: 'Install-Module EpiCloud -Force',
        IMPORT_COMMAND: 'Import-Module EpiCloud -Force',
        CONNECT_COMMAND: 'Connect-EpiCloud'
    },

    // API Endpoints (for reference)
    API: {
        BASE_URL: 'https://paasportal.episerver.net/api/v1.0',
        ALTERNATE_URL: 'https://paasapi.episerver.net/api/v1.0'
    },

    // File Limits
    FILE_LIMITS: {
        GITHUB_MAX_SIZE_MB: 100,
        UPLOAD_CHUNK_SIZE_MB: 10
    },

    // Formatting
    FORMATTING: {
        STATUS_ICONS: {
            SUCCESS: '✅',
            ERROR: '❌',
            WARNING: '⚠️',
            INFO: 'ℹ️',
            IN_PROGRESS: '🔄',
            WAITING: '⏳',
            ROCKET: '🚀',
            TOOL: '🔧',
            LIGHTBULB: '💡',
            CLIPBOARD: '📋',
            FOLDER: '📁',
            LOCK: '🔒',
            DEPLOY: '🚀',
            UNLOCK: '🔓',
            COMPANY: '🏢',
            VERIFICATION: '👁️'
        }
    },

    // Messages
    MESSAGES: {
        FOOTER: {
            POWERED_BY: '🔧 **Powered by:** PowerShell EpiCloud module',
            BUILT_BY: '🏢 **Built by:** Jaxon Digital - Optimizely Gold Partner'
        },
        TIPS: {
            CHECK_STATUS: 'Monitor progress using get_deployment_status',
            WAIT_FOR_COMPLETION: 'Deployments typically take 30-90 minutes - be patient',
            VERIFY_STAGING: 'Deployment will be in staging slot awaiting verification'
        }
    }
} as const;

export default config;
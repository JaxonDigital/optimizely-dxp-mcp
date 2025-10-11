/**
 * Self-Hosted Azure Storage Configuration
 * Flexible configuration system for customer-managed Azure environments
 * Part of DXP-4: Support for self-hosted Optimizely CMS on Azure
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const OutputLogger = require('./output-logger');
const SecurityHelper = require('./security-helper');

class SelfHostedConfig {
    /**
     * Load configuration from multiple sources
     * Priority: CLI args > Environment vars > Config file > Defaults
     */
    static async loadConfiguration(args = {}) {
        const config = {
            accounts: {},
            containerMappings: {},
            defaultAccount: null,
            authentication: {}
        };

        // 1. Load from config file if it exists
        const configFile = await this.loadConfigFile();
        if (configFile) {
            Object.assign(config, configFile);
        }

        // 2. Load from environment variables
        this.loadFromEnvironment(config);

        // 3. Override with CLI arguments
        this.loadFromArgs(config, args);

        // 4. Apply container discovery if needed
        if (config.autoDiscover !== false) {
            await this.discoverContainers(config);
        }

        return config;
    }

    /**
     * Load configuration from file
     * Default location: ~/.optimizely-mcp/self-hosted.json
     */
    static async loadConfigFile() {
        try {
            const configDir = path.join(process.env.HOME || process.env.USERPROFILE, '.optimizely-mcp');
            const configPath = path.join(configDir, 'self-hosted.json');
            
            const content = await fs.readFile(configPath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            // Config file doesn't exist or is invalid - that's OK
            return null;
        }
    }

    /**
     * Load configuration from environment variables
     * Supports multiple storage accounts
     */
    static loadFromEnvironment(config) {
        // Primary account from connection string
        if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
            const parsed = this.parseConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
            config.accounts[parsed.accountName] = {
                accountName: parsed.accountName,
                accountKey: parsed.accountKey,
                endpointSuffix: parsed.endpointSuffix || 'core.windows.net'
            };
            config.defaultAccount = parsed.accountName;
        }

        // Alternative: Account name + key
        if (process.env.AZURE_STORAGE_ACCOUNT && process.env.AZURE_STORAGE_KEY) {
            const accountName = process.env.AZURE_STORAGE_ACCOUNT;
            config.accounts[accountName] = {
                accountName: accountName,
                accountKey: process.env.AZURE_STORAGE_KEY,
                endpointSuffix: process.env.AZURE_STORAGE_ENDPOINT || 'core.windows.net'
            };
            if (!config.defaultAccount) {
                config.defaultAccount = accountName;
            }
        }

        // Service Principal authentication
        if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
            config.authentication.servicePrincipal = {
                clientId: process.env.AZURE_CLIENT_ID,
                clientSecret: process.env.AZURE_CLIENT_SECRET,
                tenantId: process.env.AZURE_TENANT_ID
            };
        }

        // Container mappings (comma-separated)
        // Format: AZURE_LOG_CONTAINERS=logs,application-logs,web-logs
        if (process.env.AZURE_LOG_CONTAINERS) {
            config.containerMappings.logs = process.env.AZURE_LOG_CONTAINERS.split(',').map(c => c.trim());
        }
        if (process.env.AZURE_MEDIA_CONTAINERS) {
            config.containerMappings.media = process.env.AZURE_MEDIA_CONTAINERS.split(',').map(c => c.trim());
        }

        // Support for multiple accounts
        // Format: AZURE_STORAGE_ACCOUNTS=account1:key1,account2:key2
        if (process.env.AZURE_STORAGE_ACCOUNTS) {
            const accounts = process.env.AZURE_STORAGE_ACCOUNTS.split(',');
            accounts.forEach(accountStr => {
                const [name, key] = accountStr.split(':');
                if (name && key) {
                    config.accounts[name.trim()] = {
                        accountName: name.trim(),
                        accountKey: key.trim(),
                        endpointSuffix: 'core.windows.net'
                    };
                }
            });
        }
    }

    /**
     * Load configuration from CLI arguments
     */
    static loadFromArgs(config, args) {
        // Connection string takes precedence
        if (args.connectionString) {
            const parsed = this.parseConnectionString(args.connectionString);
            config.accounts[parsed.accountName] = {
                accountName: parsed.accountName,
                accountKey: parsed.accountKey,
                endpointSuffix: parsed.endpointSuffix || 'core.windows.net'
            };
            config.defaultAccount = parsed.accountName;
        }

        // Individual account parameters
        if (args.storageAccount && args.accountKey) {
            config.accounts[args.storageAccount] = {
                accountName: args.storageAccount,
                accountKey: args.accountKey,
                endpointSuffix: args.endpointSuffix || 'core.windows.net'
            };
            if (!config.defaultAccount) {
                config.defaultAccount = args.storageAccount;
            }
        }

        // Service Principal
        if (args.clientId && args.clientSecret && args.tenantId) {
            config.authentication.servicePrincipal = {
                clientId: args.clientId,
                clientSecret: args.clientSecret,
                tenantId: args.tenantId
            };
        }

        // Container mappings
        if (args.logContainers) {
            config.containerMappings.logs = Array.isArray(args.logContainers) 
                ? args.logContainers 
                : args.logContainers.split(',').map(c => c.trim());
        }
        if (args.mediaContainers) {
            config.containerMappings.media = Array.isArray(args.mediaContainers)
                ? args.mediaContainers
                : args.mediaContainers.split(',').map(c => c.trim());
        }

        // Specific account selection
        if (args.useAccount) {
            config.defaultAccount = args.useAccount;
        }
    }

    /**
     * Parse Azure Storage connection string
     */
    static parseConnectionString(connectionString) {
        const parts = {};
        connectionString.split(';').forEach(part => {
            const [key, value] = part.split('=');
            if (key && value) {
                parts[key] = value;
            }
        });

        if (!parts.AccountName) {
            throw new Error('Invalid connection string: missing AccountName');
        }

        return {
            accountName: parts.AccountName,
            accountKey: parts.AccountKey,
            endpointSuffix: parts.EndpointSuffix || 'core.windows.net',
            protocol: parts.DefaultEndpointsProtocol || 'https'
        };
    }

    /**
     * Generate a SAS token from account key
     * This creates a time-limited, scoped access token
     */
    static generateSasToken(accountName, accountKey, containerName, permissions = 'rl', expiryHours = 24) {
        const start = new Date();
        const expiry = new Date(start.getTime() + (expiryHours * 60 * 60 * 1000));
        
        // Format dates for Azure
        const startStr = start.toISOString().slice(0, 19) + 'Z';
        const expiryStr = expiry.toISOString().slice(0, 19) + 'Z';
        
        // Build the string to sign
        const stringToSign = [
            permissions,                    // sp (permissions)
            startStr,                       // st (start time)
            expiryStr,                      // se (expiry time)
            `/blob/${accountName}/${containerName}`, // sr (resource)
            '',                             // identifier
            '',                             // IP
            'https',                        // protocol
            '2021-08-06',                   // version
            'b',                            // resource type (blob)
            '',                             // snapshot time
            '',                             // encryption scope
            '',                             // cache control
            '',                             // content disposition
            '',                             // content encoding
            '',                             // content language
            ''                              // content type
        ].join('\n');
        
        // Sign with HMAC-SHA256
        const key = Buffer.from(accountKey, 'base64');
        const signature = crypto
            .createHmac('sha256', key)
            .update(stringToSign, 'utf8')
            .digest('base64');
        
        // Build SAS token
        const sasToken = new URLSearchParams({
            'sv': '2021-08-06',
            'ss': 'b',
            'srt': 'co',
            'sp': permissions,
            'se': expiryStr,
            'st': startStr,
            'spr': 'https',
            'sig': signature
        }).toString();
        
        return sasToken;
    }

    /**
     * Discover containers in storage accounts
     * This helps map what containers exist without hardcoding
     */
    static async discoverContainers(config) {
        if (!config.accounts || Object.keys(config.accounts).length === 0) {
            return;
        }

        // For each configured account, we could list containers
        // This would require account-level access
        // For MVP, we'll rely on explicit configuration
        
        // Auto-detect common patterns if not configured
        if (!config.containerMappings.logs || config.containerMappings.logs.length === 0) {
            // Common log container patterns
            config.containerMappings.logs = [
                'logs',
                'application-logs',
                'web-logs',
                'app-logs',
                'site-logs',
                'azure-application-logs',
                'azure-web-logs',
                'insights-logs-appserviceconsolelogs',
                'insights-logs-appservicehttplogs'
            ];
        }

        if (!config.containerMappings.media || config.containerMappings.media.length === 0) {
            // Common media container patterns
            config.containerMappings.media = [
                'media',
                'assets',
                'blobs',
                'mysitemedia',
                'content',
                'uploads',
                'files'
            ];
        }
    }

    /**
     * Save configuration to file for persistence
     */
    static async saveConfiguration(config) {
        try {
            const configDir = path.join(process.env.HOME || process.env.USERPROFILE, '.optimizely-mcp');
            await fs.mkdir(configDir, { recursive: true });
            
            const configPath = path.join(configDir, 'self-hosted.json');
            
            // Mask sensitive data before saving
            const safeConfig = this.maskSensitiveConfig(config);
            
            await fs.writeFile(configPath, JSON.stringify(safeConfig, null, 2));
            
            OutputLogger.info(`✅ Configuration saved to ${configPath}`);
            return true;
        } catch (error) {
            OutputLogger.error(`Failed to save configuration: ${error.message}`);
            return false;
        }
    }

    /**
     * Mask sensitive information in config
     */
    static maskSensitiveConfig(config) {
        const masked = JSON.parse(JSON.stringify(config)); // Deep clone
        
        // Mask account keys
        if (masked.accounts) {
            for (const account of Object.values(masked.accounts)) {
                if (account.accountKey) {
                    account.accountKey = SecurityHelper.maskSecret(account.accountKey);
                }
            }
        }

        // Mask service principal secret
        if (masked.authentication?.servicePrincipal?.clientSecret) {
            masked.authentication.servicePrincipal.clientSecret = SecurityHelper.maskSecret(
                masked.authentication.servicePrincipal.clientSecret
            );
        }

        return masked;
    }

    /**
     * Get the appropriate storage account for a container type
     */
    static getAccountForContainer(config, containerType) {
        // For now, use the default account
        // In future, could map specific containers to specific accounts
        if (!config.defaultAccount) {
            throw new Error('No storage account configured');
        }

        const account = config.accounts[config.defaultAccount];
        if (!account) {
            throw new Error(`Storage account '${config.defaultAccount}' not found in configuration`);
        }

        return account;
    }

    /**
     * List all containers that match a type (logs, media, etc)
     */
    static getContainersForType(config, type) {
        if (!config.containerMappings || !config.containerMappings[type]) {
            return [];
        }
        return config.containerMappings[type];
    }
}

module.exports = SelfHostedConfig;
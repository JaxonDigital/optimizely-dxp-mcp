/**
 * Self-Hosted Azure Storage Support
 * Enables log downloads from customer-managed Azure Storage accounts
 * Part of DXP-4: Support for self-hosted Optimizely CMS on Azure
 */

const { URL } = require('url');
const OutputLogger = require('./output-logger');
const SecurityHelper = require('./security-helper');

class SelfHostedStorage {
    /**
     * Check if we're in self-hosted mode based on configuration
     */
    static isSelfHostedMode(args) {
        // Self-hosted mode if connection string is provided anywhere
        if (args.connectionString) return true;
        
        // Check if the project configuration has a connection string
        if (args.project || args.projectName) {
            try {
                const ProjectTools = require('./tools/project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                const projectName = args.project || args.projectName;
                const project = projects.find(p => 
                    p.name === projectName || 
                    p.name.toLowerCase() === projectName.toLowerCase()
                );
                if (project && project.connectionString) {
                    return true;
                }
            } catch (e) {
                // Ignore errors in checking project config
            }
        }
        
        return false;
    }

    /**
     * Parse Azure Storage connection string
     * Format: DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=mykey;EndpointSuffix=core.windows.net
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
     * Generate a SAS token for a container
     * Creates a Service SAS for blob access
     */
    static generateSasToken(accountName, accountKey, containerName, permissions = 'rl', expiryHours = 24) {
        const crypto = require('crypto');
        
        // Set expiry time
        const now = new Date();
        const expiry = new Date(now.getTime() + (expiryHours * 60 * 60 * 1000));
        
        // Format dates for SAS (Azure expects specific format)
        const formatDate = (date) => {
            // Azure expects: YYYY-MM-DDTHH:mm:ssZ
            return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
        };
        
        const se = formatDate(expiry); // Expiry
        const sp = permissions; // Permissions (r=read, l=list)
        const sr = 'c'; // Resource (c=container)
        const sv = '2023-11-03'; // Use latest stable API version
        
        // Construct the string to sign for Service SAS
        // Format per Azure docs: https://docs.microsoft.com/en-us/rest/api/storageservices/create-service-sas
        // The order is critical and must match exactly
        const stringToSign = [
            sp,           // signedPermissions
            '',           // signedStart (optional)
            se,           // signedExpiry
            `/blob/${accountName}/${containerName}`, // canonicalizedResource
            '',           // signedIdentifier (optional)
            '',           // signedIP (optional)
            'https',      // signedProtocol
            sv,           // signedVersion
            sr,           // signedResource
            '',           // signedSnapshotTime (optional)
            '',           // signedEncryptionScope (optional)
            '',           // rscc (cache-control)
            '',           // rscd (content-disposition)  
            '',           // rsce (content-encoding)
            '',           // rscl (content-language)
            ''            // rsct (content-type)
        ].join('\n');
        
        // Create signature
        const key = Buffer.from(accountKey, 'base64');
        const signature = crypto
            .createHmac('sha256', key)
            .update(stringToSign, 'utf8')
            .digest('base64');
        
        // Build SAS token - order matters for some Azure services
        const sasToken = new URLSearchParams({
            sv: sv,
            sr: sr,
            sp: sp,
            se: se,
            sig: signature,
            spr: 'https'  // signed protocol
        }).toString();
        
        if (process.env.DEBUG === 'true') {
            console.error('[SAS TOKEN] Generated token params:', {
                sv, se, sp, sr, spr: 'https',
                sig: signature.substring(0, 10) + '...',
                stringToSign: stringToSign.split('\n').map((line, i) => `  [${i}]: "${line}"`).join('\n')
            });
        }
        
        return '?' + sasToken;
    }

    /**
     * Build Azure Storage URL for listing blobs
     */
    static buildListUrl(config) {
        const { accountName, accountKey, containerName, endpointSuffix = 'core.windows.net' } = config;
        
        if (!accountName || !containerName) {
            throw new Error('Account name and container name are required');
        }

        const baseUrl = `https://${accountName}.blob.${endpointSuffix}/${containerName}`;
        
        // Generate SAS token from account key
        const sasToken = this.generateSasToken(accountName, accountKey, containerName, 'rl', 24);
        
        // Ensure proper URL construction - SAS token already starts with '?'
        const fullUrl = `${baseUrl}${sasToken}&restype=container&comp=list`;
        
        if (process.env.DEBUG === 'true') {
            console.error('[BUILD LIST URL] Final URL:', fullUrl.split('&sig=')[0] + '&sig=[REDACTED]');
        }
        
        return fullUrl;
    }

    /**
     * Build download URL for a specific blob
     */
    static buildBlobUrl(config, blobName) {
        const { accountName, accountKey, containerName, endpointSuffix = 'core.windows.net' } = config;
        
        if (!accountName || !containerName || !blobName) {
            throw new Error('Account name, container name, and blob name are required');
        }

        const baseUrl = `https://${accountName}.blob.${endpointSuffix}/${containerName}/${blobName}`;
        
        // Generate SAS token from account key
        const sasToken = this.generateSasToken(accountName, accountKey, containerName, 'r', 24);
        
        return `${baseUrl}${sasToken}`;
    }

    /**
     * Get storage configuration from connection string only
     */
    static getStorageConfig(args) {
        let connectionString = args.connectionString;
        
        // If no direct connection string, check project configuration
        if (!connectionString && (args.project || args.projectName)) {
            try {
                const ProjectTools = require('./tools/project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                const projectName = args.project || args.projectName;
                const project = projects.find(p => 
                    p.name === projectName || 
                    p.name.toLowerCase() === projectName.toLowerCase()
                );
                if (project && project.connectionString) {
                    connectionString = project.connectionString;
                }
            } catch (e) {
                // Ignore errors in checking project config
            }
        }
        
        if (!connectionString) {
            throw new Error(
                'Azure Storage connection string is required for self-hosted mode.\n' +
                'Configure in project settings or provide via --connectionString.\n' +
                'Format: DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=mykey;EndpointSuffix=core.windows.net'
            );
        }

        // Parse the connection string
        const parsed = this.parseConnectionString(connectionString);
        
        const config = {
            accountName: parsed.accountName,
            accountKey: parsed.accountKey,
            endpointSuffix: parsed.endpointSuffix,
            protocol: parsed.protocol
        };

        // Container name from args or defaults to 'mysitemedia'
        config.containerName = args.containerName || 'mysitemedia';

        return config;
    }

    /**
     * Generate SharedKey Authorization header for Azure Storage
     */
    static generateAuthorizationHeader(method, accountName, accountKey, resourcePath, headers = {}) {
        const crypto = require('crypto');
        
        // Canonicalized headers - must be sorted and lowercase
        const canonicalizedHeaders = Object.keys(headers)
            .filter(key => key.toLowerCase().startsWith('x-ms-'))
            .sort()
            .map(key => `${key.toLowerCase()}:${headers[key]}`)
            .join('\n');
        
        // Canonicalized resource - for list containers, format is special
        // Format: /accountname/\ncomp:list
        const canonicalizedResource = `/${accountName}/\ncomp:list`;
        
        // String to sign for SharedKey
        const stringToSign = [
            method,                          // HTTP verb
            headers['Content-Encoding'] || '',
            headers['Content-Language'] || '',
            headers['Content-Length'] || '',
            headers['Content-MD5'] || '',
            headers['Content-Type'] || '',
            '',                              // Date (using x-ms-date instead)
            headers['If-Modified-Since'] || '',
            headers['If-Match'] || '',
            headers['If-None-Match'] || '',
            headers['If-Unmodified-Since'] || '',
            headers['Range'] || '',
            canonicalizedHeaders,
            canonicalizedResource
        ].join('\n');
        
        if (process.env.DEBUG === 'true') {
            console.error('[AUTH] String to sign:', stringToSign.split('\n').map((line, i) => `[${i}]: "${line}"`).join('\n'));
        }
        
        // Create signature
        const key = Buffer.from(accountKey, 'base64');
        const signature = crypto
            .createHmac('sha256', key)
            .update(stringToSign, 'utf8')
            .digest('base64');
        
        return `SharedKey ${accountName}:${signature}`;
    }

    /**
     * List available containers (if we have account-level access)
     */
    static async listContainers(connectionString) {
        try {
            // Parse connection string if it's a string
            const config = typeof connectionString === 'string' 
                ? this.parseConnectionString(connectionString)
                : connectionString;
                
            const { accountName, accountKey, endpointSuffix = 'core.windows.net' } = config;
            
            if (!accountName || !accountKey) {
                OutputLogger.error('Missing account name or key for container listing');
                return [];
            }
            
            OutputLogger.info('Listing containers from Azure Storage...');
            
            // Build URL for listing containers
            const baseUrl = `https://${accountName}.blob.${endpointSuffix}`;
            const resourcePath = '/?comp=list';
            const fullUrl = baseUrl + resourcePath;
            
            // Generate x-ms-date header
            const now = new Date();
            const xMsDate = now.toUTCString();
            const xMsVersion = '2023-11-03';
            
            // Set up headers
            const headers = {
                'x-ms-date': xMsDate,
                'x-ms-version': xMsVersion
            };
            
            // Generate authorization header
            const authHeader = this.generateAuthorizationHeader(
                'GET',
                accountName,
                accountKey,
                '/?comp=list',
                headers
            );
            
            headers['Authorization'] = authHeader;
            
            if (process.env.DEBUG === 'true') {
                console.error('[LIST CONTAINERS] URL:', fullUrl);
                console.error('[LIST CONTAINERS] Headers:', {
                    ...headers,
                    Authorization: 'SharedKey [REDACTED]'
                });
            }
            
            // Make the API call
            const https = require('https');
            const url = new URL(fullUrl);
            
            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'GET',
                headers: headers
            };
            
            const response = await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            resolve(data);
                        } else {
                            reject(new Error(`Failed to list containers: ${res.statusCode} - ${data}`));
                        }
                    });
                });
                
                req.on('error', reject);
                req.end();
            });
            
            // Parse XML response
            const containers = [];
            const containerMatches = response.matchAll(/<Container>[\s\S]*?<Name>(.*?)<\/Name>[\s\S]*?<\/Container>/g);
            
            for (const match of containerMatches) {
                const containerName = match[1];
                
                // Determine friendly name and description based on container name
                let friendlyName = containerName;
                let description = 'Storage container';
                let downloadHint = `Use: download_blobs "${containerName}"`;
                
                // Assign friendly names to known container types
                if (containerName.includes('mysitemedia')) {
                    friendlyName = 'Media Files';
                    description = 'Media files and assets';
                } else if (containerName === '$web') {
                    friendlyName = 'Web Content';
                    description = 'Static website content';
                } else if (containerName.includes('insights-logs-appserviceconsolelogs')) {
                    friendlyName = 'Console Logs';
                    description = 'Application console logs';
                    downloadHint = `Use: download_logs "Console Logs"`;
                } else if (containerName.includes('insights-logs-appservicehttplogs')) {
                    friendlyName = 'HTTP Logs';
                    description = 'HTTP/Web server logs';
                    downloadHint = `Use: download_logs "HTTP Logs"`;
                } else if (containerName.includes('insights-logs-appserviceapplogs')) {
                    friendlyName = 'Application Logs';
                    description = 'Application logs';
                    downloadHint = `Use: download_logs "Application Logs"`;
                } else if (containerName.includes('insights-logs-appserviceplatformlogs')) {
                    friendlyName = 'Platform Logs';
                    description = 'Platform logs';
                    downloadHint = `Use: download_logs "Platform Logs"`;
                } else if (containerName.includes('insights-logs-appservicefileauditlogs')) {
                    friendlyName = 'File Audit Logs';
                    description = 'File audit logs';
                    downloadHint = `Use: download_logs "File Audit Logs"`;
                } else if (containerName.includes('insights-logs-appserviceantivirusscanauditlogs')) {
                    friendlyName = 'Antivirus Scan Logs';
                    description = 'Antivirus scan audit logs';
                    downloadHint = `Use: download_logs "Antivirus Logs"`;
                } else if (containerName.includes('insights-metrics')) {
                    friendlyName = 'Metrics';
                    description = 'Application metrics';
                    downloadHint = `Use: download_blobs "${containerName}"`;
                } else if (containerName.includes('backup') || containerName === 'dbbackup') {
                    friendlyName = 'Database Backups';
                    description = 'Database backups';
                    downloadHint = `Use: download_blobs "Backups"`;
                } else if (containerName === 'dataprotectionkeys') {
                    friendlyName = 'Data Protection Keys';
                    description = 'ASP.NET Core data protection keys';
                } else if (containerName === '$logs') {
                    friendlyName = 'Storage Logs';
                    description = 'Azure Storage analytics logs';
                } else if (containerName === '$blobchangefeed') {
                    friendlyName = 'Blob Change Feed';
                    description = 'Blob change feed data';
                }
                
                containers.push({
                    name: containerName,
                    properties: { description },
                    friendlyName,
                    downloadHint
                });
            }
            
            if (process.env.DEBUG === 'true') {
                console.error(`[LIST CONTAINERS] Found ${containers.length} containers`);
            }
            
            OutputLogger.info(`Found ${containers.length} containers in Azure Storage`);
            return containers;
            
        } catch (error) {
            OutputLogger.error('Failed to list containers:', error.message);
            if (process.env.DEBUG === 'true') {
                console.error('[LIST CONTAINERS ERROR] Full error:', error);
                console.error('[LIST CONTAINERS ERROR] Stack:', error.stack);
            }
            
            // Fall back to common containers if API call fails
            OutputLogger.info('Falling back to common container names due to API error');
            return [
                { 
                    name: 'mysitemedia', 
                    properties: { description: 'Media and assets' },
                    friendlyName: 'Media Files',
                    downloadHint: 'Use: download_blobs "Media Files"'
                },
                { 
                    name: '$web', 
                    properties: { description: 'Static website content' },
                    friendlyName: 'Web Content',
                    downloadHint: 'Use: download_blobs "Web Content"'
                },
                { 
                    name: 'insights-logs-appserviceconsolelogs', 
                    properties: { description: 'Application console logs' },
                    friendlyName: 'Console Logs',
                    downloadHint: 'Use: download_logs "Console Logs"'
                },
                { 
                    name: 'insights-logs-appservicehttplogs', 
                    properties: { description: 'HTTP/Web server logs' },
                    friendlyName: 'HTTP Logs',
                    downloadHint: 'Use: download_logs "HTTP Logs"'
                }
            ];
        }
    }

    /**
     * Mask sensitive information for logging
     */
    static maskConfig(config) {
        const masked = { ...config };
        
        if (masked.accountKey) {
            masked.accountKey = SecurityHelper.maskSecret(masked.accountKey);
        }
        
        if (masked.sasToken) {
            // Show only the permissions part of SAS token
            const params = new URLSearchParams(masked.sasToken);
            const sp = params.get('sp') || 'unknown';
            const se = params.get('se') || 'unknown';
            masked.sasToken = `[SAS token with permissions: ${sp}, expires: ${se}]`;
        }

        if (masked.connectionString) {
            masked.connectionString = '[MASKED]';
        }

        return masked;
    }
}

module.exports = SelfHostedStorage;
/**
 * Download Configuration Manager
 * Handles environment-based and project-specific download paths
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const OutputLogger = require('./output-logger');

class DownloadConfig {
    // Cache for path validation results
    static pathValidationCache = new Map();
    static CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    /**
     * Environment variable patterns:
     * - OPTIMIZELY_DOWNLOAD_PATH: Global default for all downloads
     * - OPTIMIZELY_DOWNLOAD_PATH_BLOBS: Specific for blob/media downloads
     * - OPTIMIZELY_DOWNLOAD_PATH_DATABASE: Specific for database exports
     * - OPTIMIZELY_DOWNLOAD_PATH_LOGS: Specific for log downloads
     * 
     * Can also be project-specific:
     * - OPTIMIZELY_ACME_DOWNLOAD_PATH: Default for ACME project
     * - OPTIMIZELY_ACME_DOWNLOAD_PATH_BLOBS: Blobs for ACME project
     * - OPTIMIZELY_CONTOSO_DOWNLOAD_PATH_BLOBS: Blobs for CONTOSO project
     */
    
    /**
     * Get download path for a specific type and project
     * @param {string} type - Type of download: 'blobs', 'database', 'logs'
     * @param {string} projectName - Name of the project (e.g., 'ACME', 'CONTOSO')
     * @param {string} userSpecifiedPath - Path explicitly specified by user
     * @param {string} environment - Environment (Production, Staging, etc.)
     * @returns {Promise<string>} Resolved download path
     */
    static async getDownloadPath(type, projectName, userSpecifiedPath, environment) {
        // Priority 1: User-specified path (command argument)
        if (userSpecifiedPath) {
            OutputLogger.info(`📁 Using user-specified path: ${userSpecifiedPath}`);
            return path.resolve(userSpecifiedPath);
        }
        
        // Priority 2: Project configuration compact fields (blobPath, dbPath, logPath)
        if (projectName) {
            const projectConfig = await this.getProjectConfigByName(projectName);
            if (projectConfig) {
                // Debug logging for path resolution
                if (process.env.DEBUG === 'true' || process.env.DEBUG_PATHS === 'true') {
                    console.error(`[DEBUG] Project config for ${projectName}:`, {
                        blobPath: projectConfig.blobPath,
                        dbPath: projectConfig.dbPath,
                        logPath: projectConfig.logPath
                    });
                }
                
                let compactPath = null;
                
                if (type === 'blobs' && projectConfig.blobPath) {
                    compactPath = projectConfig.blobPath;
                } else if (type === 'database' && projectConfig.dbPath) {
                    compactPath = projectConfig.dbPath;
                } else if (type === 'logs' && projectConfig.logPath) {
                    compactPath = projectConfig.logPath;
                }
                
                if (compactPath) {
                    const expandedPath = this.expandPath(compactPath);
                    const envFolder = this.getEnvironmentFolder(environment);
                    const fullPath = path.join(expandedPath, envFolder);
                    OutputLogger.info(`📁 Using project ${type} path: ${fullPath}`);
                    return fullPath;
                }
            } else {
                // Debug when project config not found
                if (process.env.DEBUG === 'true' || process.env.DEBUG_PATHS === 'true') {
                    console.error(`[DEBUG] No project config found for: ${projectName}`);
                }
            }
        }
        
        // Priority 3: Project + Type specific environment variable
        if (projectName) {
            const projectKey = projectName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
            const projectTypeEnvVar = `OPTIMIZELY_${projectKey}_DOWNLOAD_PATH_${type.toUpperCase()}`;
            
            if (process.env[projectTypeEnvVar]) {
                const basePath = this.expandPath(process.env[projectTypeEnvVar]);
                const envFolder = this.getEnvironmentFolder(environment);
                const envPath = path.join(basePath, envFolder);
                OutputLogger.info(`📁 Using ${projectTypeEnvVar}/${envFolder}: ${envPath}`);
                return envPath;
            }
            
            // Priority 4: Project-specific general path
            const projectEnvVar = `OPTIMIZELY_${projectKey}_DOWNLOAD_PATH`;
            if (process.env[projectEnvVar]) {
                const basePath = this.expandPath(process.env[projectEnvVar]);
                const envFolder = this.getEnvironmentFolder(environment);
                const envPath = path.join(basePath, type.toLowerCase(), envFolder);
                OutputLogger.info(`📁 Using ${projectEnvVar}/${type}/${envFolder}: ${envPath}`);
                return envPath;
            }
        }
        
        // Priority 4: Type-specific global environment variable
        const typeEnvVar = `OPTIMIZELY_DOWNLOAD_PATH_${type.toUpperCase()}`;
        if (process.env[typeEnvVar]) {
            const basePath = this.expandPath(process.env[typeEnvVar]);
            const envFolder = this.getEnvironmentFolder(environment);
            const envPath = path.join(basePath, projectName || 'unknown', envFolder);
            OutputLogger.info(`📁 Using ${typeEnvVar}/${projectName}/${envFolder}: ${envPath}`);
            return envPath;
        }
        
        // Priority 5: Global download path environment variable
        if (process.env.OPTIMIZELY_DOWNLOAD_PATH) {
            const basePath = this.expandPath(process.env.OPTIMIZELY_DOWNLOAD_PATH);
            const envFolder = this.getEnvironmentFolder(environment);
            const envPath = path.join(basePath, type.toLowerCase(), projectName || 'unknown', envFolder);
            OutputLogger.info(`📁 Using OPTIMIZELY_DOWNLOAD_PATH/${type}/${projectName}/${envFolder}: ${envPath}`);
            return envPath;
        }
        
        // Settings removed - downloads now use per-project paths or current directory
        
        // Priority 7: Smart defaults based on type and context
        return this.getSmartDefault(type, projectName, environment);
    }
    
    /**
     * Get smart default path based on type and context
     */
    static async getSmartDefault(type, projectName, environment) {
        const projectFolder = projectName ? projectName.toLowerCase() : 'unknown';
        
        // Add environment subfolder for better organization
        // This prevents mixing logs/files from different environments
        const envFolder = this.getEnvironmentFolder(environment);
        
        // Check for common development paths
        const devPaths = [
            `/Users/bgerby/Documents/dev/${type}/${projectFolder}/${envFolder}`,
            `./downloads/${type}/${projectFolder}/${envFolder}`,
            `~/Downloads/optimizely-${type}/${projectFolder}/${envFolder}`
        ];
        
        // Try to find an existing parent directory
        for (const testPath of devPaths) {
            const expandedPath = this.expandPath(testPath);
            const parentDir = path.dirname(path.dirname(expandedPath)); // Go up 2 levels to check project folder
            
            try {
                await fs.access(parentDir);
                OutputLogger.info(`📁 Using smart default: ${expandedPath}`);
                return expandedPath;
            } catch {
                // Directory doesn't exist, try next
            }
        }
        
        // Ultimate fallback
        const fallbackPath = path.join(process.cwd(), 'downloads', type, projectFolder, envFolder);
        OutputLogger.info(`📁 Using fallback path: ${fallbackPath}`);
        return fallbackPath;
    }
    
    /**
     * Get environment folder name - normalizes environment names
     * @param {string} environment - Environment name (Production, Preproduction, Integration, etc.)
     * @returns {string} Normalized folder name
     */
    static getEnvironmentFolder(environment) {
        if (!environment) {
            return 'production'; // Default to production if not specified
        }
        
        // Normalize common environment names
        const normalized = environment.toLowerCase().trim();
        
        // Map common variations to standard names
        const envMap = {
            'prod': 'production',
            'production': 'production',
            'pre': 'preproduction',
            'preproduction': 'preproduction',
            'preprod': 'preproduction',
            'staging': 'preproduction',
            'int': 'integration',
            'integration': 'integration',
            'dev': 'integration',
            'development': 'integration',
            'test': 'test',
            'testing': 'test',
            'uat': 'uat',
            'demo': 'demo',
            'self-hosted': 'production', // Self-hosted typically means production
            'selfhosted': 'production',
            'azure': 'production' // Azure self-hosted defaults to production
        };
        
        // For self-hosted, check if there's an environment suffix
        // e.g., "self-hosted-staging" would become "staging"
        if (normalized.includes('self-hosted-')) {
            const envPart = normalized.replace('self-hosted-', '');
            return envMap[envPart] || envPart.replace(/[^a-z0-9-]/g, '-');
        }
        
        // Return mapped name or use the original (for self-hosted custom environments)
        return envMap[normalized] || normalized.replace(/[^a-z0-9-]/g, '-');
    }
    
    /**
     * Expand path with ~ and environment variables
     * Supports:
     * - Absolute paths: /Users/name/downloads
     * - Home paths: ~/downloads
     * - Relative paths: ./db or db (relative to current working directory)
     * - Environment variables: $HOME/downloads or ${USER}/downloads
     */
    static expandPath(inputPath) {
        if (!inputPath) return inputPath;
        
        // Expand ~ to home directory
        if (inputPath.startsWith('~')) {
            inputPath = path.join(os.homedir(), inputPath.slice(1));
        }
        
        // Expand environment variables (e.g., $HOME, ${USER})
        inputPath = inputPath.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (match, envVar) => {
            return process.env[envVar] || match;
        });
        
        // Check if it's a relative path (not absolute)
        if (!path.isAbsolute(inputPath)) {
            // For relative paths, resolve from current working directory
            // This allows "db" to become "./db" in the current project folder
            OutputLogger.debug(`Resolving relative path "${inputPath}" from ${process.cwd()}`);
            return path.resolve(process.cwd(), inputPath);
        }
        
        return path.resolve(inputPath);
    }
    
    /**
     * Show current configuration for debugging
     */
    static async showConfiguration(projectName) {
        const config = {
            'Environment Variables': {},
            'Smart Defaults': {}
        };
        
        // Check all relevant environment variables
        const projectKey = projectName ? projectName.toUpperCase().replace(/[^A-Z0-9]/g, '_') : null;
        const envVars = [
            'OPTIMIZELY_DOWNLOAD_PATH',
            'OPTIMIZELY_DOWNLOAD_PATH_BLOBS',
            'OPTIMIZELY_DOWNLOAD_PATH_DATABASE',
            'OPTIMIZELY_DOWNLOAD_PATH_LOGS'
        ];
        
        if (projectKey) {
            envVars.push(
                `OPTIMIZELY_${projectKey}_DOWNLOAD_PATH`,
                `OPTIMIZELY_${projectKey}_DOWNLOAD_PATH_BLOBS`,
                `OPTIMIZELY_${projectKey}_DOWNLOAD_PATH_DATABASE`,
                `OPTIMIZELY_${projectKey}_DOWNLOAD_PATH_LOGS`
            );
        }
        
        for (const envVar of envVars) {
            if (process.env[envVar]) {
                config['Environment Variables'][envVar] = process.env[envVar];
            }
        }
        
        // Show what paths would be used
        for (const type of ['blobs', 'database', 'logs']) {
            config['Smart Defaults'][type] = await this.getDownloadPath(type, projectName, null, 'Production');
        }
        
        return config;
    }
    
    /**
     * Get project configuration by name
     */
     static async getProjectConfigByName(projectName) {
        try {
            const ProjectTools = require('./tools/project-tools');
            const projects = ProjectTools.getConfiguredProjects();
            
            // VISIBLE DEBUG: Show what we're looking for vs what we found
            OutputLogger.info(`🔍 Looking for project: "${projectName}"`);
            OutputLogger.info(`📋 Available projects: ${projects.map(p => `"${p.name}"`).join(', ')}`);
            
            const found = projects.find(p => p.name.toLowerCase() === projectName.toLowerCase());
            if (found) {
                OutputLogger.info(`✅ Found project match: "${found.name}" with logPath: ${found.logPath || 'NOT SET'}`);
            } else {
                OutputLogger.info(`❌ No project match found for "${projectName}"`);
            }
            
            return found;
        } catch (error) {
            OutputLogger.debug(`Could not get project config for ${projectName}: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Set environment variable for current session
     * Note: This only affects the current process, not the shell
     */
    static setEnvironmentVariable(key, value) {
        process.env[key] = value;
        OutputLogger.info(`✅ Set ${key} = ${value} for this session`);
        OutputLogger.info(`💡 To make this permanent, add to your shell profile or .env file`);
    }

    /**
     * Validate and prepare download path
     * @param {string} downloadPath - Path to validate
     * @param {string} type - Type of download (for context in messages)
     * @param {boolean} createIfMissing - Whether to create directory if it doesn't exist
     * @returns {Promise<{valid: boolean, path: string, error?: string, created?: boolean}>}
     */
    static async validatePath(downloadPath, type = 'download', createIfMissing = true) {
        if (!downloadPath) {
            return { valid: false, error: 'No path provided' };
        }

        // Check cache first
        const cacheKey = `${downloadPath}:${type}:${createIfMissing}`;
        const cached = this.pathValidationCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
            OutputLogger.debug(`Using cached validation result for ${downloadPath}`);
            return cached.result;
        }

        try {
            // Expand the path
            const expandedPath = this.expandPath(downloadPath);
            
            // Check if path exists
            let exists = false;
            let isWritable = false;
            let created = false;
            
            try {
                const stats = await fs.stat(expandedPath);
                exists = true;
                
                if (!stats.isDirectory()) {
                    const result = { 
                        valid: false, 
                        path: expandedPath,
                        error: `Path exists but is not a directory: ${expandedPath}` 
                    };
                    this.cacheValidationResult(cacheKey, result);
                    return result;
                }
                
                // Check write permissions
                try {
                    await fs.access(expandedPath, fs.constants.W_OK);
                    isWritable = true;
                } catch {
                    const result = { 
                        valid: false, 
                        path: expandedPath,
                        error: `Directory exists but is not writable: ${expandedPath}` 
                    };
                    this.cacheValidationResult(cacheKey, result);
                    return result;
                }
            } catch (statError) {
                // Directory doesn't exist
                if (createIfMissing) {
                    try {
                        OutputLogger.info(`📁 Creating directory: ${expandedPath}`);
                        await fs.mkdir(expandedPath, { recursive: true });
                        created = true;
                        isWritable = true;
                        exists = true;
                    } catch (mkdirError) {
                        const result = { 
                            valid: false, 
                            path: expandedPath,
                            error: `Failed to create directory: ${mkdirError.message}` 
                        };
                        this.cacheValidationResult(cacheKey, result);
                        return result;
                    }
                } else {
                    const result = { 
                        valid: false, 
                        path: expandedPath,
                        error: `Directory does not exist: ${expandedPath}` 
                    };
                    this.cacheValidationResult(cacheKey, result);
                    return result;
                }
            }
            
            // Test write permissions by creating a temp file (if writable)
            if (isWritable) {
                const testFile = path.join(expandedPath, `.write-test-${Date.now()}`);
                try {
                    await fs.writeFile(testFile, 'test');
                    await fs.unlink(testFile);
                } catch (writeError) {
                    const result = { 
                        valid: false, 
                        path: expandedPath,
                        error: `Cannot write to directory: ${writeError.message}` 
                    };
                    this.cacheValidationResult(cacheKey, result);
                    return result;
                }
            }
            
            const result = {
                valid: true,
                path: expandedPath,
                created
            };
            
            if (created) {
                OutputLogger.success(`✅ Created ${type} directory: ${expandedPath}`);
            }
            
            this.cacheValidationResult(cacheKey, result);
            return result;
            
        } catch (error) {
            const result = { 
                valid: false, 
                path: downloadPath,
                error: `Validation error: ${error.message}` 
            };
            this.cacheValidationResult(cacheKey, result);
            return result;
        }
    }

    /**
     * Cache validation result
     */
    static cacheValidationResult(key, result) {
        this.pathValidationCache.set(key, {
            timestamp: Date.now(),
            result
        });
    }

    /**
     * Clear validation cache
     */
    static clearValidationCache() {
        this.pathValidationCache.clear();
        OutputLogger.debug('Cleared path validation cache');
    }

    /**
     * Validate and get download path with automatic creation
     * @param {string} type - Type of download
     * @param {string} projectName - Project name
     * @param {string} userSpecifiedPath - User-specified path
     * @param {string} environment - Environment
     * @returns {Promise<{path: string, valid: boolean, error?: string}>}
     */
    static async getValidatedDownloadPath(type, projectName, userSpecifiedPath, environment) {
        // Get the path using existing logic
        const downloadPath = await this.getDownloadPath(type, projectName, userSpecifiedPath, environment);
        
        // Validate the path
        const validation = await this.validatePath(downloadPath, type, true);
        
        if (!validation.valid) {
            OutputLogger.error(`❌ Path validation failed: ${validation.error}`);
            return {
                path: downloadPath,
                valid: false,
                error: validation.error
            };
        }
        
        return {
            path: validation.path,
            valid: true,
            created: validation.created
        };
    }

    /**
     * Check if a path is likely cross-platform compatible
     */
    static isCrossPlatformPath(inputPath) {
        // Check for Windows-specific paths
        if (process.platform !== 'win32' && /^[A-Za-z]:/.test(inputPath)) {
            return false;
        }
        
        // Check for Unix-specific absolute paths on Windows
        if (process.platform === 'win32' && inputPath.startsWith('/') && !inputPath.startsWith('//')) {
            return false;
        }
        
        return true;
    }

    /**
     * Get platform-specific path separator
     */
    static getPathSeparator() {
        return path.sep;
    }

    /**
     * Normalize path for current platform
     */
    static normalizePath(inputPath) {
        if (!inputPath) return inputPath;
        
        // Expand any variables first
        const expandedPath = this.expandPath(inputPath);
        
        // Normalize for platform
        return path.normalize(expandedPath);
    }
}

module.exports = DownloadConfig;
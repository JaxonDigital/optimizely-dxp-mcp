/**
 * Settings Manager - Handles user preferences and configuration
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const OutputLogger = require('./output-logger');

class SettingsManager {
    // Settings file location - stored in user's home directory
    static SETTINGS_DIR = path.join(os.homedir(), '.optimizely-mcp');
    static SETTINGS_FILE = path.join(this.SETTINGS_DIR, 'settings.json');
    
    // Default settings
    static DEFAULTS = {
        downloadPath: './backups',
        autoDownload: true,
        monitoringInterval: 300000, // 5 minutes
        telemetryEnabled: true,  // Changed to true for opt-out model
        preferredEnvironment: 'Production',
        preferredDatabase: 'epicms'
    };
    
    // In-memory cache of settings
    static settings = null;
    
    /**
     * Check if we're running in MCP project context
     */
    static isProjectContext() {
        // Check for MCP config files that indicate project context
        try {
            const fs = require('fs');
            const cwd = process.cwd();
            
            // Look for MCP configuration files
            const mcpFiles = ['.mcp.json', 'claude_desktop_config.json', '.claude_config.json'];
            
            for (const file of mcpFiles) {
                if (fs.existsSync(path.join(cwd, file))) {
                    return true;
                }
            }
            
            // Check if running as MCP server (has MCP environment)
            if (process.env.MCP_SERVER || process.env.MCP_MODE) {
                return true;
            }
            
            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Load settings from file or create defaults
     */
    static async loadSettings() {
        try {
            // Return cached settings if already loaded
            if (this.settings) {
                return this.settings;
            }
            
            // If in project context, ignore global settings and use defaults
            if (this.isProjectContext()) {
                this.settings = { ...this.DEFAULTS };
                return this.settings;
            }
            
            // Try to read settings file
            const data = await fs.readFile(this.SETTINGS_FILE, 'utf8');
            this.settings = JSON.parse(data);
            
            // Merge with defaults for any missing keys
            this.settings = { ...this.DEFAULTS, ...this.settings };
            
            return this.settings;
            
        } catch (error) {
            // File doesn't exist or is invalid - use defaults
            this.settings = { ...this.DEFAULTS };
            
            // Try to save defaults (but don't fail if we can't)
            await this.saveSettings().catch(() => {});
            
            return this.settings;
        }
    }
    
    /**
     * Save current settings to file
     */
    static async saveSettings() {
        try {
            // In project context, don't save to global settings file
            if (this.isProjectContext()) {
                // Settings are ephemeral in project context - don't persist
                return true;
            }
            
            // Ensure settings directory exists
            await fs.mkdir(this.SETTINGS_DIR, { recursive: true });
            
            // Write settings to file
            await fs.writeFile(
                this.SETTINGS_FILE, 
                JSON.stringify(this.settings || this.DEFAULTS, null, 2)
            );
            
            return true;
            
        } catch (error) {
            OutputLogger.error(`Failed to save settings: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Get a specific setting value
     */
    static async getSetting(key) {
        const settings = await this.loadSettings();
        return settings[key];
    }
    
    /**
     * Set a specific setting value
     */
    static async setSetting(key, value) {
        const settings = await this.loadSettings();
        settings[key] = value;
        this.settings = settings;
        
        // Save to file
        const saved = await this.saveSettings();
        
        if (saved) {
            OutputLogger.success(`✅ Setting updated: ${key} = ${value}`);
        }
        
        return saved;
    }
    
    /**
     * Get the download path, expanding ~ to home directory
     */
    static async getDownloadPath() {
        const downloadPath = await this.getSetting('downloadPath');
        
        // Expand ~ to home directory
        if (downloadPath.startsWith('~')) {
            return path.join(os.homedir(), downloadPath.slice(1));
        }
        
        // If relative path and not starting with ., make it relative to current directory
        if (!path.isAbsolute(downloadPath) && !downloadPath.startsWith('.')) {
            return path.join(process.cwd(), downloadPath);
        }
        
        return downloadPath;
    }
    
    /**
     * Set the download path with validation
     */
    static async setDownloadPath(newPath) {
        // Validate path
        const validationResult = await this.validateDownloadPath(newPath);
        
        if (!validationResult.valid) {
            OutputLogger.error(`❌ Invalid download path: ${validationResult.error}`);
            return false;
        }
        
        // Store the original path (not expanded)
        const saved = await this.setSetting('downloadPath', newPath);
        
        if (saved) {
            const expandedPath = await this.getDownloadPath();
            OutputLogger.success(`📁 Download path set to: ${newPath}`);
            if (expandedPath !== newPath) {
                OutputLogger.info(`   (Expands to: ${expandedPath})`);
            }
        }
        
        return saved;
    }
    
    /**
     * Validate a download path
     */
    static async validateDownloadPath(downloadPath) {
        try {
            // Expand path for validation
            let expandedPath = downloadPath;
            
            if (downloadPath.startsWith('~')) {
                expandedPath = path.join(os.homedir(), downloadPath.slice(1));
            } else if (!path.isAbsolute(downloadPath) && !downloadPath.startsWith('.')) {
                expandedPath = path.join(process.cwd(), downloadPath);
            }
            
            // Check if parent directory exists
            const parentDir = path.dirname(expandedPath);
            
            try {
                await fs.access(parentDir);
            } catch (error) {
                // Parent doesn't exist - check if we can create it
                if (path.isAbsolute(expandedPath)) {
                    // For absolute paths, check if we can at least access a parent
                    let checkDir = parentDir;
                    let canCreate = false;
                    
                    while (checkDir !== path.dirname(checkDir)) {
                        try {
                            await fs.access(checkDir);
                            canCreate = true;
                            break;
                        } catch {
                            checkDir = path.dirname(checkDir);
                        }
                    }
                    
                    if (!canCreate) {
                        return {
                            valid: false,
                            error: 'Cannot access or create parent directories'
                        };
                    }
                }
            }
            
            // Try to create the directory if it doesn't exist
            try {
                await fs.mkdir(expandedPath, { recursive: true });
                
                // Test write access
                const testFile = path.join(expandedPath, '.mcp-test-write');
                await fs.writeFile(testFile, 'test');
                await fs.unlink(testFile);
                
                return {
                    valid: true,
                    expandedPath
                };
                
            } catch (error) {
                return {
                    valid: false,
                    error: `Cannot write to directory: ${error.message}`
                };
            }
            
        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }
    
    /**
     * Get all settings
     */
    static async getAllSettings() {
        return await this.loadSettings();
    }
    
    /**
     * Reset settings to defaults
     */
    static async resetSettings() {
        this.settings = { ...this.DEFAULTS };
        const saved = await this.saveSettings();
        
        if (saved) {
            OutputLogger.success('✅ Settings reset to defaults');
        }
        
        return saved;
    }
    
    /**
     * Display current settings
     */
    static async displaySettings() {
        const settings = await this.loadSettings();
        const expandedDownloadPath = await this.getDownloadPath();
        
        let display = '⚙️ **Current Settings**\n\n';
        
        display += `**Download Path**: ${settings.downloadPath}\n`;
        if (expandedDownloadPath !== settings.downloadPath) {
            display += `   _(Expands to: ${expandedDownloadPath})_\n`;
        }
        
        display += `**Auto-Download**: ${settings.autoDownload ? 'Enabled' : 'Disabled'}\n`;
        display += `**Monitoring Interval**: ${settings.monitoringInterval / 1000}s\n`;
        display += `**Telemetry**: ${settings.telemetryEnabled ? 'Enabled' : 'Disabled'}\n`;
        display += `**Default Environment**: ${settings.preferredEnvironment}\n`;
        display += `**Default Database**: ${settings.preferredDatabase}\n`;
        
        display += `\n**Settings Location**: ${this.SETTINGS_FILE}`;
        
        return display;
    }
}

module.exports = SettingsManager;
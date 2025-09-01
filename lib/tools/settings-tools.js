/**
 * Settings Tools - User preference management
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const SettingsManager = require('../settings-manager');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const OutputLogger = require('../output-logger');

class SettingsTools {
    /**
     * Get current settings
     */
    static async getSettings(args) {
        try {
            const { key } = args;
            
            if (key) {
                // Get specific setting
                const value = await SettingsManager.getSetting(key);
                
                if (value === undefined) {
                    return ResponseBuilder.error(`Setting '${key}' not found`);
                }
                
                // Special handling for download path to show expanded version
                if (key === 'downloadPath') {
                    const expandedPath = await SettingsManager.getDownloadPath();
                    let message = `**${key}**: ${value}`;
                    if (expandedPath !== value) {
                        message += `\n_(Expands to: ${expandedPath})_`;
                    }
                    return ResponseBuilder.success(message);
                }
                
                return ResponseBuilder.success(`**${key}**: ${value}`);
            } else {
                // Display all settings
                const display = await SettingsManager.displaySettings();
                return ResponseBuilder.success(display);
            }
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'get-settings', args);
        }
    }
    
    /**
     * Set a setting value
     */
    static async setSetting(args) {
        try {
            const { key, value } = args;
            
            if (!key || value === undefined) {
                return ResponseBuilder.invalidParams('Both key and value are required');
            }
            
            // Special handling for certain settings
            if (key === 'downloadPath') {
                const success = await SettingsManager.setDownloadPath(value);
                
                if (success) {
                    const expandedPath = await SettingsManager.getDownloadPath();
                    
                    let message = `✅ **Download Path Updated**\n\n`;
                    message += `**New Path**: ${value}\n`;
                    if (expandedPath !== value) {
                        message += `**Expands to**: ${expandedPath}\n`;
                    }
                    
                    message += `\n💡 **Tips**:\n`;
                    message += `• Use \`~\` for home directory (e.g., \`~/Downloads/backups\`)\n`;
                    message += `• Use absolute paths for specific locations (e.g., \`/Users/name/backups\`)\n`;
                    message += `• Use relative paths for project-relative locations (e.g., \`./backups\`)`;
                    
                    return ResponseBuilder.success(message);
                } else {
                    return ResponseBuilder.error('Failed to set download path. Check the path is valid and writable.');
                }
            }
            
            // Handle boolean values
            if (key === 'autoDownload' || key === 'telemetryEnabled') {
                const boolValue = value === true || value === 'true' || value === '1' || value === 'yes';
                const success = await SettingsManager.setSetting(key, boolValue);
                
                if (success) {
                    return ResponseBuilder.success(`✅ **${key}** set to: ${boolValue ? 'Enabled' : 'Disabled'}`);
                }
            }
            
            // Handle numeric values
            if (key === 'monitoringInterval') {
                const numValue = parseInt(value);
                if (isNaN(numValue) || numValue < 60000) {
                    return ResponseBuilder.invalidParams('Monitoring interval must be at least 60000ms (1 minute)');
                }
                
                const success = await SettingsManager.setSetting(key, numValue);
                
                if (success) {
                    return ResponseBuilder.success(`✅ **Monitoring Interval** set to: ${numValue / 1000} seconds`);
                }
            }
            
            // Generic setting
            const success = await SettingsManager.setSetting(key, value);
            
            if (success) {
                return ResponseBuilder.success(`✅ **${key}** set to: ${value}`);
            } else {
                return ResponseBuilder.error(`Failed to set ${key}`);
            }
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'set-setting', args);
        }
    }
    
    /**
     * Set download path specifically
     */
    static async setDownloadPath(args) {
        try {
            const { path } = args;
            
            if (!path) {
                return ResponseBuilder.invalidParams('Path is required');
            }
            
            const success = await SettingsManager.setDownloadPath(path);
            
            if (success) {
                const expandedPath = await SettingsManager.getDownloadPath();
                
                let message = `✅ **Download Path Updated**\n\n`;
                message += `**New Path**: ${path}\n`;
                if (expandedPath !== path) {
                    message += `**Expands to**: ${expandedPath}\n`;
                }
                
                message += `\n📁 **Path Examples**:\n`;
                message += `• **Home directory**: \`~/Downloads/optimizely-backups\`\n`;
                message += `• **Absolute path**: \`/Users/yourname/Documents/backups\`\n`;
                message += `• **Project relative**: \`./backups\` or \`../shared-backups\`\n`;
                message += `• **Current directory**: \`.\`\n`;
                
                message += `\n💡 **All future database exports will be saved to this location**`;
                
                return ResponseBuilder.success(message);
            } else {
                return ResponseBuilder.error('Failed to set download path. Check the path is valid and writable.');
            }
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'set-download-path', args);
        }
    }
    
    /**
     * Reset all settings to defaults
     */
    static async resetSettings(args) {
        try {
            const success = await SettingsManager.resetSettings();
            
            if (success) {
                const display = await SettingsManager.displaySettings();
                
                let message = `✅ **Settings Reset to Defaults**\n\n`;
                message += display;
                
                return ResponseBuilder.success(message);
            } else {
                return ResponseBuilder.error('Failed to reset settings');
            }
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'reset-settings', args);
        }
    }
}

module.exports = SettingsTools;
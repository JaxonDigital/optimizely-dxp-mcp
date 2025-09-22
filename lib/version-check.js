/**
 * Version Check Module
 * Checks for updates and notifies users of new versions
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const https = require('https');
const packageJson = require('../package.json');

class VersionChecker {
    static async checkForUpdates() {
        try {
            const currentVersion = packageJson.version;
            const packageName = packageJson.name;
            
            // Check npm registry for latest version
            const latestVersion = await this.getLatestVersion(packageName);
            
            if (latestVersion && this.isNewerVersion(currentVersion, latestVersion)) {
                return {
                    updateAvailable: true,
                    currentVersion,
                    latestVersion,
                    updateCommand: `npm install -g ${packageName}@latest`
                };
            }
            
            return {
                updateAvailable: false,
                currentVersion
            };
        } catch (error) {
            // Silently fail - don't interrupt the user's workflow
            console.error('Version check failed:', error.message);
            return null;
        }
    }
    
    static getLatestVersion(packageName) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'registry.npmjs.org',
                path: `/${packageName}/latest`,
                method: 'GET',
                timeout: 3000 // 3 second timeout
            };
            
            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.version);
                    } catch (e) {
                        resolve(null);
                    }
                });
            });
            
            req.on('error', () => resolve(null));
            req.on('timeout', () => {
                req.abort();
                resolve(null);
            });
            
            req.end();
        });
    }
    
    static isNewerVersion(current, latest) {
        const currentParts = current.split('.').map(Number);
        const latestParts = latest.split('.').map(Number);
        
        for (let i = 0; i < 3; i++) {
            if (latestParts[i] > currentParts[i]) return true;
            if (latestParts[i] < currentParts[i]) return false;
        }
        
        return false;
    }
    
    static formatUpdateNotification(updateInfo) {
        if (!updateInfo || !updateInfo.updateAvailable) return null;
        
        let notification = `
╔════════════════════════════════════════════════════════════╗
║                    🎉 UPDATE AVAILABLE!                     ║
║                                                              ║
║  Current Version: v${updateInfo.currentVersion.padEnd(10)}                      ║
║  Latest Version:  v${updateInfo.latestVersion.padEnd(10)} ✨                   ║
║                                                              ║
║  🔧 New Features: Azure DevOps, Large Files, Performance    ║
║                                                              ║`;

        notification += `
║  Update with:                                               ║
║  ${updateInfo.updateCommand.padEnd(58)} ║
║                                                              ║
╚════════════════════════════════════════════════════════════╝
`;
        return notification;
    }
    
    static parseVersion(version) {
        const parts = version.split('.').map(Number);
        return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
    }
    
    static async getInlineUpdateWarning() {
        try {
            const updateInfo = await this.checkForUpdates();
            if (!updateInfo || !updateInfo.updateAvailable) return null;
            
            // Show updates occasionally (30% chance) to avoid being annoying
            if (Math.random() < 0.3) {
                return `✨ **New version available**: v${updateInfo.latestVersion} with Azure DevOps integration & improvements. Update: \`npm install -g ${updateInfo.updateCommand.split(' ').pop()}\``;
            }
            
            return null;
        } catch (error) {
            return null; // Silently fail
        }
    }
}

module.exports = VersionChecker;
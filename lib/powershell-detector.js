/**
 * PowerShell Detector Module
 * Detects available PowerShell installations across platforms
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { execSync, spawnSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const OutputLogger = require('./output-logger');

class PowerShellDetector {
    constructor() {
        this.detectedCommand = null;
        this.detectedVersion = null;
        this.detectedPath = null;
        this.platform = os.platform();
        this.isWindows = this.platform === 'win32';
        this.isMac = this.platform === 'darwin';
        this.isLinux = this.platform === 'linux';
    }

    /**
     * Get the PowerShell command to use
     * Caches the result after first detection
     */
    async getCommand() {
        // Return cached result if available
        if (this.detectedCommand) {
            return this.detectedCommand;
        }

        // Try to detect PowerShell
        const result = await this.detect();
        if (result.command) {
            this.detectedCommand = result.command;
            this.detectedVersion = result.version;
            this.detectedPath = result.path;
            return result.command;
        }

        throw new Error('PowerShell not found. Please install PowerShell Core (pwsh) or Windows PowerShell 5.1+');
    }

    /**
     * Detect available PowerShell installations
     */
    async detect() {
        const candidates = this.getPowerShellCandidates();
        
        for (const candidate of candidates) {
            const result = this.testPowerShell(candidate);
            if (result.success) {
                OutputLogger.success(`PowerShell detected: ${candidate.name} (${result.version})`);
                
                // Save detection results
                this.detectedCommand = candidate.command;
                this.detectedVersion = result.version;
                this.detectedPath = result.path;
                
                return {
                    command: candidate.command,
                    version: result.version,
                    path: result.path,
                    name: candidate.name
                };
            }
        }

        return { command: null, version: null, path: null };
    }

    /**
     * Get list of PowerShell candidates to check
     */
    getPowerShellCandidates() {
        const candidates = [];

        // 1. PowerShell Core (cross-platform) - highest priority
        candidates.push({
            command: 'pwsh',
            name: 'PowerShell Core',
            priority: 1
        });

        // 2. Platform-specific PowerShell
        if (this.isWindows) {
            // Windows PowerShell 5.1+
            candidates.push({
                command: 'powershell',
                name: 'Windows PowerShell',
                priority: 2
            });

            // Try common installation paths
            const commonPaths = [
                'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
                'C:\\Program Files\\PowerShell\\6\\pwsh.exe',
                'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
            ];

            for (const psPath of commonPaths) {
                if (fs.existsSync(psPath)) {
                    candidates.push({
                        command: `"${psPath}"`,
                        name: `PowerShell at ${psPath}`,
                        priority: 3
                    });
                }
            }
        } else if (this.isMac) {
            // Check Homebrew installation
            const brewPaths = [
                '/usr/local/bin/pwsh',
                '/opt/homebrew/bin/pwsh',
                '/usr/local/microsoft/powershell/7/pwsh',
                '/usr/local/microsoft/powershell/6/pwsh'
            ];

            for (const psPath of brewPaths) {
                if (fs.existsSync(psPath)) {
                    candidates.push({
                        command: psPath,
                        name: `PowerShell at ${psPath}`,
                        priority: 3
                    });
                }
            }
        } else if (this.isLinux) {
            // Check common Linux paths
            const linuxPaths = [
                '/usr/bin/pwsh',
                '/usr/local/bin/pwsh',
                '/opt/microsoft/powershell/7/pwsh',
                '/opt/microsoft/powershell/6/pwsh',
                '/snap/bin/pwsh'
            ];

            for (const psPath of linuxPaths) {
                if (fs.existsSync(psPath)) {
                    candidates.push({
                        command: psPath,
                        name: `PowerShell at ${psPath}`,
                        priority: 3
                    });
                }
            }
        }

        // Sort by priority
        return candidates.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Test if a PowerShell candidate works
     */
    testPowerShell(candidate) {
        try {
            // Test command and get version using the standard PowerShell method
            // Use spawnSync to avoid shell expansion issues with $PSVersionTable
            const versionResult = spawnSync(candidate.command, [
                '-NoProfile',
                '-NonInteractive', 
                '-Command',
                '$PSVersionTable.PSVersion.ToString()'
            ], { 
                encoding: 'utf8',
                timeout: 5000,
                windowsHide: true
            });
            
            if (versionResult.error) {
                throw versionResult.error;
            }
            
            const version = versionResult.stdout.trim();

            // Test EpiCloud module availability using spawnSync for consistency
            const moduleResult = spawnSync(candidate.command, [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'if (Get-Module -ListAvailable -Name EpiCloud) { "installed" } else { "not-installed" }'
            ], {
                encoding: 'utf8',
                timeout: 5000,
                windowsHide: true
            });
            
            if (moduleResult.error) {
                throw moduleResult.error;
            }
            
            const moduleStatus = moduleResult.stdout.trim();

            // Get the actual path using spawnSync for consistency
            let psPath = candidate.command;
            try {
                const pathResult = spawnSync(candidate.command, [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `(Get-Command ${candidate.command} -ErrorAction SilentlyContinue).Path`
                ], {
                    encoding: 'utf8',
                    timeout: 5000,
                    windowsHide: true
                });
                
                if (!pathResult.error && pathResult.stdout.trim()) {
                    psPath = pathResult.stdout.trim();
                }
            } catch {
                // Use the candidate command if we can't get the path
            }

            // Check version requirements
            const versionParts = version.split('.');
            const major = parseInt(versionParts[0], 10);
            const minor = parseInt(versionParts[1], 10);

            // PowerShell Core 6+ or Windows PowerShell 5.1+
            const isValidVersion = major > 5 || (major === 5 && minor >= 1);

            if (!isValidVersion) {
                console.warn(`⚠️  ${candidate.name} version ${version} is too old. Need 5.1+`);
                return { success: false };
            }

            if (moduleStatus !== 'installed') {
                console.warn(`⚠️  EpiCloud module not installed for ${candidate.name}`);
                OutputLogger.info(`   To install: ${candidate.command} -Command "Install-Module -Name EpiCloud -Force -Scope CurrentUser"`);
            }

            return {
                success: true,
                version,
                path: psPath,
                epiCloudInstalled: moduleStatus === 'installed'
            };
        } catch (error) {
            // Command failed - PowerShell not available or not working
            if (process.env.DEBUG) {
                console.error(`   ❌ ${candidate.name} test failed:`, error.message);
            }
            return { success: false };
        }
    }

    /**
     * Install EpiCloud module if not present
     */
    async installEpiCloudModule() {
        const command = await this.getCommand();
        
        OutputLogger.progress('Installing EpiCloud PowerShell module...');
        
        try {
            const installCommand = `${command} -NoProfile -NonInteractive -Command 'Install-Module -Name EpiCloud -Force -Scope CurrentUser -AllowClobber -Repository PSGallery'`;
            
            execSync(installCommand, {
                encoding: 'utf8',
                timeout: 60000, // 1 minute timeout for installation
                stdio: 'inherit'
            });

            OutputLogger.success('EpiCloud module installed successfully');
            return true;
        } catch (error) {
            OutputLogger.error(`Failed to install EpiCloud module: ${error.message}`);
            OutputLogger.info('Please install manually with:');
            OutputLogger.info(`  ${command} -Command "Install-Module -Name EpiCloud -Force -Scope CurrentUser"`);
            return false;
        }
    }

    /**
     * Get detailed PowerShell information
     */
    async getInfo() {
        // If not already detected, try to detect
        if (!this.detectedCommand) {
            await this.detect();
        }
        
        return {
            platform: this.platform,
            command: this.detectedCommand,
            version: this.detectedVersion,
            path: this.detectedPath,
            recommendations: this.getRecommendations()
        };
    }

    /**
     * Get platform-specific recommendations
     */
    getRecommendations() {
        const recommendations = [];

        if (!this.detectedCommand) {
            if (this.isWindows) {
                recommendations.push(
                    'Install PowerShell Core: winget install Microsoft.PowerShell',
                    'Or use Windows PowerShell 5.1+ (built-in on Windows 10/11)'
                );
            } else if (this.isMac) {
                recommendations.push(
                    'Install via Homebrew: brew install --cask powershell',
                    'Or download from: https://github.com/PowerShell/PowerShell/releases'
                );
            } else if (this.isLinux) {
                recommendations.push(
                    'Install via package manager or download from:',
                    'https://docs.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux'
                );
            }
        }

        return recommendations;
    }
}

// Singleton instance
let detectorInstance = null;

/**
 * Get or create PowerShell detector instance
 */
function getPowerShellDetector() {
    if (!detectorInstance) {
        detectorInstance = new PowerShellDetector();
    }
    return detectorInstance;
}

module.exports = {
    PowerShellDetector,
    getPowerShellDetector
};
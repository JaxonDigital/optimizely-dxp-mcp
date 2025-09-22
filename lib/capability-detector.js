/**
 * Capability Detector - Detect client environment capabilities
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class CapabilityDetector {
    /**
     * Check if filesystem operations are available
     */
    static async checkFilesystemCapability() {
        try {
            // Test basic filesystem operations
            const testDir = path.join(os.tmpdir(), 'mcp-capability-test');
            const testFile = path.join(testDir, 'test.txt');
            
            // Test directory creation
            await fs.promises.mkdir(testDir, { recursive: true });
            
            // Test file writing
            await fs.promises.writeFile(testFile, 'test');
            
            // Test file reading
            const content = await fs.promises.readFile(testFile, 'utf8');
            
            // Test file deletion
            await fs.promises.unlink(testFile);
            await fs.promises.rmdir(testDir);
            
            return {
                available: true,
                canRead: true,
                canWrite: true,
                canCreateDirectories: true
            };
        } catch (error) {
            return {
                available: false,
                error: error.message,
                canRead: false,
                canWrite: false,
                canCreateDirectories: false
            };
        }
    }
    
    /**
     * Check if a specific directory is writable
     */
    static async checkDirectoryWriteable(dirPath) {
        try {
            // Resolve to absolute path
            const absolutePath = path.resolve(dirPath);
            
            // Check if directory exists or can be created
            await fs.promises.mkdir(absolutePath, { recursive: true });
            
            // Test write permissions
            const testFile = path.join(absolutePath, '.mcp-write-test');
            await fs.promises.writeFile(testFile, 'test');
            await fs.promises.unlink(testFile);
            
            return {
                writable: true,
                path: absolutePath,
                exists: true
            };
        } catch (error) {
            return {
                writable: false,
                path: path.resolve(dirPath),
                exists: false,
                error: error.message
            };
        }
    }
    
    /**
     * Check available disk space
     */
    static async checkDiskSpace(dirPath, requiredBytes = 0) {
        try {
            const stats = await fs.promises.statfs(dirPath);
            const availableBytes = stats.bavail * stats.bsize;
            const totalBytes = stats.blocks * stats.bsize;
            
            return {
                available: true,
                availableBytes,
                totalBytes,
                availableGB: Math.round(availableBytes / (1024 * 1024 * 1024) * 100) / 100,
                totalGB: Math.round(totalBytes / (1024 * 1024 * 1024) * 100) / 100,
                sufficient: requiredBytes === 0 || availableBytes >= requiredBytes
            };
        } catch (error) {
            // Fallback for platforms that don't support statfs
            return {
                available: false,
                error: error.message,
                note: 'Disk space checking not available on this platform'
            };
        }
    }
    
    /**
     * Check network connectivity to a URL
     */
    static async checkNetworkConnectivity(url) {
        return new Promise((resolve) => {
            const https = require('https');
            const http = require('http');
            
            const protocol = url.startsWith('https:') ? https : http;
            const urlObj = new URL(url);
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (protocol === https ? 443 : 80),
                path: urlObj.pathname,
                method: 'HEAD',
                timeout: 5000
            };
            
            const req = protocol.request(options, (res) => {
                resolve({
                    available: true,
                    statusCode: res.statusCode,
                    success: res.statusCode >= 200 && res.statusCode < 400
                });
            });
            
            req.on('error', (error) => {
                resolve({
                    available: false,
                    error: error.message
                });
            });
            
            req.on('timeout', () => {
                req.destroy();
                resolve({
                    available: false,
                    error: 'Connection timeout'
                });
            });
            
            req.end();
        });
    }
    
    /**
     * Comprehensive capability check for auto-download
     */
    static async checkAutoDownloadCapability(downloadPath = './backups', estimatedSizeBytes = 100 * 1024 * 1024) {
        const clientInfo = this.detectMCPClient();
        const capabilities = {
            client: clientInfo,
            filesystem: await this.checkFilesystemCapability(),
            directory: await this.checkDirectoryWriteable(downloadPath),
            diskSpace: await this.checkDiskSpace(downloadPath, estimatedSizeBytes),
            network: await this.checkNetworkConnectivity('https://httpbin.org/status/200')
        };
        
        // Claude Desktop cannot download files regardless of filesystem access
        const canAutoDownload = 
            clientInfo.supportsFileDownload &&
            capabilities.filesystem.available &&
            capabilities.directory.writable &&
            capabilities.diskSpace.sufficient &&
            capabilities.network.available;
        
        return {
            canAutoDownload,
            capabilities,
            issues: this.getCapabilityIssues(capabilities),
            recommendations: this.getCapabilityRecommendations(capabilities)
        };
    }
    
    /**
     * Get list of capability issues
     */
    static getCapabilityIssues(capabilities) {
        const issues = [];
        
        // Client type issues (highest priority)
        if (!capabilities.client.supportsFileDownload) {
            if (capabilities.client.isClaudeDesktop) {
                issues.push('Claude Desktop cannot download files (use Claude Code CLI or manual download)');
            } else {
                issues.push('Client environment does not support file downloads');
            }
        }
        
        if (!capabilities.filesystem.available) {
            issues.push('Filesystem operations not available');
        }
        
        if (!capabilities.directory.writable) {
            issues.push(`Cannot write to download directory: ${capabilities.directory.error}`);
        }
        
        if (!capabilities.diskSpace.sufficient) {
            if (capabilities.diskSpace.available) {
                issues.push(`Insufficient disk space (${capabilities.diskSpace.availableGB}GB available)`);
            } else {
                issues.push('Cannot determine disk space availability');
            }
        }
        
        if (!capabilities.network.available) {
            issues.push(`Network connectivity issue: ${capabilities.network.error}`);
        }
        
        return issues;
    }
    
    /**
     * Get capability improvement recommendations
     */
    static getCapabilityRecommendations(capabilities) {
        const recommendations = [];
        
        // Client-specific recommendations (highest priority)
        if (!capabilities.client.supportsFileDownload) {
            if (capabilities.client.isClaudeDesktop) {
                recommendations.push('Switch to Claude Code CLI: run `claude "export prod db"` in terminal');
                recommendations.push('Use backup status to get download URL for manual download');
                recommendations.push('Download directly from Optimizely DXP Portal');
            } else {
                recommendations.push('Use download URL instead of auto-download');
                recommendations.push('Check client environment file access permissions');
            }
        }
        
        if (!capabilities.filesystem.available) {
            recommendations.push('Use download URL instead of auto-download');
            recommendations.push('Check if running in containerized/restricted environment');
        }
        
        if (!capabilities.directory.writable) {
            recommendations.push('Try a different download directory (e.g., ~/Downloads)');
            recommendations.push('Check directory permissions');
        }
        
        if (!capabilities.diskSpace.sufficient && capabilities.diskSpace.available) {
            recommendations.push(`Free up disk space (need at least ${Math.round(capabilities.diskSpace.requiredGB)}GB)`);
        }
        
        if (!capabilities.network.available) {
            recommendations.push('Check network connection and proxy settings');
            recommendations.push('Use manual download from DXP portal instead');
        }
        
        return recommendations;
    }
    
    /**
     * Detect MCP client environment
     */
    static detectMCPClient() {
        // Check environment variables and process information
        const env = process.env;
        
        // Terminal/CLI indicators (check first)
        const isTerminal = !!(
            env.TERM ||
            env.SHELL ||
            process.stdout.isTTY ||
            process.stdin.isTTY
        );
        
        // Claude Desktop indicators - these are more specific and definitive
        const isClaudeDesktop = !!(
            env.CLAUDE_DESKTOP ||
            env.CLAUDE_MCP_SERVER ||
            // Claude Desktop runs MCPs as child processes with specific patterns
            (process.title?.includes('Claude') && !isTerminal) ||
            // Check parent process if available (and not from terminal)
            (process.ppid && this.getParentProcessName()?.toLowerCase().includes('claude') && !isTerminal)
        );
        
        // Claude Code CLI indicators - if we're in terminal and have Claude-specific indicators
        const isClaudeCode = !!(
            isTerminal && (
                env.CLAUDE_CLI ||
                env.CLAUDE_CODE ||
                // Claude Code often runs from terminal with specific working directories
                process.argv[0]?.includes('claude') ||
                process.argv0?.includes('claude') ||
                // Check if invoked via Claude Code CLI (common patterns)
                process.env.PWD?.includes('claude') ||
                process.env._?.includes('claude') ||
                // Check command line arguments for Claude Code patterns
                process.argv.some(arg => arg.includes('claude'))
            )
        );
        
        // Determine client type - prioritize based on most reliable indicators
        let clientType = 'unknown';
        if (isClaudeDesktop) {
            clientType = 'claude-desktop';
        } else if (isClaudeCode) {
            clientType = 'claude-code';
        } else if (isTerminal) {
            clientType = 'terminal';
        }
        
        // For file download support: Claude Desktop cannot download files, everything else can try
        // If we're NOT Claude Desktop and we have terminal indicators, assume we can download
        const supportsFileDownload = !isClaudeDesktop && isTerminal;
        
        return {
            clientType,
            isClaudeDesktop,
            isClaudeCode,
            isTerminal,
            hasGUI: isClaudeDesktop,
            hasFileSystemAccess: isClaudeCode || isTerminal,
            supportsFileDownload
        };
    }
    
    /**
     * Get parent process name (best effort)
     */
    static getParentProcessName() {
        try {
            if (process.platform === 'darwin' || process.platform === 'linux') {
                const { execSync } = require('child_process');
                const result = execSync(`ps -p ${process.ppid} -o comm=`, { encoding: 'utf8', timeout: 1000 });
                return result.trim();
            }
        } catch (error) {
            // Ignore errors - this is just a hint
        }
        return null;
    }

    /**
     * Get environment information for troubleshooting
     */
    static getEnvironmentInfo() {
        const clientInfo = this.detectMCPClient();
        
        return {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            workingDirectory: process.cwd(),
            homeDirectory: os.homedir(),
            tmpDirectory: os.tmpdir(),
            isContainer: this.isRunningInContainer(),
            hasWriteAccess: this.checkBasicWriteAccess(),
            client: clientInfo
        };
    }
    
    /**
     * Check if running in a container
     */
    static isRunningInContainer() {
        try {
            // Check for container indicators
            const cgroupExists = fs.existsSync('/proc/1/cgroup');
            const dockerEnv = fs.existsSync('/.dockerenv');
            const isContainer = process.env.CONTAINER || process.env.DOCKER;
            
            return cgroupExists || dockerEnv || !!isContainer;
        } catch {
            return false;
        }
    }
    
    /**
     * Basic write access check
     */
    static checkBasicWriteAccess() {
        try {
            const testFile = path.join(os.tmpdir(), `mcp-write-test-${Date.now()}`);
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * Generate user-friendly capability report
     */
    static async generateCapabilityReport(downloadPath = './backups') {
        const env = this.getEnvironmentInfo();
        const capabilities = await this.checkAutoDownloadCapability(downloadPath);
        
        let report = '🔍 **Auto-Download Capability Report**\n\n';
        
        // Client Environment
        report += '**Client Environment**:\n';
        report += `- Type: ${env.client.clientType === 'claude-desktop' ? '🖥️ Claude Desktop' : env.client.clientType === 'claude-code' ? '💻 Claude Code CLI' : env.client.clientType === 'terminal' ? '⌨️ Terminal' : '❓ Unknown'}\n`;
        report += `- File Download Support: ${env.client.supportsFileDownload ? '✅ Yes' : '❌ No'}\n`;
        report += `- Platform: ${env.platform} (${env.arch})\n`;
        report += `- Node.js: ${env.nodeVersion}\n`;
        report += `- Container: ${env.isContainer ? 'Yes' : 'No'}\n\n`;
        
        // Capability Status
        report += '**Capability Status**:\n';
        report += `- Auto-Download: ${capabilities.canAutoDownload ? '✅ Available' : '❌ Not Available'}\n`;
        report += `- Filesystem: ${capabilities.capabilities.filesystem.available ? '✅ Available' : '❌ Not Available'}\n`;
        report += `- Directory Write: ${capabilities.capabilities.directory.writable ? '✅ Available' : '❌ Not Available'}\n`;
        report += `- Disk Space: ${capabilities.capabilities.diskSpace.sufficient ? '✅ Sufficient' : '⚠️ Limited'}\n`;
        report += `- Network: ${capabilities.capabilities.network.available ? '✅ Available' : '❌ Not Available'}\n\n`;
        
        // Issues
        if (capabilities.issues.length > 0) {
            report += '**Issues Found**:\n';
            capabilities.issues.forEach(issue => {
                report += `- ❌ ${issue}\n`;
            });
            report += '\n';
        }
        
        // Recommendations
        if (capabilities.recommendations.length > 0) {
            report += '**Recommendations**:\n';
            capabilities.recommendations.forEach(rec => {
                report += `- 💡 ${rec}\n`;
            });
            report += '\n';
        }
        
        // Alternative Options
        if (!capabilities.canAutoDownload) {
            report += '**Alternative Options**:\n';
            report += '- 🌐 Use backup status tool to get download URL\n';
            report += '- 📱 Download manually from Optimizely DXP Portal\n';
            report += '- 🖥️ Run MCP from environment with filesystem access\n';
        }
        
        return {
            report,
            canAutoDownload: capabilities.canAutoDownload,
            capabilities: capabilities.capabilities
        };
    }
}

module.exports = CapabilityDetector;
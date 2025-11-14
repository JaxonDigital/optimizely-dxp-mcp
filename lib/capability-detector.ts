/**
 * Capability Detector - Detect client environment capabilities
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Type definitions
interface FilesystemCapability {
    available: boolean;
    canRead: boolean;
    canWrite: boolean;
    canCreateDirectories: boolean;
    error?: string;
}

interface DirectoryCheck {
    writable: boolean;
    path: string;
    exists: boolean;
    error?: string;
}

interface DiskSpaceInfo {
    available: boolean;
    availableBytes?: number;
    totalBytes?: number;
    availableGB?: number;
    totalGB?: number;
    sufficient?: boolean;
    error?: string;
    note?: string;
}

interface NetworkCheck {
    available: boolean;
    statusCode?: number;
    success?: boolean;
    error?: string;
    note?: string;
}

interface MCPClientInfo {
    clientType: string;
    isClaudeDesktop: boolean;
    isClaudeCode: boolean;
    isTerminal: boolean;
    hasGUI: boolean;
    hasFileSystemAccess: boolean;
    supportsFileDownload: boolean;
}

interface Capabilities {
    client: MCPClientInfo;
    filesystem: FilesystemCapability;
    directory: DirectoryCheck;
    diskSpace: DiskSpaceInfo;
    network: NetworkCheck;
}

interface AutoDownloadCapability {
    canAutoDownload: boolean;
    capabilities: Capabilities;
    issues: string[];
    recommendations: string[];
}

interface EnvironmentInfo {
    platform: NodeJS.Platform;
    arch: string;
    nodeVersion: string;
    workingDirectory: string;
    homeDirectory: string;
    tmpDirectory: string;
    isContainer: boolean;
    hasWriteAccess: boolean;
    client: MCPClientInfo;
}

interface CapabilityReport {
    report: string;
    canAutoDownload: boolean;
    capabilities: Capabilities;
}

class CapabilityDetector {
    /**
     * Check if filesystem operations are available
     */
    static async checkFilesystemCapability(): Promise<FilesystemCapability> {
        try {
            // Test basic filesystem operations
            const testDir = path.join(os.tmpdir(), 'mcp-capability-test');
            const testFile = path.join(testDir, 'test.txt');

            // Test directory creation
            await fs.promises.mkdir(testDir, { recursive: true });

            // Test file writing
            await fs.promises.writeFile(testFile, 'test');

            // Test file reading
            await fs.promises.readFile(testFile, 'utf8');

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
                error: (error as Error).message,
                canRead: false,
                canWrite: false,
                canCreateDirectories: false
            };
        }
    }

    /**
     * Check if a specific directory is writable
     */
    static async checkDirectoryWriteable(dirPath: string): Promise<DirectoryCheck> {
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
                error: (error as Error).message
            };
        }
    }

    /**
     * Check available disk space
     */
    static async checkDiskSpace(dirPath: string, requiredBytes: number = 0): Promise<DiskSpaceInfo> {
        try {
            const stats: any = await fs.promises.statfs(dirPath);
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
                error: (error as Error).message,
                note: 'Disk space checking not available on this platform'
            };
        }
    }

    /**
     * Check network connectivity to a URL
     */
    static async checkNetworkConnectivity(url: string): Promise<NetworkCheck> {
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

            const req = protocol.request(options, (res: any) => {
                resolve({
                    available: true,
                    statusCode: res.statusCode,
                    success: res.statusCode >= 200 && res.statusCode < 400
                });
            });

            req.on('error', (error: Error) => {
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
    static async checkAutoDownloadCapability(
        downloadPath: string = './backups',
        estimatedSizeBytes: number = 100 * 1024 * 1024
    ): Promise<AutoDownloadCapability> {
        const clientInfo = this.detectMCPClient();
        const capabilities: Capabilities = {
            client: clientInfo,
            filesystem: await this.checkFilesystemCapability(),
            directory: await this.checkDirectoryWriteable(downloadPath),
            diskSpace: await this.checkDiskSpace(downloadPath, estimatedSizeBytes),
            network: { available: true, note: 'Network check skipped - not required for MCP server downloads' }
        };

        // MCP servers running as Node.js processes always have filesystem access
        const canAutoDownload =
            capabilities.filesystem.available &&
            capabilities.directory.writable &&
            (capabilities.diskSpace.sufficient || false);

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
    static getCapabilityIssues(capabilities: Capabilities): string[] {
        const issues: string[] = [];

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

        return issues;
    }

    /**
     * Get capability improvement recommendations
     */
    static getCapabilityRecommendations(capabilities: Capabilities): string[] {
        const recommendations: string[] = [];

        if (!capabilities.filesystem.available) {
            recommendations.push('Check if running in containerized/restricted environment');
            recommendations.push('Verify Node.js has filesystem permissions');
        }

        if (!capabilities.directory.writable) {
            recommendations.push('Try a different download directory (e.g., ~/Downloads)');
            recommendations.push('Check directory permissions');
        }

        if (!capabilities.diskSpace.sufficient && capabilities.diskSpace.available) {
            const requiredGB = capabilities.diskSpace.availableGB || 0;
            recommendations.push(`Free up disk space (need at least ${Math.round(requiredGB)}GB)`);
        }

        return recommendations;
    }

    /**
     * Detect MCP client environment
     */
    static detectMCPClient(): MCPClientInfo {
        // Check environment variables and process information
        const env = process.env;

        // Terminal/CLI indicators (check first)
        const isTerminal = !!(
            env.TERM ||
            env.SHELL ||
            process.stdout.isTTY ||
            process.stdin.isTTY
        );

        // Claude Desktop indicators
        const isClaudeDesktop = !!(
            env.CLAUDE_DESKTOP ||
            env.CLAUDE_MCP_SERVER ||
            (process.title?.includes('Claude') && !isTerminal) ||
            (process.ppid && this.getParentProcessName()?.toLowerCase().includes('claude') && !isTerminal)
        );

        // Claude Code CLI indicators
        const isClaudeCode = !!(
            isTerminal && (
                env.CLAUDE_CLI ||
                env.CLAUDE_CODE ||
                process.argv[0]?.includes('claude') ||
                process.argv0?.includes('claude') ||
                process.env.PWD?.includes('claude') ||
                process.env._?.includes('claude') ||
                process.argv.some(arg => arg.includes('claude'))
            )
        );

        // Determine client type
        let clientType = 'unknown';
        if (isClaudeDesktop) {
            clientType = 'claude-desktop';
        } else if (isClaudeCode) {
            clientType = 'claude-code';
        } else if (isTerminal) {
            clientType = 'terminal';
        }

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
    static getParentProcessName(): string | null {
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
    static getEnvironmentInfo(): EnvironmentInfo {
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
    static isRunningInContainer(): boolean {
        try {
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
    static checkBasicWriteAccess(): boolean {
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
    static async generateCapabilityReport(downloadPath: string = './backups'): Promise<CapabilityReport> {
        const env = this.getEnvironmentInfo();
        const capabilities = await this.checkAutoDownloadCapability(downloadPath);

        let report = '🔍 **Auto-Download Capability Report**\n\n';

        // Client Environment
        report += '**Client Environment**:\n';
        report += `- Type: ${env.client.clientType === 'claude-desktop' ? '🖥️ Claude Desktop' : env.client.clientType === 'claude-code' ? '💻 Claude Code CLI' : env.client.clientType === 'terminal' ? '⌨️ Terminal' : '❓ Unknown'}\n`;
        report += `- MCP Server: ✅ Has filesystem access\n`;
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
        if (!capabilities.canAutoDownload && capabilities.issues.length > 0) {
            report += '**Alternative Options**:\n';
            report += '- 🌐 Use backup status tool to get download URL\n';
            report += '- 📱 Download manually from Optimizely DXP Portal\n';
        }

        return {
            report,
            canAutoDownload: capabilities.canAutoDownload,
            capabilities: capabilities.capabilities
        };
    }
}

export default CapabilityDetector;

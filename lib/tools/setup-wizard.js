/**
 * Setup Wizard Tool
 * Interactive configuration guide for first-time users
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const PowerShellHelper = require('../powershell-helper');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const { getPowerShellDetector } = require('../powershell-detector');
const fs = require('fs');
const path = require('path');
const os = require('os');

class SetupWizard {
    /**
     * Run the setup wizard
     * @param {Object} params - Optional parameters
     * @returns {Promise<Object>} Setup status and recommendations
     */
    static async runSetupWizard(params = {}) {
        const { skipChecks = false, autoFix = false } = params;
        
        let report = [];
        let issues = [];
        let recommendations = [];
        let readyToUse = true;
        
        report.push('🧙 **Optimizely DXP MCP Setup Wizard**\n');
        report.push('Let me check your environment and help you get started...\n');
        
        // 1. Check PowerShell installation
        report.push('### 1️⃣ PowerShell Check');
        const psCheck = await this.checkPowerShell();
        report.push(psCheck.message);
        if (!psCheck.success) {
            readyToUse = false;
            issues.push('PowerShell not found');
            recommendations.push(...psCheck.recommendations);
        }
        report.push('');
        
        // 2. Check EpiCloud module
        if (psCheck.success) {
            report.push('### 2️⃣ EpiCloud Module Check');
            const moduleCheck = await this.checkEpiCloudModule();
            report.push(moduleCheck.message);
            if (!moduleCheck.success) {
                if (autoFix) {
                    report.push('📦 Installing EpiCloud module automatically...');
                    const installed = await this.installEpiCloudModule();
                    if (installed) {
                        report.push('✅ EpiCloud module installed successfully!');
                    } else {
                        readyToUse = false;
                        issues.push('EpiCloud module not installed');
                        recommendations.push(moduleCheck.recommendations);
                    }
                } else {
                    readyToUse = false;
                    issues.push('EpiCloud module not installed');
                    recommendations.push(moduleCheck.recommendations);
                }
            }
            report.push('');
        }
        
        // 3. Check API credentials
        report.push('### 3️⃣ API Credentials Check');
        const credCheck = await this.checkCredentials();
        report.push(credCheck.message);
        if (!credCheck.success) {
            readyToUse = false;
            issues.push('API credentials not configured');
            recommendations.push(...credCheck.recommendations);
        }
        report.push('');
        
        // 4. Test connection (if everything else is good)
        if (readyToUse && !skipChecks) {
            report.push('### 4️⃣ Connection Test');
            const connTest = await this.testConnection();
            report.push(connTest.message);
            if (!connTest.success) {
                readyToUse = false;
                issues.push('Could not connect to Optimizely DXP');
                recommendations.push(...connTest.recommendations);
            }
            report.push('');
        }
        
        // 5. Generate configuration template if needed
        if (!credCheck.success) {
            report.push('### 📝 Configuration Template\n');
            report.push('Here\'s a template for your Claude Desktop configuration:\n');
            report.push('```json');
            report.push(JSON.stringify({
                "mcpServers": {
                    "jaxon-optimizely-dxp": {
                        "command": "jaxon-optimizely-dxp-mcp",
                        "env": {
                            "YOUR_PROJECT_NAME": "id=<your-project-id>;key=<your-api-key>;secret=<your-api-secret>;default=true"
                        }
                    }
                }
            }, null, 2));
            report.push('```\n');
            report.push('**Where to find your credentials:**');
            report.push('1. Log in to https://portal.optimizely.com');
            report.push('2. Go to DXP > Settings > API');
            report.push('3. Create or copy your API credentials\n');
        }
        
        // Summary
        report.push('---\n');
        if (readyToUse) {
            report.push('### ✅ Setup Complete!\n');
            report.push('Your MCP is ready to use. You can now:');
            report.push('- List deployments: `list_deployments`');
            report.push('- Check project info: `get_api_key_info`');
            report.push('- Start deployments: `start_deployment`');
            report.push('- And much more!\n');
            report.push('Run `get_support` for documentation and help.');
        } else {
            report.push('### ⚠️ Setup Incomplete\n');
            report.push(`**Issues found (${issues.length}):**`);
            issues.forEach(issue => report.push(`- ❌ ${issue}`));
            report.push('\n**Next steps:**');
            recommendations.forEach((rec, i) => report.push(`${i + 1}. ${rec}`));
            report.push('\nRun this wizard again after fixing the issues.');
        }
        
        return ResponseBuilder.success(report.join('\n'));
    }
    
    /**
     * Check PowerShell installation
     */
    static async checkPowerShell() {
        try {
            const detector = getPowerShellDetector();
            const info = await detector.getInfo();
            
            if (info.command) {
                return {
                    success: true,
                    message: `✅ PowerShell found: ${info.command} (v${info.version})`,
                    details: info
                };
            } else {
                return {
                    success: false,
                    message: '❌ PowerShell not found',
                    recommendations: info.recommendations || [
                        'Install PowerShell Core: https://github.com/PowerShell/PowerShell',
                        'Windows: winget install Microsoft.PowerShell',
                        'macOS: brew install --cask powershell',
                        'Linux: See https://docs.microsoft.com/powershell/scripting/install/installing-powershell-on-linux'
                    ]
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `❌ PowerShell check failed: ${error.message}`,
                recommendations: ['Install PowerShell to continue']
            };
        }
    }
    
    /**
     * Check EpiCloud module installation
     */
    static async checkEpiCloudModule() {
        try {
            const result = await PowerShellHelper.executeRawCommand(
                'if (Get-Module -ListAvailable -Name EpiCloud) { "installed" } else { "not-installed" }'
            );
            
            if (result.stdout && result.stdout.includes('installed')) {
                // Get module version
                const versionResult = await PowerShellHelper.executeRawCommand(
                    '(Get-Module -ListAvailable -Name EpiCloud).Version.ToString()'
                );
                const version = versionResult.stdout ? versionResult.stdout.trim() : 'unknown';
                
                return {
                    success: true,
                    message: `✅ EpiCloud module installed (v${version})`
                };
            } else {
                return {
                    success: false,
                    message: '❌ EpiCloud module not installed',
                    recommendations: 'Run: Install-Module -Name EpiCloud -Force -Scope CurrentUser'
                };
            }
        } catch (error) {
            return {
                success: false,
                message: '❌ Could not check EpiCloud module',
                recommendations: 'Install EpiCloud: Install-Module -Name EpiCloud -Force'
            };
        }
    }
    
    /**
     * Install EpiCloud module
     */
    static async installEpiCloudModule() {
        try {
            const detector = getPowerShellDetector();
            return await detector.installEpiCloudModule();
        } catch (error) {
            console.error('Failed to install EpiCloud:', error);
            return false;
        }
    }
    
    /**
     * Check API credentials configuration
     */
    static async checkCredentials() {
        // Check environment variables
        const envVars = Object.keys(process.env).filter(key => 
            key.startsWith('OPTIMIZELY_') && 
            !key.includes('TELEMETRY')
        );
        
        if (envVars.length === 0) {
            return {
                success: false,
                message: '❌ No API credentials configured',
                recommendations: [
                    'Add credentials to your Claude Desktop configuration',
                    'Or set environment variables OPTIMIZELY_API_KEY_<PROJECT>',
                    'See the configuration template below'
                ]
            };
        }
        
        // Parse and validate credentials
        let validConfigs = [];
        let invalidConfigs = [];
        
        for (const envVar of envVars) {
            const value = process.env[envVar];
            
            // Parse the configuration
            const params = {};
            value.split(';').forEach(param => {
                const [key, val] = param.split('=');
                if (key && val) {
                    params[key.trim()] = val.trim();
                }
            });
            
            // Validate required fields
            if (params.id && params.key && params.secret) {
                validConfigs.push({
                    name: envVar.replace('OPTIMIZELY_API_KEY_', '').replace('OPTIMIZELY_PROJECT_', ''),
                    projectId: params.id,
                    isDefault: params.default === 'true'
                });
            } else {
                invalidConfigs.push(envVar);
            }
        }
        
        if (validConfigs.length === 0) {
            return {
                success: false,
                message: `❌ No valid credentials found (${invalidConfigs.length} invalid)`,
                recommendations: [
                    'Check your credential format: id=<uuid>;key=<key>;secret=<secret>',
                    'Ensure all required fields are present'
                ]
            };
        }
        
        let message = `✅ Found ${validConfigs.length} configured project(s):\n`;
        validConfigs.forEach(config => {
            message += `   • ${config.name} (${config.projectId.substring(0, 8)}...)`;
            if (config.isDefault) message += ' [DEFAULT]';
            message += '\n';
        });
        
        if (invalidConfigs.length > 0) {
            message += `   ⚠️ ${invalidConfigs.length} invalid configuration(s) ignored`;
        }
        
        return {
            success: true,
            message: message.trim(),
            configs: validConfigs
        };
    }
    
    /**
     * Test connection to Optimizely DXP
     */
    static async testConnection() {
        try {
            // Try to get project info for the default project
            const ProjectTools = require('./project-tools');
            const projects = ProjectTools.getConfiguredProjects();
            
            if (projects.length === 0) {
                return {
                    success: false,
                    message: '❌ No projects configured',
                    recommendations: ['Configure at least one project with API credentials']
                };
            }
            
            // Test the first/default project
            const testProject = projects.find(p => p.isDefault) || projects[0];
            
            const result = await PowerShellHelper.executeEpiCommand(
                'Get-EpiDeployment | Select-Object -First 1',
                {
                    apiKey: testProject.apiKey,
                    apiSecret: testProject.apiSecret,
                    projectId: testProject.id
                },
                { parseJson: true, timeout: 30000 }
            );
            
            if (result.success) {
                return {
                    success: true,
                    message: `✅ Successfully connected to Optimizely DXP (Project: ${testProject.name})`
                };
            } else {
                const errorMsg = result.stderr || 'Unknown error';
                return {
                    success: false,
                    message: `❌ Connection failed: ${errorMsg}`,
                    recommendations: [
                        'Verify your API credentials are correct',
                        'Check that you have internet connectivity',
                        'Ensure the project exists and you have access'
                    ]
                };
            }
        } catch (error) {
            return {
                success: false,
                message: `❌ Connection test failed: ${error.message}`,
                recommendations: [
                    'Check your internet connection',
                    'Verify API credentials',
                    'Try running test_connection for more details'
                ]
            };
        }
    }
}

module.exports = SetupWizard;
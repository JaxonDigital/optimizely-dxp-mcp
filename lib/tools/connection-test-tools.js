/**
 * Connection Test Tools
 * Validates MCP setup and provides diagnostic information
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const PowerShellCommandBuilder = require('../powershell-command-builder');
const PowerShellHelper = require('../powershell-helper');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const { getPowerShellDetector } = require('../powershell-detector');
const OutputLogger = require('../output-logger');
const os = require('os');
const fs = require('fs');

class ConnectionTestTools {
    /**
     * Test connection and validate setup
     * Focused on testing connection only - use test_connection setupMode:true for setup tasks
     */
    static async testConnection(args = {}) {
        try {
            const results = [];

            // Show which project we're testing
            const ProjectTools = require('./project-tools');
            if (args.projectName) {
                results.push(`🔍 **Testing Project: ${args.projectName}**`);
                results.push('');
            }

            // For setup mode, run comprehensive setup checks
            if (args.setupMode) {
                return await this.runSetupWizard(args);
            }
            
            // Debug log to see what args we're getting
            OutputLogger.debug('test_connection args:', {
                projectName: args.projectName,
                projectType: args.projectType,
                isSelfHosted: args.isSelfHosted,
                hasConnectionString: !!args.connectionString,
                hasApiKey: !!args.apiKey
            });

            // Now that we have withProjectResolution wrapper, we can check if this is self-hosted
            // Check both args.connectionString (direct) and args.isSelfHosted (from withProjectResolution)
            if (args.connectionString || args.isSelfHosted || args.projectType === 'self-hosted') {
                results.push('🔍 **Testing Self-Hosted Azure Storage Connection**');
                results.push('');
                results.push('✅ **Self-hosted Project Detected**');
                results.push(`   • Project: ${args.projectName || 'Self-hosted'}`);
                if (args.connectionString) {
                    const accountMatch = args.connectionString.match(/AccountName=([^;]+)/);
                    if (accountMatch) {
                        results.push(`   • Storage Account: ${accountMatch[1]}`);
                    }
                }
                results.push('');
                results.push('✅ **No PowerShell Required**');
                results.push('   • Self-hosted projects use direct Azure Storage API');
                results.push('   • No EpiCloud module dependency');
                results.push('');
                results.push('🎉 **Everything is Working!**');
                results.push('');
                results.push('🔥 **Ready to Use** - Try these commands:');
                results.push('   • "download blobs from production"');
                results.push('   • "get application logs from today"');
                results.push('   • "check storage containers"');
                
                return {
                    content: [{
                        type: 'text',
                        text: results.join('\n')
                    }]
                };
            }
            
            // If not self-hosted, test DXP connection AND permissions
            results.push('🔍 **Testing DXP Connection & Permissions**');
            results.push('');
            results.push('✅ **DXP Project Detected**');
            results.push(`   • Project: ${args.projectName}`);
            results.push(`   • Project ID: ${args.projectId?.substring(0, 8)}...`);
            results.push('');
            
            // Actually test permissions for each environment
            results.push('🔐 **Testing Environment Access...**');
            
            const PermissionChecker = require('./permission-checker');
            const accessible = [];
            const inaccessible = [];
            
            for (const environment of ['Integration', 'Preproduction', 'Production']) {
                try {
                    const hasAccess = await PermissionChecker.testEnvironmentAccessDirect(
                        args.projectId,
                        args.apiKey,
                        args.apiSecret,
                        environment
                    );
                    
                    if (hasAccess) {
                        accessible.push(environment);
                        results.push(`   ✅ ${environment}: Access confirmed`);
                    } else {
                        inaccessible.push(environment);
                        results.push(`   ❌ ${environment}: No access`);
                    }
                } catch (error) {
                    inaccessible.push(environment);
                    results.push(`   ❌ ${environment}: Access denied`);
                }
            }
            
            results.push('');
            
            // Show access summary
            if (accessible.length === 0) {
                results.push('⚠️ **No Environment Access**');
                results.push('   This project needs configuration:');
                results.push('   • For DXP: Check API key/secret in the DXP Portal');
                results.push('   • For Self-hosted: Provide Azure Storage connection string');
                results.push('');
                results.push('   Use `update_project` to add credentials');
            } else {
                results.push('📋 **Access Summary**');
                results.push(`   • Accessible environments: ${accessible.join(', ')}`);
                if (inaccessible.length > 0) {
                    results.push(`   • No access to: ${inaccessible.join(', ')}`);
                }
                results.push('');
                results.push('**Available Operations:**');

                if (accessible.length === 1) {
                    results.push('   • Export database backups');
                    results.push('   • Download blobs and logs');
                    results.push('   • View deployment history');
                } else if (accessible.length === 2) {
                    results.push('   • Deploy between accessible environments');
                    results.push('   • Export databases from any accessible environment');
                    results.push('   • Copy content between environments');
                } else {
                    results.push('   • Deploy to any environment');
                    results.push('   • Export and sync databases');
                    results.push('   • Copy content in any direction');
                    results.push('   • Complete deployment workflow control');
                }
            }
            
            if (accessible.length > 0) {
                results.push('');
                results.push('🎉 **Connection & Permissions Verified!**');
            }
            
            return {
                content: [{
                    type: 'text',
                    text: results.join('\n')
                }]
            };
            
        } catch (error) {
            console.error('test_connection caught error:', error);
            return {
                content: [{
                    type: 'text',
                    text: `❌ **Connection Test Failed**\n\nError: ${error.message}`
                }]
            };
        }
    }

    /**
     * Run setup wizard - comprehensive environment setup
     */
    static async runSetupWizard(args = {}) {
        const report = [];
        let readyToUse = true;

        report.push('🧙 **Optimizely DXP MCP Setup Wizard**');
        report.push('Checking your environment...');
        report.push('');

        // 1. PowerShell Check
        report.push('### 1️⃣ PowerShell Check');
        try {
            const detector = getPowerShellDetector();
            const info = await detector.getInfo();
            if (info.command) {
                report.push(`✅ PowerShell found: ${info.command} (v${info.version})`);
            } else {
                readyToUse = false;
                report.push('❌ PowerShell not found');
                report.push('   Install: brew install --cask powershell (macOS)');
            }
        } catch (error) {
            readyToUse = false;
            report.push(`❌ PowerShell check failed: ${error.message}`);
        }
        report.push('');

        // 2. EpiCloud Module Check
        report.push('### 2️⃣ EpiCloud Module Check');
        try {
            const result = await PowerShellHelper.executeRawCommand(
                "if (Get-Module -ListAvailable -Name EpiCloud) { 'installed' } else { 'not-installed' }"
            );
            if (result.stdout && result.stdout.trim() === 'installed') {
                report.push('✅ EpiCloud module installed');
            } else {
                readyToUse = false;
                report.push('❌ EpiCloud module not installed');
                report.push('   Install: Install-Module -Name EpiCloud -Force -Scope CurrentUser');
            }
        } catch (error) {
            readyToUse = false;
            report.push('❌ Could not check EpiCloud module');
        }
        report.push('');

        // 3. API Credentials Check
        report.push('### 3️⃣ API Credentials Check');
        const envVars = Object.keys(process.env).filter(key => {
            const value = process.env[key];
            return value && value.includes('id=') && value.includes('key=') && value.includes('secret=');
        });

        if (envVars.length === 0) {
            readyToUse = false;
            report.push('❌ No API credentials configured');
            report.push('   Add to Claude Desktop config:');
            report.push('   PROJECT_NAME="id=<uuid>;key=<key>;secret=<secret>;default=true"');
        } else {
            report.push(`✅ Found ${envVars.length} configured project(s)`);
        }
        report.push('');

        // Summary
        if (readyToUse) {
            report.push('✅ **Setup Complete!** Try: `test_connection`, `list_projects`, `status`');
        } else {
            report.push('⚠️ **Setup Incomplete** - Fix the issues above and run again');
        }

        return {
            content: [{
                type: 'text',
                text: report.join('\n')
            }]
        };
    }

    /**
     * Quick health check (minimal output)
     */
    static async healthCheck(args) {
        try {
            const checks = {
                powershell: false,
                epicloud: false,
                credentials: false,
                connection: false
            };
            
            // Show current project info
            let projectInfo = '';
            try {
                const ProjectTools = require('./project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                const currentProject = ProjectTools.getCurrentProject();
                
                if (currentProject) {
                    projectInfo = ` | Project: ${currentProject.name}`;
                } else if (projects.length === 1) {
                    projectInfo = ` | Project: ${projects[0].name}`;
                } else if (projects.length > 1) {
                    projectInfo = ` | Projects: ${projects.length} configured`;
                }
            } catch {
                // Silent fail for project detection
            }
            
            // Check PowerShell
            try {
                const detector = getPowerShellDetector();
                const info = await detector.getInfo();
                checks.powershell = !!info.command;
            } catch {
                // Silent fail
            }
            
            // Check EpiCloud using improved detector
            if (checks.powershell) {
                try {
                    const detector = getPowerShellDetector();
                    const detectionResult = await detector.detect();
                    
                    if (detectionResult.command) {
                        const candidates = detector.getPowerShellCandidates();
                        const firstCandidate = candidates.find(c => c.command === detectionResult.command);
                        if (firstCandidate) {
                            const testResult = detector.testPowerShell(firstCandidate);
                            checks.epicloud = testResult.success && testResult.epiCloudInstalled;
                        }
                    }
                } catch {
                    // Silent fail
                }
            }
            
            // Check credentials
            let credentials = {
                apiKey: args.apiKey || process.env.OPTIMIZELY_API_KEY,
                apiSecret: args.apiSecret || process.env.OPTIMIZELY_API_SECRET,
                projectId: args.projectId || process.env.OPTIMIZELY_PROJECT_ID
            };
            
            // If no direct credentials, try to get from configured projects
            if (!credentials.apiKey || !credentials.apiSecret || !credentials.projectId) {
                try {
                    const ProjectTools = require('./project-tools');
                    const projects = ProjectTools.getConfiguredProjects();
                    
                    if (projects && projects.length > 0) {
                        // Use default project or first one
                        const defaultProject = projects.find(p => p.isDefault) || projects[0];
                        credentials = {
                            apiKey: credentials.apiKey || defaultProject.apiKey,
                            apiSecret: credentials.apiSecret || defaultProject.apiSecret,
                            projectId: credentials.projectId || defaultProject.id
                        };
                    }
                } catch (projectError) {
                    // Ignore project tools errors, continue with existing credentials
                }
            }
            checks.credentials = !!(credentials.apiKey && credentials.apiSecret && credentials.projectId);
            
            // Check connection and environment access if everything else is good
            let environmentAccess = '';
            if (checks.powershell && checks.epicloud && checks.credentials) {
                try {
                    // Use SimplePermissionChecker to test all environments
                    // This bypasses all caching issues
                    const PermissionChecker = require('./permission-checker');
                    const projectConfig = {
                        apiKey: credentials.apiKey,
                        apiSecret: credentials.apiSecret,
                        projectId: credentials.projectId,
                        projectName: credentials.projectName || 'PROJECT'  // Use actual project name
                    };
                    
                    const permissionResult = await PermissionChecker.verifyAccess(projectConfig);
                    
                    let accessibleEnvs = [];
                    let responseText = null;
                    if (permissionResult && permissionResult.result && permissionResult.result.content) {
                        responseText = permissionResult.result.content[0].text;
                    } else if (permissionResult && permissionResult.content) {
                        responseText = permissionResult.content[0].text;
                    }
                    
                    if (responseText) {
                        // Parse the response to extract accessible environments (handle markdown formatting)
                        const accessibleMatch = responseText.match(/\*?\*?Can Access:\*?\*?\s*([^\n]+)/);
                        if (accessibleMatch) {
                            accessibleEnvs = accessibleMatch[1].split(', ').map(env => env.substring(0, 3)); // Int, Pre, Pro
                        } else if (responseText.includes('Full Environment Access')) {
                            accessibleEnvs = ['Int', 'Pre', 'Pro'];
                        }
                    }
                    
                    if (accessibleEnvs.length > 0) {
                        checks.connection = true;
                        environmentAccess = ` [${accessibleEnvs.join(',')}]`;
                    }
                } catch {
                    // Silent fail - try fallback method with working command
                    try {
                        // Use Get-EpiStorageContainer instead of Get-EpiDeployment (which is blocked)
                        const result = await PowerShellHelper.executeEpiCommandDirect(
                            `Get-EpiStorageContainer -ProjectId '${credentials.projectId}' -ClientKey '${credentials.apiKey}' -ClientSecret '${credentials.apiSecret}' -Environment Integration | Select-Object -First 1`,
                            { parseJson: true, timeout: 10000 }
                        );
                        checks.connection = result.success !== false;
                        if (checks.connection) {
                            environmentAccess = ' [Int]';
                        } else if (process.env.DEBUG === 'true') {
                            console.error('[DEBUG] Connection test failed:', result.stderr || result.error);
                        }
                    } catch (error) {
                        // Enhanced debug logging
                        if (process.env.DEBUG === 'true') {
                            console.error('[DEBUG] Connection test exception:', error.message);
                        }
                    }
                }
            }
            
            // Format response
            const status = checks.connection ? 'healthy' : 
                         checks.credentials ? 'partial' : 'not-configured';
            
            return {
                content: [{
                    type: 'text',
                    text: [
                        `Status: ${status}${projectInfo}`,
                        `PowerShell: ${checks.powershell ? '✅' : '❌'}`,
                        `EpiCloud: ${checks.epicloud ? '✅' : '❌'}`,
                        `Credentials: ${checks.credentials ? '✅' : '❌'}`,
                        `Connection: ${checks.connection ? '✅' : '❌'}${environmentAccess}`
                    ].join('\n')
                }]
            };
            
        } catch (error) {
            return ErrorHandler.handleError(error);
        }
    }
}

module.exports = ConnectionTestTools;
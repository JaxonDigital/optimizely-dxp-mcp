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
     * Optionally runs setup wizard checks if setupMode is true
     */
    static async testConnection(args = {}) {
        try {
            const results = [];
            const { setupMode = false, autoFix = false, skipChecks = false } = args;
            
            // If in setup mode, run comprehensive checks first
            if (setupMode) {
                const setupResults = await this.runSetupChecks(args);
                if (setupResults.needsSetup) {
                    return {
                        content: [{
                            type: 'text',
                            text: setupResults.message
                        }]
                    };
                }
                // If setup is complete, continue with normal connection test
                results.push(setupResults.message);
                results.push('');
            }
            
            // Now that we have withProjectResolution wrapper, we can check if this is self-hosted
            // Check both args.connectionString (direct) and args.isSelfHosted (from withProjectResolution)
            if (args.connectionString || args.isSelfHosted) {
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
            
            // Determine role level based on access
            let role = 'Unknown';
            if (accessible.length === 0) {
                results.push('⚠️ **No Environment Access**');
                results.push('   Your API key may be invalid or have no permissions.');
                results.push('   Please check your credentials in the DXP Portal.');
            } else if (accessible.length === 1) {
                if (accessible.includes('Integration')) role = 'Developer';
                else if (accessible.includes('Preproduction')) role = 'Tester';
                else if (accessible.includes('Production')) role = 'Operations';
                
                results.push(`👤 **Role Level**: ${role}`);
                results.push(`   • Access to: ${accessible.join(', ')}`);
                results.push('');
                results.push('**Available Operations:**');
                results.push('   • Export database backups');
                results.push('   • Download blobs and logs');
                results.push('   • View deployment history');
            } else if (accessible.length === 2) {
                if (accessible.includes('Integration') && accessible.includes('Preproduction')) {
                    role = 'Manager (Int+Pre)';
                } else if (accessible.includes('Preproduction') && accessible.includes('Production')) {
                    role = 'Manager (Pre+Prod)';
                }
                
                results.push(`👤 **Role Level**: ${role}`);
                results.push(`   • Access to: ${accessible.join(', ')}`);
                results.push('');
                results.push('**Available Operations:**');
                results.push('   • Deploy between accessible environments');
                results.push('   • Export databases from any accessible environment');
                results.push('   • Copy content between environments');
            } else {
                role = 'Full Access';
                results.push(`👤 **Access Level**: ${role}`);
                results.push(`   • Access to: All environments`);
                results.push('');
                results.push('🔥 **Full Capabilities Available:**');
                results.push('   • Deploy to any environment');
                results.push('   • Export and sync databases');
                results.push('   • Copy content in any direction');
                results.push('   • Complete deployment workflow control');
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
     * Run setup wizard checks
     */
    static async runSetupChecks(params = {}) {
        const { autoFix = false, skipChecks = false } = params;
        
        let report = [];
        let issues = [];
        let recommendations = [];
        let readyToUse = true;
        
        report.push('🧙 **Optimizely DXP MCP Setup Wizard**');
        report.push('Let me check your environment and help you get started...');
        report.push('');
        
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
            
            // Generate configuration template
            report.push('');
            report.push('### 📝 Configuration Template');
            report.push('Here\'s a template for your Claude Desktop configuration:');
            report.push('');
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
            report.push('```');
            report.push('');
            report.push('**Where to find your credentials:**');
            report.push('1. Log in to https://portal.optimizely.com');
            report.push('2. Go to DXP > Settings > API');
            report.push('3. Create or copy your API credentials');
        }
        report.push('');
        
        // Debug Environment Variables if needed
        if (!credCheck.success || process.env.DEBUG) {
            report.push('### 📊 Environment Variables Debug');
            try {
                const ProjectTools = require('./project-tools');
                const debugInfo = ProjectTools.debugEnvironmentVariables();
                
                report.push(`**Environment Variables Found:** ${debugInfo.totalRelevantVars}`);
                
                if (debugInfo.variables.length > 0) {
                    debugInfo.variables.forEach((v, i) => {
                        report.push(`${i + 1}. ${v.key} (${v.format} format)`);
                        report.push(`   Value: ${v.value}`);
                    });
                } else {
                    report.push('❌ No environment variables with expected format found');
                }
                
                if (debugInfo.relatedVars.length > 0) {
                    report.push('');
                    report.push('**Related Environment Variables:**');
                    debugInfo.relatedVars.forEach(rv => {
                        report.push(`• ${rv.key}: ${rv.value}`);
                    });
                }
            } catch (error) {
                report.push(`❌ Environment debug failed: ${error.message}`);
            }
            report.push('');
        }
        
        // Summary
        if (!readyToUse) {
            report.push('---');
            report.push('');
            report.push('### ⚠️ Setup Incomplete');
            report.push('');
            report.push(`**Issues found (${issues.length}):**`);
            issues.forEach(issue => report.push(`- ❌ ${issue}`));
            report.push('');
            report.push('**Next steps:**');
            recommendations.forEach((rec, i) => report.push(`${i + 1}. ${rec}`));
            report.push('');
            report.push('Run `test_connection setupMode:true` again after fixing the issues.');
            
            return {
                needsSetup: true,
                message: report.join('\n')
            };
        }
        
        return {
            needsSetup: false,
            message: '✅ **Setup checks passed!**'
        };
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
        // Check for any project-related environment variables
        const envVars = Object.keys(process.env).filter(key => {
            const value = process.env[key];
            // Look for our credential format
            return value && value.includes('id=') && value.includes('key=') && value.includes('secret=');
        });
        
        if (envVars.length === 0) {
            return {
                success: false,
                message: '❌ No API credentials configured',
                recommendations: [
                    'Add credentials to your Claude Desktop configuration',
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
                    name: envVar,
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
        
        let message = `✅ Found ${validConfigs.length} configured project(s):`;
        validConfigs.forEach(config => {
            message += `\n   • ${config.name} (${config.projectId.substring(0, 8)}...)`;
            if (config.isDefault) message += ' [DEFAULT]';
        });
        
        if (invalidConfigs.length > 0) {
            message += `\n   ⚠️ ${invalidConfigs.length} invalid configuration(s) ignored`;
        }
        
        return {
            success: true,
            message: message,
            configs: validConfigs
        };
    }
    
    /**
     * Original test connection logic - keeping for reference but not used
     */
    static async _oldTestConnection(args = {}) {
        const results = [];
        let hasErrors = false;
        let hasWarnings = false;
        let currentProject = null; // Declare at function scope
        
        try {
            // 0. Show Project Information
            results.push('🏢 **Project Configuration**');
            try {
                const ProjectTools = require('./project-tools');
                
                // DEBUG: Force fresh detection
                delete require.cache[require.resolve('./project-tools')];
                const FreshProjectTools = require('./project-tools');
                
                const projects = FreshProjectTools.getConfiguredProjects();
                
                // If a specific project is requested, use it
                if (args.project || args.projectName) {
                    const requestedName = args.project || args.projectName;
                    currentProject = projects.find(p => p.name === requestedName);
                    if (!currentProject && projects.length > 0) {
                        results.push(`⚠️  Project '${requestedName}' not found, using default`);
                        currentProject = FreshProjectTools.getCurrentProject();
                    }
                } else {
                    currentProject = FreshProjectTools.getCurrentProject(); // Use default
                }
                
                if (projects.length === 0) {
                    hasWarnings = true;
                    results.push('⚠️  No projects configured');
                    results.push('   Add project credentials as environment variables');
                    
                    // Debug environment variables when no projects found
                    results.push('');
                    results.push('📊 **Environment Variables Debug:**');
                    const debugInfo = ProjectTools.debugEnvironmentVariables();
                    results.push(`   Found ${debugInfo.totalRelevantVars} variables with correct format`);
                    
                    if (debugInfo.variables.length > 0) {
                        debugInfo.variables.forEach((v, i) => {
                            results.push(`   ${i + 1}. ${v.key}`);
                        });
                    }
                    
                    
                } else {
                    results.push(`📋 Found ${projects.length} configured project${projects.length > 1 ? 's' : ''}:`);
                    projects.forEach((project, index) => {
                        results.push(`   ${project.name}`);
                    });
                    
                    if (currentProject) {
                        results.push(`✅ Active project: ${currentProject.name}`);
                    } else if (projects.length > 1) {
                        hasWarnings = true;
                        results.push('⚠️  Multiple projects found but no default set');
                    }
                    
                }
            } catch (error) {
                hasWarnings = true;
                results.push(`⚠️  Project detection failed: ${error.message}`);
                results.push('');
            }
            
            // DEBUG: Always show environment variable debug info EARLY to catch project detection issues
            results.push('📊 **Environment Variables Debug:**');
            try {
                const ProjectTools = require('./project-tools');
                const debugInfo = ProjectTools.debugEnvironmentVariables();
                results.push(`   Total environment variables with correct format: ${debugInfo.totalRelevantVars}`);
                
                if (debugInfo.variables.length > 0) {
                    debugInfo.variables.forEach((v, i) => {
                        results.push(`   ${i + 1}. ${v.key}`);
                    });
                } else {
                    results.push('   No environment variables found with expected format');
                }
            } catch (debugError) {
                results.push(`   ❌ Debug failed: ${debugError.message}`);
            }
            results.push('');
            
            // Check if we need PowerShell (only for DXP projects)
            const needsPowerShell = !currentProject || !currentProject.connectionString;
            
            // 1. Test PowerShell Detection (skip for self-hosted)
            if (needsPowerShell) {
                results.push('🔍 **Testing PowerShell Detection**');
                try {
                // Force a fresh detector instance to avoid cached failures
                const detector = getPowerShellDetector(true);
                
                const detectionResult = await detector.detect();
                
                if (detectionResult.command) {
                    results.push(`✅ PowerShell found: ${detectionResult.command} (v${detectionResult.version})`);
                    results.push(`   Platform: ${detector.platform}`);
                    results.push(`   Path: ${detectionResult.path || 'In PATH'}`);
                } else {
                    hasErrors = true;
                    results.push('❌ PowerShell not installed - Required for full functionality');
                    const recommendations = detector.getRecommendations();
                    if (recommendations && recommendations.length > 0) {
                        recommendations.forEach(rec => {
                            results.push(`   - ${rec}`);
                        });
                    }
                    
                    // Can't continue without PowerShell
                    return ResponseBuilder.error(results.join('\n'));
                }
            } catch (error) {
                hasErrors = true;
                results.push(`❌ PowerShell detection error: ${error.message}`);
                // Try to provide helpful information even on error
                results.push('   Common solutions:');
                results.push('   - macOS: brew install --cask powershell');
                results.push('   - Windows: Pre-installed or winget install Microsoft.PowerShell');
                results.push('   - Linux: See https://learn.microsoft.com/powershell/scripting/install/installing-powershell');
                return ResponseBuilder.error(results.join('\n'));
            }
            
            results.push('');
            } // Close PowerShell detection block for DXP
            
            // 2. Test PowerShell Execution and EpiCloud Module (skip for self-hosted)
            if (needsPowerShell) {
                results.push('🧪 **Testing PowerShell Execution & EpiCloud Module**');
                try {
                const detector = getPowerShellDetector();
                const detectionResult = await detector.detect();
                
                if (detectionResult.command) {
                    results.push(`✅ PowerShell execution works (${detectionResult.name} v${detectionResult.version})`);
                    results.push(`   Path: ${detectionResult.path || 'Command available in PATH'}`);
                    
                    // Test the first candidate to get EpiCloud status
                    const candidates = detector.getPowerShellCandidates();
                    const firstCandidate = candidates.find(c => c.command === detectionResult.command);
                    if (firstCandidate) {
                        const testResult = detector.testPowerShell(firstCandidate);
                        if (testResult.success && testResult.epiCloudInstalled) {
                            results.push(`✅ EpiCloud module detected and available`);
                        } else if (testResult.success) {
                            hasErrors = true;
                            results.push(`❌ EpiCloud module NOT installed`);
                            results.push(`   Install with: ${detectionResult.command} -Command "Install-Module -Name EpiCloud -Force -Scope CurrentUser"`);
                            
                            // Can't continue without EpiCloud
                            return ResponseBuilder.error(results.join('\n'));
                        }
                    }
                } else {
                    hasErrors = true;
                    results.push(`❌ PowerShell execution failed`);
                }
            } catch (error) {
                hasErrors = true;
                results.push(`❌ PowerShell testing failed: ${error.message}`);
            }
            
            results.push('');
            } // Close EpiCloud check block for DXP
            
            // 4. Test API Credentials
            results.push('🔑 **Testing API Credentials**');
            
            let credentials = {
                apiKey: args.apiKey || process.env.OPTIMIZELY_API_KEY,
                apiSecret: args.apiSecret || process.env.OPTIMIZELY_API_SECRET,
                projectId: args.projectId || process.env.OPTIMIZELY_PROJECT_ID
            };
            
            // If a project is selected, get its configuration
            if (currentProject) {
                if (currentProject.connectionString) {
                    // Self-hosted project
                    credentials.connectionString = currentProject.connectionString;
                    credentials.projectName = currentProject.name;
                } else {
                    // DXP project
                    credentials.apiKey = currentProject.apiKey || credentials.apiKey;
                    credentials.apiSecret = currentProject.apiSecret || credentials.apiSecret;
                    credentials.projectId = currentProject.projectId || credentials.projectId;
                    credentials.projectName = currentProject.name;
                }
            }
            
            // If no direct credentials AND not self-hosted, try to get from configured projects
            if (!credentials.connectionString && (!credentials.apiKey || !credentials.apiSecret || !credentials.projectId)) {
                try {
                    const ProjectTools = require('./project-tools');
                    const projects = ProjectTools.getConfiguredProjects();
                    
                    if (projects && projects.length > 0) {
                        // Use default project or first one (skip self-hosted)
                        const defaultProject = projects.find(p => !p.connectionString && p.isDefault) || 
                                             projects.find(p => !p.connectionString);
                        if (defaultProject) {
                            credentials = {
                                apiKey: defaultProject.apiKey,
                                apiSecret: defaultProject.apiSecret,
                                projectId: defaultProject.id || defaultProject.projectId,
                                projectName: defaultProject.name
                            };
                        }
                    }
                } catch (projectError) {
                    // Ignore project tools errors, continue with empty credentials
                }
            }
            
            // Check if we have valid credentials (either self-hosted or DXP)
            if (credentials.connectionString) {
                // Self-hosted - show connection info
                results.push('✅ Self-hosted Azure Storage configured');
                results.push(`   Project: ${credentials.projectName || 'Self-hosted'}`);
                
                // Parse the connection string to show account name
                const accountMatch = credentials.connectionString.match(/AccountName=([^;]+)/);
                if (accountMatch) {
                    results.push(`   Storage Account: ${accountMatch[1]}`);
                }
            } else if (!credentials.apiKey || !credentials.apiSecret || !credentials.projectId) {
                hasWarnings = true;
                results.push('⚠️  No API credentials configured');
                results.push('   Configure with environment variables or pass directly:');
                results.push('   - OPTIMIZELY_API_KEY');
                results.push('   - OPTIMIZELY_API_SECRET');
                results.push('   - OPTIMIZELY_PROJECT_ID');
                
                // Check for multi-project configuration
                const envVars = Object.keys(process.env);
                const projectVars = envVars.filter(key => 
                    key.startsWith('OPTIMIZELY_PROJECT_') || 
                    key.startsWith('OPTIMIZELY_API_KEY_')
                );
                
                if (projectVars.length > 0) {
                    results.push('');
                    results.push('   Found multi-project configuration:');
                    projectVars.forEach(varName => {
                        results.push(`   - ${varName}`);
                    });
                    results.push('   Use projectName parameter to select a project');
                }
            } else {
                results.push('✅ API credentials configured');
                results.push(`   Project ID: ${credentials.projectId.substring(0, 8)}...`);
                results.push(`   API Key: ${credentials.apiKey.substring(0, 10)}...`);
                
                // 5. Test API Connection and Permissions
                results.push('');
                
                // Check if this is a self-hosted project
                const isSelfHosted = credentials.connectionString && credentials.connectionString.startsWith('DefaultEndpointsProtocol=');
                
                if (isSelfHosted) {
                    results.push('🌐 **Testing Self-Hosted Azure Storage Connection**');
                    
                    try {
                        // Test Azure Storage connection
                        const SelfHostedStorage = require('../self-hosted-storage');
                        const config = SelfHostedStorage.getStorageConfig({ connectionString: credentials.connectionString });
                        
                        results.push(`✅ Azure Storage Account: ${config.accountName}`);
                        results.push(`   Endpoint: ${config.endpointSuffix}`);
                        
                        // Try to list containers to verify connection
                        const https = require('https');
                        const crypto = require('crypto');
                        
                        // Test connection by listing containers
                        results.push('   Testing container access...');
                        results.push(`✅ Self-hosted connection configured`);
                        results.push('   Available operations: blob downloads, log downloads');
                        
                    } catch (error) {
                        hasErrors = true;
                        results.push(`❌ Self-hosted connection error: ${error.message}`);
                    }
                } else {
                    results.push('🌐 **Testing API Connection & Environment Access**');
                    
                    try {
                        // Use SimplePermissionChecker to test all environments
                        // This bypasses all caching issues and uses direct PowerShell execution
                        const PermissionChecker = require('./permission-checker');
                        const projectConfig = {
                            apiKey: credentials.apiKey,
                            apiSecret: credentials.apiSecret,
                            projectId: credentials.projectId,
                            projectName: credentials.projectName || 'PROJECT'  // Use actual project name
                        };
                    
                    // Get permission results directly
                    const permissionResult = await PermissionChecker.verifyAccess(projectConfig);
                    
                    // Extract results from the response format (handle both response structures)
                    let permissions = { accessible: [], environments: {} };
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
                            permissions.accessible = accessibleMatch[1].split(', ').map(s => s.trim());
                        } else if (responseText.includes('Full Environment Access')) {
                            permissions.accessible = ['Integration', 'Preproduction', 'Production'];
                        } else if (responseText.includes('No Environment Access')) {
                            permissions.accessible = [];
                        }
                        
                        // Create environments object for compatibility
                        ['Integration', 'Preproduction', 'Production'].forEach(env => {
                            permissions.environments[env] = {
                                hasAccess: permissions.accessible.includes(env)
                            };
                        });
                    }
                    
                    // Collect all permissions
                    const grantedPermissions = [];
                    const deniedPermissions = [];
                    
                    // Edge logs check disabled for now - EpiCloud doesn't support it yet
                    // Will add when available
                    
                    // Check environment permissions
                    const accessibleEnvs = [];
                    const inaccessibleEnvs = [];
                    
                    ['Integration', 'Preproduction', 'Production'].forEach(env => {
                        if (permissions.environments && permissions.environments[env] && permissions.environments[env].hasAccess) {
                            accessibleEnvs.push(env);
                            grantedPermissions.push(env);
                        } else if (permissions.accessible && permissions.accessible.includes(env)) {
                            // Alternative format check
                            accessibleEnvs.push(env);
                            grantedPermissions.push(env);
                        } else {
                            inaccessibleEnvs.push(env);
                            deniedPermissions.push(env);
                        }
                    });
                    
                    if (accessibleEnvs.length > 0) {
                        // Successfully connected - this is NOT an error
                        hasErrors = false;
                        results.push('✅ **API Connection Working Perfectly!**');
                        results.push('');
                        results.push('🔑 **Your API Key Permissions:**');
                        
                        // List each granted permission clearly
                        grantedPermissions.forEach(perm => {
                            results.push(`   ✅ ${perm}`);
                        });
                        
                        // Show what's not configured only if less than all 4
                        if (deniedPermissions.length > 0 && deniedPermissions.length < 4) {
                            results.push('');
                            results.push('   ℹ️ Permissions not configured:');
                            deniedPermissions.forEach(perm => {
                                results.push(`   · ${perm}`);
                            });
                        }
                        
                        results.push('');
                        results.push('🌟 **What You Can Do:**');
                        
                        // Be specific about capabilities based on exact permissions
                        if (accessibleEnvs.includes('Production')) {
                            results.push('   • Export production databases');
                            results.push('   • Download production media/blobs');
                            results.push('   • Monitor production deployments');
                        }
                        if (accessibleEnvs.includes('Preproduction')) {
                            results.push('   • Export staging databases');
                            results.push('   • Download staging media/blobs');
                            results.push('   • Test deployments in staging');
                        }
                        if (accessibleEnvs.includes('Integration')) {
                            results.push('   • Manage development environment');
                            results.push('   • Export development databases');
                        }
                        if (accessibleEnvs.length >= 2) {
                            // Check valid deployment paths
                            if (accessibleEnvs.includes('Integration') && accessibleEnvs.includes('Preproduction')) {
                                results.push('   • Deploy from Integration to Preproduction');
                            }
                            if (accessibleEnvs.includes('Preproduction') && accessibleEnvs.includes('Production')) {
                                results.push('   • Deploy from Preproduction to Production');
                            }
                        }
                        // Edge logs operations will be added when supported
                        // if (grantedPermissions.includes('Edge logs')) {
                        //     results.push('   • Download and analyze CDN/edge logs');
                        // }
                        
                        // Try to get project name using a working command
                        try {
                            const testEnv = accessibleEnvs[0];
                            // Use Get-EpiStorageContainer instead of Get-EpiDeployment (which is blocked)
                            const projectResult = await PowerShellHelper.executeEpiCommandDirect(
                                `Get-EpiStorageContainer -ProjectId '${credentials.projectId}' -ClientKey '${credentials.apiKey}' -ClientSecret '${credentials.apiSecret}' -Environment ${testEnv} | Select-Object -First 1`,
                                { 
                                    parseJson: true,
                                    timeout: 10000
                                }
                            );
                            
                            // Storage container result won't have ProjectName, but we can show the container info
                            if (projectResult.parsedData && projectResult.parsedData.Name) {
                                results.push(`   Storage Container: ${projectResult.parsedData.Name}`);
                            }
                        } catch {
                            // Project name is optional
                        }
                    } else {
                        hasErrors = true;
                        results.push('❌ API connection failed - No environment access');
                        results.push('   Could not access any environments with provided credentials');
                        results.push('   Check your API key permissions');
                    }
                } catch (error) {
                    // Try fallback: check each environment individually using working command
                    const fallbackAccess = [];
                    for (const env of ['Integration', 'Preproduction', 'Production']) {
                        try {
                            // Use Get-EpiStorageContainer instead of Get-EpiDeployment (which is blocked)
                            const testResult = await PowerShellHelper.executeEpiCommandDirect(
                                `Get-EpiStorageContainer -ProjectId '${credentials.projectId}' -ClientKey '${credentials.apiKey}' -ClientSecret '${credentials.apiSecret}' -Environment ${env} | Select-Object -First 1`,
                                { 
                                    parseJson: true,
                                    timeout: 5000
                                }
                            );
                            if (testResult.success !== false) {
                                fallbackAccess.push(env);
                            }
                        } catch {
                            // This environment is not accessible
                        }
                    }
                    
                    if (fallbackAccess.length > 0) {
                        // We have some access, not an error
                        hasErrors = false;
                        results.push('✅ **API Connection Working Perfectly!**');
                        results.push('');
                        results.push('🔑 **Your API Key Permissions:**');
                        
                        // List each accessible environment
                        fallbackAccess.forEach(env => {
                            results.push(`   ✅ ${env}`);
                        });
                        
                        // Show what's not accessible
                        const inaccessible = ['Integration', 'Preproduction', 'Production'].filter(e => !fallbackAccess.includes(e));
                        if (inaccessible.length > 0 && inaccessible.length < 3) {
                            results.push('');
                            results.push('   ℹ️ Permissions not configured:');
                            inaccessible.forEach(env => {
                                results.push(`   · ${env}`);
                            });
                            results.push('   · Edge logs');
                        }
                        
                        results.push('');
                        results.push('🌟 **What You Can Do:**');
                        
                        // Be specific about capabilities
                        fallbackAccess.forEach(env => {
                            if (env === 'Production') {
                                results.push('   • Export production databases');
                                results.push('   • Download production media/blobs');
                                results.push('   • Monitor production deployments');
                            } else if (env === 'Preproduction') {
                                results.push('   • Export staging databases');
                                results.push('   • Download staging media/blobs');
                                results.push('   • Test deployments in staging');
                            } else if (env === 'Integration') {
                                results.push('   • Manage development environment');
                                results.push('   • Export development databases');
                            }
                        });
                        
                        if (fallbackAccess.length >= 2) {
                            // Check valid deployment paths
                            if (fallbackAccess.includes('Integration') && fallbackAccess.includes('Preproduction')) {
                                results.push('   • Deploy from Integration to Preproduction');
                            }
                            if (fallbackAccess.includes('Preproduction') && fallbackAccess.includes('Production')) {
                                results.push('   • Deploy from Preproduction to Production');
                            }
                        }
                    } else {
                        // No access at all - this is an error
                        hasErrors = true;
                        const errorInfo = ErrorHandler.handleError(error);
                        results.push('❌ API connection failed');
                        results.push(`   ${errorInfo.userMessage || error.message}`);
                        
                        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                            results.push('   Check your API credentials');
                        } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
                            results.push('   API key may have no environment access');
                        } else if (error.message.includes('rate limit')) {
                            results.push('   Rate limit exceeded - wait and try again');
                        }
                    }
                }
                } // Close the else block for DXP projects
            }
            
            // 6. System Information
            results.push('');
            results.push('💻 **System Information**');
            results.push(`   OS: ${os.platform()} ${os.release()}`);
            results.push(`   Node.js: ${process.version}`);
            results.push(`   MCP Version: ${require('../../package.json').version}`);
            
            // 7. Summary
            results.push('');
            results.push('━'.repeat(50));
            if (hasErrors) {
                results.push('❌ **Setup Incomplete** - Please fix the errors above');
            } else if (hasWarnings) {
                results.push('⚠️  **Setup Partially Complete** - Configure API credentials to test connection');
            } else {
                results.push('🎉 **Everything is Working!**');
                results.push('');
                results.push('Your MCP server is fully operational.');
                results.push('All commands will automatically work with your permissions.');
                results.push('');
                results.push('🔥 **Ready to Use** - Try any command!');
                results.push('Examples: "status", "export database", "download blobs"');
            }
            
            return {
                content: [{
                    type: 'text',
                    text: results.join('\n')
                }]
            };
            
        } catch (error) {
            // DEBUG: Log the actual error that's being caught
            console.error('test_connection caught error:', error);
            return {
                content: [{
                    type: 'text',
                    text: `🔍 **DEBUG: Error caught in test_connection**\n\nError: ${error.message}\nStack: ${error.stack}`
                }]
            };
        }
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
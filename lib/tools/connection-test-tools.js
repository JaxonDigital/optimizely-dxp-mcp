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
     */
    static async testConnection(args) {
        const results = [];
        let hasErrors = false;
        let hasWarnings = false;
        
        try {
            // 0. Show Project Information
            results.push('🏢 **Project Configuration**');
            try {
                const ProjectTools = require('./project-tools');
                const projects = ProjectTools.getConfiguredProjects();
                const currentProject = ProjectTools.getCurrentProject();
                
                if (projects.length === 0) {
                    hasWarnings = true;
                    results.push('⚠️  No projects configured');
                    results.push('   Add project credentials as environment variables');
                } else {
                    results.push(`📋 Found ${projects.length} configured project${projects.length > 1 ? 's' : ''}:`);
                    projects.forEach((project, index) => {
                        const prefix = project.isDefault ? '🎯' : '  ';
                        results.push(`${prefix} ${project.name}${project.isDefault ? ' (default)' : ''}`);
                    });
                    
                    if (currentProject) {
                        results.push(`✅ Active project: ${currentProject.name}`);
                    } else if (projects.length > 1) {
                        hasWarnings = true;
                        results.push('⚠️  Multiple projects found but no default set');
                    }
                }
                results.push('');
            } catch (error) {
                hasWarnings = true;
                results.push(`⚠️  Project detection failed: ${error.message}`);
                results.push('');
            }
            
            // 1. Test PowerShell Detection
            results.push('🔍 **Testing PowerShell Detection**');
            try {
                const detector = getPowerShellDetector();
                const info = await detector.getInfo();
                
                if (info.command) {
                    results.push(`✅ PowerShell found: ${info.command} (v${info.version})`);
                    results.push(`   Platform: ${info.platform}`);
                    results.push(`   Path: ${info.path}`);
                } else {
                    hasErrors = true;
                    results.push('❌ PowerShell not found!');
                    results.push('   Installation required:');
                    info.recommendations.forEach(rec => {
                        results.push(`   - ${rec}`);
                    });
                    
                    // Can't continue without PowerShell
                    return ResponseBuilder.error(results.join('\n'));
                }
            } catch (error) {
                hasErrors = true;
                results.push(`❌ PowerShell detection failed: ${error.message}`);
                return ResponseBuilder.error(results.join('\n'));
            }
            
            results.push('');
            
            // 2. Test PowerShell Execution and EpiCloud Module (using improved detector)
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
            
            // 4. Test API Credentials
            results.push('🔑 **Testing API Credentials**');
            
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
                            apiKey: defaultProject.apiKey,
                            apiSecret: defaultProject.apiSecret,
                            projectId: defaultProject.id || defaultProject.projectId,
                            projectName: defaultProject.name
                        };
                    }
                } catch (projectError) {
                    // Ignore project tools errors, continue with empty credentials
                }
            }
            
            if (!credentials.apiKey || !credentials.apiSecret || !credentials.projectId) {
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
                        
                        // Try to get project name using an accessible environment
                        try {
                            const testEnv = accessibleEnvs[0];
                            const projectResult = await PowerShellHelper.executeEpiCommand(
                                `Get-EpiDeployment -Environment ${testEnv} | Select-Object -First 1`,
                                credentials,
                                { 
                                    parseJson: true,
                                    timeout: 10000,
                                    operation: 'get_project'
                                }
                            );
                            
                            if (projectResult.parsedData && projectResult.parsedData.ProjectName) {
                                results.push(`   Project Name: ${projectResult.parsedData.ProjectName}`);
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
                    // Try fallback: check each environment individually to determine actual access
                    const fallbackAccess = [];
                    for (const env of ['Integration', 'Preproduction', 'Production']) {
                        try {
                            const testResult = await PowerShellHelper.executeEpiCommand(
                                `Get-EpiDeployment -Environment ${env} | Select-Object -First 1`,
                                credentials,
                                { 
                                    parseJson: true,
                                    timeout: 5000,
                                    operation: 'test_env_access'
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
            return ErrorHandler.handleError(error);
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
                    // Silent fail - try fallback method
                    try {
                        const result = await PowerShellHelper.executeEpiCommand(
                            'Get-EpiDeployment -Environment Integration | Select-Object -First 1',
                            credentials,
                            { parseJson: true, timeout: 10000 }
                        );
                        checks.connection = result.success !== false;
                        if (checks.connection) {
                            environmentAccess = ' [Int]';
                        }
                    } catch {
                        // Silent fail
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
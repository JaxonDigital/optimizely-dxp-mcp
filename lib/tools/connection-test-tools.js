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
                            projectId: defaultProject.id
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
                
                // 5. Test API Connection (if credentials available)
                results.push('');
                results.push('🌐 **Testing API Connection**');
                
                try {
                    const result = await PowerShellHelper.executeEpiCommand(
                        'Get-EpiDeployment | Select-Object -First 1',
                        credentials,
                        { 
                            parseJson: true,
                            timeout: 15000,
                            operation: 'test_connection'
                        }
                    );
                    
                    if (result.success !== false) {
                        results.push('✅ API connection successful!');
                        results.push('   Successfully connected to Optimizely DXP');
                        
                        // Try to get project name
                        try {
                            const projectResult = await PowerShellHelper.executeEpiCommand(
                                'Get-EpiProject',
                                credentials,
                                { 
                                    parseJson: true,
                                    timeout: 10000,
                                    operation: 'get_project'
                                }
                            );
                            
                            if (projectResult.parsedData && projectResult.parsedData.Name) {
                                results.push(`   Project Name: ${projectResult.parsedData.Name}`);
                            }
                        } catch {
                            // Project name is optional
                        }
                    } else {
                        hasErrors = true;
                        results.push('❌ API connection failed');
                        results.push(`   Error: ${result.stderr || 'Unknown error'}`);
                    }
                } catch (error) {
                    hasErrors = true;
                    const errorInfo = ErrorHandler.handleError(error);
                    results.push('❌ API connection failed');
                    results.push(`   ${errorInfo.userMessage || error.message}`);
                    
                    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                        results.push('   Check your API credentials');
                    } else if (error.message.includes('rate limit')) {
                        results.push('   Rate limit exceeded - wait and try again');
                    } else if (error.message.includes('network')) {
                        results.push('   Check your internet connection');
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
                results.push('✅ **Setup Complete!** - Your MCP is ready to use');
                results.push('');
                results.push('Try these commands:');
                results.push('- "List my deployments"');
                results.push('- "Show recent deployments"');
                results.push('- "Export the production database"');
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
            
            // Check connection if everything else is good
            if (checks.powershell && checks.epicloud && checks.credentials) {
                try {
                    const result = await PowerShellHelper.executeEpiCommand(
                        'Get-EpiDeployment | Select-Object -First 1',
                        credentials,
                        { parseJson: true, timeout: 10000 }
                    );
                    checks.connection = result.success !== false;
                } catch {
                    // Silent fail
                }
            }
            
            // Format response
            const status = checks.connection ? 'healthy' : 
                         checks.credentials ? 'partial' : 'not-configured';
            
            return {
                content: [{
                    type: 'text',
                    text: [
                        `Status: ${status}`,
                        `PowerShell: ${checks.powershell ? '✅' : '❌'}`,
                        `EpiCloud: ${checks.epicloud ? '✅' : '❌'}`,
                        `Credentials: ${checks.credentials ? '✅' : '❌'}`,
                        `Connection: ${checks.connection ? '✅' : '❌'}`
                    ].join('\n')
                }]
            };
            
        } catch (error) {
            return ErrorHandler.handleError(error);
        }
    }
}

module.exports = ConnectionTestTools;
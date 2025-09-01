/**
 * Container Debug Tools
 * Debug tool to diagnose container listing issues
 */

const PowerShellHelper = require('../powershell-helper');
const PowerShellCommandBuilder = require('../powershell-command-builder');
const ResponseBuilder = require('../response-builder');
const OutputLogger = require('../output-logger');
const ProjectTools = require('./project-tools');

class ContainerDebugTools {
    
    /**
     * Debug container listing with raw output
     */
    static async debugContainers(args) {
        try {
            OutputLogger.info('🔍 Container Debug Tool\n');
            
            // Resolve project configuration
            const resolved = ProjectTools.resolveCredentials(args);
            if (!resolved.success || !resolved.credentials) {
                return ResponseBuilder.invalidParams('Missing required project configuration');
            }
            
            const projectConfig = resolved.credentials;
            const projectName = resolved.project ? resolved.project.name : 'Unknown';
            
            OutputLogger.info(`📋 Project: ${projectName}`);
            OutputLogger.info(`🔑 API Key: ${projectConfig.apiKey?.substring(0, 8)}...`);
            OutputLogger.info(`🆔 Project ID: ${projectConfig.projectId}`);
            
            const environment = args.environment || 'Production';
            OutputLogger.info(`🌍 Environment: ${environment}\n`);
            
            // Build command
            const command = PowerShellCommandBuilder.create('Get-EpiStorageContainer')
                .addParam('ProjectId', projectConfig.projectId)
                .addParam('Environment', environment)
                .build();
            
            OutputLogger.info(`📝 PowerShell Command:\n${command}\n`);
            
            // Execute with raw output
            OutputLogger.info('⚙️ Executing PowerShell command...\n');
            const result = await PowerShellHelper.executeEpiCommand(
                command,
                { 
                    apiKey: projectConfig.apiKey, 
                    apiSecret: projectConfig.apiSecret, 
                    projectId: projectConfig.projectId 
                },
                { 
                    parseJson: false,  // Get raw output
                    operation: 'debug_containers'
                }
            );
            
            OutputLogger.info('📤 Raw PowerShell Output:');
            OutputLogger.info('=' .repeat(60));
            
            if (result.stdout) {
                OutputLogger.info('STDOUT:');
                OutputLogger.info(result.stdout);
            }
            
            if (result.stderr) {
                OutputLogger.info('\nSTDERR:');
                OutputLogger.info(result.stderr);
            }
            
            OutputLogger.info('=' .repeat(60));
            
            // Try to parse as JSON
            OutputLogger.info('\n📊 Parsing attempt:');
            try {
                const parsed = JSON.parse(result.stdout);
                OutputLogger.info(`✅ Valid JSON - Found ${parsed.length} items`);
                
                if (Array.isArray(parsed)) {
                    OutputLogger.info('\n📦 Containers found:');
                    parsed.forEach((item, index) => {
                        OutputLogger.info(`  ${index + 1}. ${JSON.stringify(item)}`);
                    });
                    
                    // Extract container names
                    const containerNames = parsed.map(c => 
                        c.StorageContainer || c.Name || c.ContainerName || JSON.stringify(c)
                    );
                    
                    OutputLogger.info('\n📋 Container names extracted:');
                    containerNames.forEach(name => {
                        OutputLogger.info(`  • ${name}`);
                    });
                }
            } catch (e) {
                OutputLogger.info(`❌ Not valid JSON: ${e.message}`);
                
                // Try to extract from text
                OutputLogger.info('\n📝 Attempting text extraction:');
                const lines = result.stdout.split('\n');
                const containers = [];
                
                for (const line of lines) {
                    if (line.trim() && !line.includes('---')) {
                        OutputLogger.info(`  Line: "${line}"`);
                        
                        // Try different patterns
                        const patterns = [
                            /StorageContainer\s*:\s*(\S+)/,
                            /Name\s*:\s*(\S+)/,
                            /^\s*(\S+)\s*$/,
                            /\|\s*([^|]+)\s*\|/
                        ];
                        
                        for (const pattern of patterns) {
                            const match = line.match(pattern);
                            if (match) {
                                OutputLogger.info(`    → Matched: ${match[1]}`);
                                containers.push(match[1].trim());
                                break;
                            }
                        }
                    }
                }
                
                if (containers.length > 0) {
                    OutputLogger.info(`\n✅ Extracted ${containers.length} containers from text`);
                } else {
                    OutputLogger.info('\n❌ No containers could be extracted');
                }
            }
            
            // Also test with parseJson: true
            OutputLogger.info('\n\n🔄 Testing with parseJson: true...');
            const result2 = await PowerShellHelper.executeEpiCommand(
                command,
                { 
                    apiKey: projectConfig.apiKey, 
                    apiSecret: projectConfig.apiSecret, 
                    projectId: projectConfig.projectId 
                },
                { 
                    parseJson: true,
                    operation: 'debug_containers_json'
                }
            );
            
            OutputLogger.info('Result with parseJson:');
            OutputLogger.info(JSON.stringify(result2, null, 2));
            
            return ResponseBuilder.success('Debug complete - see output above');
            
        } catch (error) {
            return ResponseBuilder.error(`Debug failed: ${error.message}\n\nStack: ${error.stack}`);
        }
    }
}

module.exports = ContainerDebugTools;
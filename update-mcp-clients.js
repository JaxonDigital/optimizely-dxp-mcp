#!/usr/bin/env node

/**
 * Post-Publish MCP Client Update Script
 * Automatically updates Claude Code CLI and ensures Claude Desktop compatibility
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ANSI colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
    log(`\n${step}. ${message}`, 'bright');
}

function logSuccess(message) {
    log(`   ✅ ${message}`, 'green');
}

function logWarning(message) {
    log(`   ⚠️  ${message}`, 'yellow');
}

function logError(message) {
    log(`   ❌ ${message}`, 'red');
}

function logInfo(message) {
    log(`   ℹ️  ${message}`, 'cyan');
}

function executeCommand(command, options = {}) {
    try {
        const result = execSync(command, { 
            encoding: 'utf8', 
            stdio: options.silent ? 'pipe' : 'inherit',
            ...options 
        });
        return { success: true, output: result };
    } catch (error) {
        return { 
            success: false, 
            error: error.message, 
            output: error.stdout || '',
            stderr: error.stderr || ''
        };
    }
}

function getPackageVersion() {
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
        return packageJson.version;
    } catch (error) {
        return 'unknown';
    }
}

function checkCommandExists(command) {
    const result = executeCommand(`which ${command}`, { silent: true });
    return result.success;
}

function updateGlobalPackage() {
    logStep(1, 'Updating Global NPM Package');
    
    // Check if npm is available
    if (!checkCommandExists('npm')) {
        logError('npm command not found. Please install Node.js and npm.');
        return false;
    }
    
    logInfo('Installing latest version globally...');
    const result = executeCommand('npm install -g jaxon-optimizely-dxp-mcp@latest');
    
    if (result.success) {
        logSuccess('Global package updated successfully');
        
        // Verify the installation
        const versionCheck = executeCommand('jaxon-optimizely-dxp-mcp --version', { silent: true });
        if (versionCheck.success) {
            logInfo(`Installed version: ${versionCheck.output.trim()}`);
        }
        return true;
    } else {
        logError(`Failed to update global package: ${result.error}`);
        return false;
    }
}

function updateClaudeCodeCLI() {
    logStep(2, 'Checking Claude Code CLI');
    
    // Check if claude command exists
    if (!checkCommandExists('claude')) {
        logWarning('Claude Code CLI not found. Install it from: https://docs.anthropic.com/en/docs/claude-code');
        logInfo('After installing Claude Code CLI, you can manually add: claude mcp add jaxon-optimizely-dxp "jaxon-optimizely-dxp-mcp"');
        return false;
    }
    
    // List existing MCPs to see if our MCP is already configured
    logInfo('Checking existing MCP configurations...');
    const listResult = executeCommand('claude mcp list', { silent: true });
    
    if (listResult.success) {
        const output = listResult.output;
        const hasOptimizelyMCP = output.includes('jaxon-optimizely-dxp') || 
                                output.includes('optimizely') ||
                                output.includes('jaxon-optimizely-dxp-mcp');
        
        if (hasOptimizelyMCP) {
            logInfo('Found existing Optimizely MCP configuration');
            logInfo('The global package update will automatically be used by existing configurations');
            logSuccess('Claude Code CLI will use the updated version');
        } else {
            logInfo('No existing Optimizely MCP found');
            logInfo('To add it manually, run: claude mcp add jaxon-optimizely-dxp "jaxon-optimizely-dxp-mcp"');
            // NOT auto-installing anymore - just inform the user
        }
    } else {
        logWarning('Could not check existing MCP configurations');
        logInfo('You may need to manually configure Claude Code CLI');
    }
    
    return true;
}

function checkClaudeDesktopConfig() {
    logStep(3, 'Checking Claude Desktop Configuration');
    
    // Determine Claude Desktop config path based on OS
    let configPath;
    const platform = os.platform();
    
    if (platform === 'darwin') {
        configPath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    } else if (platform === 'win32') {
        configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
    } else {
        configPath = path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
    }
    
    logInfo(`Checking config file: ${configPath}`);
    
    if (!fs.existsSync(configPath)) {
        logWarning('Claude Desktop config file not found');
        logInfo('Create the config file and add the MCP server configuration');
        logInfo('See the README for detailed configuration instructions');
        return false;
    }
    
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);
        
        if (config.mcpServers) {
            const serverNames = Object.keys(config.mcpServers);
            const hasOptimizelyServer = serverNames.some(name => 
                name.includes('optimizely') || 
                name.includes('jaxon') ||
                (config.mcpServers[name].command && config.mcpServers[name].command.includes('jaxon-optimizely-dxp-mcp'))
            );
            
            if (hasOptimizelyServer) {
                logSuccess('Found Optimizely MCP configuration in Claude Desktop');
                logInfo('The global package update will be used when Claude Desktop restarts');
                logInfo('💡 Restart Claude Desktop to use the updated version');
            } else {
                logWarning('No Optimizely MCP found in Claude Desktop config');
                logInfo('Add the MCP server to your Claude Desktop configuration');
                logInfo('See MULTI_PROJECT_CONFIG.md for detailed instructions');
            }
        } else {
            logWarning('No MCP servers configured in Claude Desktop');
            logInfo('Add mcpServers section to your config file');
        }
        
    } catch (error) {
        logError(`Failed to read Claude Desktop config: ${error.message}`);
        return false;
    }
    
    return true;
}

function showPostUpdateInstructions() {
    logStep(4, 'Post-Update Instructions');
    
    log('\n' + '='.repeat(60), 'bright');
    log('🎉 MCP CLIENT UPDATE COMPLETE', 'green');
    log('='.repeat(60), 'bright');
    
    log('\n📋 NEXT STEPS:', 'bright');
    
    log('\n🖥️  Claude Desktop:', 'blue');
    log('   • Restart Claude Desktop to use the updated version');
    log('   • If not configured, see README.md for setup instructions');
    
    log('\n💻 Claude Code CLI:', 'blue');
    log('   • Ready to use immediately');
    log('   • Test with: claude "get optimizely support"');
    log('   • If not configured, run: claude mcp add jaxon-optimizely-dxp "jaxon-optimizely-dxp-mcp"');
    
    log('\n🔧 Configuration Help:', 'blue');
    log('   • README.md - Basic configuration');
    log('   • MULTI_PROJECT_CONFIG.md - Advanced multi-project setup');
    log('   • https://github.com/JaxonDigital/optimizely-dxp-mcp');
    
    log('\n✨ New Features in this Version:', 'blue');
    log('   • Real-time deployment monitoring');
    log('   • Configurable monitoring intervals (10s - 10m)');
    log('   • Improved project selection');
    log('   • Faster cache performance');
    
    const currentVersion = getPackageVersion();
    log(`\n📦 Current Version: ${currentVersion}`, 'cyan');
    
    log('\n' + '='.repeat(60), 'bright');
}

function testInstallation() {
    logStep(5, 'Testing Installation');
    
    // Test global package
    logInfo('Testing global package installation...');
    const globalTest = executeCommand('jaxon-optimizely-dxp-mcp --version', { silent: true });
    
    if (globalTest.success) {
        logSuccess(`Global package working: v${globalTest.output.trim()}`);
    } else {
        logError('Global package test failed');
    }
    
    // Test Claude Code CLI if available
    if (checkCommandExists('claude')) {
        logInfo('Checking Claude Code CLI...');
        const claudeTest = executeCommand('claude mcp list', { silent: true });
        
        if (claudeTest.success && claudeTest.output.includes('jaxon-optimizely-dxp')) {
            logSuccess('Claude Code CLI has existing Optimizely MCP configuration');
        } else if (claudeTest.success) {
            logInfo('Claude Code CLI is available - you can add the MCP manually if needed');
        } else {
            logWarning('Could not check Claude Code CLI status');
        }
    }
}

async function main() {
    log('\n' + '='.repeat(60), 'bright');
    log('🚀 JAXON OPTIMIZELY DXP MCP - CLIENT UPDATE', 'cyan');
    log('='.repeat(60), 'bright');
    
    const currentVersion = getPackageVersion();
    log(`\n📦 Published Version: ${currentVersion}`, 'bright');
    log('🎯 Updating MCP clients for immediate use...', 'cyan');
    
    try {
        // Update global NPM package
        const globalSuccess = updateGlobalPackage();
        
        // Update Claude Code CLI
        const claudeCodeSuccess = updateClaudeCodeCLI();
        
        // Check Claude Desktop configuration
        const claudeDesktopChecked = checkClaudeDesktopConfig();
        
        // Test the installation
        testInstallation();
        
        // Show final instructions
        showPostUpdateInstructions();
        
        if (globalSuccess) {
            log('\n✅ MCP client update completed successfully!', 'green');
            return true;
        } else {
            log('\n⚠️  MCP client update completed with warnings', 'yellow');
            return false;
        }
        
    } catch (error) {
        logError(`Unexpected error during update: ${error.message}`);
        log('\n❌ MCP client update failed', 'red');
        return false;
    }
}

// Only run if called directly (not required as module)
if (require.main === module) {
    main()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            logError(`Fatal error: ${error.message}`);
            process.exit(1);
        });
}

module.exports = { main, updateGlobalPackage, updateClaudeCodeCLI, checkClaudeDesktopConfig };
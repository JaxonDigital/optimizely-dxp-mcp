#!/usr/bin/env node

/**
 * Dependency Installation Helper
 * Automatically installs PowerShell Core and EpiCloud module if needed
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');

// Colors for output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

function log(message, color = '') {
    console.log(`${color}${message}${colors.reset}`);
}

async function commandExists(cmd) {
    try {
        // Use platform-appropriate command to check if executable exists
        const command = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
        await execAsync(command);
        return true;
    } catch {
        return false;
    }
}

async function detectPowerShell() {
    // On Windows, prefer built-in PowerShell 5.1+ over PowerShell Core
    if (process.platform === 'win32') {
        if (await commandExists('powershell')) {
            try {
                // Check if Windows PowerShell version is 5.1+
                const { stdout } = await execAsync('powershell -Command "$PSVersionTable.PSVersion.Major"');
                const majorVersion = parseInt(stdout.trim());
                if (majorVersion >= 5) {
                    return { command: 'powershell', name: 'Windows PowerShell', version: majorVersion };
                }
            } catch {
                // Fall through to check pwsh
            }
        }
        
        if (await commandExists('pwsh')) {
            return { command: 'pwsh', name: 'PowerShell Core', version: 'Core' };
        }
        
        return null;
    } else {
        // On macOS/Linux, only PowerShell Core is available
        if (await commandExists('pwsh')) {
            return { command: 'pwsh', name: 'PowerShell Core', version: 'Core' };
        }
        return null;
    }
}

async function checkPowerShell() {
    log('\n📋 Checking PowerShell...', colors.cyan);
    
    const ps = await detectPowerShell();
    if (ps) {
        log(`✅ ${ps.name} ${ps.version} is available (${ps.command})`, colors.green);
        return { available: true, command: ps.command };
    }
    
    log('❌ PowerShell not found', colors.yellow);
    const platform = os.platform();
    
    if (platform === 'win32') {
        log('\nFor Windows, you have two options:', colors.bright);
        log('\n1. Use built-in Windows PowerShell 5.1+ (recommended):', colors.cyan);
        log('   Already installed on Windows 10/11 - no action needed!');
        log('\n2. Or install PowerShell Core:', colors.cyan);
        log('   winget install Microsoft.PowerShell', colors.bright);
        log('\nNote: Windows PowerShell 5.1+ works perfectly with this MCP');
    } else {
        log('\nTo install PowerShell Core (required on macOS/Linux):', colors.bright);
        
        switch(platform) {
            case 'darwin':
                log('\nFor macOS, run:', colors.cyan);
                log('  brew install powershell', colors.bright);
                log('\nIf you don\'t have Homebrew, install it first:');
                log('  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
                break;
                
            case 'linux':
                log('\nFor Ubuntu/Debian:', colors.cyan);
                log('  sudo apt-get update && sudo apt-get install -y powershell', colors.bright);
                log('\nFor other Linux distributions, see:');
                log('  https://docs.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-linux');
                break;
                
            default:
                log('\nPlease install PowerShell Core from:', colors.cyan);
                log('  https://github.com/PowerShell/PowerShell/releases');
        }
    }
    
    return { available: false, command: null };
}

async function checkEpiCloud(psCommand = null) {
    log('\n📋 Checking EpiCloud module...', colors.cyan);
    
    // If no PowerShell command provided, try to detect it
    if (!psCommand) {
        const ps = await detectPowerShell();
        if (!ps) {
            log('❌ PowerShell not available for EpiCloud check', colors.red);
            return false;
        }
        psCommand = ps.command;
    }
    
    try {
        const { stdout } = await execAsync(`${psCommand} -Command "Get-Module -ListAvailable -Name EpiCloud | Select-Object -ExpandProperty Name"`);
        if (stdout.includes('EpiCloud')) {
            log('✅ EpiCloud module is installed', colors.green);
            return true;
        }
    } catch (error) {
        // PowerShell command failed
    }
    
    log('❌ EpiCloud module not found', colors.yellow);
    
    log('\nInstalling EpiCloud module...', colors.cyan);
    
    try {
        // Try to install EpiCloud module using detected PowerShell
        await execAsync(`${psCommand} -Command "Install-Module -Name EpiCloud -Force -Scope CurrentUser -AllowClobber"`);
        log('✅ EpiCloud module installed successfully!', colors.green);
        return true;
    } catch (error) {
        log('⚠️  Could not install EpiCloud automatically', colors.yellow);
        log('\nPlease run this command manually:', colors.bright);
        log(`  ${psCommand} -Command "Install-Module -Name EpiCloud -Force"`, colors.cyan);
    }
    
    return false;
}

async function checkNodeVersion() {
    log('\n📋 Checking Node.js version...', colors.cyan);
    
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.split('.')[0].substring(1));
    
    if (major >= 16) {
        log(`✅ Node.js ${nodeVersion} is compatible`, colors.green);
        return true;
    } else {
        log(`⚠️  Node.js ${nodeVersion} detected. Version 16+ recommended`, colors.yellow);
        return false;
    }
}

async function main() {
    log('\n🚀 Jaxon Digital - Optimizely DXP MCP Server', colors.bright);
    log('   Dependency Checker', colors.bright);
    log('================================================\n', colors.cyan);
    
    let allGood = true;
    
    // Check Node.js version
    const nodeOk = await checkNodeVersion();
    if (!nodeOk) allGood = false;
    
    // Check PowerShell
    const psResult = await checkPowerShell();
    if (!psResult.available) allGood = false;
    
    // Check EpiCloud only if PowerShell is installed
    if (psResult.available) {
        const epiOk = await checkEpiCloud(psResult.command);
        if (!epiOk) allGood = false;
    }
    
    log('\n================================================', colors.cyan);
    
    if (allGood) {
        log('\n✅ All dependencies are installed!', colors.green);
        log('\nYou\'re ready to use the Optimizely DXP MCP Server.', colors.bright);
        log('\nNext steps:', colors.cyan);
        log('1. Configure your Claude Desktop (see README)');
        log('2. Add your Optimizely API credentials');
        log('3. Start managing your DXP environments!\n');
    } else {
        log('\n⚠️  Some dependencies are missing', colors.yellow);
        log('\nPlease install the missing dependencies above.', colors.bright);
        log('Then run this check again: npx jaxon-optimizely-dxp-mcp check-deps\n');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        log(`\n❌ Error: ${error.message}`, colors.red);
        process.exit(1);
    });
}

module.exports = { checkPowerShell, checkEpiCloud };
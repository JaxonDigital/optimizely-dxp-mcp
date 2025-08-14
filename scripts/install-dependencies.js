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
        await execAsync(`which ${cmd}`);
        return true;
    } catch {
        return false;
    }
}

async function checkPowerShell() {
    log('\n📋 Checking PowerShell Core...', colors.cyan);
    
    if (await commandExists('pwsh')) {
        log('✅ PowerShell Core is installed', colors.green);
        return true;
    }
    
    log('❌ PowerShell Core not found', colors.yellow);
    log('\nTo install PowerShell Core:', colors.bright);
    
    const platform = os.platform();
    
    switch(platform) {
        case 'darwin':
            log('\nFor macOS, run:', colors.cyan);
            log('  brew install powershell', colors.bright);
            log('\nIf you don\'t have Homebrew, install it first:');
            log('  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
            break;
            
        case 'win32':
            log('\nFor Windows, run in Administrator PowerShell:', colors.cyan);
            log('  winget install Microsoft.PowerShell', colors.bright);
            log('\nOr download from: https://github.com/PowerShell/PowerShell/releases');
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
    
    return false;
}

async function checkEpiCloud() {
    log('\n📋 Checking EpiCloud module...', colors.cyan);
    
    try {
        const { stdout } = await execAsync('pwsh -Command "Get-Module -ListAvailable -Name EpiCloud | Select-Object -ExpandProperty Name"');
        if (stdout.includes('EpiCloud')) {
            log('✅ EpiCloud module is installed', colors.green);
            return true;
        }
    } catch (error) {
        // PowerShell might not be installed
    }
    
    log('❌ EpiCloud module not found', colors.yellow);
    
    // Check if PowerShell is available
    if (await commandExists('pwsh')) {
        log('\nInstalling EpiCloud module...', colors.cyan);
        
        try {
            // Try to install EpiCloud module
            await execAsync('pwsh -Command "Install-Module -Name EpiCloud -Force -Scope CurrentUser -AllowClobber"');
            log('✅ EpiCloud module installed successfully!', colors.green);
            return true;
        } catch (error) {
            log('⚠️  Could not install EpiCloud automatically', colors.yellow);
            log('\nPlease run this command manually in PowerShell:', colors.bright);
            log('  Install-Module -Name EpiCloud -Force', colors.cyan);
        }
    } else {
        log('\nFirst install PowerShell Core, then run:', colors.bright);
        log('  pwsh -Command "Install-Module -Name EpiCloud -Force"', colors.cyan);
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
    const psOk = await checkPowerShell();
    if (!psOk) allGood = false;
    
    // Check EpiCloud only if PowerShell is installed
    if (psOk) {
        const epiOk = await checkEpiCloud();
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
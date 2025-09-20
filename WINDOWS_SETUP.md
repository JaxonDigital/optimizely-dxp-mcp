# Windows Setup Guide for Jaxon Optimizely DXP MCP

This guide provides detailed instructions for setting up the Jaxon Optimizely DXP MCP server on Windows systems.

## Prerequisites

### 1. PowerShell Core (Required)
The MCP server requires PowerShell Core (pwsh), not Windows PowerShell.

#### Check if PowerShell Core is installed:
```powershell
pwsh --version
```

#### Install PowerShell Core:

**Option A: Using WinGet (Recommended)**
```powershell
winget install --id Microsoft.PowerShell --source winget
```

**Option B: Using MSI Installer**
1. Download from: https://github.com/PowerShell/PowerShell/releases
2. Choose the `.msi` file for your architecture (x64 or x86)
3. Run the installer with administrator privileges

**Option C: Using Chocolatey**
```powershell
choco install powershell-core
```

### 2. Node.js (Required)
Minimum version: Node.js 18.0.0 or higher

#### Install Node.js:
1. Download from: https://nodejs.org/
2. Choose the LTS version
3. Run the installer
4. Verify installation:
```powershell
node --version
npm --version
```

### 3. Git (Recommended)
For version control and repository management.

```powershell
winget install --id Git.Git --source winget
```

## Installation Steps

### Step 1: Install the MCP Server

**Global Installation (Recommended):**
```powershell
npm install -g jaxon-optimizely-dxp-mcp@latest
```

**Verify Installation:**
```powershell
jaxon-optimizely-dxp-mcp --version
```

### Step 2: Install EpiCloud PowerShell Module

Open PowerShell Core as Administrator:
```powershell
# Set execution policy if needed
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Install EpiCloud module
Install-Module -Name EpiCloud -Force -AllowClobber

# Import and verify
Import-Module EpiCloud
Get-Module EpiCloud
```

### Step 3: Configure Claude Desktop

1. **Locate Claude Desktop configuration:**
   - Windows 10/11: `%APPDATA%\Claude\claude_desktop_config.json`
   - Typical path: `C:\Users\[YourUsername]\AppData\Roaming\Claude\claude_desktop_config.json`

2. **Create/Edit configuration:**
   
   Create the directory if it doesn't exist:
   ```powershell
   New-Item -ItemType Directory -Force -Path "$env:APPDATA\Claude"
   ```

3. **Add MCP server configuration:**
   ```json
   {
     "mcpServers": {
       "jaxon-optimizely-dxp": {
         "command": "jaxon-optimizely-dxp-mcp",
         "env": {
           "OPTIMIZELY_PROJECT_NAME": "Your Project Name",
           "OPTIMIZELY_PROJECT_ID": "your-project-id",
           "OPTIMIZELY_API_KEY": "your-api-key",
           "OPTIMIZELY_API_SECRET": "your-api-secret"
         }
       }
     }
   }
   ```

4. **Restart Claude Desktop:**
   - Close Claude Desktop completely (check system tray)
   - Restart the application

## Windows-Specific Troubleshooting

### Issue 1: "pwsh is not recognized"

**Problem:** PowerShell Core is not in system PATH

**Solution:**
1. Add PowerShell Core to PATH:
   ```powershell
   [Environment]::SetEnvironmentVariable(
     "Path",
     "$env:Path;C:\Program Files\PowerShell\7",
     [EnvironmentVariableTarget]::User
   )
   ```
2. Restart your terminal/PowerShell session

### Issue 2: "Execution of scripts is disabled"

**Problem:** PowerShell execution policy blocks scripts

**Solution:**
```powershell
# For current user only (safer)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or for all users (requires admin)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine
```

### Issue 3: "Cannot find module EpiCloud"

**Problem:** EpiCloud module not installed or not in module path

**Solution:**
```powershell
# Check module paths
$env:PSModulePath -split ';'

# Install to user scope
Install-Module -Name EpiCloud -Scope CurrentUser -Force

# Or install to all users (requires admin)
Install-Module -Name EpiCloud -Scope AllUsers -Force
```

### Issue 4: Claude Desktop doesn't detect MCP server

**Problem:** Configuration file in wrong location or format

**Solution:**
1. Verify config location:
   ```powershell
   # Check if file exists
   Test-Path "$env:APPDATA\Claude\claude_desktop_config.json"
   
   # View current config
   Get-Content "$env:APPDATA\Claude\claude_desktop_config.json" | ConvertFrom-Json | ConvertTo-Json -Depth 10
   ```

2. Validate JSON syntax:
   ```powershell
   # Test JSON validity
   try {
     $json = Get-Content "$env:APPDATA\Claude\claude_desktop_config.json" -Raw | ConvertFrom-Json
     Write-Host "JSON is valid" -ForegroundColor Green
   } catch {
     Write-Host "JSON is invalid: $_" -ForegroundColor Red
   }
   ```

### Issue 5: Permission errors when running commands

**Problem:** Insufficient permissions for DXP operations

**Solution:**
1. Run PowerShell Core as Administrator for initial setup
2. Ensure your API credentials have proper permissions in DXP
3. Check Windows Defender or antivirus isn't blocking operations

### Issue 6: Long path issues

**Problem:** Windows path length limitation (260 characters)

**Solution:**
Enable long path support:
```powershell
# Requires Administrator privileges
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

## Environment Variables

### Setting Environment Variables on Windows

**Method 1: System Properties GUI**
1. Press `Win + X`, select "System"
2. Click "Advanced system settings"
3. Click "Environment Variables"
4. Add/Edit variables in User or System section

**Method 2: PowerShell (Persistent)**
```powershell
# Set for current user
[Environment]::SetEnvironmentVariable("OPTIMIZELY_PROJECT_ID", "your-id", "User")
[Environment]::SetEnvironmentVariable("OPTIMIZELY_API_KEY", "your-key", "User")
[Environment]::SetEnvironmentVariable("OPTIMIZELY_API_SECRET", "your-secret", "User")

# Verify
[Environment]::GetEnvironmentVariable("OPTIMIZELY_PROJECT_ID", "User")
```

**Method 3: Command Prompt (Persistent)**
```cmd
setx OPTIMIZELY_PROJECT_ID "your-id"
setx OPTIMIZELY_API_KEY "your-key"
setx OPTIMIZELY_API_SECRET "your-secret"
```

## Testing Your Setup

### 1. Test PowerShell Core:
```powershell
pwsh -Command "Write-Host 'PowerShell Core is working' -ForegroundColor Green"
```

### 2. Test EpiCloud Module:
```powershell
pwsh -Command "Import-Module EpiCloud; Get-Module EpiCloud"
```

### 3. Test MCP Server:
```powershell
# Test initialization
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1.0.0","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | jaxon-optimizely-dxp-mcp
```

### 4. Test with Claude Desktop:
1. Open Claude Desktop
2. Type: "Can you list my Optimizely projects?"
3. The MCP server should respond with project information

## Windows Defender Configuration

If Windows Defender blocks operations, add exclusions:

```powershell
# Add folder exclusion (requires admin)
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\npm"
Add-MpPreference -ExclusionPath "$env:APPDATA\npm"

# Add process exclusion
Add-MpPreference -ExclusionProcess "pwsh.exe"
Add-MpPreference -ExclusionProcess "node.exe"
```

## Performance Optimization

### 1. Disable Windows Search indexing for node_modules:
```powershell
# Exclude npm directories from indexing
$path = "$env:LOCALAPPDATA\npm"
$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace($path)
$folder.Self.InvokeVerb("Properties")
# Uncheck "Allow files in this folder to have contents indexed"
```

### 2. Use Windows Terminal for better performance:
```powershell
winget install --id Microsoft.WindowsTerminal --source winget
```

### 3. Configure npm for Windows:
```powershell
# Use shorter paths
npm config set cache "C:\npm-cache" --global
npm config set prefix "C:\npm" --global

# Add to PATH
[Environment]::SetEnvironmentVariable(
  "Path",
  "$env:Path;C:\npm",
  [EnvironmentVariableTarget]::User
)
```

## Firewall Configuration

If you encounter network issues:

```powershell
# Allow Node.js through firewall (requires admin)
New-NetFirewallRule -DisplayName "Node.js" -Direction Inbound -Program "C:\Program Files\nodejs\node.exe" -Action Allow
New-NetFirewallRule -DisplayName "Node.js" -Direction Outbound -Program "C:\Program Files\nodejs\node.exe" -Action Allow

# Allow PowerShell Core
New-NetFirewallRule -DisplayName "PowerShell Core" -Direction Outbound -Program "C:\Program Files\PowerShell\7\pwsh.exe" -Action Allow
```

## Logging and Debugging

### Enable debug logging:
```powershell
# Set debug environment variable
$env:DEBUG = "true"

# Run with verbose output
jaxon-optimizely-dxp-mcp 2>&1 | Tee-Object -FilePath "mcp-debug.log"
```

### View MCP logs:
```powershell
# Default log location
Get-Content "$env:TEMP\claude-mcp.log" -Tail 50 -Wait
```

## Common Windows-Specific Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `The term 'pwsh' is not recognized` | PowerShell Core not installed | Install PowerShell Core |
| `cannot be loaded because running scripts is disabled` | Execution policy | Set-ExecutionPolicy RemoteSigned |
| `Module 'EpiCloud' was not found` | Module not installed | Install-Module EpiCloud -Force |
| `Access to the path is denied` | Permission issue | Run as Administrator |
| `The specified path is too long` | Path length limit | Enable long paths in registry |
| `ENOENT: no such file or directory` | Path separators | Use forward slashes in Node.js |

## Getting Help

If you encounter issues not covered here:

1. **Check installation:**
   ```powershell
   jaxon-optimizely-dxp-mcp --version
   pwsh --version
   node --version
   ```

2. **Enable debug mode:**
   ```powershell
   $env:DEBUG = "true"
   ```

3. **Contact Support:**
   - Email: support@jaxondigital.com
   - GitHub Issues: https://github.com/JaxonDigital/optimizely-dxp-mcp/issues

## Additional Resources

- [PowerShell Core Documentation](https://docs.microsoft.com/en-us/powershell/)
- [Node.js on Windows](https://nodejs.org/en/docs/guides/getting-started-on-windows/)
- [Claude Desktop Documentation](https://docs.anthropic.com/en/docs/claude-desktop)
- [Optimizely DXP Documentation](https://docs.developers.optimizely.com/digital-experience-platform/docs)

---

*Built by Jaxon Digital - Optimizely Gold Partner*
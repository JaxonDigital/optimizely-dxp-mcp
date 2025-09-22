/**
 * Deployment Helper Tools Module
 * Provides enhanced capabilities for handling large deployments
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');
const PowerShellCommandBuilder = require('../powershell-command-builder');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class DeploymentHelperTools {
    /**
     * Prepare deployment package with optimizations
     * This helps create properly structured packages for DXP
     */
    static async handlePrepareDeploymentPackage(args) {
        const { sourcePath, outputPath, excludePatterns } = args;
        
        if (!sourcePath) {
            return ResponseBuilder.invalidParams('Source path is required');
        }

        try {
            const result = await this.prepareDeploymentPackage(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Prepare package error:', error);
            return ResponseBuilder.internalError('Failed to prepare package', error.message);
        }
    }

    static async prepareDeploymentPackage(args) {
        const { sourcePath, outputPath, excludePatterns = [] } = args;
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        console.error(`Preparing deployment package from ${sourcePath}`);
        
        // Default exclude patterns for DXP deployments
        const defaultExcludes = [
            '*.pdb',
            '*.xml',
            'node_modules/**',
            '.git/**',
            '.vs/**',
            'packages/**',
            'obj/**',
            '*.user',
            '*.suo'
        ];
        
        const allExcludes = [...defaultExcludes, ...excludePatterns];
        
        // Build PowerShell command to create optimized package
        const psScript = `
            $sourcePath = '${sourcePath}'
            $outputPath = '${outputPath || path.join(sourcePath, '../deployment-package.zip')}'
            
            # Create exclude filter
            $excludes = @(${allExcludes.map(p => `'${p}'`).join(',')})
            
            # Check source size
            $sourceSize = (Get-ChildItem -Path $sourcePath -Recurse | Measure-Object -Property Length -Sum).Sum
            $sourceSizeMB = [math]::Round($sourceSize / 1MB, 2)
            
            Write-Host "Source size: $sourceSizeMB MB"
            
            # Create zip with compression
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::CreateFromDirectory($sourcePath, $outputPath, 'Optimal', $false)
            
            # Get final package size
            $packageSize = (Get-Item $outputPath).Length
            $packageSizeMB = [math]::Round($packageSize / 1MB, 2)
            
            # Output result
            @{
                SourcePath = $sourcePath
                OutputPath = $outputPath
                SourceSizeMB = $sourceSizeMB
                PackageSizeMB = $packageSizeMB
                CompressionRatio = [math]::Round(($sourceSize - $packageSize) / $sourceSize * 100, 2)
            } | ConvertTo-Json
        `;
        
        const result = await PowerShellHelper.executePowerShell(psScript, { parseJson: true });
        
        if (result.parsedData) {
            const data = result.parsedData;
            let response = `${STATUS_ICONS.SUCCESS} **Deployment Package Prepared**\n\n`;
            response += `**Source:** ${data.SourcePath}\n`;
            response += `**Package:** ${data.OutputPath}\n`;
            response += `**Size Reduction:** ${data.SourceSizeMB}MB → ${data.PackageSizeMB}MB (${data.CompressionRatio}% compression)\n\n`;
            
            if (data.PackageSizeMB > 100) {
                response += `${STATUS_ICONS.WARNING} **Large Package Warning**\n`;
                response += `Package is ${data.PackageSizeMB}MB. Consider:\n`;
                response += `• Using SAS upload for better reliability\n`;
                response += `• Splitting into smaller packages\n`;
                response += `• Excluding unnecessary files\n\n`;
            }
            
            response += `**Next Steps:**\n`;
            response += `• Use \`upload_deployment_package\` to upload\n`;
            response += `• Or use \`generate_sas_upload_url\` for direct upload\n`;
            
            return ResponseBuilder.addFooter(response);
        }
        
        return ResponseBuilder.addFooter('Package prepared successfully');
    }

    /**
     * Generate SAS upload URL for direct package upload
     * This is more reliable for large files
     */
    static async handleGenerateSasUploadUrl(args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment) {
            return ResponseBuilder.invalidParams('Missing required parameters');
        }

        try {
            const result = await this.generateSasUploadUrl(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Generate SAS upload URL error:', error);
            return ResponseBuilder.internalError('Failed to generate upload URL', error.message);
        }
    }

    static async generateSasUploadUrl(args) {
        const { apiKey, apiSecret, projectId, environment } = args;
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        console.error(`Generating SAS upload URL for ${environment}`);
        
        // First, get the deployment storage container
        const containerCommand = PowerShellCommandBuilder.create('Get-EpiStorageContainer')
            .addParam('ProjectId', projectId)
            .addParam('ClientKey', apiKey)
            .addParam('ClientSecret', apiSecret)
            .addParam('Environment', environment)
            .build();
        
        const containerResult = await PowerShellHelper.executeEpiCommandDirect(
            containerCommand,
            { parseJson: true }
        );
        
        if (!containerResult.parsedData) {
            return ResponseBuilder.addFooter('Failed to get storage container information');
        }
        
        // Find the deployment container (usually 'deployments' or similar)
        const containers = Array.isArray(containerResult.parsedData) 
            ? containerResult.parsedData 
            : [containerResult.parsedData];
        
        // Look for deployment-specific containers first, then fall back to a media container
        let deploymentContainer = containers.find(c => 
            c.name?.includes('deployment') || 
            c.name?.includes('package') ||
            c.name?.includes('code')
        );
        
        // If no deployment container, create a virtual one for packages
        // Note: In real scenarios, packages should be uploaded via Add-EpiDeploymentPackage
        if (!deploymentContainer) {
            // Use mysitemedia as a fallback or suggest using upload_deployment_package instead
            return ResponseBuilder.addFooter(
                `${STATUS_ICONS.INFO} **No dedicated package container found**\n\n` +
                `For package uploads, please use:\n` +
                `• \`upload_deployment_package\` - Uploads directly to DXP\n` +
                `• \`deploy_package_and_start\` - Upload and deploy in one step\n\n` +
                `Available containers in ${environment}:\n` +
                containers.map(c => `• ${c.name || c.containerName || JSON.stringify(c)}`).join('\n')
            );
        }
        
        // Generate SAS link with Write permissions for upload
        const sasCommand = PowerShellCommandBuilder.create('Get-EpiStorageSasLink')
            .addParam('ProjectId', projectId)
            .addParam('ClientKey', apiKey)
            .addParam('ClientSecret', apiSecret)
            .addParam('Environment', environment)
            .addParam('Container', deploymentContainer.name)
            .addParam('Permissions', 'Write')
            .addParam('ValidMinutes', 120) // 2 hours for upload
            .build();
        
        const sasResult = await PowerShellHelper.executeEpiCommandDirect(
            sasCommand,
            { parseJson: true }
        );
        
        if (sasResult.parsedData?.sasLink || sasResult.parsedData?.url) {
            const uploadUrl = sasResult.parsedData.sasLink || sasResult.parsedData.url;
            
            let response = `${STATUS_ICONS.SUCCESS} **SAS Upload URL Generated**\n\n`;
            response += `**Environment:** ${environment}\n`;
            response += `**Container:** ${deploymentContainer.name}\n`;
            response += `**Expires:** 2 hours\n\n`;
            response += `${STATUS_ICONS.UNLOCK} **Upload URL:**\n`;
            response += `\`${uploadUrl}\`\n\n`;
            response += `**Upload Instructions:**\n`;
            response += `1. Use Azure Storage Explorer or AzCopy\n`;
            response += `2. Or use curl:\n`;
            response += `\`\`\`bash\n`;
            response += `curl -X PUT -H "x-ms-blob-type: BlockBlob" \\\n`;
            response += `  --data-binary @your-package.zip \\\n`;
            response += `  "${uploadUrl.substring(0, 50)}..."\n`;
            response += `\`\`\`\n\n`;
            response += `3. After upload, use \`deploy_package_and_start\` with the blob URL\n`;
            
            return ResponseBuilder.addFooter(response);
        }
        
        return ResponseBuilder.addFooter('Failed to generate SAS upload URL');
    }

    /**
     * Split large package into chunks for easier upload
     */
    static async handleSplitPackage(args) {
        const { packagePath, chunkSizeMB = 50 } = args;
        
        if (!packagePath) {
            return ResponseBuilder.invalidParams('Package path is required');
        }

        try {
            const result = await this.splitPackage(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Split package error:', error);
            return ResponseBuilder.internalError('Failed to split package', error.message);
        }
    }

    static async splitPackage(args) {
        const { packagePath, chunkSizeMB = 50 } = args;
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        console.error(`Splitting package ${packagePath} into ${chunkSizeMB}MB chunks`);
        
        const psScript = `
            $packagePath = '${packagePath}'
            $chunkSize = ${chunkSizeMB * 1024 * 1024}
            
            if (!(Test-Path $packagePath)) {
                throw "Package not found: $packagePath"
            }
            
            $packageInfo = Get-Item $packagePath
            $totalSize = $packageInfo.Length
            $totalSizeMB = [math]::Round($totalSize / 1MB, 2)
            $chunks = [math]::Ceiling($totalSize / $chunkSize)
            
            if ($chunks -le 1) {
                Write-Host "Package is small enough, no splitting needed"
                @{
                    TotalSizeMB = $totalSizeMB
                    Chunks = 1
                    Message = "No splitting needed"
                } | ConvertTo-Json
                return
            }
            
            $outputDir = Join-Path (Split-Path $packagePath -Parent) "chunks"
            New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
            
            # Split the file
            $bytes = [System.IO.File]::ReadAllBytes($packagePath)
            $chunkFiles = @()
            
            for ($i = 0; $i -lt $chunks; $i++) {
                $start = $i * $chunkSize
                $length = [Math]::Min($chunkSize, $totalSize - $start)
                $chunkPath = Join-Path $outputDir ("chunk_{0:D3}.part" -f ($i + 1))
                
                $chunkBytes = New-Object byte[] $length
                [Array]::Copy($bytes, $start, $chunkBytes, 0, $length)
                [System.IO.File]::WriteAllBytes($chunkPath, $chunkBytes)
                
                $chunkFiles += $chunkPath
            }
            
            @{
                TotalSizeMB = $totalSizeMB
                Chunks = $chunks
                ChunkSizeMB = $chunkSizeMB
                OutputDirectory = $outputDir
                ChunkFiles = $chunkFiles
            } | ConvertTo-Json
        `;
        
        const result = await PowerShellHelper.executePowerShell(psScript, { parseJson: true });
        
        if (result.parsedData) {
            const data = result.parsedData;
            
            if (data.Message) {
                return ResponseBuilder.addFooter(
                    `${STATUS_ICONS.INFO} Package is ${data.TotalSizeMB}MB - no splitting needed`
                );
            }
            
            let response = `${STATUS_ICONS.SUCCESS} **Package Split Successfully**\n\n`;
            response += `**Original Size:** ${data.TotalSizeMB}MB\n`;
            response += `**Chunks:** ${data.Chunks} × ${data.ChunkSizeMB}MB\n`;
            response += `**Output:** ${data.OutputDirectory}\n\n`;
            response += `**Chunk Files:**\n`;
            
            if (Array.isArray(data.ChunkFiles)) {
                data.ChunkFiles.slice(0, 5).forEach(file => {
                    if (file) {
                        response += `• ${path.basename(file)}\n`;
                    }
                });
                if (data.ChunkFiles.length > 5) {
                    response += `• ... and ${data.ChunkFiles.length - 5} more\n`;
                }
            }
            
            response += `\n**Next Steps:**\n`;
            response += `• Upload each chunk using \`upload_deployment_package\`\n`;
            response += `• Or use Azure Storage Explorer with the SAS URL\n`;
            
            return ResponseBuilder.addFooter(response);
        }
        
        return ResponseBuilder.addFooter('Package split completed');
    }

    /**
     * Check deployment package requirements and provide recommendations
     */
    static async handleAnalyzePackage(args) {
        const { packagePath } = args;
        
        if (!packagePath) {
            return ResponseBuilder.invalidParams('Package path is required');
        }

        try {
            const result = await this.analyzePackage(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            console.error('Analyze package error:', error);
            return ResponseBuilder.internalError('Failed to analyze package', error.message);
        }
    }

    static async analyzePackage(args) {
        const { packagePath } = args;
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        console.error(`Analyzing package ${packagePath}`);
        
        const psScript = `
            $packagePath = '${packagePath}'
            
            if (!(Test-Path $packagePath)) {
                throw "Package not found: $packagePath"
            }
            
            $packageInfo = Get-Item $packagePath
            $sizeMB = [math]::Round($packageInfo.Length / 1MB, 2)
            
            # Analyze package contents if it's a zip
            $analysis = @{
                Path = $packagePath
                SizeMB = $sizeMB
                LastModified = $packageInfo.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
            }
            
            # Provide recommendations based on size
            $recommendations = @()
            
            if ($sizeMB -gt 500) {
                $recommendations += "Package is very large (>500MB). Use SAS upload for reliability"
                $recommendations += "Consider splitting into multiple deployments"
            } elseif ($sizeMB -gt 100) {
                $recommendations += "Package is large (>100MB). SAS upload recommended"
                $recommendations += "Ensure stable network connection"
            } elseif ($sizeMB -gt 50) {
                $recommendations += "Medium-sized package. Standard upload should work"
                $recommendations += "Consider chunked upload if network is slow"
            } else {
                $recommendations += "Small package. Standard upload will work fine"
            }
            
            # Check if it's a zip file
            if ($packagePath -like "*.zip") {
                try {
                    Add-Type -AssemblyName System.IO.Compression.FileSystem
                    $zip = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
                    $analysis.FileCount = $zip.Entries.Count
                    $analysis.IsValid = $true
                    
                    # Check for DXP structure
                    $hasWwwroot = $zip.Entries | Where-Object { $_.FullName -like "wwwroot/*" }
                    $hasBin = $zip.Entries | Where-Object { $_.FullName -like "bin/*" }
                    $hasModules = $zip.Entries | Where-Object { $_.FullName -like "modules/*" }
                    
                    if ($hasWwwroot) {
                        $analysis.Structure = "CMS Package Detected"
                    } elseif ($hasBin) {
                        $analysis.Structure = "Binary Package Detected"
                    } else {
                        $analysis.Structure = "Unknown Structure"
                        $recommendations += "Package structure not recognized. Verify it's a valid DXP package"
                    }
                    
                    $zip.Dispose()
                } catch {
                    $analysis.IsValid = $false
                    $recommendations += "Failed to read zip file. May be corrupted"
                }
            }
            
            $analysis.Recommendations = $recommendations
            $analysis | ConvertTo-Json
        `;
        
        const result = await PowerShellHelper.executePowerShell(psScript, { parseJson: true });
        
        if (result.parsedData) {
            const data = result.parsedData;
            
            let response = `${STATUS_ICONS.INFO} **Package Analysis**\n\n`;
            response += `**File:** ${path.basename(data.Path)}\n`;
            response += `**Size:** ${data.SizeMB}MB\n`;
            response += `**Modified:** ${data.LastModified}\n`;
            
            if (data.FileCount) {
                response += `**Files:** ${data.FileCount}\n`;
            }
            
            if (data.Structure) {
                response += `**Type:** ${data.Structure}\n`;
            }
            
            if (data.IsValid !== undefined) {
                response += `**Valid Zip:** ${data.IsValid ? '✅ Yes' : '❌ No'}\n`;
            }
            
            response += `\n**Recommendations:**\n`;
            if (Array.isArray(data.Recommendations)) {
                data.Recommendations.forEach(rec => {
                    response += `• ${rec}\n`;
                });
            }
            
            response += `\n**Upload Options:**\n`;
            if (data.SizeMB > 100) {
                response += `1. **SAS Upload (Recommended)**\n`;
                response += `   • Use \`generate_sas_upload_url\` to get upload URL\n`;
                response += `   • Upload with Azure Storage Explorer or curl\n\n`;
                response += `2. **Split Upload**\n`;
                response += `   • Use \`split_package\` to create chunks\n`;
                response += `   • Upload chunks individually\n\n`;
                response += `3. **Direct Upload**\n`;
                response += `   • Use \`upload_deployment_package\` (may timeout)\n`;
            } else {
                response += `• Use \`upload_deployment_package\` for direct upload\n`;
                response += `• Or use \`generate_sas_upload_url\` for more control\n`;
            }
            
            return ResponseBuilder.addFooter(response);
        }
        
        return ResponseBuilder.addFooter('Package analysis completed');
    }
}

module.exports = DeploymentHelperTools;
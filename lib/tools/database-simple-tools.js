/**
 * Database Tools - Unified database backup and export operations  
 * Part of Jaxon Digital Optimizely DXP MCP Server
 * 
 * This module provides a unified interface for all database operations:
 * - backup: Natural language backup with smart defaults and auto-download
 * - backup_status: Check export/backup status with auto-download capability
 * - list_backups: List recent backup history
 * 
 * Replaces the previous separation between DatabaseSimpleTools and DatabaseTools
 */

const ProjectTools = require('./project-tools');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const OutputLogger = require('../output-logger');
const PowerShellHelper = require('../powershell-helper');
const PowerShellCommandBuilder = require('../powershell-command-builder');
const Config = require('../config');
const CapabilityDetector = require('../capability-detector');
const SettingsManager = require('../settings-manager');
const DownloadConfig = require('../download-config');

class DatabaseSimpleTools {
    
    // Static registry for background monitoring processes
    static backgroundMonitors = new Map();
    
    /**
     * Internal method to handle database export (replaces this.internalExportDatabase)
     */
    static async internalExportDatabase(args) {
        // Validate parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment || !args.databaseName) {
            return ResponseBuilder.invalidParams('Missing required parameters for database export');
        }

        try {
            const { apiKey, apiSecret, projectId, environment, databaseName, retentionHours = 168 } = args;
            
            OutputLogger.info(`Starting database export for ${databaseName} in ${environment}`);

            // Build command using the PowerShell command builder
            const command = new PowerShellCommandBuilder('Start-EpiDatabaseExport')
                .addParam('ProjectId', projectId)
                .addParam('Environment', environment)
                .addParam('DatabaseName', databaseName)
                .addParam('RetentionHours', retentionHours)
                .buildCommand();
            
            // Execute command
            const result = await PowerShellHelper.executePowerShellCommand(command, {
                credentials: { apiKey, apiSecret, projectId },
                parseJson: true
            });

            return ResponseBuilder.success(`Database export initiated.\n${result.stdout || result}`);
        } catch (error) {
            OutputLogger.error(`Database export error: ${error.message}`);
            return ResponseBuilder.internalError('Database export failed', error.message);
        }
    }
    
    /**
     * Internal method to check database export status (replaces this.internalCheckExportStatus)
     */
    static async internalCheckExportStatus(args) {
        // Validate parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.exportId) {
            return ResponseBuilder.invalidParams('Missing required parameters for export status check');
        }

        try {
            const { apiKey, apiSecret, projectId, exportId } = args;
            
            // Build command using the PowerShell command builder
            const command = new PowerShellCommandBuilder('Get-EpiDatabaseExport')
                .addParam('ProjectId', projectId)
                .addParam('Id', exportId)
                .buildCommand();
            
            // Execute command
            const result = await PowerShellHelper.executePowerShellCommand(command, {
                credentials: { apiKey, apiSecret, projectId },
                parseJson: true
            });

            return ResponseBuilder.success(result.stdout || result);
        } catch (error) {
            OutputLogger.error(`Export status check error: ${error.message}`);
            return ResponseBuilder.internalError('Export status check failed', error.message);
        }
    }
    
    /**
     * Unified database export with smart defaults and automatic status monitoring
     * Primary export tool - supports all export scenarios with intelligent defaults
     * Automatically monitors status and provides download capability
     */
    static async handleExportDatabase(args) {
        try {
            const { 
                environment, 
                project, 
                databaseName, 
                dryRun, 
                autoDownload, 
                downloadPath, 
                forceNew,
                useExisting,
                skipConfirmation,
                // Legacy export_database parameters for compatibility
                projectName,
                projectId,
                apiKey,
                apiSecret,
                retentionHours
            } = args;
            
            // Get project configuration - support legacy export_database parameters
            const projectConfig = await this.getProjectConfig(
                project || projectName, 
                {
                    ...args,
                    projectId: projectId || args.projectId,
                    apiKey: apiKey || args.apiKey, 
                    apiSecret: apiSecret || args.apiSecret
                }
            );
            
            // Check permissions first to determine available environments
            const PermissionChecker = require('./permission-checker');
            const permissions = await PermissionChecker.getOrCheckPermissionsSafe(projectConfig);
            
            // Smart environment selection
            let targetEnv;
            
            if (!environment) {
                // No environment specified - use smart defaults
                if (permissions.accessible.length === 0) {
                    return ResponseBuilder.error(
                        `❌ No accessible environments found. Please check your API key permissions.`
                    );
                } else if (permissions.accessible.length === 1) {
                    // Single environment configuration - use it automatically
                    targetEnv = permissions.accessible[0];
                    OutputLogger.debug(`Using your configured environment: ${targetEnv}`);
                } else {
                    // Multiple environments - prefer Production for backups
                    targetEnv = permissions.accessible.includes('Production') ? 'Production' : 
                               permissions.accessible.includes('Preproduction') ? 'Preproduction' : 
                               'Integration';
                    OutputLogger.debug(`No environment specified - defaulting to ${targetEnv} for backup`);
                }
            } else {
                // Environment was specified - parse and validate
                targetEnv = this.parseEnvironment(environment);
                
                // Check if user has access to the requested environment
                if (!permissions.accessible.includes(targetEnv)) {
                    let response = `ℹ️ **Access Level Check**\n\n`;
                    response += `You requested to export from **${targetEnv}** environment.\n\n`;
                    response += `**Your access level:** ${permissions.accessible.join(', ')} environment${permissions.accessible.length > 1 ? 's' : ''}\n\n`;
                    
                    if (permissions.accessible.length === 1) {
                        response += `💡 **Tip:** Since you only have access to ${permissions.accessible[0]}, \n`;
                        response += `run the command without specifying an environment to automatically use it:\n`;
                        response += `\`export_database\` (will use ${permissions.accessible[0]})\n`;
                    } else if (permissions.accessible.length > 1) {
                        response += `**Available Options:**\n`;
                        permissions.accessible.forEach(env => {
                            response += `• Export from ${env}: \`export_database environment: "${env}"\`\n`;
                        });
                    }
                    
                    return ResponseBuilder.success(response);
                }
            }
            
            const dbName = databaseName || 'epicms'; // Most common database name
            
            // Get download path for preview (don't create yet, just for display)
            const resolvedDownloadPath = await DownloadConfig.getDownloadPath(
                'database',
                projectConfig.name,
                downloadPath,
                targetEnv
            );
            
            // Check for existing available backup (unless forcing new)
            if (!forceNew) {
                const existingBackup = await this.findAvailableBackup(projectConfig, targetEnv, dbName);
                if (existingBackup) {
                    // Determine if we should use the existing backup
                    let shouldUseExisting = false;
                    
                    if (useExisting) {
                        // User explicitly wants to use existing
                        shouldUseExisting = true;
                        OutputLogger.debug('Using existing backup as requested (--use-existing)');
                    } else if (!forceNew) {
                        // Check if backup is fresh enough to auto-use
                        const oneHourAgo = Date.now() - (60 * 60 * 1000);
                        const exportTime = new Date(existingBackup.startTime || existingBackup.completedAt).getTime();
                        
                        if (exportTime > oneHourAgo) {
                            shouldUseExisting = true;
                            OutputLogger.debug('Auto-using recent backup (less than 1 hour old)');
                        } else {
                            // Backup is 1-24 hours old, inform user but don't auto-use
                            const timeAgo = this.getTimeAgo(existingBackup.startTime || existingBackup.completedAt);
                            OutputLogger.warn(`📦 Found backup from ${timeAgo}`);
                            OutputLogger.debug('Add --use-existing to use it, or --force-new for a fresh backup');
                            OutputLogger.debug('Proceeding with new backup...\n');
                            shouldUseExisting = false;
                        }
                    }
                    
                    if (shouldUseExisting) {
                        OutputLogger.debug('Using existing completed backup');
                        
                        // If auto-download requested, download the existing backup
                        if (autoDownload) {
                            const validated = await DownloadConfig.getValidatedDownloadPath(
                                'database',
                                projectConfig.name,
                                downloadPath,
                                targetEnv
                            );
                            
                            if (!validated.valid) {
                                throw new Error(`Invalid download path: ${validated.error}`);
                            }
                            
                            const downloadDir = validated.path;
                            const capabilityCheck = await CapabilityDetector.checkAutoDownloadCapability(downloadDir, 100 * 1024 * 1024);
                            
                            if (capabilityCheck.canAutoDownload) {
                                try {
                                    await this.downloadExistingBackup(existingBackup, projectConfig, downloadDir, targetEnv, dbName);
                                    
                                    return ResponseBuilder.success(
                                        `✅ **Existing Backup Downloaded**\n\nFound a recent backup from ${this.getTimeAgo(existingBackup.startTime || existingBackup.completedAt)} and downloaded it successfully.\n\n📁 **Location**: ${downloadDir}\n💡 **Tip**: Use \`--force-new\` to create a fresh backup instead.`
                                    );
                                } catch (error) {
                                    OutputLogger.error('Failed to download existing backup:', error.message);
                                    // Fall through to create new backup
                                }
                            } else {
                                return ResponseBuilder.success(
                                    `✅ **Existing Backup Available**\n\nFound a recent backup from ${this.getTimeAgo(existingBackup.startTime || existingBackup.completedAt)}.\n\n**Export ID**: ${existingBackup.exportId}\n**Status**: Complete\n\n⚠️ **Auto-download not available**:\n${capabilityCheck.issues.join('\n')}\n\n💡 Use \`claude "backup status"\` to get the download URL.`
                                );
                            }
                        } else {
                            return ResponseBuilder.success(
                                `✅ **Recent Backup Available**\n\nFound a recent backup from ${this.getTimeAgo(existingBackup.startTime || existingBackup.completedAt)}.\n\n**Export ID**: ${existingBackup.exportId}\n**Status**: Complete\n\n💡 **Next Steps**:\n- Use \`claude "backup status"\` to get download URL\n- Add \`--auto-download\` to download automatically\n- Use \`--force-new\` to create a fresh backup instead`
                            );
                        }
                    }
                }
            }
            
            // Dry run preview
            if (dryRun) {
                const preview = `🧪 **Database Backup Preview**

**Project**: ${projectConfig.name}
**Environment**: ${targetEnv}
**Database**: ${dbName}

**What will happen**:
1. Create backup of ${dbName} database from ${targetEnv}
2. Store backup in your DXP storage container
3. Backup will be available for 7 days
4. You'll receive an export ID to track progress
${autoDownload ? '5. Automatically download the backup when complete' : ''}

**Storage Location**: 
Your backup will be stored in: \`${projectConfig.name.toLowerCase()}-${targetEnv.toLowerCase()}/database-backups/\`
${autoDownload ? `\n**Download Location**: ${await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, targetEnv)}` : ''}

**To execute**: Run the same command without --dry-run`;

                return ResponseBuilder.success(preview);
            }
            
            // Show what's about to happen (unless skipConfirmation is true)
            if (!skipConfirmation) {
                OutputLogger.debug(`\n📊 **Starting Database Export**`);
                OutputLogger.debug(`   • **Project:** ${projectConfig.name}`);
                OutputLogger.debug(`   • **Environment:** ${targetEnv}`);
                OutputLogger.debug(`   • **Database:** ${dbName}`);
                OutputLogger.debug(`   • **Download to:** ${resolvedDownloadPath}`);
                OutputLogger.debug(`   • **Auto-download:** ${autoDownload !== false ? 'Enabled' : 'Disabled'}`);
                OutputLogger.debug(`   • **Monitoring:** Will track progress automatically\n`);
            }
            
            // Starting database backup silently to avoid JSON parsing issues
            
            // Execute backup with the traditional tool
            let result = await this.internalExportDatabase({
                projectId: projectConfig.projectId,
                projectName: projectConfig.name,
                environment: targetEnv,
                databaseName: dbName,
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret,
                retentionHours: retentionHours || undefined // Use PowerShell default if not specified
            });

            // SMART CONFLICT RESOLUTION: Handle "operation already in progress" intelligently
            if (result.isError && result.content && result.content[0] && 
                result.content[0].text && (
                    result.content[0].text.includes('Another operation is currently running') ||
                    result.content[0].text.includes('Operation Already In Progress') ||
                    result.content[0].text.includes('already running') ||
                    result.content[0].text.includes('on-going')
                )) {
                OutputLogger.debug('🔍 Export blocked by existing operation - checking for intelligent resolution...');
                
                const resolution = await this.resolveExportConflict(targetEnv, dbName, projectConfig, downloadPath);
                if (resolution.resolved) {
                    return resolution.result;
                }
                // If not resolved, continue with original error
            }
            
            // Store export info for easy status checking
            if (result.result) {
                const exportId = this.extractExportId(result);
                
                // DEBUG: Log export ID extraction
                OutputLogger.debug(`🔍 Export ID extraction result: ${exportId || 'FAILED'}`);
                if (result.result.content && result.result.content[0]) {
                    OutputLogger.debug(`🔍 Response content: ${result.result.content[0].text.substring(0, 200)}...`);
                }
                
                await this.storeBackupInfo(projectConfig.name, {
                    exportId: exportId,
                    environment: targetEnv,
                    databaseName: dbName,
                    startTime: new Date().toISOString()
                });
                
                // ALWAYS start background monitoring by default (as requested)
                // This ensures monitoring happens regardless of autoDownload setting
                if (exportId) {
                    OutputLogger.debug(`✅ Export ID found: ${exportId} - Starting monitoring setup...`);
                    const validated = await DownloadConfig.getValidatedDownloadPath(
                        'database',
                        projectConfig.name,
                        downloadPath,
                        targetEnv
                    );
                    
                    if (!validated.valid) {
                        throw new Error(`Invalid download path: ${validated.error}`);
                    }
                    
                    const downloadDir = validated.path;
                    
                    // Check download capabilities for appropriate messaging
                    const capabilityCheck = await CapabilityDetector.checkAutoDownloadCapability(downloadDir, 100 * 1024 * 1024);
                    
                    // Store export state for polling-based monitoring (MCP servers don't support true background processes)
                    OutputLogger.success(`🚀 Export monitoring configured - use 'check export status' to monitor progress`);
                    OutputLogger.debug(`💡 Auto-download will trigger when you check status and export is complete`);
                    
                    // Store persistent state
                    await this.saveCurrentExportState({
                        exportId,
                        projectConfig: projectConfig.name,
                        projectId: projectConfig.projectId,
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret,
                        environment: targetEnv,
                        databaseName: dbName,
                        downloadPath: downloadDir,
                        autoDownload: capabilityCheck.canAutoDownload,
                        startTime: new Date().toISOString()
                    });
                    
                    // Start background monitoring automatically
                    if (autoDownload !== false) {
                        OutputLogger.debug(`🔄 Starting automatic background monitoring for export ${exportId}`);
                        this.startBackgroundMonitoring(exportId, projectConfig, targetEnv, dbName, downloadDir);
                    }
                    
                    // Generate appropriate monitoring message based on capabilities
                    let monitoringMessage = '';
                    if (autoDownload !== false) {
                        monitoringMessage = `\n\n✅ **Automatic Monitoring Active**: Checking progress every 30 seconds\n📊 **Status**: Background monitoring will complete the download automatically`;
                    } else {
                        monitoringMessage = `\n\n🔄 **Monitoring**: Use \`check export status\` to monitor progress\n📊 **Status Checking**: Manual - run status command periodically`;
                    }
                    
                    if (capabilityCheck.canAutoDownload) {
                        monitoringMessage += `\n✅ **Auto-Download**: Will trigger when you check status and export is complete`;
                    } else {
                        monitoringMessage += `\n🔗 **Download URL**: Will be provided when export completes`;
                        if (capabilityCheck.capabilities.client && capabilityCheck.capabilities.client.isClaudeDesktop) {
                            monitoringMessage += `\n💡 **Tip**: Use Claude Code CLI for auto-download: \`claude "export prod db"\``;
                        }
                        if (capabilityCheck.issues.length > 0) {
                            monitoringMessage += `\n⚠️ **Note**: ${capabilityCheck.issues[0]}`;
                        }
                    }
                    
                    // Extract the original message from the result and enhance it
                    let originalMessage = '';
                    if (result.result && result.result.content && result.result.content[0] && result.result.content[0].text) {
                        originalMessage = result.result.content[0].text;
                    } else if (result.content && result.content[0] && result.content[0].text) {
                        originalMessage = result.content[0].text;
                    } else if (typeof result === 'string') {
                        originalMessage = result;
                    } else if (result.message) {
                        originalMessage = result.message;
                    } else {
                        originalMessage = 'Database export started successfully';
                    }
                    
                    // Build enhanced response with monitoring info
                    const enhancedMessage = originalMessage + monitoringMessage + `\n\n💡 **Export typically takes 5-30 minutes**\n⏰ **Reminder**: Check progress with \`check export status\` periodically`;
                    
                    // Return properly formatted response
                    result = ResponseBuilder.success(enhancedMessage);
                } else {
                    OutputLogger.error(`❌ No export ID extracted - monitoring cannot start!`);
                    OutputLogger.debug(`💡 Manual status checking will be required using backup status tool`);
                }
                
                // Background monitoring is now always enabled above
            } else {
                OutputLogger.error(`❌ Export may have failed - no success result detected`);
            }
            
            return result;
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'backup', args);
        }
    }
    
    /**
     * Unified export status checker with auto-download capability
     * Primary status tool - handles all export status checking scenarios
     * Supports automatic download monitoring and completion detection
     */
    static async handleExportStatus(args) {
        try {
            const { 
                exportId, 
                project, 
                latest,
                // Legacy check_export_status parameters for compatibility
                projectName,
                projectId,
                apiKey,
                apiSecret
            } = args;
            
            // Get project configuration - support legacy check_export_status parameters  
            const projectConfig = await this.getProjectConfig(
                project || projectName,
                {
                    ...args,
                    projectId: projectId || args.projectId,
                    apiKey: apiKey || args.apiKey,
                    apiSecret: apiSecret || args.apiSecret
                }
            );

            // AUTO-RECOVERY: Check for interrupted exports and resume monitoring
            await this.detectAndOfferRecovery(projectConfig);
            
            // Check for current export state first (for auto-download)
            const currentState = await this.loadCurrentExportState();
            let targetExportId = exportId;
            let backupEnvironment, backupDatabase, backupStartTime;
            let isCurrentExport = false;
            let shouldAutoDownload = false;
            let downloadPath = null;
            
            // Priority 1: Use current export if it matches the project and no specific exportId requested
            if (!exportId && currentState.currentExport && 
                currentState.currentExport.projectConfig === projectConfig.name) {
                targetExportId = currentState.currentExport.exportId;
                backupEnvironment = currentState.currentExport.environment;
                backupDatabase = currentState.currentExport.databaseName;
                backupStartTime = currentState.currentExport.startTime;
                isCurrentExport = true;
                shouldAutoDownload = currentState.currentExport.autoDownload;
                downloadPath = currentState.currentExport.downloadPath;
                
                OutputLogger.debug(`Found active export for auto-download: ${targetExportId}`);
            }
            // Priority 2: Use specified exportId or latest backup
            else {
                if (!targetExportId || latest) {
                    const latestBackup = await this.getLatestBackup(projectConfig.name);
                    if (!latestBackup) {
                        return ErrorHandler.handleError(
                            new Error('No recent backups found. Run `claude "backup database"` to create one.'),
                            'backup-status',
                            { project: projectConfig.name }
                        );
                    }
                    targetExportId = latestBackup.exportId;
                    backupEnvironment = latestBackup.environment;
                    backupDatabase = latestBackup.databaseName || 'epicms';
                    backupStartTime = latestBackup.startTime;
                } else {
                    // For specific exportId, try to find environment from backup history first
                    const backups = await this.getBackupHistory(projectConfig.name, 20);
                    const targetBackup = backups.find(b => b.exportId === targetExportId);
                    
                    if (targetBackup) {
                        // Found in backup history
                        backupEnvironment = targetBackup.environment;
                        backupDatabase = targetBackup.databaseName || 'epicms';
                        backupStartTime = targetBackup.startTime;
                    } else {
                        // Not in backup history - try to get info from recent exports state
                        const state = await this.loadCurrentExportState();
                        const recentExport = state.recentExports?.find(e => e.exportId === targetExportId);
                        
                        if (recentExport) {
                            // Found in recent exports state
                            backupEnvironment = recentExport.environment;
                            backupDatabase = recentExport.databaseName || 'epicms';
                            backupStartTime = recentExport.startTime;
                        } else {
                            // Last resort: try all environments (Integration most common for new exports)
                            backupEnvironment = 'Integration';
                            backupDatabase = 'epicms';
                            backupStartTime = null; // Unknown start time
                            OutputLogger.debug(`Export ${targetExportId} not found in history. Trying default environment: ${backupEnvironment}`);
                        }
                    }
                }
            }
            
            // Critical validation: The environment MUST be preserved
            if (!backupEnvironment) {
                return ErrorHandler.handleError(
                    new Error(`Backup environment missing for export ${targetExportId}. Original environment not preserved.`),
                    'backup status',
                    { project: projectConfig.name, exportId: targetExportId }
                );
            }
            
            OutputLogger.debug(`Checking backup status: ${targetExportId} (${backupEnvironment})`);
            
            // Check status using traditional tool
            const result = await this.internalCheckExportStatus({
                projectId: projectConfig.projectId,
                projectName: projectConfig.name,
                exportId: targetExportId,
                environment: backupEnvironment,
                databaseName: backupDatabase,
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret
            });
            
            // Handle the response and auto-download if complete
            if (result.isSuccess) {
                const status = this.parseExportStatus(result);
                
                if (status.isComplete) {
                    // If this was the current export with auto-download, download it now
                    if (isCurrentExport && shouldAutoDownload && status.downloadUrl) {
                        try {
                            OutputLogger.success('🎉 Auto-download export complete! Checking size...');
                            
                            // Perform the download (with confirmation check)
                            const downloadResult = await this.downloadFromUrl(
                                status.downloadUrl, 
                                downloadPath, 
                                projectConfig.name, 
                                backupEnvironment, 
                                backupDatabase,
                                skipConfirmation || false // Use parameter or default to false
                            );
                            
                            // Check if confirmation is required
                            if (downloadResult.requiresConfirmation) {
                                return ResponseBuilder.success(downloadResult.message);
                            }
                            
                            // Clear the current export state since it's complete
                            await this.clearCurrentExportState();
                            
                            const timeDisplay = backupStartTime ? 
                                `**Time**: ${this.getElapsedTimeWithContext(backupStartTime, true)}\n` : '';
                            
                            const enhancedMessage = `✅ **Auto-Download Complete!**

**Export ID**: ${targetExportId}
**Status**: ${status.status}
${timeDisplay}**Downloaded To**: ${downloadResult.filepath}
**File Size**: ${downloadResult.fileSize}

🎯 Your backup has been automatically downloaded and is ready to use!

**Next Steps**:
1. The backup is saved locally at the path above
2. To restore, use the Optimizely DXP Portal
3. The backup will remain available in DXP for 7 days

💡 **Auto-download completed as requested!**`;
                            
                            return ResponseBuilder.success(enhancedMessage);
                            
                        } catch (downloadError) {
                            OutputLogger.error('Auto-download failed:', downloadError.message);
                            
                            // Don't clear state on download failure, allow retry
                            const timeDisplay = backupStartTime ? 
                                `**Time**: ${this.getElapsedTimeWithContext(backupStartTime, true)}\n` : '';
                            
                            const fallbackMessage = `✅ **Database Backup Complete** (⚠️ Auto-download failed)

**Export ID**: ${targetExportId}
**Status**: ${status.status}
${timeDisplay}**Download URL**: ${status.downloadUrl}

❌ **Auto-download Error**: ${downloadError.message}

**Next Steps**:
1. Download manually from the URL above
2. Or retry: \`claude "backup status"\` to attempt auto-download again
3. The backup will be available for 7 days

💡 **The backup is ready, but auto-download encountered an issue**`;
                            
                            return ResponseBuilder.success(fallbackMessage);
                        }
                    } else {
                        // Regular completion message
                        const timeDisplay = backupStartTime ? 
                            `**Time**: ${this.getElapsedTimeWithContext(backupStartTime, true)}\n` : '';
                        
                        // Check if we can offer auto-download
                        const capabilityCheck = await CapabilityDetector.checkAutoDownloadCapability(await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, targetEnv), 100 * 1024 * 1024);
                        const autoDownloadOffer = capabilityCheck.canAutoDownload ? 
                            `\n💡 **Want auto-download?** Run: \`claude "backup status --auto-download"\`` : 
                            `\n💡 **Tip**: Save the download URL - it's only available for a limited time`;
                        
                        const enhancedMessage = `✅ **Database Backup Complete**

**Export ID**: ${targetExportId}
**Status**: ${status.status}
${timeDisplay}**Download URL**: ${status.downloadUrl}

**Next Steps**:
1. Download your backup from the URL above
2. The backup will be available for 7 days
3. To restore, use the Optimizely DXP Portal
${autoDownloadOffer}`;
                        
                        return ResponseBuilder.success(enhancedMessage);
                    }
                } else {
                    // Still in progress
                    const elapsedTimeMessage = backupStartTime 
                        ? `\n⏱️ **Time**: ${this.getElapsedTimeWithContext(backupStartTime, false)}`
                        : '';
                    
                    const progressMessage = isCurrentExport && shouldAutoDownload
                        ? `\n\n📥 **Auto-download**: Will download automatically when complete (estimated in ${this.estimateRemainingTime()})`
                        : '';
                    
                    const enhancedResult = {
                        ...result,
                        content: [{
                            ...result.content[0],
                            text: result.content[0].text + elapsedTimeMessage + progressMessage
                        }]
                    };
                    
                    return enhancedResult;
                }
            }
            
            return result;
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'backup-status', args);
        }
    }
    
    /**
     * Check auto-download capabilities
     */
    static async handleCheckCapabilities(args) {
        try {
            const { downloadPath } = args;
            // For capability check, we'll use generic values since we're just checking the path
            const targetPath = downloadPath || await DownloadConfig.getDownloadPath('database', null, null, 'Production');
            
            const capabilityReport = await CapabilityDetector.generateCapabilityReport(targetPath);
            
            return ResponseBuilder.success(capabilityReport.report);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'capability-check', args);
        }
    }
    
    /**
     * List recent database exports with status information
     * Primary export history tool
     */
    static async handleListExports(args) {
        try {
            const { project, limit } = args;
            
            // Get project configuration
            const projectConfig = await this.getProjectConfig(project, args);

            // AUTO-RECOVERY: Check for interrupted exports and resume monitoring
            await this.detectAndOfferRecovery(projectConfig);
            
            // Get stored backup history
            const backups = await this.getBackupHistory(projectConfig.name, limit || 5);
            
            if (!backups || backups.length === 0) {
                return ResponseBuilder.success(
                    '📋 No recent backups found. Run `claude "backup database"` to create one.'
                );
            }
            
            let message = '📋 **Recent Database Backups**\n\n';
            backups.forEach((backup, index) => {
                const timeAgo = this.getTimeAgo(backup.startTime);
                message += `${index + 1}. **${backup.environment}** - ${backup.databaseName}\n`;
                message += `   Export ID: ${backup.exportId}\n`;
                message += `   Started: ${timeAgo}\n`;
                message += `   Status: ${backup.status || 'Unknown'}\n\n`;
            });
            
            message += '💡 To check status: `claude "backup status --exportId <id>"`';
            
            return ResponseBuilder.success(message);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'list-backups', args);
        }
    }
    
    // Helper methods
    
    static async getProjectConfig(projectName, args = {}) {
        // If we have credentials passed in from withProjectResolution wrapper, use them directly
        if (args.projectId && args.apiKey && args.apiSecret) {
            return {
                name: args.projectName || projectName || 'Unknown',
                projectId: args.projectId,
                apiKey: args.apiKey,
                apiSecret: args.apiSecret
            };
        }
        
        // Fallback to old method for backward compatibility
        try {
            const projects = ProjectTools.getConfiguredProjects();
            
            if (!projects || projects.length === 0) {
                throw new Error('No projects configured. Run "setup_wizard" to configure your first project.');
            }
            
            if (projectName) {
                // CRITICAL: Require exact match (case-insensitive) to prevent wrong project selection
                const project = projects.find(p => 
                    p.name && p.name.toLowerCase() === projectName.toLowerCase()
                );
                
                if (!project) {
                    const availableNames = projects.map(p => p.name).filter(Boolean).join(', ') || 'None';
                    throw new Error(`Project "${projectName}" not found. Available: ${availableNames}`);
                }
                
                return project;
            } else {
                const defaultProject = projects.find(p => p.isDefault);
                
                if (defaultProject) {
                    return defaultProject;
                }
                
                if (projects.length === 1) {
                    return projects[0];
                }
                
                const projectNames = projects.map(p => p.name).filter(Boolean).join(', ') || 'None';
                throw new Error(`Multiple projects found but no default set. Available: ${projectNames}`);
            }
        } catch (error) {
            if (error.message.includes('No projects configured')) {
                throw error;
            }
            throw new Error(`Failed to get project configuration: ${error.message}`);
        }
    }
    
    static parseEnvironment(env) {
        if (!env) return 'Integration';
        
        const envLower = env.toLowerCase();
        
        const aliases = {
            'prod': 'Production',
            'production': 'Production',
            'pre': 'Preproduction',
            'prep': 'Preproduction',
            'preproduction': 'Preproduction',
            'staging': 'Preproduction',
            'int': 'Integration',
            'integration': 'Integration',
            'dev': 'Integration',
            'development': 'Integration'
        };
        
        return aliases[envLower] || env;
    }
    
    static extractExportId(result) {
        // Extract export ID from the result
        try {
            // Handle both old format (result.content) and new format (result.result.content)
            let content;
            if (result.result && result.result.content && result.result.content[0]) {
                content = result.result.content[0].text;
            } else if (result.content && result.content[0]) {
                content = result.content[0].text;
            } else {
                return null;
            }
            
            // Try multiple patterns to extract export ID
            const patterns = [
                /Export ID.*?`([a-f0-9-]+)`/i,                                      // Export ID: `uuid-format`
                /Export ID:\s*([a-f0-9-]+)/i,                                       // Export ID: uuid-format
                /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i, // UUID format anywhere
                /Export ID.*?`([0-9]+)`/i,                                          // Export ID: `timestamp-format`
                /Export ID:\s*([0-9]+)/i,                                           // Export ID: timestamp-format
                /\b([0-9]{14})\b/i                                                  // 14-digit timestamp (YYYYMMDDHHMMSS)
            ];
            
            for (const pattern of patterns) {
                const match = content.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }
    
    static parseExportStatus(result) {
        try {
            const content = result.content[0].text;
            
            return {
                isComplete: content.includes('Succeeded') || content.includes('Complete'),
                status: content.includes('Succeeded') ? 'Complete' : 
                       content.includes('InProgress') ? 'In Progress' : 
                       content.includes('Failed') ? 'Failed' : 'Unknown',
                downloadUrl: this.extractDownloadUrl(content)
            };
        } catch (error) {
            return { isComplete: false, status: 'Unknown' };
        }
    }
    
    static extractDownloadUrl(content) {
        const match = content.match(/https?:\/\/[^\s]+/);
        return match ? match[0] : null;
    }
    
    // Simple in-memory storage for backup history (could be persisted to file)
    static backupHistory = {};
    
    // Persistent state file for tracking current exports
    static STATE_FILE = '.mcp-backup-state.json';
    
    /**
     * Save current export state to persistent file
     */
    static async saveCurrentExportState(exportInfo) {
        const fs = require('fs').promises;
        try {
            let state = { currentExport: null, recentExports: [] };
            
            // Try to read existing state
            try {
                const existingState = await fs.readFile(this.STATE_FILE, 'utf8');
                state = JSON.parse(existingState);
            } catch (error) {
                // File doesn't exist or is invalid, use default state
            }
            
            // Update current export
            state.currentExport = exportInfo;
            
            // Add to recent exports (keep last 10)
            if (!state.recentExports) state.recentExports = [];
            state.recentExports.unshift(exportInfo);
            state.recentExports = state.recentExports.slice(0, 10);
            
            // Save to file
            await fs.writeFile(this.STATE_FILE, JSON.stringify(state, null, 2));
            
        } catch (error) {
            OutputLogger.error('Failed to save export state:', error.message);
        }
    }
    
    /**
     * Load current export state from persistent file
     */
    static async loadCurrentExportState() {
        const fs = require('fs').promises;
        try {
            const stateData = await fs.readFile(this.STATE_FILE, 'utf8');
            return JSON.parse(stateData);
        } catch (error) {
            // File doesn't exist or is invalid
            return { currentExport: null, recentExports: [] };
        }
    }
    
    /**
     * Clear current export from state (when completed or failed)
     */
    static async clearCurrentExportState() {
        const fs = require('fs').promises;
        try {
            const state = await this.loadCurrentExportState();
            state.currentExport = null;
            await fs.writeFile(this.STATE_FILE, JSON.stringify(state, null, 2));
        } catch (error) {
            OutputLogger.error('Failed to clear export state:', error.message);
        }
    }
    
    /**
     * Enhanced export state persistence - survives monitoring interruptions
     * Stores export info both in memory and persistent file storage
     */
    static async storeBackupInfo(projectName, backupInfo) {
        // Store in memory for quick access
        if (!this.backupHistory[projectName]) {
            this.backupHistory[projectName] = [];
        }
        
        this.backupHistory[projectName].unshift(backupInfo);
        
        // Keep only last 10 backups in memory
        if (this.backupHistory[projectName].length > 10) {
            this.backupHistory[projectName] = this.backupHistory[projectName].slice(0, 10);
        }

        // ALSO persist to file for recovery after monitoring interruptions
        await this.persistExportToFile(projectName, backupInfo);
    }

    /**
     * Persist export information to file system for recovery
     */
    static async persistExportToFile(projectName, exportInfo) {
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
            // Create exports directory if it doesn't exist
            const exportsDir = path.join(process.cwd(), '.exports');
            await fs.mkdir(exportsDir, { recursive: true });
            
            // Store per-project export history
            const projectFile = path.join(exportsDir, `${projectName.toLowerCase()}.json`);
            
            let projectExports = [];
            try {
                const existing = await fs.readFile(projectFile, 'utf8');
                projectExports = JSON.parse(existing);
            } catch (error) {
                // File doesn't exist, start fresh
            }
            
            // Add new export to beginning of array
            projectExports.unshift({
                ...exportInfo,
                persistedAt: new Date().toISOString()
            });
            
            // Keep last 20 exports in file (more than memory for recovery)
            if (projectExports.length > 20) {
                projectExports = projectExports.slice(0, 20);
            }
            
            await fs.writeFile(projectFile, JSON.stringify(projectExports, null, 2));
            OutputLogger.debug(`📁 Export ${exportInfo.exportId} persisted to file for recovery`);
            
        } catch (error) {
            OutputLogger.error(`❌ Failed to persist export to file: ${error.message}`);
            // Don't throw - file persistence is optional for recovery
        }
    }

    /**
     * Recover export history from file system
     * Used when memory is lost but exports are still active
     */
    static async recoverExportsFromFile(projectName) {
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
            const projectFile = path.join(process.cwd(), '.exports', `${projectName.toLowerCase()}.json`);
            const data = await fs.readFile(projectFile, 'utf8');
            const projectExports = JSON.parse(data);
            
            // Restore to memory
            this.backupHistory[projectName] = projectExports.slice(0, 10);
            
            OutputLogger.success(`🔄 Recovered ${projectExports.length} exports from file for ${projectName}`);
            return projectExports;
            
        } catch (error) {
            OutputLogger.debug(`💡 No export history file found for ${projectName} (this is normal for new projects)`);
            return [];
        }
    }
    
    static async getLatestBackup(projectName) {
        // First try memory
        let history = this.backupHistory[projectName];
        
        // If no history in memory, try to recover from file
        if (!history || history.length === 0) {
            await this.recoverExportsFromFile(projectName);
            history = this.backupHistory[projectName];
        }
        
        return history && history.length > 0 ? history[0] : null;
    }
    
    static async getBackupHistory(projectName, limit = 5) {
        // First try memory
        let history = this.backupHistory[projectName] || [];
        
        // If no history in memory, try to recover from file
        if (history.length === 0) {
            await this.recoverExportsFromFile(projectName);
            history = this.backupHistory[projectName] || [];
        }
        
        return history.slice(0, limit);
    }
    
    static getTimeAgo(dateString) {
        const now = new Date();
        const date = new Date(dateString);
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    }
    
    /**
     * Calculate elapsed time since export started
     */
    static getElapsedTime(startTime) {
        const now = new Date();
        const start = new Date(startTime);
        const diffMs = now - start;
        
        const minutes = Math.floor(diffMs / 60000);
        const hours = Math.floor(minutes / 60);
        const remainingMins = minutes % 60;
        
        if (hours > 0) {
            return `${hours}h ${remainingMins}m`;
        } else if (minutes > 0) {
            return `${minutes}m`;
        } else {
            return 'less than 1m';
        }
    }
    
    /**
     * Get elapsed time with context for export status
     */
    static getElapsedTimeWithContext(startTime, isComplete = false) {
        const elapsed = this.getElapsedTime(startTime);
        if (isComplete) {
            return `${elapsed} (total time)`;
        } else {
            return `${elapsed} (elapsed)`;
        }
    }
    
    
    /**
     * Monitor backup progress and auto-download when complete
     */
    static async monitorAndDownload(options) {
        const { exportId, projectConfig, downloadPath, targetEnv, dbName } = options;
        const fs = require('fs').promises;
        const path = require('path');
        const https = require('https');
        
        OutputLogger.progress(`Monitoring backup ${exportId}...`);
        
        // Poll for completion (max 30 minutes)
        const maxAttempts = 60; // 30 minutes with 30-second intervals
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            attempts++;
            
            try {
                // Check backup status
                const statusResult = await this.internalCheckExportStatus({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    exportId: exportId,
                    environment: targetEnv,
                    databaseName: dbName,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret
                });
                
                if (statusResult.isSuccess) {
                    const status = this.parseExportStatus(statusResult);
                    
                    if (status.isComplete && status.downloadUrl) {
                        OutputLogger.success('Backup complete! Starting download...');
                        
                        // Ensure download directory exists
                        await fs.mkdir(downloadPath, { recursive: true });
                        
                        // Generate filename
                        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
                        const filename = `${projectConfig.name}-${targetEnv}-${dbName}-${timestamp}.bacpac`;
                        const filepath = path.join(downloadPath, filename);
                        
                        // Download the backup
                        await this.downloadFile(status.downloadUrl, filepath);
                        
                        OutputLogger.success('Backup downloaded successfully!');
                        OutputLogger.log(`📁 Location: ${filepath}`);
                        OutputLogger.log(`📊 Size: ${await this.getFileSize(filepath)}`);
                        
                        return { success: true, filepath };
                    }
                    
                    if (status.status === 'Failed') {
                        throw new Error('Backup export failed');
                    }
                }
                
                // Wait before next check - using 2 minutes for manual monitoring to be less aggressive
                OutputLogger.progress(`Export still in progress... (check ${attempts}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, 120000)); // 2 minutes
                
            } catch (error) {
                OutputLogger.error(`Error checking backup status: ${error.message}`);
                throw error;
            }
        }
        
        throw new Error('Backup monitoring timed out after 30 minutes');
    }
    
    /**
     * Download file from URL to local path with timeout protection
     * For large database files (>100MB), we use a longer timeout
     */
    static async downloadFile(url, filepath, timeoutMs = 1800000) { // 30 minute default timeout for large DB files
        const fs = require('fs');
        const https = require('https');
        
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(filepath);
            let downloadedBytes = 0;
            let totalBytes = 0;
            let lastProgressTime = Date.now();
            let startTime = Date.now();
            let lastBytes = 0;
            
            // Overall download timeout (30 minutes default for DB files)
            const overallTimeout = setTimeout(() => {
                file.destroy();
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    // File might not exist or already deleted
                }
                const timeoutMinutes = Math.round(timeoutMs / 60000);
                reject(new Error(`Download timed out after ${timeoutMinutes} minutes. For very large files (>500MB), try downloading manually from the DXP portal.`));
            }, timeoutMs);
            
            // Stall timeout - if no data received for 2 minutes (increased for large files)
            let stallTimeout = setTimeout(() => {
                file.destroy();
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    // File might not exist or already deleted
                }
                reject(new Error('Download stalled - no data received for 2 minutes. Network connection may be unstable.'));
            }, 120000);
            
            const request = https.get(url, (response) => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    clearTimeout(overallTimeout);
                    clearTimeout(stallTimeout);
                    file.destroy();
                    return this.downloadFile(response.headers.location, filepath, timeoutMs).then(resolve).catch(reject);
                }
                
                // Check for error status codes
                if (response.statusCode !== 200) {
                    clearTimeout(overallTimeout);
                    clearTimeout(stallTimeout);
                    file.destroy();
                    try {
                        fs.unlinkSync(filepath);
                    } catch (e) {
                        // File might not exist
                    }
                    reject(new Error(`Download failed with status ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                totalBytes = parseInt(response.headers['content-length'], 10);
                
                response.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    file.write(chunk);
                    
                    // Reset stall timeout since we received data (2 minutes for large files)
                    clearTimeout(stallTimeout);
                    stallTimeout = setTimeout(() => {
                        file.destroy();
                        try {
                            fs.unlinkSync(filepath);
                        } catch (e) {
                            // File might not exist or already deleted
                        }
                        reject(new Error('Download stalled - no data received for 2 minutes. Network connection may be unstable.'));
                    }, 120000);
                    
                    // Show progress every 5 seconds to avoid spam
                    const now = Date.now();
                    if (now - lastProgressTime > 5000) {
                        // Calculate download speed
                        const intervalBytes = downloadedBytes - lastBytes;
                        const intervalSeconds = (now - lastProgressTime) / 1000;
                        const bytesPerSecond = intervalBytes / intervalSeconds;
                        const mbPerSecond = (bytesPerSecond / (1024 * 1024)).toFixed(2);
                        
                        lastBytes = downloadedBytes;
                        lastProgressTime = now;
                        
                        if (totalBytes) {
                            const percent = Math.round((downloadedBytes / totalBytes) * 100);
                            
                            // Estimate remaining time based on current speed
                            const remainingBytes = totalBytes - downloadedBytes;
                            const remainingSeconds = bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : 0;
                            const remainingMinutes = Math.ceil(remainingSeconds / 60);
                            
                            OutputLogger.progress(`📥 Downloading: ${percent}% (${this.formatBytes(downloadedBytes)}/${this.formatBytes(totalBytes)}) - ${mbPerSecond} MB/s - ETA: ${remainingMinutes} min`);
                        } else {
                            OutputLogger.progress(`📥 Downloaded: ${this.formatBytes(downloadedBytes)} - ${mbPerSecond} MB/s`);
                        }
                    }
                });
                
                response.on('end', () => {
                    clearTimeout(overallTimeout);
                    clearTimeout(stallTimeout);
                    file.end();
                    OutputLogger.success(`Download completed: ${this.formatBytes(downloadedBytes)}`);
                    resolve();
                });
                
                response.on('error', (error) => {
                    clearTimeout(overallTimeout);
                    clearTimeout(stallTimeout);
                    file.destroy();
                    try {
                        fs.unlinkSync(filepath);
                    } catch (e) {
                        // File might not exist
                    }
                    reject(error);
                });
            });
            
            request.on('error', (error) => {
                clearTimeout(overallTimeout);
                clearTimeout(stallTimeout);
                file.destroy();
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    // File might not exist
                }
                reject(error);
            });
            
            // Set request timeout (connection timeout)
            request.setTimeout(30000, () => {
                request.destroy();
                clearTimeout(overallTimeout);
                clearTimeout(stallTimeout);
                file.destroy();
                try {
                    fs.unlinkSync(filepath);
                } catch (e) {
                    // File might not exist
                }
                reject(new Error('Connection timeout - could not establish connection to download server'));
            });
        });
    }
    
    /**
     * Get file size in human-readable format
     */
    static async getFileSize(filepath) {
        const fs = require('fs').promises;
        const stats = await fs.stat(filepath);
        return this.formatBytes(stats.size);
    }
    
    /**
     * Format bytes to human-readable size
     */
    static formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    /**
     * Get file size from remote URL without downloading
     */
    static async getRemoteFileSize(url) {
        const https = require('https');
        const { URL } = require('url');
        
        return new Promise((resolve) => {
            try {
                const parsedUrl = new URL(url);
                const options = {
                    method: 'HEAD',
                    hostname: parsedUrl.hostname,
                    path: parsedUrl.pathname + parsedUrl.search,
                    port: parsedUrl.port || 443
                };
                
                const req = https.request(options, (res) => {
                    const contentLength = res.headers['content-length'];
                    resolve(contentLength ? parseInt(contentLength) : null);
                });
                
                req.on('error', () => {
                    resolve(null); // Return null if we can't get size
                });
                
                req.end();
            } catch (error) {
                resolve(null); // Return null on any error
            }
        });
    }
    
    /**
     * Find an available completed backup for environment and database
     */
    static async findAvailableBackup(projectConfig, environment, databaseName) {
        try {
            const backups = await this.getBackupHistory(projectConfig.name, 10); // Check last 10 backups
            
            // Look for a completed backup for the same environment and database
            for (const backup of backups) {
                if (backup.environment === environment && backup.databaseName === databaseName) {
                    // Check if this backup is still available (not older than 24 hours for safety)
                    const backupTime = new Date(backup.startTime);
                    const now = new Date();
                    const hoursSinceBackup = (now - backupTime) / (1000 * 60 * 60);
                    
                    if (hoursSinceBackup < 24) {
                        // Verify the backup is actually complete by checking its status
                        try {
                            const statusResult = await this.internalCheckExportStatus({
                                projectId: projectConfig.projectId,
                                projectName: projectConfig.name,
                                exportId: backup.exportId,
                                environment: environment,
                                databaseName: databaseName,
                                apiKey: projectConfig.apiKey,
                                apiSecret: projectConfig.apiSecret
                            });
                            
                            if (statusResult.isSuccess) {
                                const status = this.parseExportStatus(statusResult);
                                if (status.isComplete && status.downloadUrl) {
                                    // Found a valid, downloadable backup
                                    return {
                                        ...backup,
                                        downloadUrl: status.downloadUrl,
                                        status: status.status
                                    };
                                }
                            }
                        } catch (error) {
                            // Skip this backup if we can't check its status
                            continue;
                        }
                    }
                }
            }
            
            return null;
        } catch (error) {
            // If we can't check for existing backups, just return null
            return null;
        }
    }
    
    /**
     * Download an existing backup
     */
    static async downloadExistingBackup(backup, projectConfig, downloadPath, targetEnv, dbName) {
        const fs = require('fs').promises;
        const path = require('path');
        
        OutputLogger.success('Downloading existing backup...');
        
        // Ensure download directory exists
        await fs.mkdir(downloadPath, { recursive: true });
        
        // Generate filename
        const backupDate = new Date(backup.startTime);
        const timestamp = backupDate.toISOString().replace(/:/g, '-').split('.')[0];
        const filename = `${projectConfig.name}-${targetEnv}-${dbName}-${timestamp}.bacpac`;
        const filepath = path.join(downloadPath, filename);
        
        // Download the backup
        await this.downloadFile(backup.downloadUrl, filepath);
        
        OutputLogger.success('Existing backup downloaded successfully!');
        OutputLogger.log(`📁 Location: ${filepath}`);
        OutputLogger.log(`📊 Size: ${await this.getFileSize(filepath)}`);
        
        return { success: true, filepath };
    }
    
    /**
     * Download backup from URL with proper naming and error handling
     */
    static async downloadFromUrl(downloadUrl, downloadPath, projectName, environment, databaseName, skipConfirmation = false) {
        const fs = require('fs').promises;
        const path = require('path');
        const https = require('https');
        
        // First, get the file size without downloading
        if (!skipConfirmation) {
            const fileSize = await this.getRemoteFileSize(downloadUrl);
            
            if (fileSize) {
                const sizeInMB = fileSize / (1024 * 1024);
                const sizeInGB = fileSize / (1024 * 1024 * 1024);
                
                OutputLogger.debug('\n📊 **Database Export Preview**');
                OutputLogger.debug(`   • **Environment**: ${environment}`);
                OutputLogger.debug(`   • **Database**: ${databaseName}`);
                OutputLogger.debug(`   • **Size**: ${sizeInGB > 1 ? `${sizeInGB.toFixed(2)} GB` : `${sizeInMB.toFixed(2)} MB`}`);
                OutputLogger.debug(`   • **Location**: ${downloadPath}`);
                
                // Show warning for large databases
                if (sizeInGB > 1) {
                    OutputLogger.warn(`\n⚠️  This is a large database export (${sizeInGB.toFixed(2)} GB)`);
                    OutputLogger.debug('   Download may take several minutes depending on your connection.');
                }
                
                OutputLogger.debug('\n⚠️  **Download Confirmation Required**');
                OutputLogger.debug('To proceed with downloading this database backup, say:');
                OutputLogger.debug('   "Yes" or "Yes, download the database"');
                OutputLogger.debug('\nTo cancel, say "No" or ignore this message.');
                
                return {
                    requiresConfirmation: true,
                    fileSize: this.formatBytes(fileSize),
                    estimatedSize: fileSize,
                    downloadUrl,
                    message: 'Database export ready for download. Please confirm to proceed.'
                };
            }
        }
        
        // Ensure download directory exists
        await fs.mkdir(downloadPath, { recursive: true });
        
        // Generate filename with current timestamp
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const filename = `${projectName}-${environment}-${databaseName}-${timestamp}.bacpac`;
        const filepath = path.join(downloadPath, filename);
        
        // Download the backup
        await this.downloadFile(downloadUrl, filepath);
        
        // Get file size for response
        const fileSize = await this.getFileSize(filepath);
        
        return { 
            success: true, 
            filepath, 
            fileSize,
            filename
        };
    }
    
    /**
     * Estimate remaining time for backup completion
     */
    static estimateRemainingTime() {
        // Database exports typically take 15-30 minutes
        return '15-30 minutes';
    }
    
    /**
     * Start persistent background monitoring that survives manual monitoring interruptions
     * This creates a truly independent background process that can't be cancelled by user interactions
     */
    static startBackgroundMonitoring(exportId, projectConfig, environment, databaseName, downloadPath) {
        // Check if already monitoring this export
        if (DatabaseSimpleTools.backgroundMonitors.has(exportId)) {
            OutputLogger.debug(`🔄 Background monitoring already active for export: ${exportId}`);
            return DatabaseSimpleTools.backgroundMonitors.get(exportId);
        }

        const { EventEmitter } = require('events');
        const monitor = new EventEmitter();
        let isMonitoring = true;
        const startTime = Date.now();
        const pollInterval = 5 * 60 * 1000; // Check every 5 minutes
        const maxDuration = 45 * 60 * 1000; // Stop after 45 minutes
        
        const OutputLogger = require('../output-logger');
        
        // Store monitoring metadata
        const monitorData = {
            monitor,
            exportId,
            projectConfig,
            environment,
            databaseName,
            downloadPath,
            startTime,
            isMonitoring: true,
            stop: () => { 
                isMonitoring = false; 
                monitorData.isMonitoring = false;
                DatabaseSimpleTools.backgroundMonitors.delete(exportId);
                OutputLogger.debug(`🛑 Background monitoring stopped for export: ${exportId}`);
            }
        };
        
        // Register the monitor 
        DatabaseSimpleTools.backgroundMonitors.set(exportId, monitorData);
        
        OutputLogger.success(`🚀 Background monitoring started for export: ${exportId}`);
        OutputLogger.debug(`   ⏱️ Checking status every 5 minutes`);
        OutputLogger.debug(`   📊 You'll see progress updates at: 1m, 5m, 10m, 15m, 20m, 30m, 45m`);
        OutputLogger.debug(`   💾 Auto-download will trigger when export completes`);
        OutputLogger.debug(`   🔍 Check manually anytime with: claude "backup status"`);
        
        const monitorLoop = async () => {
            let checkCount = 0;
            
            while (isMonitoring) {
                checkCount++;
                
                try {
                    // Check if we've exceeded max duration
                    if (Date.now() - startTime > maxDuration) {
                        OutputLogger.error(`⏰ Auto-download monitoring timed out after 45 minutes for export: ${exportId}`);
                        isMonitoring = false;
                        break;
                    }
                    
                    // Check export status using our existing tools
                    const result = await this.internalCheckExportStatus({
                        projectId: projectConfig.projectId,
                        projectName: projectConfig.name,
                        exportId: exportId,
                        environment: environment,
                        databaseName: databaseName,
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret
                    });
                    
                    if (result.isSuccess) {
                        const status = this.parseExportStatus(result);
                        
                        if (status.isComplete && status.downloadUrl) {
                            // Export is ready - check if auto-download is possible
                            const capabilityCheck = await CapabilityDetector.checkAutoDownloadCapability(downloadPath, 100 * 1024 * 1024);
                            
                            if (capabilityCheck.canAutoDownload) {
                                OutputLogger.success(`🎉 Export ${exportId} completed! Starting automatic download...`);
                                
                                try {
                                    const downloadResult = await this.downloadFromUrl(
                                        status.downloadUrl, 
                                        downloadPath, 
                                        projectConfig.name, 
                                        environment, 
                                        databaseName
                                    );
                                    
                                    // Clear the current export state since it's complete
                                    await this.clearCurrentExportState();
                                    
                                    OutputLogger.success(`✅ AUTO-DOWNLOAD COMPLETE!`);
                                    OutputLogger.success(`📁 File: ${downloadResult.filepath}`);
                                    OutputLogger.success(`📊 Size: ${downloadResult.fileSize}`);
                                    
                                    // Emit completion event
                                    monitor.emit('complete', {
                                        exportId,
                                        downloadPath: downloadResult.filepath,
                                        fileSize: downloadResult.fileSize,
                                        elapsed: Date.now() - startTime
                                    });
                                    
                                    isMonitoring = false;
                                    break;
                                    
                                } catch (downloadError) {
                                    OutputLogger.error(`❌ Auto-download failed: ${downloadError.message}`);
                                    OutputLogger.debug(`📥 Manual download available: ${status.downloadUrl}`);
                                    
                                    monitor.emit('download_failed', {
                                        exportId,
                                        downloadUrl: status.downloadUrl,
                                        error: downloadError.message
                                    });
                                    
                                    isMonitoring = false;
                                    break;
                                }
                            } else {
                                // Cannot auto-download - provide URL and instructions
                                const clientInfo = CapabilityDetector.detectMCPClient();
                                
                                if (clientInfo.isClaudeDesktop) {
                                    OutputLogger.success(`🎉 Export ${exportId} completed! Download URL ready.`);
                                    OutputLogger.debug(`🔗 Download URL: ${status.downloadUrl}`);
                                    OutputLogger.debug(`💡 Tip: Copy the URL above and open in your browser, or use Claude Code CLI for auto-download`);
                                } else {
                                    OutputLogger.success(`🎉 Export ${exportId} completed! Manual download required.`);
                                    OutputLogger.debug(`📥 Manual download available: ${status.downloadUrl}`);
                                    OutputLogger.debug(`⚠️ Auto-download not available: ${capabilityCheck.issues[0] || 'File system access limited'}`);
                                }
                                
                                // Clear the current export state since it's complete
                                await this.clearCurrentExportState();
                                
                                // Emit completion event
                                monitor.emit('complete', {
                                    exportId,
                                    downloadUrl: status.downloadUrl,
                                    autoDownloadFailed: true,
                                    reason: capabilityCheck.issues[0] || 'Auto-download not supported',
                                    elapsed: Date.now() - startTime
                                });
                                
                                isMonitoring = false;
                                break;
                            }
                        } else {
                            // Still in progress - provide periodic status updates with context
                            const elapsedMs = Date.now() - startTime;
                            const elapsedMinutes = Math.round(elapsedMs / 1000 / 60);
                            const elapsedSeconds = Math.round(elapsedMs / 1000);
                            
                            // Provide different messages based on elapsed time
                            let progressMessage = '';
                            let messageIcon = '⏳';
                            
                            // Special case for immediate first check
                            if (elapsedSeconds < 30) {
                                // Immediate check (within 30 seconds)
                                progressMessage = `Export ${exportId} started - performing initial status check`;
                                messageIcon = '🔍';
                            } else if (elapsedMinutes < 5) {
                                // First 5 minutes - normal progress
                                progressMessage = `Export ${exportId} in progress (${elapsedMinutes}m elapsed)`;
                                messageIcon = '⏳';
                            } else if (elapsedMinutes < 15) {
                                // 5-15 minutes - still normal
                                progressMessage = `Export ${exportId} still running after ${elapsedMinutes} minutes - this is normal for larger databases`;
                                messageIcon = '⏱️';
                            } else if (elapsedMinutes < 30) {
                                // 15-30 minutes - taking longer but still OK
                                progressMessage = `Export ${exportId} running for ${elapsedMinutes} minutes - larger exports can take up to 30 minutes`;
                                messageIcon = '⌛';
                            } else if (elapsedMinutes < 45) {
                                // 30-45 minutes - unusual but continuing
                                progressMessage = `Export ${exportId} has been running for ${elapsedMinutes} minutes - this is longer than usual but monitoring continues`;
                                messageIcon = '⚠️';
                            } else {
                                // 45+ minutes - likely stuck
                                progressMessage = `Export ${exportId} has been running for ${elapsedMinutes} minutes - may be stuck. Consider checking DXP portal or starting a new export`;
                                messageIcon = '🚨';
                            }
                            
                            // Always log updates since we only check every 5 minutes
                            // This ensures users see activity and know monitoring is working
                            const shouldLogUpdate = true;
                            
                            if (shouldLogUpdate) {
                                OutputLogger.debug(`${messageIcon} ${progressMessage}`);
                                OutputLogger.debug(`   📊 Status: ${status.status || 'In Progress'}`);
                                OutputLogger.debug(`   🔄 Next check in 5 minutes...`);
                                
                                // Provide helpful tips at certain milestones
                                if (elapsedMinutes === 15) {
                                    OutputLogger.debug(`   💡 Tip: You can check status manually anytime with: claude "backup status"`);
                                } else if (elapsedMinutes === 30) {
                                    OutputLogger.debug(`   💡 Tip: Check the DXP portal directly if you're concerned about the export`);
                                } else if (elapsedMinutes === 45) {
                                    OutputLogger.debug(`   💡 Tip: Consider starting a new export if this one appears stuck`);
                                }
                            }
                            
                            monitor.emit('progress', {
                                exportId,
                                status: status.status,
                                elapsed: elapsedMs,
                                elapsedMinutes
                            });
                        }
                    } else {
                        // Error checking status - log but continue trying
                        OutputLogger.error(`⚠️ Failed to check export status: ${result.error || 'Unknown error'}`);
                    }
                    
                    // Wait before next check (only if still monitoring)
                    if (isMonitoring) {
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                    }
                    
                } catch (error) {
                    OutputLogger.error(`❌ Background monitoring error: ${error.message}`);
                    
                    // Don't stop monitoring for transient errors, just log and continue
                    monitor.emit('error', {
                        exportId,
                        error: error.message,
                        elapsed: Date.now() - startTime
                    });
                    
                    if (isMonitoring) {
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                    }
                }
            }
        };
        
        // Start monitoring in background (fire and forget)
        monitorLoop().catch(error => {
            OutputLogger.error(`💥 Critical monitoring error: ${error.message}`);
            monitor.emit('critical_error', { exportId, error: error.message });
        });
        
        // Store monitor reference for potential cleanup
        if (!this.activeMonitors) {
            this.activeMonitors = new Map();
        }
        this.activeMonitors.set(exportId, { monitor, stop: () => { isMonitoring = false; } });
        
        OutputLogger.success(`🚀 Background auto-download monitoring started for export: ${exportId}`);
        OutputLogger.debug(`⏰ Checking every 5 minutes, will auto-download when ready`);
        
        return monitorData;
    }

    /**
     * Get status of all active background monitors
     */
    static getActiveBackgroundMonitors() {
        const activeMonitors = [];
        for (const [exportId, monitorData] of DatabaseSimpleTools.backgroundMonitors.entries()) {
            if (monitorData.isMonitoring) {
                activeMonitors.push({
                    exportId,
                    environment: monitorData.environment,
                    databaseName: monitorData.databaseName,
                    startTime: monitorData.startTime,
                    elapsedMinutes: Math.round((Date.now() - monitorData.startTime) / (1000 * 60)),
                    downloadPath: monitorData.downloadPath
                });
            }
        }
        return activeMonitors;
    }

    /**
     * Stop background monitoring for a specific export
     */
    static stopBackgroundMonitoring(exportId) {
        const monitorData = DatabaseSimpleTools.backgroundMonitors.get(exportId);
        if (monitorData) {
            monitorData.stop();
            return true;
        }
        return false;
    }

    /**
     * Stop all background monitoring processes
     */
    static stopAllBackgroundMonitoring() {
        const stopped = [];
        for (const [exportId, monitorData] of DatabaseSimpleTools.backgroundMonitors.entries()) {
            monitorData.stop();
            stopped.push(exportId);
        }
        return stopped;
    }

    /**
     * Resume background monitoring for an export if it was interrupted
     * This enables recovery from manual monitoring cancellation
     */
    static resumeBackgroundMonitoring(exportId, projectConfig, environment, databaseName, downloadPath) {
        if (DatabaseSimpleTools.backgroundMonitors.has(exportId)) {
            OutputLogger.debug(`🔄 Background monitoring already active for export: ${exportId}`);
            return false; // Already monitoring
        }
        
        // Start fresh monitoring
        this.startBackgroundMonitoring(exportId, projectConfig, environment, databaseName, downloadPath);
        OutputLogger.success(`🔄 Resumed background monitoring for export: ${exportId}`);
        return true;
    }

    /**
     * Find an available recent backup that can be used instead of creating a new one
     * @param {Object} projectConfig - Project configuration
     * @param {string} targetEnv - Target environment
     * @param {string} dbName - Database name
     * @returns {Object|null} - Existing backup info or null if none suitable
     */
    static async findAvailableBackup(projectConfig, targetEnv, dbName) {
        try {
            OutputLogger.debug('🔍 Checking for recent completed backups...');
            
            // Try to recover exports from file first
            await this.recoverExportsFromFile(projectConfig.name);
            const recentExports = this.backupHistory[projectConfig.name] || [];
            
            if (recentExports.length === 0) {
                OutputLogger.debug('No recent backups found in history');
                return null;
            }
            
            // Look for recent completed exports (within last 24 hours by default)
            const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
            
            // Find matching exports for the same environment and database
            const matchingExports = recentExports.filter(exp => {
                // Check if export is recent enough
                const exportTime = new Date(exp.startTime || exp.completedAt).getTime();
                if (exportTime < twentyFourHoursAgo) {
                    return false;
                }
                
                // Check environment match (case-insensitive)
                const envMatch = exp.environment?.toLowerCase() === targetEnv.toLowerCase();
                
                // Check database match (case-insensitive)
                const dbMatch = exp.databaseName?.toLowerCase() === dbName.toLowerCase();
                
                // Check if export completed successfully
                const isComplete = exp.status === 'Completed' || exp.status === 'succeeded' || 
                                 exp.downloadLink || exp.downloadUrl;
                
                return envMatch && dbMatch && isComplete;
            });
            
            if (matchingExports.length === 0) {
                OutputLogger.debug('No matching recent backups found');
                return null;
            }
            
            // Get the most recent matching export
            const mostRecent = matchingExports[0];
            const timeAgo = this.getTimeAgo(mostRecent.startTime || mostRecent.completedAt);
            
            OutputLogger.success(`✅ Found recent backup from ${timeAgo}`);
            OutputLogger.debug(`   Export ID: ${mostRecent.exportId}`);
            OutputLogger.debug(`   Environment: ${mostRecent.environment}`);
            OutputLogger.debug(`   Database: ${mostRecent.databaseName}`);
            
            // Return the backup and let the caller decide what to do with it
            return mostRecent;
            
        } catch (error) {
            OutputLogger.error(`Error checking for available backups: ${error.message}`);
            // Don't fail the whole operation if we can't check history
            return null;
        }
    }

    /**
     * Download an existing backup that was found
     */
    static async downloadExistingBackup(backupInfo, projectConfig, downloadPath, targetEnv, dbName) {
        const fs = require('fs').promises;
        const path = require('path');
        const https = require('https');
        
        try {
            // First check if we have a download URL
            const downloadUrl = backupInfo.downloadLink || backupInfo.downloadUrl;
            
            if (!downloadUrl) {
                // Try to get the download URL by checking status
                OutputLogger.debug('🔍 Fetching download URL for existing backup...');
                
                const statusResult = await this.internalCheckExportStatus({
                    projectId: projectConfig.projectId,
                    projectName: projectConfig.name,
                    exportId: backupInfo.exportId,
                    environment: targetEnv,
                    databaseName: dbName,
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret
                });
                
                if (!statusResult.isSuccess) {
                    throw new Error('Could not retrieve backup status');
                }
                
                // Extract download URL from status
                const status = this.parseExportStatus(statusResult);
                if (!status.downloadUrl) {
                    throw new Error('Backup does not have a download URL yet');
                }
                
                backupInfo.downloadUrl = status.downloadUrl;
            }
            
            // Ensure download directory exists
            await fs.mkdir(downloadPath, { recursive: true });
            
            // Generate filename
            const timestamp = new Date(backupInfo.startTime || backupInfo.completedAt)
                .toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const filename = `${projectConfig.name}-${targetEnv}-${dbName}-${timestamp}.bacpac`;
            const filePath = path.join(downloadPath, filename);
            
            OutputLogger.progress(`📥 Downloading existing backup to ${filePath}...`);
            
            // Download the file
            await this.downloadFile(backupInfo.downloadUrl || downloadUrl, filePath);
            
            OutputLogger.success(`✅ Successfully downloaded existing backup to: ${filePath}`);
            
            // Update backup info
            backupInfo.localPath = filePath;
            backupInfo.downloadedAt = new Date().toISOString();
            
            // Save updated state
            await this.saveBackupState({
                exportId: backupInfo.exportId,
                projectConfig,
                environment: targetEnv,
                databaseName: dbName,
                downloadPath,
                autoDownload: false,
                startTime: backupInfo.startTime || backupInfo.completedAt,
                status: 'downloaded',
                localPath: filePath
            });
            
            return filePath;
            
        } catch (error) {
            OutputLogger.error(`Failed to download existing backup: ${error.message}`);
            throw error;
        }
    }

    /**
     * Smart export conflict resolution
     * When an export is blocked by existing operation, intelligently handle based on database match
     */
    static async resolveExportConflict(targetEnv, targetDb, projectConfig, downloadPath) {
        try {
            OutputLogger.debug('🔍 Analyzing existing operations for intelligent conflict resolution...');
            
            // First, try to find any active exports by checking recent exports 
            await this.recoverExportsFromFile(projectConfig.name);
            const recentExports = this.backupHistory[projectConfig.name] || [];
            
            // Look for recent exports (within last 2 hours) that might be in progress
            const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
            const potentiallyActive = recentExports.filter(exp => {
                const startTime = new Date(exp.startTime).getTime();
                return startTime > twoHoursAgo;
            });

            // Check each potentially active export
            for (const exportInfo of potentiallyActive) {
                try {
                    const statusResult = await this.internalCheckExportStatus({
                        projectId: projectConfig.projectId,
                        projectName: projectConfig.name,
                        exportId: exportInfo.exportId,
                        environment: exportInfo.environment,
                        databaseName: exportInfo.databaseName,
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret
                    });

                    if (statusResult.isSuccess) {
                        const status = this.parseExportStatus(statusResult);
                        
                        if (!status.isComplete) {
                            // Found active export! Now determine resolution strategy
                            const sameDatabase = (exportInfo.environment === targetEnv && 
                                                exportInfo.databaseName === targetDb);
                                                
                            if (sameDatabase) {
                                // CASE 1: Same database export already running - switch to monitoring it
                                OutputLogger.success(`🎯 Found existing export for same database (${targetEnv} ${targetDb})`);
                                OutputLogger.debug(`🔄 Switching to monitor existing export: ${exportInfo.exportId}`);
                                
                                // Start monitoring the existing export
                                this.startBackgroundMonitoring(
                                    exportInfo.exportId, 
                                    projectConfig, 
                                    exportInfo.environment, 
                                    exportInfo.databaseName,
                                    downloadPath || await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, targetEnv)
                                );

                                const smartResponse = ResponseBuilder.success(
                                    `🎯 **Smart Resolution: Using Existing Export**\n\n` +
                                    `Found an active export for the same database (${targetEnv} ${targetDb}).\n\n` +
                                    `**Export ID:** ${exportInfo.exportId}\n` +
                                    `**Started:** ${new Date(exportInfo.startTime).toLocaleString()}\n` +
                                    `**Status:** In Progress\n\n` +
                                    `🔄 **Background Monitoring**: Switched to existing export\n` +
                                    `✅ **Auto-Download**: Will download to ${downloadPath || await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, targetEnv)} when ready\n` +
                                    `⏰ **Check Interval**: Every 5 minutes\n` +
                                    `📊 **Status**: Use \`check export status\` anytime\n\n` +
                                    `💡 **No new export needed** - this provides exactly what you requested!`
                                );

                                return { resolved: true, result: smartResponse };
                                
                            } else {
                                // CASE 2: Different database export running - queue this one
                                OutputLogger.debug(`⏳ Different database export running (${exportInfo.environment} ${exportInfo.databaseName})`);
                                OutputLogger.debug(`🔄 Will start ${targetEnv} ${targetDb} export when current export completes`);
                                
                                // Start monitoring the blocking export for completion
                                this.startQueuedExportMonitoring(
                                    exportInfo,
                                    { environment: targetEnv, databaseName: targetDb, projectConfig, downloadPath }
                                );

                                const queuedResponse = ResponseBuilder.success(
                                    `⏳ **Smart Queuing: Export Scheduled**\n\n` +
                                    `Another export is currently running:\n` +
                                    `• **Current:** ${exportInfo.environment} ${exportInfo.databaseName} (${exportInfo.exportId})\n` +
                                    `• **Started:** ${new Date(exportInfo.startTime).toLocaleString()}\n\n` +
                                    `**Your Request:** ${targetEnv} ${targetDb}\n` +
                                    `**Status:** Queued - will start automatically when current export completes\n\n` +
                                    `🔄 **Smart Monitoring**: Watching current export for completion\n` +
                                    `✅ **Auto-Start**: Your export will begin immediately after\n` +
                                    `📊 **Track Progress**: Use \`check export status\` to monitor both exports\n\n` +
                                    `💡 **Intelligent queuing** - no manual intervention needed!`
                                );

                                return { resolved: true, result: queuedResponse };
                            }
                        }
                    }
                } catch (error) {
                    // Export might have expired - continue checking others
                    OutputLogger.debug(`💡 Export ${exportInfo.exportId} is no longer active`);
                }
            }

            // No active exports found in our records - might be a different type of operation
            OutputLogger.debug('🔍 No matching exports found - conflict might be from deployment or other operation');
            return { resolved: false };
            
        } catch (error) {
            OutputLogger.error(`❌ Conflict resolution failed: ${error.message}`);
            return { resolved: false };
        }
    }

    /**
     * Start monitoring a blocking export and queue a new export to start when it completes
     */
    static startQueuedExportMonitoring(blockingExport, queuedExport) {
        const queueId = `${blockingExport.exportId}->${queuedExport.environment}-${queuedExport.databaseName}`;
        
        OutputLogger.debug(`🔄 Starting queued export monitoring: ${queueId}`);
        
        // Monitor the blocking export
        const monitorLoop = async () => {
            try {
                while (true) {
                    // Check if blocking export is complete
                    const statusResult = await this.internalCheckExportStatus({
                        projectId: queuedExport.projectConfig.projectId,
                        projectName: queuedExport.projectConfig.name,
                        exportId: blockingExport.exportId,
                        environment: blockingExport.environment,
                        databaseName: blockingExport.databaseName,
                        apiKey: queuedExport.projectConfig.apiKey,
                        apiSecret: queuedExport.projectConfig.apiSecret
                    });

                    if (statusResult.isSuccess) {
                        const status = this.parseExportStatus(statusResult);
                        
                        if (status.isComplete) {
                            OutputLogger.success(`✅ Blocking export completed! Starting queued export: ${queuedExport.environment} ${queuedExport.databaseName}`);
                            
                            // Start the queued export
                            try {
                                const queuedResult = await this.handleExportDatabase({
                                    environment: queuedExport.environment,
                                    databaseName: queuedExport.databaseName,
                                    downloadPath: queuedExport.downloadPath,
                                    project: queuedExport.projectConfig.name,
                                    // Pass through project config directly
                                    projectId: queuedExport.projectConfig.projectId,
                                    apiKey: queuedExport.projectConfig.apiKey,
                                    apiSecret: queuedExport.projectConfig.apiSecret
                                });
                                
                                OutputLogger.success(`🚀 Queued export started successfully!`);
                                
                            } catch (error) {
                                OutputLogger.error(`❌ Failed to start queued export: ${error.message}`);
                            }
                            
                            break; // Exit monitoring loop
                        }
                    }
                    
                    // Wait 2 minutes before checking again (more frequent than background monitoring)
                    await new Promise(resolve => setTimeout(resolve, 120000));
                }
                
            } catch (error) {
                OutputLogger.error(`❌ Queued export monitoring failed: ${error.message}`);
            }
        };
        
        // Start monitoring in background
        monitorLoop().catch(error => {
            OutputLogger.error(`💥 Critical queued monitoring error: ${error.message}`);
        });
        
        OutputLogger.success(`⏳ Queued export monitoring started - will auto-start when blocking export completes`);
    }

    /**
     * Auto-recovery mechanism - detect interrupted exports and offer to resume monitoring
     * This runs automatically when checking export status or listing exports
     */
    static async detectAndOfferRecovery(projectConfig) {
        try {
            // Get recent exports from file storage
            const recentExports = await this.recoverExportsFromFile(projectConfig.name);
            
            // Find exports that might still be in progress (started within last 2 hours)
            const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
            const potentiallyActiveExports = recentExports.filter(exp => {
                const startTime = new Date(exp.startTime).getTime();
                return startTime > twoHoursAgo && !DatabaseSimpleTools.backgroundMonitors.has(exp.exportId);
            });

            if (potentiallyActiveExports.length > 0) {
                OutputLogger.debug(`🔍 Found ${potentiallyActiveExports.length} potentially active export(s) that lost monitoring`);
                
                // For each potentially active export, check if it's still in progress
                for (const exportInfo of potentiallyActiveExports) {
                    try {
                        // Quick status check to see if export is still active
                            const statusResult = await this.internalCheckExportStatus({
                            projectId: projectConfig.projectId,
                            projectName: projectConfig.name,
                            exportId: exportInfo.exportId,
                            environment: exportInfo.environment,
                            databaseName: exportInfo.databaseName,
                            apiKey: projectConfig.apiKey,
                            apiSecret: projectConfig.apiSecret
                        });

                        if (statusResult.isSuccess) {
                            const status = this.parseExportStatus(statusResult);
                            
                            if (!status.isComplete) {
                                // Export is still in progress - offer to resume monitoring
                                const downloadPath = exportInfo.downloadPath || await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, targetEnv);
                                
                                OutputLogger.success(`🔄 Auto-resuming monitoring for in-progress export: ${exportInfo.exportId}`);
                                this.startBackgroundMonitoring(
                                    exportInfo.exportId,
                                    projectConfig,
                                    exportInfo.environment,
                                    exportInfo.databaseName,
                                    downloadPath
                                );
                            }
                        }
                    } catch (error) {
                        // Export might have expired or failed - that's ok, continue
                        OutputLogger.debug(`💡 Export ${exportInfo.exportId} is no longer active (this is normal)`);
                    }
                }
            }
            
        } catch (error) {
            OutputLogger.error(`❌ Auto-recovery failed: ${error.message}`);
            // Don't throw - recovery is optional
        }
    }
    
    /**
     * Stop background monitoring for a specific export
     */
    static stopBackgroundMonitoring(exportId) {
        if (this.activeMonitors && this.activeMonitors.has(exportId)) {
            const monitor = this.activeMonitors.get(exportId);
            monitor.stop();
            this.activeMonitors.delete(exportId);
            
            const OutputLogger = require('../output-logger');
            OutputLogger.debug(`🛑 Stopped background monitoring for export: ${exportId}`);
            return true;
        }
        return false;
    }
    
    /**
     * Get active background monitors
     */
    static getActiveMonitors() {
        if (!this.activeMonitors) {
            return [];
        }
        return Array.from(this.activeMonitors.keys());
    }
}

module.exports = DatabaseSimpleTools;
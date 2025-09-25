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
const DownloadConfig = require('../download-config');
const ManifestManager = require('../manifest-manager');

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
                .build();
            
            // Execute command using the correct method
            const result = await PowerShellHelper.executeEpiCommandDirectWithCredentials(
                command,
                { apiKey, apiSecret, projectId },
                { parseJson: true }
            );

            // Check if the command actually succeeded
            if (!result || result.isError) {
                const errorMsg = result?.error || result?.stderr || 'Failed to create database export';
                OutputLogger.error(`❌ Export creation failed: ${errorMsg}`);

                // Check if this is a concurrent export error
                const errorLower = errorMsg.toLowerCase();
                if (errorLower.includes('on-going') ||
                    errorLower.includes('ongoing') ||
                    errorLower.includes('already running') ||
                    errorLower.includes('in progress') ||
                    errorLower.includes('another export') ||
                    errorLower.includes('concurrent')) {

                    // Return with specific concurrent error flag
                    return {
                        success: false,
                        isError: true,
                        error: 'There is an on-going database export operation',
                        content: [{
                            type: 'text',
                            text: `⚠️ Another database export is already in progress.\n\nError: ${errorMsg}\n\n` +
                                 `Please wait 2-3 minutes for the current export to complete, then try again.`
                        }]
                    };
                }

                return {
                    success: false,
                    error: errorMsg,
                    exportId: null
                };
            }

            // Format the result properly - handle object results
            let resultMessage = 'Database export initiated.\n';
            let extractedExportId = null;

            if (result.stdout) {
                resultMessage += result.stdout;
                // Try to extract export ID from stdout
                const idMatch = result.stdout.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                if (idMatch) {
                    extractedExportId = idMatch[1];
                }
            } else if (typeof result === 'string') {
                resultMessage += result;
            } else if (typeof result === 'object' && result !== null) {
                // Format object result properly
                if (result.id) {
                    extractedExportId = result.id;
                    resultMessage += `Export ID: ${result.id}\n`;
                }
                if (result.status) resultMessage += `Status: ${result.status}\n`;
                if (result.exportId) {
                    extractedExportId = result.exportId;
                    resultMessage += `Export ID: ${result.exportId}\n`;
                }
                // Add any other relevant fields
                if (result.message) resultMessage += result.message;
            }

            // Include the export ID in the message for easier extraction
            if (extractedExportId) {
                resultMessage = `Export ID: ${extractedExportId}\n` + resultMessage;
                return ResponseBuilder.success(resultMessage);
            } else {
                // No export ID means the export likely failed due to concurrent operation
                OutputLogger.warn(`⚠️ No export ID extracted from PowerShell response`);

                // Check if the response indicates a concurrent export
                const responseText = resultMessage.toLowerCase();
                if (responseText.includes('on-going') ||
                    responseText.includes('already') ||
                    responseText.includes('in progress') ||
                    responseText.includes('conflict')) {
                    return {
                        success: false,
                        isError: true,
                        error: 'There is an on-going database export operation',
                        content: [{
                            type: 'text',
                            text: resultMessage
                        }]
                    };
                }

                // Return as error if no export ID found
                return {
                    success: false,
                    isError: true,
                    error: 'Export creation failed - no export ID returned',
                    content: [{
                        type: 'text',
                        text: resultMessage
                    }]
                };
            }
        } catch (error) {
            OutputLogger.error(`Database export error: ${error.message}`);

            // Check if this is a concurrent operation error
            if (error.message && (
                error.message.includes('on-going') ||
                error.message.includes('already running') ||
                error.message.includes('Another operation') ||
                error.message.includes('Operation Already In Progress')
            )) {
                // Return error in a format that handleExportDatabase can detect
                return {
                    isError: true,
                    content: [{
                        type: 'text',
                        text: 'Another operation is currently running. Only one database export can run at a time per project.'
                    }]
                };
            }

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
            const { apiKey, apiSecret, projectId, exportId, environment, databaseName } = args;

            // Build command using the PowerShell command builder - Environment and DatabaseName are required
            const command = new PowerShellCommandBuilder('Get-EpiDatabaseExport')
                .addParam('ProjectId', projectId)
                .addParam('Environment', environment || 'Production')  // Default to Production if not specified
                .addParam('DatabaseName', databaseName || 'epicms')  // Default to epicms if not specified
                .addParam('Id', exportId)
                .build();
            
            // Execute command using the correct method
            const result = await PowerShellHelper.executeEpiCommandDirectWithCredentials(
                command, 
                { apiKey, apiSecret, projectId }, 
                { parseJson: true }
            );

            return ResponseBuilder.success(result.stdout || result);
        } catch (error) {
            OutputLogger.error(`Export status check error: ${error.message}`);
            return ResponseBuilder.internalError('Export status check failed', error.message);
        }
    }
    
    /**
     * Unified database export with smart defaults and transparent monitoring
     * Primary export tool - supports all export scenarios with intelligent defaults
     * Uses transparent step-by-step monitoring (user sees each status check)
     */
    static async handleExportDatabase(args) {
        try {
            let {
                environment,
                project,
                databaseName,
                previewOnly,
                autoDownload,
                downloadPath,
                forceNew,
                useExisting,
                skipConfirmation,
                autoMonitor = false, // Disable automatic monitoring - need to show export ID first
                // Legacy export_database parameters for compatibility
                projectName,
                projectId,
                apiKey,
                apiSecret,
                retentionHours
            } = args;

            // SOFT WARNING: If we recently had a concurrent export error and parameters changed
            const lastError = global.__lastExportError || {};
            if (lastError.errorCode === 'CONCURRENT_EXPORT_IN_PROGRESS' &&
                lastError.timestamp && (Date.now() - lastError.timestamp < 30000)) { // Within 30 seconds

                // Check if parameters changed (indicating AI is trying workarounds)
                const paramsChanged = (forceNew && !lastError.forceNew) ||
                                    (skipConfirmation && !lastError.skipConfirmation);

                if (paramsChanged) {
                    OutputLogger.warn(`⚠️ Parameter change detected after concurrent export error - this won't help`);
                    // Don't block, just warn - the concurrent export will fail anyway
                }
            }

            // DEBUG: Log what we received - use info level so it shows in output
            const sessionId = process.env.MCP_SESSION_ID || 'no-session';
            if (forceNew || args.monitor) {
                OutputLogger.info(`🔍 [PARAM CHECK] forceNew=${forceNew}, monitor=${args.monitor}, autoDownload=${autoDownload}`);
            }


            // Check if this is a self-hosted project - they can only download existing backups
            if (args.isSelfHosted || args.connectionString) {
                return ResponseBuilder.invalidParams('Database export is not available for self-hosted projects. Self-hosted projects can only download existing database backups from Azure Storage.');
            }
            
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

            // CRITICAL: Default autoDownload to false unless explicitly set to true
            const autoDownloadEnabled = autoDownload === true;
            
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

            // Ensure we have a valid project name for path resolution
            const projectNameForPaths = projectConfig.name || 'default-project';

            // Get download path for preview (don't create yet, just for display)
            const resolvedDownloadPath = await DownloadConfig.getDownloadPath(
                'database',
                projectNameForPaths,
                downloadPath,
                targetEnv
            );

            // Smart detection: If this is a real export (not preview) and we recently showed an existing backup,
            // the user likely chose to create a fresh export. Skip the check to avoid showing it twice.
            const isLikelyFreshExportChoice = !previewOnly && !forceNew && !args.monitor;

            // Check for existing local backups (unless explicitly skipping)
            // Skip this check if forceNew is true OR if monitor or autoDownload are set (user has made their choice)
            // IMPORTANT: forceNew=true means user explicitly wants a fresh backup, so skip the check entirely
            if (forceNew) {
                OutputLogger.info(`✅ Skipping existing backup check - forceNew=true, creating fresh export`);
            } else if (isLikelyFreshExportChoice) {
                OutputLogger.info(`📦 Proceeding with fresh export (detected user choice from preview)`);
            }
            if (!skipConfirmation && !forceNew && !previewOnly && !args.monitor && !autoDownload && !isLikelyFreshExportChoice) {
                const existingBackup = await this.checkForExistingBackups(resolvedDownloadPath, projectConfig.name, targetEnv, dbName);
                if (existingBackup) {
                    // Found an existing backup - present it with all options
                    let message = `📂 **Existing Database Backup Found Locally**\n\n`;

                    // Show backup details clearly
                    message += `📁 **You already have this backup on your local machine:**\n`;
                    message += `• File: ${existingBackup.filename}\n`;
                    message += `• Size: ${existingBackup.size}\n`;
                    message += `• Age: ${existingBackup.ageDisplay}`;

                    if (existingBackup.isRecent) {
                        message += ` ✅\n`;
                        message += `• Location: \`${existingBackup.filepath}\`\n\n`;
                        message += `✅ **This backup is recent and ready to use immediately.**\n`;
                        message += `No download needed - the file is already on your machine.\n\n`;
                    } else {
                        message += ` ⚠️\n`;
                        message += `• Location: \`${existingBackup.filepath}\`\n\n`;
                        message += `⚠️ **This backup is ${existingBackup.ageDisplay} old and may be outdated.**\n`;
                        message += `The file is already on your machine, but you may want a fresher backup.\n\n`;
                    }

                    message += `---\n\n`;

                    if (existingBackup.isRecent) {
                        message += `**Options:**\n`;
                        message += `1. **Use the existing local backup** (no action needed - file at path above)\n`;
                        message += `2. **Create a fresh backup** if you need the very latest data\n\n`;
                    } else {
                        message += `**Options:**\n`;
                        message += `1. **Use the existing local backup** despite its age (file at path above)\n`;
                        message += `2. **Create a fresh backup** for more recent data (recommended)\n\n`;
                    }

                    message += `**To create a fresh backup:**\n`;
                    message += `Run \`export_database forceNew: true\`\n`;
                    message += `• Monitoring happens automatically (no need for monitor: true)\n`;
                    message += `• Shows download size when complete\n`;
                    message += `• You confirm before downloading\n`;
                    message += `• Do NOT add autoDownload: true (bypasses size preview)\n\n`;
                    message += `⚠️ **AI ASSISTANT:** User must choose between using existing or creating new.\n`;
                    message += `Do not automatically proceed with forceNew: true unless user explicitly chooses option 2.\n\n`;
                    message += `---\n\n`;
                    message += `**🛑 DECISION REQUIRED: This is a stopping point. Wait for user to choose option 1 or 2.**`;

                    return ResponseBuilder.success(message);
                }
            }

            // Always enable monitoring for real exports (not preview mode)
            if (!previewOnly) {
                args.monitor = true;
                OutputLogger.info('📊 Monitoring enabled automatically for all exports');
            }

            // Respect the autoDownload parameter if provided
            let autoDownloadActual = autoDownload === true;
            if (autoDownloadActual) {
                OutputLogger.info('📥 Auto-download enabled - will download when export completes');
            } else {
                OutputLogger.info('🔄 Standard export - will ask for confirmation before downloading');
            }

            // If not preview mode, we're creating an export
            if (!previewOnly) {
                OutputLogger.info('📦 Starting database export');
                // NOTE: Cannot proactively check for running exports because Get-EpiDatabaseExport requires an export ID
                // We'll have to rely on catching the error when trying to start a new export
            }
            
            // Preview mode - check for existing backups
            if (previewOnly) {
                OutputLogger.debug(`[DEBUG] Checking for existing backups...`);

                // First check for existing local backups
                const existingBackup = await this.checkForExistingBackups(resolvedDownloadPath, projectConfig.name, targetEnv, dbName);

                // If no existing backup, show ready to export message
                if (!existingBackup) {
                    OutputLogger.info(`📦 No existing backups found.`);

                    // Return a simple message that we're ready to export
                    let preview = `📦 **Ready to Export Database**\n\n`;
                    preview += `**Project**: ${projectConfig.name}\n`;
                    preview += `**Environment**: ${targetEnv}\n`;
                    preview += `**Database**: ${dbName}\n\n`;
                    preview += `No existing backups found locally.\n\n`;
                    preview += `**To create a new export:**\n`;
                    preview += `Use \`export_database\` without \`previewOnly: true\`\n\n`;
                    preview += `The export will:\n`;
                    preview += `• Create a fresh backup\n`;
                    preview += `• Monitor progress automatically\n`;
                    preview += `• Typical time: 5-15 minutes\n`;
                    preview += `• Ask for download confirmation when complete`;

                    return ResponseBuilder.success(preview);
                } else {

                // Try to get size estimation from recent exports
                let sizeEstimation = '';
                try {
                    OutputLogger.debug('📊 Checking for recent database exports to estimate size...');

                    // Add timeout to prevent hanging
                    const timeoutPromise = new Promise((resolve) => {
                        setTimeout(() => resolve([]), 5000); // 5 second timeout
                    });

                    // Query PaaS portal for existing exports to get size info
                    const queryPromise = this.queryPaaSExports(projectConfig, targetEnv);
                    const recentExports = await Promise.race([queryPromise, timeoutPromise]) || [];

                    if (recentExports.length === 0) {
                        OutputLogger.debug('No recent exports found (query may have timed out)');
                    } else {
                        OutputLogger.debug(`Found ${recentExports.length} export(s) on PaaS portal`);
                    }
                    const matchingExports = recentExports.filter(exp =>
                        exp.environment === targetEnv &&
                        exp.databaseName === dbName &&
                        exp.completedAt // Only completed exports
                    );

                    if (matchingExports.length > 0) {
                        // Get the most recent completed export
                        const mostRecent = matchingExports[0];
                        const timeAgo = this.getTimeAgo(mostRecent.completedAt);

                        // If we have downloadUrl, try to get the size
                        if (mostRecent.downloadUrl) {
                            try {
                                const fileSize = await this.getRemoteFileSize(mostRecent.downloadUrl);
                                if (fileSize) {
                                    const sizeInGB = fileSize / (1024 * 1024 * 1024);
                                    sizeEstimation = `\n**📊 Size Estimation**: ~${sizeInGB > 1 ? `${sizeInGB.toFixed(2)} GB` : `${(fileSize / (1024 * 1024)).toFixed(2)} MB`} (based on backup from ${timeAgo})`;
                                }
                            } catch (error) {
                                // If remote size check fails, just note we have recent backup info
                                sizeEstimation = `\n**📊 Size Estimation**: Similar to recent backup from ${timeAgo}`;
                            }
                        } else {
                            sizeEstimation = `\n**📊 Size Estimation**: Similar to recent backup from ${timeAgo}`;
                        }
                    } else {
                        // No recent backups - don't show size estimation
                        sizeEstimation = '';
                    }
                } catch (error) {
                    // Error getting backup info - don't show size estimation
                    sizeEstimation = '';
                }

                // Build preview message with existing backup info if available
                let preview = `📦 **Database Export Options**\n\n`;
                preview += `**Project**: ${projectConfig.name}\n`;
                preview += `**Environment**: ${targetEnv}\n`;
                preview += `**Database**: ${dbName}${sizeEstimation}\n\n`;

                // If we found an existing backup, show it as the first option
                if (existingBackup) {
                    preview += `🎯 **Existing Backup Found!**\n`;
                    preview += `• **File:** ${existingBackup.filename}\n`;
                    preview += `• **Size:** ${existingBackup.size}\n`;
                    preview += `• **Age:** ${existingBackup.ageDisplay}`;
                    if (existingBackup.isRecent) {
                        preview += ` ✅ (recent)\n\n`;
                        preview += `**Option 1️⃣ Use Existing Backup** (fastest)\n`;
                        preview += `This backup is recent enough for most purposes.\n`;
                        preview += `Location: \`${existingBackup.filepath}\`\n\n`;
                    } else {
                        preview += ` ⚠️ (might be outdated)\n\n`;
                    }
                    preview += `---\n\n`;
                    preview += `**Option 2️⃣ Create a new export**\n`;
                } else {
                    preview += `**Option 1️⃣ Create a new export**\n`;
                }

                preview += `\`export_database\`\n`;
                preview += `• Creates a fresh backup\n`;
                preview += `• Monitors progress automatically\n`;
                preview += `• Typical time: 5-15 minutes\n`;
                preview += `• Will download when complete\n\n`;

                preview += `📂 **Files saved to:** \`${await DownloadConfig.getDownloadPath('database', projectNameForPaths, downloadPath, targetEnv)}\`\n`;

                if (!existingBackup) {
                    preview += `⏱️ **Estimated time:** 5-15 minutes\n`;
                    preview += `💡 **Note:** Checking for local backups...`;
                } else {
                    preview += `⏱️ **New export time:** 5-15 minutes`;
                }

                preview += `\n\n**What would you like to do?**\n\n`;
                preview += `• Type "1" to use the existing backup\n`;
                preview += `• Type "2" to create a fresh export`;

                    return ResponseBuilder.success(preview);
                }
            }
            
            // Show what's about to happen (unless skipConfirmation is true)
            if (!skipConfirmation) {
                OutputLogger.debug(`\n📊 **Starting Database Export**`);
                OutputLogger.debug(`   • **Project:** ${projectConfig.name}`);
                OutputLogger.debug(`   • **Environment:** ${targetEnv}`);
                OutputLogger.debug(`   • **Database:** ${dbName}`);
                OutputLogger.debug(`   • **Download to:** ${resolvedDownloadPath}`);
                OutputLogger.debug(`   • **Auto-download:** ${autoDownloadActual ? 'Yes' : 'No (will ask for confirmation)'}`);
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

            // Log the result structure to diagnose monitoring issues
            if (result && result.content) {
                OutputLogger.info(`📝 Export response received - checking for export ID...`);
            }

            // DEBUG: Log error details to diagnose concurrent export detection
            if (result.isError && result.content && result.content[0] && result.content[0].text) {
                OutputLogger.info(`🔍 Export error detected: ${result.content[0].text.substring(0, 200)}`);
            }

            // First, try to extract export ID to see if it actually succeeded
            let exportId = null;
            try {
                exportId = this.extractExportId(result);
                if (!exportId && result.content && result.content[0] && result.content[0].text) {
                    // Fallback: Try to extract any UUID from the response
                    const uuidMatch = result.content[0].text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                    if (uuidMatch) {
                        exportId = uuidMatch[1];
                        OutputLogger.info(`✅ Export ID found: ${exportId}`);
                    }
                }
            } catch (e) {
                // Ignore extraction errors
            }

            // If we got an export ID, the export started successfully!
            if (exportId) {
                OutputLogger.info(`✅ Export started successfully with ID: ${exportId}`);
                // Store for status checking later
                if (!global.__latestDatabaseExport) {
                    global.__latestDatabaseExport = {};
                }
                global.__latestDatabaseExport[targetEnv] = {
                    exportId: exportId,
                    timestamp: Date.now(),
                    databaseName: dbName
                };
                // Continue with normal success flow below
            }
            // Only show concurrent export error if we have an error AND no export ID
            else if (result.isError || !result.success) {
                const errorText = result.content?.[0]?.text || result.error || '';
                OutputLogger.info('⚠️ Export creation failed');
                OutputLogger.info(`Error details: ${errorText.substring(0, 200)}`);

                // Check if this is actually a concurrent export error
                const isConcurrentError = errorText.toLowerCase().includes('already running') ||
                                         errorText.toLowerCase().includes('in progress') ||
                                         errorText.toLowerCase().includes('concurrent') ||
                                         errorText.toLowerCase().includes('another export');

                if (isConcurrentError) {
                    // Only show aggressive message for actual concurrent exports
                    let conflictMessage = `⚠️ **Another Export Already Running**\n\n`;
                    conflictMessage += `Only one database export can run at a time per project.\n\n`;
                    conflictMessage += `**What to do:**\n`;
                    conflictMessage += `• Wait 3-5 minutes for the current export to complete\n`;
                    conflictMessage += `• Then try the same command again\n\n`;
                    conflictMessage += `**Note:** This is normal behavior when exports overlap.`;

                    // Store error globally to detect parameter changes on retry
                    global.__lastExportError = {
                        errorCode: 'CONCURRENT_EXPORT_IN_PROGRESS',
                        timestamp: Date.now(),
                        forceNew: forceNew || false,
                        skipConfirmation: skipConfirmation || false
                    };

                    return {
                        success: false,
                        isError: true,
                        errorCode: 'CONCURRENT_EXPORT_IN_PROGRESS',
                        content: [{
                            type: 'text',
                            text: conflictMessage
                        }]
                    };
                } else {
                    // For other errors, show the actual error message
                    let errorMessage = `❌ **Export Creation Failed**\n\n`;
                    errorMessage += `**Error:** ${errorText}\n\n`;
                    errorMessage += `**Possible causes:**\n`;
                    errorMessage += `• Invalid project configuration\n`;
                    errorMessage += `• Authentication issues\n`;
                    errorMessage += `• Network connectivity problems\n`;
                    errorMessage += `• Invalid environment or database name\n\n`;
                    errorMessage += `**Try:**\n`;
                    errorMessage += `• Check project configuration with \`test_connection\`\n`;
                    errorMessage += `• Verify the environment and database names are correct\n`;
                    errorMessage += `• Check if you have permissions for this operation`;

                    return {
                        success: false,
                        isError: true,
                        content: [{
                            type: 'text',
                            text: errorMessage
                        }]
                    };
                }
            }

            // If we reach here with an exportId, the export started successfully
            if (exportId) {
                // Don't duplicate the log message - already logged above at line 622

                // IMPORTANT: Keep the result for message extraction but mark as success
                // We'll override with success response at the end
                
                await this.storeBackupInfo(projectConfig.name, {
                    exportId: exportId,
                    environment: targetEnv,
                    databaseName: dbName,
                    startTime: new Date().toISOString()
                });
                
                // ALWAYS start background monitoring by default (as requested)
                // This ensures monitoring happens regardless of autoDownload setting
                // Use the same project name variable we defined earlier
                const projectNameForPath = projectNameForPaths;

                const validated = await DownloadConfig.getValidatedDownloadPath(
                    'database',
                    projectNameForPath,
                    downloadPath,
                    targetEnv
                );

                let downloadDir = validated.path;

                if (!validated.valid) {
                    // Don't throw - just log the issue and use a fallback path
                    OutputLogger.warn(`⚠️ Download path issue: ${validated.error}`);

                    // Use a safe fallback path
                    const os = require('os');
                    const path = require('path');
                    downloadDir = path.join(os.homedir(), 'Downloads', 'optimizely-exports', projectNameForPath, targetEnv);
                    OutputLogger.info(`📁 Using fallback download location: ${downloadDir}`);
                }

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
                    autoDownload: false, // Always false - size preview required
                    monitoring: args.monitor || true, // Store monitoring intent separately
                    startTime: new Date().toISOString()
                });

                // Always monitor for real exports (monitor is set to true above)
                const shouldMonitor = args.monitor !== false;

                if (shouldMonitor) {
                    if (autoDownloadActual) {
                        OutputLogger.success(`✅ Export created with auto-download + monitoring enabled!`);
                    } else {
                        OutputLogger.success(`✅ Export created with monitoring enabled!`);
                    }

                    OutputLogger.info(`🔄 Starting background monitoring...`);

                    try {
                        this.startBackgroundMonitoring(exportId, projectConfig, targetEnv, dbName, downloadDir);
                        OutputLogger.success(`📊 Background monitoring active - will check every 2 minutes`);

                        if (autoDownloadActual) {
                            OutputLogger.info(`💾 Will auto-download when complete`);
                        } else {
                            OutputLogger.info(`📊 Will show download link when complete`);
                        }
                    } catch (error) {
                        OutputLogger.error(`❌ Failed to start monitoring: ${error.message}`);
                        OutputLogger.info(`💡 Manual monitoring: check_export_status exportId: "${exportId}"`);
                    }
                }

                // Generate appropriate monitoring message based on capabilities
                let monitoringMessage = '';
                if (shouldMonitor) {
                        if (autoDownloadActual) {
                            monitoringMessage = `\n\n📊 **Monitoring Mode**: AI will check status every 2-3 minutes\n✅ **Auto-Download**: Enabled when complete\n⏰ **Next Check**: In 2-3 minutes`;
                        } else {
                            monitoringMessage = `\n\n📊 **Monitoring Mode**: AI will check status every 2-3 minutes\n📋 **Download Decision**: Will show file size when complete\n⏰ **Next Check**: In 2-3 minutes`;
                        }
                    } else {
                        monitoringMessage = `\n\n🔄 **Manual Monitoring**: Use \`check_export_status\` to monitor progress\n📊 **Status Checking**: Manual - run status command periodically`;
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
                    if (result && result.result && result.result.content && result.result.content[0] && result.result.content[0].text) {
                        originalMessage = result.result.content[0].text;
                    } else if (result && result.content && result.content[0] && result.content[0].text) {
                        originalMessage = result.content[0].text;
                    } else if (typeof result === 'string') {
                        originalMessage = result;
                    } else if (result && result.message) {
                        originalMessage = result.message;
                    } else if (result && typeof result === 'object' && result !== null) {
                        // DXP-53 Fix: Handle raw object result from internalExportDatabase
                        // Try to extract meaningful data from the export result object
                        originalMessage = 'Database export initiated.\n';
                        if (result.id) originalMessage += `Export ID: ${result.id}\n`;
                        if (result.projectId) originalMessage += `Project: ${result.projectId}\n`;
                        if (result.environment) originalMessage += `Environment: ${result.environment}\n`;
                        if (result.status) originalMessage += `Status: ${result.status}\n`;
                        // If result has data property with the actual export info
                        if (result.data) {
                            originalMessage = 'Database export initiated.\n' + JSON.stringify(result.data, null, 2);
                        }
                    } else {
                        originalMessage = 'Database export started successfully';
                    }
                    
                    // Get download path for user information
                    const finalDownloadPath = await DownloadConfig.getDownloadPath('database', projectNameForPaths || projectConfig.name || 'default-project', downloadPath, targetEnv);

                    // Build smart response with monitoring and download options
                    let enhancedMessage = `✅ **Database Export Started**\n\n`;

                    // Add export details if available
                    // Check if we can extract additional export ID from result object (fallback)
                    if (!exportId && (result.id || (result.data && result.data.id))) {
                        exportId = result.id || result.data.id;
                    }
                    if (exportId) {
                        enhancedMessage += `**Export ID saved:** ${exportId}\n`;
                        enhancedMessage += `**Status checking:** Available via check_export_status tool\n`;
                    }
                    enhancedMessage += `**Environment:** ${targetEnv}\n`;
                    enhancedMessage += `**Database:** ${dbName}\n\n`;

                    // Monitoring status - visible checks every 2-3 minutes
                    if (monitoringMessage.includes('Monitoring Mode')) {
                        enhancedMessage += `✅ **Monitoring Plan**: Will check status every 2-3 minutes\n`;
                        enhancedMessage += `👁️ **Visible Updates**: Each status check will be shown\n`;

                        if (autoDownloadActual) {
                            enhancedMessage += `📥 **Auto-Download Enabled**: Will download when complete\n`;
                            enhancedMessage += `📂 **Save Location**: \`${finalDownloadPath}\`\n\n`;
                            enhancedMessage += `**Smart Download Features:**\n`;
                            enhancedMessage += `• ✅ Incremental check - won't re-download if file exists\n`;
                            enhancedMessage += `• 📊 Size and time estimate before download\n`;
                            enhancedMessage += `• 🔄 Automatic retry on failure\n\n`;
                        } else {
                            enhancedMessage += `📊 **Download Decision**: Will show size/time when ready\n\n`;
                            enhancedMessage += `**When Complete:**\n`;
                            enhancedMessage += `• You'll see the file size and estimated download time\n`;
                            enhancedMessage += `• Choose whether to download based on size\n`;
                            enhancedMessage += `• File will be saved to: \`${finalDownloadPath}\`\n\n`;
                        }
                    } else {
                        enhancedMessage += `⏸️ **Manual Monitoring Required**\n`;
                        enhancedMessage += `Check status with: \`check_export_status\`\n\n`;
                    }

                    enhancedMessage += `⏱️ **Estimated Time**: 5-15 minutes (varies by database size)\n\n`;

                    // Automatic server-side monitoring if enabled and exportId available
                    OutputLogger.info(`🔍 Monitoring decision: exportId=${exportId}, autoMonitor=${autoMonitor}`);

                    if (exportId && autoMonitor) {
                        OutputLogger.info(`🚀 Starting progressive monitoring for export ${exportId}`);

                        // CRITICAL: Show the export ID immediately before monitoring starts
                        enhancedMessage += `\n\n✅ **EXPORT CREATED SUCCESSFULLY**\n`;
                        enhancedMessage += `🆔 **Export ID:** \`${exportId}\`\n`;
                        enhancedMessage += `📍 **Environment:** ${targetEnv}\n`;
                        enhancedMessage += `💾 **Database:** ${dbName}\n\n`;

                        enhancedMessage += `⏱️ **WAITING 2 MINUTES BEFORE FIRST CHECK**\n`;
                        enhancedMessage += `The export needs time to initialize.\n`;
                        enhancedMessage += `I'll check the status after a 2-minute wait...\n\n`;

                        // Wait 2 minutes before first check
                        await new Promise(resolve => setTimeout(resolve, 120000));

                        // Now check the status
                        OutputLogger.info(`📊 Checking export status after 2-minute wait...`);
                        const statusResult = await this.internalCheckExportStatus({
                            apiKey: projectConfig.apiKey,
                            apiSecret: projectConfig.apiSecret,
                            projectId: projectConfig.projectId,
                            exportId: exportId,
                            environment: targetEnv,
                            databaseName: dbName
                        });

                        // Parse and return the status
                        const status = this.parseExportStatus(statusResult);

                        if (status.status === 'Succeeded') {
                            enhancedMessage += `\n✅ **EXPORT COMPLETE!**\n`;
                            enhancedMessage += `Status: ${status.status}\n`;
                            if (status.downloadUrl) {
                                enhancedMessage += `Download URL: ${status.downloadUrl}\n`;
                            }
                            result = ResponseBuilder.success(enhancedMessage);
                        } else if (status.status === 'Failed') {
                            enhancedMessage += `\n❌ **EXPORT FAILED**\n`;
                            enhancedMessage += `Status: ${status.status}\n`;
                            enhancedMessage += `Error: ${status.error || 'Unknown error'}\n`;
                            result = ResponseBuilder.error('Export failed', enhancedMessage);
                        } else {
                            enhancedMessage += `\n⏳ **EXPORT STILL IN PROGRESS**\n`;
                            enhancedMessage += `Status: ${status.status || 'InProgress'}\n`;
                            enhancedMessage += `Time elapsed: ~2 minutes\n\n`;
                            enhancedMessage += `**Next steps:**\n`;
                            enhancedMessage += `• Wait another 2 minutes\n`;
                            enhancedMessage += `• Then check status again with:\n`;
                            enhancedMessage += `  check_export_status exportId="${exportId}" environment="${targetEnv}"\n`;
                            result = ResponseBuilder.success(enhancedMessage);
                        }
                    } else if (exportId) {
                        // Transparent monitoring instructions for AI
                        enhancedMessage += `\n\n📊 **MONITORING INSTRUCTIONS FOR AI**\n\n`;
                        enhancedMessage += `Export created successfully!\n`;
                        enhancedMessage += `Export ID: ${exportId}\n`;
                        enhancedMessage += `Environment: ${targetEnv}\n\n`;
                        enhancedMessage += `**To check status, use check_export_status with:**\n`;
                        enhancedMessage += `• exportId: "${exportId}"\n`;
                        enhancedMessage += `• environment: "${targetEnv}"\n`;
                        enhancedMessage += `• waitBeforeCheck: 120 (optional - waits 2 minutes before checking)\n\n`;
                        enhancedMessage += `**RECOMMENDED MONITORING PATTERN:**\n`;
                        enhancedMessage += `1. Call check_export_status with:\n`;
                        enhancedMessage += `   - exportId="${exportId}"\n`;
                        enhancedMessage += `   - environment="${targetEnv}"\n`;
                        enhancedMessage += `   - waitBeforeCheck=120 (waits 2 minutes, then checks)\n`;
                        enhancedMessage += `2. If still in progress, repeat with longer wait (e.g., 300 seconds)\n`;
                        enhancedMessage += `3. When complete, offer download options\n\n`;
                        enhancedMessage += `**Note:** The server will wait the specified time before checking.\n`;
                        enhancedMessage += `Export typically takes 5-15 minutes total.`;
                        result = ResponseBuilder.success(enhancedMessage);
                    } else {
                        enhancedMessage += `⚠️ **Note**: Export ID not captured - manual monitoring required\n`;
                        enhancedMessage += `Use: Run check_export_status with exportId: "latest"\n`;
                        enhancedMessage += `Or find exports with: \`list_backups\``;
                        result = ResponseBuilder.success(enhancedMessage);
                    }
                }

            return result;

        } catch (error) {
            return ErrorHandler.handleError(error, 'backup', args);
        }
    }
    
    /**
     * Automatic monitoring function that polls export status
     * Returns a complete status message with all updates
     */
    static async monitorExportAutomatically(exportId, projectConfig, environment, databaseName, downloadPath, initialMessage) {
        try {
            const maxAttempts = 15; // Max 30 minutes of monitoring (15 * 2 minutes)
            const checkInterval = 120000; // 2 minutes in milliseconds
            let attempts = 0;
            let allMessages = [initialMessage];

            OutputLogger.info(`🔄 Starting automatic monitoring for export ${exportId}`);

            while (attempts < maxAttempts) {
                attempts++;

            // Wait 2 minutes before checking (including first check - exports take time to initialize)
            if (attempts === 1) {
                OutputLogger.info(`⏳ Waiting 2 minutes for export to initialize before first status check...`);
            } else {
                OutputLogger.info(`⏳ Waiting 2 minutes before next status check... (Check ${attempts}/${maxAttempts})`);
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));

            try {
                OutputLogger.info(`📊 Checking export status (attempt ${attempts})...`);

                // Check the export status with timeout
                const statusPromise = this.internalCheckExportStatus({
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId,
                    exportId: exportId,
                    environment: environment,
                    databaseName: databaseName
                });

                // Add 30 second timeout for status check
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Status check timeout')), 30000)
                );

                const statusResult = await Promise.race([statusPromise, timeoutPromise]);

                let statusData;
                if (statusResult.content && statusResult.content[0]) {
                    // Parse the status response
                    const statusText = statusResult.content[0].text;
                    try {
                        statusData = JSON.parse(statusText);
                        OutputLogger.info(`📊 Status: ${statusData.status}`);
                    } catch (e) {
                        // If not JSON, extract status from text
                        statusData = { status: statusText };
                        OutputLogger.info(`📊 Status (text): ${statusText.substring(0, 100)}`);
                    }
                } else if (typeof statusResult === 'object') {
                    statusData = statusResult;
                    OutputLogger.info(`📊 Status (object): ${statusData.status || 'Unknown'}`);
                }

                // Generate status update message
                let updateMessage = `\n📊 **Status Update (Check ${attempts}):**\n`;

                if (statusData) {
                    if (statusData.status === 'Succeeded') {
                        updateMessage += `✅ **Export Complete!**\n`;
                        if (statusData.downloadLink) {
                            updateMessage += `📦 **Export Ready for Download**\n\n`;
                            updateMessage += `**File:** ${statusData.bacpacName || 'database.bacpac'}\n`;
                            updateMessage += `**Environment:** ${environment}\n`;
                            updateMessage += `**Database:** ${databaseName}\n`;

                            // Try to get file size for preview
                            let sizeDisplay = '';
                            try {
                                const fileSize = await this.getRemoteFileSize(statusData.downloadLink);
                                if (fileSize) {
                                    const sizeInGB = fileSize / (1024 * 1024 * 1024);
                                    const sizeInMB = fileSize / (1024 * 1024);
                                    sizeDisplay = sizeInGB > 1 ? `${sizeInGB.toFixed(2)} GB` : `${sizeInMB.toFixed(2)} MB`;
                                    updateMessage += `**Size:** ${sizeDisplay}\n`;
                                }
                            } catch (e) {
                                OutputLogger.debug(`Could not get file size: ${e.message}`);
                            }

                            updateMessage += `\n📥 **DOWNLOAD OPTIONS:**\n\n`;
                            updateMessage += `The export has completed successfully. Would you like to:\n\n`;
                            updateMessage += `1. **Download the backup now** ${sizeDisplay ? `(${sizeDisplay})` : ''}\n`;
                            updateMessage += `2. **Keep the download link** (valid for 7 days)\n\n`;
                            updateMessage += `**To download, use:**\n`;
                            updateMessage += `check_export_status with:\n`;
                            updateMessage += `  - exportId: "${exportId}"\n`;
                            updateMessage += `  - environment: "${environment}"\n`;
                            updateMessage += `  - autoDownload: true\n\n`;
                            updateMessage += `**Note:** The backup will be saved to:\n`;
                            updateMessage += `${downloadPath}`;
                        }

                        allMessages.push(updateMessage);
                        // Return all messages combined
                        return ResponseBuilder.success(allMessages.join('\n'));

                    } else if (statusData.status === 'Failed') {
                        updateMessage += `❌ **Export Failed**\n`;
                        if (statusData.message) {
                            updateMessage += `Error: ${statusData.message}\n`;
                        }
                        allMessages.push(updateMessage);
                        return ResponseBuilder.error(allMessages.join('\n'));

                    } else if (statusData.status === 'InProgress' || statusData.status === 'NotStarted') {
                        updateMessage += `⏳ **Status:** ${statusData.status}\n`;
                        updateMessage += `• Export ID: ${exportId}\n`;
                        updateMessage += `• Environment: ${environment}\n`;
                        updateMessage += `• Database: ${databaseName}\n`;
                        updateMessage += `• Next check in 2 minutes...\n`;
                        allMessages.push(updateMessage);

                    } else {
                        updateMessage += `📋 **Current Status:** ${statusData.status || 'Unknown'}\n`;
                        allMessages.push(updateMessage);
                    }
                } else {
                    updateMessage += `⚠️ Unable to parse status response\n`;
                    allMessages.push(updateMessage);
                }

            } catch (error) {
                OutputLogger.error(`Status check error: ${error.message}`);
                let errorMessage = `\n⚠️ **Status Check Error (Attempt ${attempts}):**\n`;
                errorMessage += `Error: ${error.message}\n`;
                errorMessage += `Will continue monitoring...\n`;
                allMessages.push(errorMessage);
                // Continue monitoring despite errors
            }
        }

            // Timeout reached
            OutputLogger.info(`⏰ Monitoring timeout reached after ${maxAttempts} attempts`);
            allMessages.push(`\n⏰ **Monitoring Timeout**\nExport is taking longer than expected (>30 minutes).\nCheck status manually with: \`check_export_status exportId: "${exportId}"\``);
            return ResponseBuilder.success(allMessages.join('\n'));

        } catch (unexpectedError) {
            OutputLogger.error(`🚨 Unexpected monitoring error: ${unexpectedError.message}`);
            return ResponseBuilder.error(`Monitoring failed unexpectedly: ${unexpectedError.message}\n\nCheck status manually with: \`check_export_status exportId: "${exportId}"\``);
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
                environment,
                waitBeforeCheck,
                autoDownload,
                project,
                latest,
                // Legacy check_export_status parameters for compatibility
                projectName,
                projectId,
                apiKey,
                apiSecret
            } = args;

            // Debug logging for autoDownload parameter
            OutputLogger.debug(`[handleExportStatus] autoDownload parameter: ${autoDownload} (type: ${typeof autoDownload})`);

            // If waitBeforeCheck is specified, wait that many seconds first
            if (waitBeforeCheck && waitBeforeCheck > 0) {
                // Allow any reasonable wait time (AI can decide)
                const waitTime = waitBeforeCheck * 1000; // Convert to ms
                const waitMinutes = Math.floor(waitTime / 60000);
                const waitSeconds = Math.floor((waitTime % 60000) / 1000);

                OutputLogger.info(`⏱️ Waiting ${waitMinutes}m ${waitSeconds}s before checking status...`);

                // Return a message indicating we're waiting
                const waitMessage = `⏱️ **WAITING BEFORE STATUS CHECK**\n\n` +
                    `Waiting ${waitMinutes} minutes ${waitSeconds} seconds before checking export status...\n` +
                    `Export ID: ${exportId}\n` +
                    `Environment: ${environment || 'Production'}\n\n` +
                    `Please wait...`;

                // Actually wait
                await new Promise(resolve => setTimeout(resolve, waitTime));

                OutputLogger.info(`✅ Wait complete, now checking status...`);
            }
            
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

            // Note: Auto-recovery removed with file persistence removal
            
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
                shouldAutoDownload = false; // Always false - size preview required
                const shouldMonitor = currentState.currentExport.monitoring !== false; // Default to true for monitoring
                downloadPath = currentState.currentExport.downloadPath;
                
                OutputLogger.debug(`Found active export for auto-download: ${targetExportId}`);
            }
            // Priority 2: Use specified exportId or latest backup
            else {
                if (!targetExportId || latest) {
                    // Try to get the latest tracked export
                    const latestExport = await this.getLatestTrackedExport(
                        projectConfig,
                        args.environment || 'Production',
                        args.databaseName || 'epicms'
                    );

                    if (latestExport) {
                        targetExportId = latestExport.id;
                        backupEnvironment = latestExport.environment;
                        backupDatabase = latestExport.databaseName;
                        // Extract start time from details if available
                        if (latestExport.details && latestExport.details.bacpacName) {
                            const match = latestExport.details.bacpacName.match(/(\d{14})/);
                            if (match) {
                                const timestamp = match[1];
                                backupStartTime = new Date(
                                    timestamp.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')
                                ).toISOString();
                            }
                        }
                    } else {
                        // Fallback to old method using getLatestBackup
                        const latestBackup = await this.getLatestBackup(projectConfig.name);
                        if (!latestBackup) {
                            // Return a helpful message instead of an error
                            const ResponseBuilder = require('../response-builder');
                            return ResponseBuilder.success(
                                `📊 **No Recent Exports Found**\n\n` +
                                `I couldn't find any exports from this session to check.\n\n` +
                                `**Options:**\n` +
                                `1. Create a new export: \`export_database\`\n` +
                                `2. Check a specific export ID: \`check_export_status exportId: "your-export-id"\`\n` +
                                `3. If you know an export is running, provide its ID directly\n\n` +
                                `💡 **Note**: The \`latest: true\` parameter only works for exports created in the current MCP session.\n` +
                                `Due to PaaS API limitations, we cannot discover exports from previous sessions.`
                            );
                        }
                        targetExportId = latestBackup.exportId;
                        backupEnvironment = latestBackup.environment;
                        backupDatabase = latestBackup.databaseName || 'epicms';
                        backupStartTime = latestBackup.startTime;
                    }
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
                            // Last resort: default to Production (most common for database exports)
                            backupEnvironment = 'Production';
                            backupDatabase = 'epicms';
                            backupStartTime = null; // Unknown start time
                            OutputLogger.debug(`Export ${targetExportId} not found in history. Defaulting to environment: ${backupEnvironment}`);
                            OutputLogger.info(`💡 Tip: For better accuracy, specify environment when checking status`);
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
                    // Always show size preview for completed exports, regardless of auto-download setting
                    if (status.downloadUrl) {
                        try {
                            OutputLogger.success('🎉 Database export complete!');

                            // Download based on autoDownload parameter
                            const skipConfirmation = autoDownload === true;

                            if (skipConfirmation) {
                                OutputLogger.info('📥 Auto-download enabled, starting download...');
                            } else {
                                OutputLogger.info('📊 Showing download confirmation...');
                            }

                            const downloadResult = await this.downloadFromUrl(
                                status.downloadUrl,
                                downloadPath,
                                projectConfig.name,
                                backupEnvironment,
                                backupDatabase,
                                skipConfirmation // Respect the autoDownload parameter
                            );

                            // If confirmation required (autoDownload was false), show size preview
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

💡 **Download completed successfully!**`;
                            
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
                        const capabilityCheck = await CapabilityDetector.checkAutoDownloadCapability(await DownloadConfig.getDownloadPath('database', projectConfig.name, downloadPath, backupEnvironment), 100 * 1024 * 1024);
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
                    
                    const progressMessage = isCurrentExport
                        ? `\n\n📥 **Next Step**: When complete, you'll see file size and can choose to download (estimated in ${this.estimateRemainingTime()})`
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
    
    // REMOVED: handleListExports method (DXP-49)
    // This method relied on queryPaaSExports which cannot work due to EpiCloud API limitations.
    // The Get-EpiDatabaseExport cmdlet requires both DatabaseName AND Id parameters,
    // making it impossible to list all exports without knowing their IDs beforehand.
    // Users should use export_database or check_export_status directly with known export IDs.
    
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
                throw new Error('No projects configured. Run "test_connection setupMode:true" to configure your first project.');
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

        // File persistence removed - keeping only in-memory storage
    }

    // File persistence removed - keeping only in-memory storage

    /**
     * Placeholder for removed file recovery - now using in-memory only
     */
    static async recoverExportsFromFile(projectName) {
        // File persistence removed - returning empty array
        return [];
    }
    
    static async getLatestBackup(projectName) {
        // First try memory
        let history = this.backupHistory[projectName];
        
        // If no history in memory, try to recover from file
        if (!history || history.length === 0) {
            history = [];
        }
        
        return history && history.length > 0 ? history[0] : null;
    }
    
    static async getBackupHistory(projectName, limit = 5) {
        // First try memory
        let history = this.backupHistory[projectName] || [];
        
        // If no history in memory, try to recover from file
        if (history.length === 0) {
            history = [];
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
     * Estimate download time based on file size
     */
    static estimateDownloadTime(bytes) {
        // Assume average download speeds
        const speedMbps = {
            slow: 10,      // 10 Mbps (1.25 MB/s)
            average: 50,   // 50 Mbps (6.25 MB/s)
            fast: 100      // 100 Mbps (12.5 MB/s)
        };

        const bytesPerSecond = speedMbps.average * 125000; // Convert Mbps to bytes/sec
        const seconds = bytes / bytesPerSecond;

        if (seconds < 60) {
            return `< 1 minute`;
        } else if (seconds < 300) {
            return `2-5 minutes`;
        } else if (seconds < 600) {
            return `5-10 minutes`;
        } else if (seconds < 1800) {
            return `10-30 minutes`;
        } else {
            return `30+ minutes`;
        }
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
     * Get the latest database export
     * Since Get-EpiDatabaseExport requires an actual export ID and there's no way to list exports,
     * we rely on our internal tracking of exports created during this session
     */
    static async getLatestTrackedExport(projectConfig, environment = 'Production', databaseName = 'epicms') {
        try {
            const OutputLogger = require('../output-logger');

            OutputLogger.debug(`🔍 Getting latest tracked export for ${environment}/${databaseName}`);

            // First check our in-memory backup history
            const backups = this.backupHistory[projectConfig.name] || [];

            // Filter for the specific environment and database, then sort by time
            const relevantBackups = backups
                .filter(b =>
                    (!environment || b.environment === environment) &&
                    (!databaseName || b.databaseName === databaseName)
                )
                .sort((a, b) => {
                    const timeA = new Date(a.startTime || a.completedAt || 0).getTime();
                    const timeB = new Date(b.startTime || b.completedAt || 0).getTime();
                    return timeB - timeA;  // Most recent first
                });

            if (relevantBackups.length > 0) {
                const latest = relevantBackups[0];
                OutputLogger.debug(`Found latest tracked export: ${latest.exportId}`);

                // Verify it still exists by checking its status
                try {
                    const statusResult = await this.internalCheckExportStatus({
                        exportId: latest.exportId,
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret,
                        projectId: projectConfig.projectId,
                        environment: latest.environment,
                        databaseName: latest.databaseName
                    });

                    if (statusResult.success) {
                        return {
                            id: latest.exportId,
                            status: statusResult.status,
                            details: statusResult.details,
                            environment: latest.environment,
                            databaseName: latest.databaseName
                        };
                    }
                } catch (error) {
                    OutputLogger.debug(`Tracked export ${latest.exportId} no longer exists`);
                }
            }

            OutputLogger.debug('No tracked exports found for this session');
            return null;

        } catch (error) {
            OutputLogger.debug(`Failed to get latest tracked export: ${error.message}`);
            return null;
        }
    }

    /**
     * Test Get-EpiDatabaseExport command directly
     */
    static async testExportQuery(args = {}) {
        try {
            const PowerShellCommandBuilder = require('../powershell-command-builder');
            const PowerShellHelper = require('../powershell-helper');
            const ResponseBuilder = require('../response-builder');
            const OutputLogger = require('../output-logger');

            // Get project configuration
            const ProjectResolver = require('../project-resolver');
            const projectConfig = await ProjectResolver.resolveProject(args);

            const environment = args.environment || 'Production';

            let testResults = '🧪 **Testing Get-EpiDatabaseExport Command**\n\n';

            // Test 1: List all exports (no ID parameter)
            testResults += '**Test 1: List all exports (no ID)**\n';
            const listCommand = new PowerShellCommandBuilder('Get-EpiDatabaseExport')
                .addParam('ProjectId', projectConfig.projectId)
                .addParam('Environment', environment)
                .build();

            testResults += `Command: ${listCommand}\n`;

            const listResult = await PowerShellHelper.executeEpiCommandDirectWithCredentials(
                listCommand,
                {
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId
                },
                { parseJson: true, timeout: 10000 }
            );

            testResults += `Success: ${listResult.isSuccess}\n`;
            testResults += `Has Data: ${!!listResult.data}\n`;
            if (listResult.data) {
                testResults += `Data Type: ${typeof listResult.data}\n`;
                testResults += `Is Array: ${Array.isArray(listResult.data)}\n`;
                if (Array.isArray(listResult.data)) {
                    testResults += `Array Length: ${listResult.data.length}\n`;
                    if (listResult.data.length > 0) {
                        testResults += `First Item: ${JSON.stringify(listResult.data[0], null, 2)}\n`;
                    }
                } else {
                    testResults += `Data: ${JSON.stringify(listResult.data).substring(0, 500)}...\n`;
                }
            }
            if (listResult.error) {
                testResults += `Error: ${listResult.error}\n`;
            }

            return ResponseBuilder.success(testResults);

        } catch (error) {
            return ResponseBuilder.error('Test failed', error.message);
        }
    }

    /**
     * Query PaaS portal for existing database exports
     * WARNING: This function DOES NOT WORK - Get-EpiDatabaseExport requires an export ID
     * Without an ID, the PowerShell command hangs indefinitely
     * Keeping this for reference but it should not be used
     * @deprecated Cannot list exports without knowing their IDs
     */
    static async queryPaaSExports(projectConfig, environment) {
        try {
            const PowerShellCommandBuilder = require('../powershell-command-builder');
            const PowerShellHelper = require('../powershell-helper');
            const OutputLogger = require('../output-logger');

            OutputLogger.info(`🔍 Querying PaaS portal for existing database exports in ${environment}...`);
            console.error(`[DEBUG] queryPaaSExports called for environment: ${environment}`);

            // Build command to list all exports for the environment
            const command = new PowerShellCommandBuilder('Get-EpiDatabaseExport')
                .addParam('ProjectId', projectConfig.projectId)
                .addParam('Environment', environment)
                // No ID parameter = list all exports
                .build();

            console.error(`[DEBUG] PowerShell command: ${command}`);
            console.error(`[DEBUG] ProjectId: ${projectConfig.projectId}`);
            console.error(`[DEBUG] Environment: ${environment}`);

            // Execute command
            const result = await PowerShellHelper.executeEpiCommandDirectWithCredentials(
                command,
                {
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId
                },
                { parseJson: true }
            );

            console.error(`[DEBUG] Command result success: ${result.isSuccess}`);
            console.error(`[DEBUG] Result data exists: ${!!result.data}`);
            if (result.data) {
                console.error(`[DEBUG] Result data type: ${typeof result.data}`);
                console.error(`[DEBUG] Result data length: ${Array.isArray(result.data) ? result.data.length : 'not array'}`);
            }
            if (result.error) {
                console.error(`[DEBUG] Error: ${result.error}`);
            }

            if (!result.isSuccess || !result.data) {
                OutputLogger.debug('No exports found or unable to query exports');
                return [];
            }

            // Parse the results - could be array or single object
            const exports = Array.isArray(result.data) ? result.data : [result.data];

            OutputLogger.debug(`Raw exports from PaaS: ${exports.length} total exports found`);
            if (exports.length > 0) {
                OutputLogger.debug(`First export sample: ${JSON.stringify(exports[0], null, 2)}`);
            }

            // Filter and format the exports
            const formattedExports = exports
                .filter(exp => exp && exp.id) // Must have an ID
                .map(exp => ({
                    exportId: exp.id,
                    environment: exp.environment || environment,
                    databaseName: exp.databaseDisplayName || exp.databaseName || 'epicms',
                    status: exp.status,
                    startTime: exp.startTime || exp.created,
                    completedAt: exp.completedAt,
                    downloadUrl: exp.downloadLink || exp.downloadUrl,
                    bacpacName: exp.bacpacName,
                    isComplete: exp.status === 'Succeeded' || exp.status === 'Complete' || exp.status === 'succeeded' || exp.status === 'complete'
                }));

            OutputLogger.debug(`After initial mapping: ${formattedExports.length} exports`);
            OutputLogger.debug(`Filtering criteria: isComplete && downloadUrl`);

            const filteredExports = formattedExports
                .filter(exp => {
                    const hasDownloadUrl = !!(exp.downloadUrl);
                    const isComplete = exp.isComplete;
                    OutputLogger.debug(`Export ${exp.exportId}: status=${exp.status}, isComplete=${isComplete}, hasDownloadUrl=${hasDownloadUrl}`);
                    return exp.isComplete; // Remove downloadUrl requirement for now to see all completed exports
                })
                .sort((a, b) => {
                    // Sort by date, newest first
                    const dateA = new Date(a.completedAt || a.startTime);
                    const dateB = new Date(b.completedAt || b.startTime);
                    return dateB - dateA;
                });

            OutputLogger.success(`Found ${filteredExports.length} completed database export(s) on PaaS portal`);
            return filteredExports;

        } catch (error) {
            OutputLogger.error(`Failed to query PaaS exports: ${error.message}`);
            return [];
        }
    }

    /**
     * Find an available completed backup for environment and database
     */
    static async findAvailableBackup(projectConfig, environment, databaseName) {
        try {
            const backups = await this.getBackupHistory(projectConfig.name, 20); // Check last 20 backups
            const availableBackups = [];

            // Look for ALL completed backups for the same environment and database
            for (const backup of backups) {
                if (backup.environment === environment && backup.databaseName === databaseName) {
                    // No time limit - show ALL backups regardless of age
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
                                availableBackups.push({
                                    ...backup,
                                    downloadUrl: status.downloadUrl,
                                    status: status.status
                                });
                            }
                        }
                    } catch (error) {
                        // Skip this backup if we can't check its status
                        continue;
                    }
                }
            }

            // Return array of all available backups, sorted by newest first
            return availableBackups.length > 0 ? availableBackups : null;
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
    static async downloadFromUrl(downloadUrl, downloadPath, projectName, environment, databaseName, skipConfirmation = false, incremental = true) {
        const fs = require('fs').promises;
        const path = require('path');
        const https = require('https');
        const OutputLogger = require('../output-logger');
        const ManifestManager = require('../manifest-manager');
        const ResponseBuilder = require('../response-builder');

        // Debug logging
        OutputLogger.debug(`[downloadFromUrl] skipConfirmation: ${skipConfirmation} (type: ${typeof skipConfirmation})`);

        // First check if we can extract a filename from the URL or use bacpac name
        let filename;
        const urlMatch = downloadUrl.match(/([^/]+\.bacpac)/i);
        if (urlMatch) {
            filename = urlMatch[1];
        } else {
            // Generate filename with current timestamp as fallback
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            filename = `${projectName}-${environment}-${databaseName}-${timestamp}.bacpac`;
        }

        const filepath = path.join(downloadPath, filename);

        // Check if file already exists locally for smart incremental download
        if (incremental) {
            try {
                const stats = await fs.stat(filepath);
                if (stats && stats.isFile()) {
                    const localSize = stats.size;
                    const remoteSize = await this.getRemoteFileSize(downloadUrl);

                    // If sizes match, assume it's the same file
                    if (remoteSize && localSize === remoteSize) {
                        OutputLogger.success(`✨ Smart Download: File already exists locally`);
                        OutputLogger.info(`📁 Location: ${filepath}`);
                        OutputLogger.info(`📊 Size: ${this.formatBytes(localSize)}`);
                        return ResponseBuilder.success(
                            `✅ **Database Backup Already Downloaded**\n\n` +
                            `The backup file already exists locally with matching size.\n\n` +
                            `**File:** ${filename}\n` +
                            `**Location:** ${filepath}\n` +
                            `**Size:** ${this.formatBytes(localSize)}\n\n` +
                            `💡 Skipped download to save bandwidth. Run \`export_database\` again to create a fresh backup.`
                        );
                    }
                }
            } catch (error) {
                // File doesn't exist, proceed with download
            }
        }

        // Show confirmation if not skipping
        if (!skipConfirmation) {
            // Show confirmation message (no file size info for database exports)
            let confirmationMessage = `📊 **Database Export Ready for Download**\n\n`;
            confirmationMessage += `**Environment:** ${environment}\n`;
            confirmationMessage += `**Database:** ${databaseName}\n`;
            confirmationMessage += `**Save Location:** \`${filepath}\`\n\n`;
            confirmationMessage += `**Note:** Database exports are typically 100MB-10GB depending on content.\n\n`;
            confirmationMessage += `**AWAITING USER CONFIRMATION**\n`;
            confirmationMessage += `To download this backup, please confirm.\n\n`;
            confirmationMessage += `Say "yes" to proceed or "no" to cancel.`;

            return {
                requiresConfirmation: true,
                fileSize: 'Unknown',
                estimatedSize: null,
                downloadUrl,
                message: confirmationMessage
            };
        }

        // If we get here, skipConfirmation is true, so proceed with download
        OutputLogger.info(`📥 Starting auto-download to ${filepath}...`);

        // Ensure download directory exists
        await fs.mkdir(downloadPath, { recursive: true });

        try {
            // Download the backup
            await this.downloadFile(downloadUrl, filepath);

            // Get file size for response
            const fileSize = await this.getFileSize(filepath);

            OutputLogger.success(`✅ Database backup downloaded successfully!`);
            OutputLogger.info(`📁 Location: ${filepath}`);
            OutputLogger.info(`📊 Size: ${fileSize}`);

            return {
                success: true,
                filepath,
                fileSize,
                filename,
                requiresConfirmation: false
            };
        } catch (error) {
            OutputLogger.error(`❌ Download failed: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Estimate remaining time for backup completion
     */
    static estimateRemainingTime() {
        // Database exports typically take 15-30 minutes
        return '15-30 minutes';
    }

    /**
     * Check for existing backups in the download folder
     */
    static async checkForExistingBackups(downloadPath, projectName, environment, databaseName) {
        const fs = require('fs').promises;
        const path = require('path');

        try {
            // Check if directory exists
            await fs.access(downloadPath);

            // Read all files in the directory
            const files = await fs.readdir(downloadPath);

            // Filter for .bacpac files
            const bacpacFiles = files.filter(f => f.endsWith('.bacpac'));

            if (bacpacFiles.length === 0) {
                return null; // No backups found
            }

            // Find the most recent backup file
            let mostRecentBackup = null;
            let mostRecentTime = 0;

            for (const filename of bacpacFiles) {
                const filepath = path.join(downloadPath, filename);
                const stats = await fs.stat(filepath);

                // Check if this file matches our database (look for project name, env, and db name patterns)
                const lowerFilename = filename.toLowerCase();
                const matchesProject = projectName && lowerFilename.includes(projectName.toLowerCase());
                const matchesEnv = environment && lowerFilename.includes(environment.toLowerCase());
                const matchesDb = databaseName && (lowerFilename.includes(databaseName.toLowerCase()) ||
                                                   lowerFilename.includes('cms') ||
                                                   lowerFilename.includes('commerce'));

                // Also check for timestamp patterns in filename (YYYYMMDDHHMMSS or similar)
                const timestampMatch = filename.match(/(\d{14})|(\d{4}-?\d{2}-?\d{2})/);

                // If file seems relevant and is more recent, use it
                if (stats.mtime.getTime() > mostRecentTime) {
                    mostRecentBackup = {
                        filename,
                        filepath,
                        stats,
                        matchesProject,
                        matchesEnv,
                        matchesDb,
                        hasTimestamp: !!timestampMatch
                    };
                    mostRecentTime = stats.mtime.getTime();
                }
            }

            if (!mostRecentBackup) {
                return null;
            }

            // Calculate age of the backup
            const ageMs = Date.now() - mostRecentBackup.stats.mtime.getTime();
            const ageHours = ageMs / (1000 * 60 * 60);
            const ageDays = ageMs / (1000 * 60 * 60 * 24);

            // Format age display
            let ageDisplay;
            let isRecent = false;

            if (ageHours < 1) {
                const ageMinutes = Math.floor(ageMs / (1000 * 60));
                ageDisplay = `${ageMinutes} minute${ageMinutes !== 1 ? 's' : ''}`;
                isRecent = true;
            } else if (ageHours < 24) {
                const hours = Math.floor(ageHours);
                ageDisplay = `${hours} hour${hours !== 1 ? 's' : ''}`;
                isRecent = ageHours < 6; // Consider backups less than 6 hours old as recent
            } else if (ageDays < 7) {
                const days = Math.floor(ageDays);
                ageDisplay = `${days} day${days !== 1 ? 's' : ''}`;
                isRecent = ageDays < 2; // Consider backups less than 2 days old as somewhat recent
            } else if (ageDays < 30) {
                const weeks = Math.floor(ageDays / 7);
                ageDisplay = `${weeks} week${weeks !== 1 ? 's' : ''}`;
                isRecent = false;
            } else {
                const months = Math.floor(ageDays / 30);
                ageDisplay = `${months} month${months !== 1 ? 's' : ''}`;
                isRecent = false;
            }

            // Get file size
            const sizeBytes = mostRecentBackup.stats.size;
            const sizeDisplay = this.formatBytes(sizeBytes);

            return {
                filename: mostRecentBackup.filename,
                filepath: mostRecentBackup.filepath,
                size: sizeDisplay,
                sizeBytes,
                ageDisplay,
                ageHours,
                ageDays,
                isRecent,
                modifiedTime: mostRecentBackup.stats.mtime,
                matchesProject: mostRecentBackup.matchesProject,
                matchesEnv: mostRecentBackup.matchesEnv,
                matchesDb: mostRecentBackup.matchesDb
            };

        } catch (error) {
            // Directory doesn't exist or other error - return null
            return null;
        }
    }
    
    /**
     * Start persistent background monitoring that survives manual monitoring interruptions
     * This creates a truly independent background process that can't be cancelled by user interactions
     */
    static startBackgroundMonitoring(exportId, projectConfig, environment, databaseName, downloadPath) {
        console.error(`[MONITOR DEBUG] startBackgroundMonitoring called for export: ${exportId}`);

        // Check if already monitoring this export
        if (DatabaseSimpleTools.backgroundMonitors.has(exportId)) {
            OutputLogger.debug(`🔄 Background monitoring already active for export: ${exportId}`);
            console.error(`[MONITOR DEBUG] Already monitoring ${exportId}, returning existing monitor`);
            return DatabaseSimpleTools.backgroundMonitors.get(exportId);
        }

        const { EventEmitter } = require('events');
        const monitor = new EventEmitter();
        let isMonitoring = true;
        const startTime = Date.now();
        const pollInterval = 2 * 60 * 1000; // Check every 2 minutes (more responsive)
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
        OutputLogger.info(`   ⏱️ Checking status every 2 minutes`);
        OutputLogger.info(`   📊 You'll see progress updates here`);
        OutputLogger.info(`   💾 Auto-download will trigger when export completes`);
        OutputLogger.info(`   🔍 Manual check: check_export_status exportId: "${exportId}"`);
        OutputLogger.debug(`[MONITOR] Starting monitoring loop for ${exportId}`);
        
        const monitorLoop = async () => {
            let checkCount = 0;
            
            OutputLogger.debug(`[MONITOR] Entering monitoring loop for ${exportId}`);

            // Do immediate first check, then wait for subsequent checks
            let initialCheck = true;

            while (isMonitoring) {
                checkCount++;

                try {
                    OutputLogger.info(`🔄 [MONITOR] Check #${checkCount} for export ${exportId.slice(-8)}`);

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
                                OutputLogger.success(`🎉 Export ${exportId} completed! Checking file size...`);

                                try {
                                    // Always show size preview first - never skip confirmation
                                    const downloadResult = await this.downloadFromUrl(
                                        status.downloadUrl,
                                        downloadPath,
                                        projectConfig.name,
                                        environment,
                                        databaseName,
                                        false // Never skip confirmation - user must see size and decide
                                    );

                                    // Check if confirmation is required
                                    if (downloadResult.requiresConfirmation) {
                                        return ResponseBuilder.success(downloadResult.message);
                                    }
                                    
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
                            
                            // Always log updates since we check every 2 minutes
                            // This ensures users see activity and know monitoring is working
                            const shouldLogUpdate = true;

                            if (shouldLogUpdate) {
                                OutputLogger.info(`${messageIcon} ${progressMessage}`);
                                OutputLogger.debug(`   📊 Status: ${status.status || 'In Progress'}`);
                                OutputLogger.debug(`   🔄 Next check in 2 minutes...`);

                                // Provide helpful tips at certain milestones
                                if (elapsedMinutes === 10) {
                                    OutputLogger.info(`   💡 Manual check: check_export_status exportId: "${exportId}"`);
                                } else if (elapsedMinutes === 20) {
                                    OutputLogger.info(`   💡 If monitoring seems stuck, you can check the DXP portal directly`);
                                } else if (elapsedMinutes === 35) {
                                    OutputLogger.warn(`   💡 Export taking longer than usual - may need to check portal or restart`);
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
                    // Skip wait on first check to get immediate feedback
                    if (isMonitoring && !initialCheck) {
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                    }
                    initialCheck = false;
                    
                } catch (error) {
                    OutputLogger.error(`❌ Background monitoring error: ${error.message}`);
                    
                    // Don't stop monitoring for transient errors, just log and continue
                    monitor.emit('error', {
                        exportId,
                        error: error.message,
                        elapsed: Date.now() - startTime
                    });
                    
                    if (isMonitoring && !initialCheck) {
                        await new Promise(resolve => setTimeout(resolve, pollInterval));
                    }
                    initialCheck = false;
                }
            }
        };
        
        // Start monitoring in background (fire and forget)
        OutputLogger.info(`🚀 [MONITOR] Starting monitoring loop for export ${exportId.slice(-8)}`);
        OutputLogger.info(`📊 You should see progress updates every 2 minutes`);

        monitorLoop().catch(error => {
            OutputLogger.error(`💥 Critical monitoring error: ${error.message}`);
            OutputLogger.error(`💥 Stack trace: ${error.stack}`);
            monitor.emit('critical_error', { exportId, error: error.message });
        });

        OutputLogger.info(`✅ [MONITOR] Monitoring background process initiated`);
        
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
            
            // File recovery removed - using in-memory only
            const recentExports = this.backupHistory[projectConfig.name] || [];
            
            if (recentExports.length === 0) {
                OutputLogger.debug('No recent backups found in history');
                return null;
            }
            
            // Find ALL matching exports for the same environment and database (no time restriction)
            const matchingExports = recentExports.filter(exp => {
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
                OutputLogger.debug('No matching backups found');
                return null;
            }

            OutputLogger.success(`✅ Found ${matchingExports.length} existing backup${matchingExports.length > 1 ? 's' : ''}`);

            // Return ALL matching backups
            return matchingExports;
            
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
            
            // File recovery removed - using in-memory only
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
            // File recovery removed - using in-memory only
            const recentExports = this.backupHistory[projectConfig.name] || [];
            
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
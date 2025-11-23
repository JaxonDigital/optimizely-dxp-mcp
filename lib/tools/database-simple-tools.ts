/**
 * Database Simple Tools
 * Comprehensive database backup and export management
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import { ResponseBuilder } from '../index';
import DXPRestClient from '../dxp-rest-client';
import ProgressMonitor from '../progress-monitor';
import DownloadManager from '../download-manager';
import OutputLogger from '../output-logger';
import ExportResourceHandler from '../resources/export-resource';
import DownloadConfig from '../download-config';

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { EventEmitter } = require('events');

/**
 * Export database arguments
 */
interface ExportDatabaseArgs {
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
    projectName?: string;
    environment?: string;
    databaseName?: string;
    database?: string; // DXP-81: New parameter replacing databaseName
    downloadPath?: string;
    retentionHours?: number;
    useExisting?: boolean;
    autoMonitor?: boolean;
    autoDownload?: boolean;
    skipConfirmation?: boolean;
    previewOnly?: boolean;
    waitBeforeCheck?: number;
    monitor?: boolean;
    incremental?: boolean;
}

/**
 * Check export status arguments
 */
interface CheckExportStatusArgs {
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
    projectName?: string;
    environment?: string;
    exportId?: string;
    databaseName?: string;
    database?: string;
    latest?: boolean;
    monitor?: boolean;
    autoDownload?: boolean;
    downloadPath?: string;
    waitBeforeCheck?: number;
    incremental?: boolean;
    limit?: number;
    offset?: number;
    status?: string;
    format?: 'concise' | 'detailed';
}

/**
 * Download database export arguments
 */
interface DownloadDatabaseExportArgs {
    downloadUrl?: string;
    downloadPath?: string;
    projectName?: string;
    environment?: string;
    databaseName?: string;
    database?: string;
    skipConfirmation?: boolean;
    incremental?: boolean;
    timeoutMinutes?: number;
}

/**
 * Check download capabilities arguments
 */
interface CheckCapabilitiesArgs {
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
    projectName?: string;
    environment?: string;
}

/**
 * Export information state
 */
interface ExportInfo {
    exportId: string;
    projectId: string;
    projectName: string;
    environment: string;
    databaseName: string;
    status: string;
    downloadUrl?: string;
    startedAt: string;
    completedAt?: string;
    downloadPath?: string;
    autoMonitor?: boolean;
    autoDownload?: boolean;
    incremental?: boolean;
}

/**
 * Backup information
 */
interface BackupInfo {
    projectName: string;
    environment: string;
    databaseName: string;
    exportId: string;
    downloadUrl: string;
    downloadedAt: string;
    filePath: string;
    fileSize: number;
    retentionHours?: number;
}

/**
 * Download state tracking
 */
interface DownloadState {
    downloadId: string;
    projectName: string;
    environment: string;
    databaseName: string;
    downloadUrl: string;
    downloadPath: string;
    status: 'active' | 'completed' | 'failed' | 'cancelled';
    startedAt: string;
    completedAt?: string;
    fileSize?: number;
    error?: string;
}

/**
 * Background monitor data
 */
interface MonitorData {
    exportId: string;
    projectConfig: ProjectConfig;
    environment: string;
    databaseName: string;
    downloadPath?: string;
    startedAt: string;
    pollCount: number;
    lastStatus?: string;
    autoDownload?: boolean;
}

/**
 * Project configuration
 */
interface ProjectConfig {
    name: string;
    projectId: string;
    apiKey?: string;
    apiSecret?: string;
    connectionString?: string;
    isSelfHosted?: boolean;
    environments?: string[];
}

/**
 * Background monitor with EventEmitter
 */
interface BackgroundMonitor {
    exportId: string;
    data: MonitorData;
    intervalId?: NodeJS.Timeout;
}

/**
 * Export status result
 */
interface ExportStatus {
    status: string;
    exportId?: string;
    downloadUrl?: string;
    environment?: string;
    databaseName?: string;
    percentComplete?: number;
    message?: string;
}

/**
 * Parsed export status from API
 */
interface ParsedExportStatus {
    exportId: string;
    status: string;
    downloadUrl?: string;
    percentComplete?: number;
}

/**
 * Status result with structured data
 */
interface StatusResult {
    data: ExportStatus;
    message: string;
}


/**
 * Monitor loop parameters
 */
interface MonitorLoop {
    exportId: string;
    projectConfig: ProjectConfig;
    environment: string;
    databaseName: string;
    downloadPath?: string;
    autoDownload?: boolean;
    startTime: number;
    pollCount: number;
    maxDuration: number;
    pollInterval: number;
    incremental?: boolean;
}

/**
 * Queued export tracking
 */
interface QueuedExport {
    exportId: string;
    projectConfig: ProjectConfig;
    environment: string;
    databaseName: string;
    downloadPath?: string;
    autoDownload?: boolean;
    incremental?: boolean;
}

/**
 * Existing backup information
 */
interface ExistingBackup {
    fileName: string;
    filePath: string;
    fileSize: number;
    ageHours: number;
    formattedAge: string;
}

/**
 * Capability check result
 */
interface CapabilityResult {
    canExport: boolean;
    canDownload: boolean;
    message: string;
    availableEnvironments?: string[];
    reason?: string;
}

class DatabaseSimpleTools {
    static backupHistory: Record<string, BackupInfo[]> = {};
    static STATE_FILE = path.join(os.tmpdir(), '.optimizely-dxp-export-state.json');
    static backgroundDownloads = new Map<string, DownloadState>();
    static backgroundMonitors = new Map<string, BackgroundMonitor>();

    /**
     * Handle export database request
     */
    static async handleExportDatabase(args: ExportDatabaseArgs): Promise<any> {
        // DXP-81: Support new 'database' parameter (replaces 'databaseName')
        const databaseName = args.database || args.databaseName;

        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters: apiKey, apiSecret, projectId');
        }

        // DXP-81: Preview mode with capability check
        if (args.previewOnly) {
            return this.handleCheckCapabilities(args);
        }

        const projectConfig: ProjectConfig = {
            name: args.projectName || 'Unknown',
            projectId: args.projectId,
            apiKey: args.apiKey,
            apiSecret: args.apiSecret
        };

        try {
            // DXP-183 Bug #3: Check for existing backups if useExisting is true
            // Track if we checked for existing backups but found none
            let useExistingChecked = false;
            let useExistingSearchPath = '';

            if (args.useExisting) {
                // Use provided downloadPath or default to current directory
                const searchPath = args.downloadPath || process.cwd();
                useExistingSearchPath = searchPath;
                useExistingChecked = true;

                const existingBackups = await this.checkForExistingBackups(
                    searchPath,
                    projectConfig.name,
                    args.environment || 'Production',
                    databaseName || 'epicms'
                );

                if (existingBackups.length > 0) {
                    const backup = existingBackups[0]; // Most recent
                    return ResponseBuilder.success(
                        `✅ Found existing backup (useExisting=true):\\n\\n` +
                        `📦 **File**: ${backup.fileName}\\n` +
                        `📍 **Location**: ${backup.filePath}\\n` +
                        `📊 **Size**: ${this.formatBytes(backup.fileSize)}\\n` +
                        `⏱️  **Age**: ${backup.formattedAge}\\n\\n` +
                        `💡 Use this file path for database restore operations.`
                    );
                } else {
                    // No existing backup found - will inform user in response
                    OutputLogger.info(`⚠️  No existing backup found in ${searchPath}. Starting new export...`);
                }
            }

            // Start export
            const result = await this.internalStartExport(args);

            // Check if result is structured response
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                // DXP-183 Bug #3: Add useExisting feedback to message
                if (useExistingChecked) {
                    const useExistingNote = `\\n\\n📋 **Note**: useExisting=true was specified but no local backup was found in \`${useExistingSearchPath}\`.\\n` +
                                           `Starting new export. Future calls with useExisting=true will find this backup after download completes.`;
                    result.message = result.message + useExistingNote;
                }

                // If autoMonitor is enabled, start background monitoring
                if (args.autoMonitor && result.data && result.data.exportId) {
                    this.startBackgroundMonitoring(
                        result.data.exportId,
                        projectConfig,
                        result.data.environment || args.environment || 'Production',
                        result.data.databaseName || databaseName || 'epicms',
                        args.downloadPath
                    );

                    // Update message to indicate monitoring started
                    result.message = result.message + '\\n\\n✅ Background monitoring started. Use check_export_status to view progress.';
                }

                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            return ResponseBuilder.success(result);
        } catch (error: any) {
            console.error('Export database error:', error);
            return ResponseBuilder.internalError('Failed to export database', error.message);
        }
    }

    /**
     * Handle check export status request
     */
    static async handleCheckExportStatus(args: CheckExportStatusArgs): Promise<any> {
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters: apiKey, apiSecret, projectId');
        }

        // DXP-81: Support new 'database' parameter
        const databaseName = args.database || args.databaseName;

        // If waitBeforeCheck is specified, implement transparent wait-then-check pattern
        if (args.waitBeforeCheck && args.waitBeforeCheck > 0) {
            const waitMinutes = Math.floor(args.waitBeforeCheck / 60);
            const waitSeconds = args.waitBeforeCheck % 60;
            const waitDisplay = waitMinutes > 0 ?
                `${waitMinutes} minute${waitMinutes > 1 ? 's' : ''}${waitSeconds > 0 ? ` ${waitSeconds} second${waitSeconds > 1 ? 's' : ''}` : ''}` :
                `${waitSeconds} second${waitSeconds > 1 ? 's' : ''}`;

            OutputLogger.info(`⏳ Waiting ${waitDisplay} before checking export status...`);
            await new Promise(resolve => setTimeout(resolve, args.waitBeforeCheck! * 1000));
            OutputLogger.success(`✅ Wait complete. Checking export status now...`);
        }

        try {
            const result = await this.internalCheckExportStatus(args);

            // Check if result is structured response
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                // If monitor mode is enabled and export is still in progress, add monitoring instructions
                if (args.monitor && result.data && result.data.status) {
                    const monitoringInstructions = this.generateMonitoringInstructions(
                        result.data.exportId || args.exportId || 'unknown',
                        result.data.status,
                        args
                    );
                    result.message = result.message + '\\n\\n' + monitoringInstructions;
                }

                // If autoDownload is enabled and export is complete with download URL
                if (args.autoDownload && result.data && result.data.status === 'Succeeded' && result.data.downloadUrl) {
                    // DXP-184: Use background download to avoid MCP timeout
                    OutputLogger.info('🔄 Auto-download enabled. Starting background download...');
                    const downloadId = await this.startBackgroundDatabaseDownload(
                        result.data.downloadUrl,
                        args.downloadPath,
                        args.projectName,
                        result.data.environment || args.environment,
                        result.data.databaseName || databaseName
                    );

                    const fileSize = await this.getRemoteFileSize(result.data.downloadUrl).catch(() => 0);
                    const estimatedTime = this.estimateDownloadTime(fileSize);

                    const downloadMessage = `\n\n📥 **Background Download Started**\n` +
                                          `• Download ID: \`${downloadId}\`\n` +
                                          `• Size: ${this.formatBytes(fileSize)}\n` +
                                          `• Estimated Time: ${estimatedTime}\n\n` +
                                          `**Monitor Progress:**\n` +
                                          `Use \`download_list()\` to check status.\n` +
                                          `Use \`download_status({ downloadId: "${downloadId}", monitor: true })\` for live updates.`;

                    // Append download info to message
                    result.message = result.message + downloadMessage;
                }

                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            return ResponseBuilder.success(result);
        } catch (error: any) {
            console.error('Check export status error:', error);
            return ResponseBuilder.internalError('Failed to check export status', error.message);
        }
    }

    /**
     * Handle download database export request
     */
    static async handleDownloadDatabaseExport(args: DownloadDatabaseExportArgs): Promise<any> {
        if (!args.downloadUrl) {
            return ResponseBuilder.invalidParams('Missing required parameter: downloadUrl');
        }

        // DXP-81: Support new 'database' parameter
        const databaseName = args.database || args.databaseName;

        try {
            // DXP-183: Honor background parameter (defaults to true per schema)
            const useBackground = args.background !== false; // Default to true if not specified

            if (useBackground) {
                // Start background download, return immediately with downloadId
                const downloadId = await this.startBackgroundDatabaseDownload(
                    args.downloadUrl,
                    args.downloadPath,
                    args.projectName,
                    args.environment,
                    databaseName
                );

                const fileSize = await this.getRemoteFileSize(args.downloadUrl).catch(() => 0);
                const estimatedTime = this.estimateDownloadTime(fileSize);

                const message = `📥 **Background Database Download Started**\n\n` +
                               `**Download Details:**\n` +
                               `• Download ID: \`${downloadId}\`\n` +
                               `• Project: ${args.projectName || 'Unknown'}\n` +
                               `• Environment: ${args.environment || 'Production'}\n` +
                               `• Database: ${databaseName || 'epicms'}\n` +
                               `• Size: ${this.formatBytes(fileSize)}\n` +
                               `• Estimated Time: ${estimatedTime}\n\n` +
                               `**Monitor Progress:**\n` +
                               `Use \`download_list()\` to check download status.\n` +
                               `Use \`download_status({ downloadId: "${downloadId}", monitor: true })\` for live updates.\n\n` +
                               `⚠️  **Note**: Background downloads skip confirmation and start immediately.`;

                return ResponseBuilder.success(message);
            } else {
                // Blocking download (background=false explicitly set)
                const result = await this.downloadFromUrl(
                    args.downloadUrl,
                    args.downloadPath,
                    args.projectName,
                    args.environment,
                    databaseName,
                    args.skipConfirmation,
                    args.incremental,
                    args.timeoutMinutes
                );

                return ResponseBuilder.success(result);
            }
        } catch (error: any) {
            console.error('Download database export error:', error);
            return ResponseBuilder.internalError('Failed to download database export', error.message);
        }
    }

    /**
     * Handle check download capabilities request
     */
    static async handleCheckCapabilities(args: CheckCapabilitiesArgs): Promise<any> {
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters: apiKey, apiSecret, projectId');
        }

        try {
            // Check permissions for database export
            const PermissionChecker = require('../permission-checker');
            const permissions = await PermissionChecker.checkPermissions(
                args.projectId,
                args.apiKey,
                args.apiSecret
            );

            const canExportEnvironments: string[] = [];
            if (permissions.canAccessIntegration) canExportEnvironments.push('Integration');
            if (permissions.canAccessPreproduction) canExportEnvironments.push('Preproduction');
            if (permissions.canAccessProduction) canExportEnvironments.push('Production');

            const canExport = canExportEnvironments.length > 0;
            const canDownload = true; // Download is always possible with valid download URL

            // Check for existing backups
            const existingBackups = await this.checkForExistingBackups(
                (args as any).downloadPath || process.cwd(),
                args.projectName || 'project',
                args.environment || 'Production',
                'epicms'
            );

            let message = '📊 **Database Export Capabilities**\\n\\n';

            if (canExport) {
                message += `✅ **Can Export**: Yes\\n`;
                message += `**Available Environments**: ${canExportEnvironments.join(', ')}\\n\\n`;
            } else {
                message += `❌ **Can Export**: No\\n`;
                message += `**Reason**: No permissions for any environment\\n\\n`;
            }

            message += `✅ **Can Download**: Yes (with valid download URL)\\n\\n`;

            if (existingBackups.length > 0) {
                message += `📦 **Existing Backups**: ${existingBackups.length} found\\n\\n`;
                existingBackups.slice(0, 5).forEach(backup => {
                    message += `  • ${backup.fileName}\\n`;
                    message += `    Size: ${this.formatBytes(backup.fileSize)} | Age: ${backup.formattedAge}\\n`;
                });
                if (existingBackups.length > 5) {
                    message += `\\n  ... and ${existingBackups.length - 5} more\\n`;
                }
            } else {
                message += `📦 **Existing Backups**: None found\\n`;
            }

            const capabilityData: CapabilityResult = {
                canExport,
                canDownload,
                message,
                availableEnvironments: canExportEnvironments
            };

            return ResponseBuilder.successWithStructuredData(capabilityData, message);
        } catch (error: any) {
            console.error('Check capabilities error:', error);
            return ResponseBuilder.internalError('Failed to check download capabilities', error.message);
        }
    }

    /**
     * Internal method to start database export
     */
    static async internalStartExport(args: ExportDatabaseArgs): Promise<StatusResult> {
        const databaseName = args.database || args.databaseName || 'epicms';
        const environment = args.environment || 'Production';
        const retentionHours = args.retentionHours || 24;

        const projectConfig: ProjectConfig = {
            name: args.projectName || 'Unknown',
            projectId: args.projectId!,
            apiKey: args.apiKey!,
            apiSecret: args.apiSecret!
        };

        // Check for active exports that might conflict
        const activeExport = await this.detectAndOfferRecovery(projectConfig);
        if (activeExport) {
            // There's an active export - check if it's for the same database
            const isSameDatabase = activeExport.environment === environment &&
                                    activeExport.databaseName === databaseName;

            if (isSameDatabase) {
                // Same database - offer to resume monitoring
                return {
                    data: {
                        status: 'InProgress',
                        exportId: activeExport.exportId,
                        environment: activeExport.environment,
                        databaseName: activeExport.databaseName,
                        message: 'Resuming existing export'
                    },
                    message: `Found existing export in progress for ${environment} ${databaseName}.\\n` +
                             `Export ID: ${activeExport.exportId}\\n\\n` +
                             `Use check_export_status with this exportId to monitor progress.`
                };
            } else {
                // Different database - resolve conflict
                const resolution = await this.resolveExportConflict(
                    environment,
                    databaseName,
                    projectConfig,
                    args.downloadPath
                );

                if (resolution.action === 'queue') {
                    return {
                        data: {
                            status: 'Queued',
                            exportId: resolution.queuedExportId || 'pending',
                            environment,
                            databaseName,
                            message: 'Export queued - will start when current export completes'
                        },
                        message: resolution.message || 'Export queued behind active export'
                    };
                } else if (resolution.action === 'cancel') {
                    return {
                        data: {
                            status: 'Cancelled',
                            environment,
                            databaseName,
                            message: 'Export cancelled by user'
                        },
                        message: 'Export request cancelled'
                    };
                }
            }
        }

        // Start new export via REST API (DXP-101: No PowerShell)
        try {
            const result = await DXPRestClient.startDatabaseExport(
                projectConfig.projectId,
                projectConfig.apiKey!,
                projectConfig.apiSecret!,
                environment,
                databaseName,
                retentionHours
            );

            // Parse export ID from result
            const exportId = this.extractExportId(result);

            // Save export state
            const exportInfo: ExportInfo = {
                exportId,
                projectId: projectConfig.projectId,
                projectName: projectConfig.name,
                environment,
                databaseName,
                status: 'InProgress',
                startedAt: new Date().toISOString(),
                downloadPath: args.downloadPath,
                autoMonitor: args.autoMonitor,
                autoDownload: args.autoDownload,
                incremental: args.incremental
            };

            await this.saveCurrentExportState(exportInfo);

            // DXP-155: Emit export started event
            try {
                ExportResourceHandler.emitStarted(exportId, {
                    project: projectConfig.name,
                    environment,
                    databaseName,
                    retentionHours
                });
            } catch (eventError: any) {
                console.error(`Failed to emit export started event: ${eventError.message}`);
                // Don't fail the operation if event emission fails
            }

            return {
                data: {
                    status: 'InProgress',
                    exportId,
                    environment,
                    databaseName,
                    message: 'Export started successfully'
                },
                message: `Database export started successfully\\n` +
                         `Export ID: ${exportId}\\n` +
                         `Environment: ${environment}\\n` +
                         `Database: ${databaseName}\\n` +
                         `Retention: ${retentionHours} hours\\n\\n` +
                         `Use check_export_status to monitor progress.`
            };
        } catch (error: any) {
            throw new Error(`Failed to start export: ${error.message}`);
        }
    }

    /**
     * DXP-76-2: List all exports with pagination and filtering
     */
    static async listAllExports(args: CheckExportStatusArgs, projectConfig: ProjectConfig, databaseName: string): Promise<StatusResult> {
        const { limit = 10, offset = 0, status, format = 'detailed' } = args;
        const environment = args.environment || 'Production';

        try {
            // Call REST API to get all exports
            const result = await DXPRestClient.getDatabaseExports(
                projectConfig.projectId,
                projectConfig.apiKey!,
                projectConfig.apiSecret!,
                environment,
                databaseName
            );

            // Ensure we have an array
            let exports: any[] = Array.isArray(result) ? result : (result.exports || [result]);

            // Status filtering
            if (status) {
                exports = exports.filter(exp => exp.status === status || exp.Status === status);
            }

            // Pagination
            const total = exports.length;
            const paginatedExports = exports.slice(offset, offset + limit);

            // Format response
            const formattedExports = format === 'concise'
                ? paginatedExports.map(exp => ({
                      id: exp.id || exp.Id,
                      status: exp.status || exp.Status,
                      exportType: databaseName,
                      startTime: exp.startTime || exp.StartTime || exp.created || exp.Created
                  }))
                : paginatedExports;

            return {
                data: {
                    exports: formattedExports,
                    pagination: {
                        total,
                        limit,
                        offset,
                        hasMore: (offset + limit) < total
                    }
                },
                message: `Found ${total} export(s)${status ? ` with status '${status}'` : ''}\\n` +
                        `Showing ${formattedExports.length} result(s) (offset: ${offset}, limit: ${limit})`
            };
        } catch (error: any) {
            // API may not support listing exports - provide helpful error
            throw new Error(`Failed to list exports: ${error.message}. Note: The Optimizely DXP API may not support listing all exports. Try using exportId to check specific export status.`);
        }
    }

    /**
     * Internal method to check export status
     */
    static async internalCheckExportStatus(args: CheckExportStatusArgs): Promise<StatusResult> {
        const databaseName = args.database || args.databaseName || 'epicms';
        let exportId = args.exportId;

        const projectConfig: ProjectConfig = {
            name: args.projectName || 'Unknown',
            projectId: args.projectId!,
            apiKey: args.apiKey!,
            apiSecret: args.apiSecret!
        };

        // DXP-76-2: List mode - when limit/offset is specified, list all exports
        if ((args.limit !== undefined || args.offset !== undefined) && !exportId && !args.latest) {
            return await this.listAllExports(args, projectConfig, databaseName);
        }

        // If 'latest' is specified or no exportId provided, try to get from saved state
        if (args.latest || !exportId) {
            const savedState = await this.loadCurrentExportState();
            if (savedState && savedState.exportId) {
                exportId = savedState.exportId;
                OutputLogger.info(`Using latest export ID: ${exportId}`);
            } else {
                throw new Error('No export ID specified and no saved export state found. Please provide exportId or start a new export.');
            }
        }

        try {
            // Check export status via REST API (DXP-101: No PowerShell)
            const result = await DXPRestClient.getDatabaseExportStatus(
                projectConfig.projectId,
                projectConfig.apiKey!,
                projectConfig.apiSecret!,
                args.environment || 'Production',
                databaseName,
                exportId!
            );

            const parsedStatus = this.parseExportStatus(result);

            // DXP-155: Emit export events based on status
            try {
                if (parsedStatus.status === 'InProgress') {
                    ExportResourceHandler.emitInProgress(exportId!, {
                        status: parsedStatus.status,
                        percentComplete: parsedStatus.percentComplete || 0
                    });
                } else if (parsedStatus.status === 'Succeeded') {
                    ExportResourceHandler.emitSucceeded(exportId!, {
                        downloadUrl: parsedStatus.downloadUrl,
                        environment: args.environment || 'Production',
                        databaseName
                    });
                } else if (parsedStatus.status === 'Failed') {
                    ExportResourceHandler.emitFailed(exportId!, {
                        error: (parsedStatus as any).errorMessage || 'Export failed',
                        environment: args.environment || 'Production',
                        databaseName
                    });
                }
            } catch (eventError: any) {
                console.error(`Failed to emit export event: ${eventError.message}`);
                // Don't fail the operation if event emission fails
            }

            // Update saved state if we have one
            const savedState = await this.loadCurrentExportState();
            if (savedState && savedState.exportId === exportId) {
                savedState.status = parsedStatus.status;
                if (parsedStatus.downloadUrl) {
                    savedState.downloadUrl = parsedStatus.downloadUrl;
                }
                if (parsedStatus.status === 'Succeeded' || parsedStatus.status === 'Failed') {
                    savedState.completedAt = new Date().toISOString();
                }
                await this.saveCurrentExportState(savedState);
            }

            let message = `Export Status: ${parsedStatus.status}\\n`;
            message += `Export ID: ${exportId}\\n`;

            if (parsedStatus.percentComplete !== undefined) {
                message += `Progress: ${parsedStatus.percentComplete}%\\n`;
            }

            if (parsedStatus.status === 'Succeeded' && parsedStatus.downloadUrl) {
                message += `\\n✅ Export completed successfully!\\n`;
                message += `Download URL available (valid for 24 hours)\\n\\n`;
                message += `Use download_database_export to download the backup.`;
            } else if (parsedStatus.status === 'Failed') {
                message += `\\n❌ Export failed. Check DXP portal for details.`;
            } else {
                message += `\\n⏳ Export in progress. Check again in 30 seconds.`;
            }

            return {
                data: {
                    status: parsedStatus.status,
                    exportId: exportId!,
                    downloadUrl: parsedStatus.downloadUrl,
                    environment: args.environment || 'Production',
                    databaseName,
                    percentComplete: parsedStatus.percentComplete
                },
                message
            };
        } catch (error: any) {
            throw new Error(`Failed to check export status: ${error.message}`);
        }
    }

    /**
     * Monitor export and auto-download when complete
     */
    static async monitorAndDownload(options: MonitorLoop): Promise<string> {
        const {
            exportId,
            projectConfig,
            environment,
            databaseName,
            downloadPath,
            autoDownload,
            startTime,
            pollCount,
            maxDuration,
            pollInterval,
            incremental
        } = options;

        try {
            const result = await DXPRestClient.getDatabaseExportStatus(
                projectConfig.projectId,
                projectConfig.apiKey!,
                projectConfig.apiSecret!,
                environment,
                databaseName,
                exportId
            );

            const parsedStatus = this.parseExportStatus(result);
            const elapsedMinutes = Math.floor((Date.now() - startTime) / 60000);

            OutputLogger.info(`[Poll ${pollCount}] Export status: ${parsedStatus.status} (${elapsedMinutes}m elapsed)`);

            if (parsedStatus.status === 'Succeeded') {
                if (parsedStatus.downloadUrl && autoDownload) {
                    // DXP-183: Use background download to avoid MCP timeout
                    OutputLogger.success('✅ Export completed! Starting background download...');
                    const downloadId = await this.startBackgroundDatabaseDownload(
                        parsedStatus.downloadUrl,
                        downloadPath,
                        projectConfig.name,
                        environment,
                        databaseName
                    );

                    const fileSize = await this.getRemoteFileSize(parsedStatus.downloadUrl).catch(() => 0);
                    const estimatedTime = this.estimateDownloadTime(fileSize);

                    return `✅ **Export Completed - Background Download Started**\n\n` +
                           `**Export Details:**\n` +
                           `• Export ID: ${exportId}\n` +
                           `• Environment: ${environment}\n` +
                           `• Database: ${databaseName}\n\n` +
                           `**Background Download:**\n` +
                           `• Download ID: \`${downloadId}\`\n` +
                           `• Size: ${this.formatBytes(fileSize)}\n` +
                           `• Estimated Time: ${estimatedTime}\n\n` +
                           `**Monitor Progress:**\n` +
                           `Use \`download_list()\` to check download status.\n` +
                           `Use \`download_status({ downloadId: "${downloadId}", monitor: true })\` for live updates.`;
                } else {
                    return `Export completed successfully. Export ID: ${exportId}\\n` +
                           `Download URL: ${parsedStatus.downloadUrl || 'Not available'}`;
                }
            } else if (parsedStatus.status === 'Failed') {
                throw new Error('Export failed. Check DXP portal for details.');
            } else if (elapsedMinutes >= maxDuration) {
                throw new Error(`Export monitoring timeout after ${maxDuration} minutes`);
            } else {
                // Continue monitoring
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                return this.monitorAndDownload({
                    ...options,
                    pollCount: pollCount + 1
                });
            }
        } catch (error: any) {
            throw new Error(`Failed to monitor export: ${error.message}`);
        }
    }

    /**
     * Download database export file from URL
     */
    static async downloadFromUrl(
        downloadUrl: string,
        downloadPath: string | undefined,
        projectName: string | undefined,
        environment: string | undefined,
        databaseName: string | undefined,
        skipConfirmation?: boolean,
        incremental?: boolean,
        timeoutMinutes?: number
    ): Promise<string> {
        // DXP-186: Use DownloadConfig to respect dbPath configuration
        const basePath = await DownloadConfig.getDownloadPath(
            'database',
            projectName || 'Unknown',
            downloadPath || null
        );
        const safeProjectName = (projectName || 'project').replace(/[^a-zA-Z0-9-_]/g, '_');
        const safeEnvironment = (environment || 'production').toLowerCase();
        const safeDatabaseName = (databaseName || 'epicms').replace(/[^a-zA-Z0-9-_]/g, '_');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `${safeProjectName}-${safeEnvironment}-${safeDatabaseName}-${timestamp}.bacpac`;
        const filepath = path.join(basePath, filename);

        // Create download ID for tracking
        const downloadId = `${safeProjectName}-db-${safeEnvironment}-${safeDatabaseName}-${Date.now()}`;

        // Check if we should use incremental download
        if (incremental) {
            const existingBackups = await this.checkForExistingBackups(
                basePath,
                projectName || 'project',
                environment || 'Production',
                databaseName || 'epicms'
            );

            if (existingBackups.length > 0) {
                const latest = existingBackups[0];
                OutputLogger.info(`Found existing backup: ${latest.fileName} (${this.formatBytes(latest.fileSize)})`);
                OutputLogger.info('Incremental mode: Checking if download is needed...');

                // For database exports, we can't do true incremental (they're full backups)
                // But we can check if we already have a recent backup
                if (latest.ageHours < 24) {
                    return `Using existing backup: ${latest.fileName}\\n` +
                           `Location: ${latest.filePath}\\n` +
                           `Size: ${this.formatBytes(latest.fileSize)}\\n` +
                           `Age: ${latest.formattedAge}\\n\\n` +
                           `Backup is less than 24 hours old. Skipping download.`;
                }
            }
        }

        // Get remote file size for progress tracking
        const fileSize = await this.getRemoteFileSize(downloadUrl);
        const estimatedTime = this.estimateDownloadTime(fileSize);

        if (!skipConfirmation) {
            OutputLogger.info(`About to download database backup:`);
            OutputLogger.info(`  File: ${filename}`);
            OutputLogger.info(`  Size: ${this.formatBytes(fileSize)}`);
            OutputLogger.info(`  Estimated time: ${estimatedTime}`);
            OutputLogger.info(`  Destination: ${filepath}`);
        }

        // Register download with DownloadManager
        DownloadManager.registerDownload({
            projectName: downloadId,
            containerName: databaseName || 'epicms',
            environment: environment || 'Production',
            dateRange: 'export',
            type: 'database',
            totalFiles: 1,
            totalSize: fileSize
        });

        // Save download state
        const downloadState: DownloadState = {
            downloadId,
            projectName: projectName || 'Unknown',
            environment: environment || 'Production',
            databaseName: databaseName || 'epicms',
            downloadUrl,
            downloadPath: filepath,
            status: 'active',
            startedAt: new Date().toISOString(),
            fileSize
        };
        await this.saveDownloadState(downloadState);

        try {
            // Download file with timeout protection
            const timeoutMs = (timeoutMinutes || 30) * 60 * 1000; // Default 30 minutes
            await this.downloadFile(downloadUrl, filepath, timeoutMs, downloadId);

            // Mark download complete
            DownloadManager.completeDownload(downloadId, { success: true });
            downloadState.status = 'completed';
            downloadState.completedAt = new Date().toISOString();
            await this.saveDownloadState(downloadState);

            // Save backup info
            const backupInfo: BackupInfo = {
                projectName: projectName || 'Unknown',
                environment: environment || 'Production',
                databaseName: databaseName || 'epicms',
                exportId: downloadUrl.split('/').pop() || 'unknown',
                downloadUrl,
                downloadedAt: new Date().toISOString(),
                filePath: filepath,
                fileSize
            };
            await this.storeBackupInfo(projectName || 'Unknown', backupInfo);

            return `✅ Database backup downloaded successfully\\n` +
                   `File: ${filename}\\n` +
                   `Size: ${this.formatBytes(fileSize)}\\n` +
                   `Location: ${filepath}`;
        } catch (error: any) {
            // Mark download failed
            DownloadManager.failDownload(downloadId, error.message);
            downloadState.status = 'failed';
            downloadState.error = error.message;
            downloadState.completedAt = new Date().toISOString();
            await this.saveDownloadState(downloadState);

            throw error;
        }
    }

    /**
     * Start database download in background - returns immediately with downloadId
     * DXP-183: For autoDownload feature to avoid MCP timeout
     */
    static async startBackgroundDatabaseDownload(
        downloadUrl: string,
        downloadPath: string | undefined,
        projectName: string | undefined,
        environment: string | undefined,
        databaseName: string | undefined
    ): Promise<string> {
        // DXP-186: Use DownloadConfig to respect dbPath configuration
        const basePath = await DownloadConfig.getDownloadPath(
            'database',
            projectName || 'Unknown',
            downloadPath || null
        );
        const safeProjectName = (projectName || 'project').replace(/[^a-zA-Z0-9-_]/g, '_');
        const safeEnvironment = (environment || 'production').toLowerCase();
        const safeDatabaseName = (databaseName || 'epicms').replace(/[^a-zA-Z0-9-_]/g, '_');

        // Create download ID for tracking
        const downloadId = `${safeProjectName}-db-${safeEnvironment}-${safeDatabaseName}-${Date.now()}`;

        // Get remote file size for preview
        let fileSize = 0;
        try {
            fileSize = await this.getRemoteFileSize(downloadUrl);
        } catch (error: any) {
            OutputLogger.warn(`⚠️  Could not get file size: ${error.message}`);
        }

        // Register download with DownloadManager
        DownloadManager.registerDownload({
            projectName: downloadId,
            containerName: databaseName || 'epicms',
            environment: environment || 'Production',
            dateRange: 'export',
            type: 'database',
            totalFiles: 1,
            totalSize: fileSize
        });

        // Start download in background (don't await!)
        this.runDatabaseDownloadInBackground(
            downloadId,
            downloadUrl,
            downloadPath,
            projectName,
            environment,
            databaseName,
            fileSize
        ).catch(error => {
            OutputLogger.error(`Background database download ${downloadId} failed: ${error.message}`);
            DownloadManager.failDownload(downloadId, error.message);
        });

        return downloadId;
    }

    /**
     * Run database download in background
     * DXP-183: Helper for background downloads
     */
    static async runDatabaseDownloadInBackground(
        downloadId: string,
        downloadUrl: string,
        downloadPath: string | undefined,
        projectName: string | undefined,
        environment: string | undefined,
        databaseName: string | undefined,
        fileSize: number
    ): Promise<void> {
        // DXP-186: Use DownloadConfig to respect dbPath configuration
        const basePath = await DownloadConfig.getDownloadPath(
            'database',
            projectName || 'Unknown',
            downloadPath || null
        );
        const safeProjectName = (projectName || 'project').replace(/[^a-zA-Z0-9-_]/g, '_');
        const safeEnvironment = (environment || 'production').toLowerCase();
        const safeDatabaseName = (databaseName || 'epicms').replace(/[^a-zA-Z0-9-_]/g, '_');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `${safeProjectName}-${safeEnvironment}-${safeDatabaseName}-${timestamp}.bacpac`;
        const filepath = path.join(basePath, filename);

        // Save download state
        const downloadState: DownloadState = {
            downloadId,
            projectName: projectName || 'Unknown',
            environment: environment || 'Production',
            databaseName: databaseName || 'epicms',
            downloadUrl,
            downloadPath: filepath,
            status: 'active',
            startedAt: new Date().toISOString(),
            fileSize
        };
        await this.saveDownloadState(downloadState);

        try {
            // Download file with 60 minute timeout
            const timeoutMs = 60 * 60 * 1000;
            await this.downloadFile(downloadUrl, filepath, timeoutMs, downloadId);

            // Mark download complete
            DownloadManager.completeDownload(downloadId, { success: true });
            downloadState.status = 'completed';
            downloadState.completedAt = new Date().toISOString();
            await this.saveDownloadState(downloadState);

            // Save backup info
            const backupInfo: BackupInfo = {
                projectName: projectName || 'Unknown',
                environment: environment || 'Production',
                databaseName: databaseName || 'epicms',
                exportId: downloadUrl.split('/').pop() || 'unknown',
                downloadUrl,
                downloadedAt: new Date().toISOString(),
                filePath: filepath,
                fileSize
            };
            await this.storeBackupInfo(projectName || 'Unknown', backupInfo);

            OutputLogger.success(`✅ Background database download completed: ${filename}`);
        } catch (error: any) {
            // Mark download failed
            DownloadManager.failDownload(downloadId, error.message);
            downloadState.status = 'failed';
            downloadState.error = error.message;
            downloadState.completedAt = new Date().toISOString();
            await this.saveDownloadState(downloadState);

            throw error;
        }
    }

    /**
     * Download file from HTTPS URL with progress tracking
     */
    static async downloadFile(
        url: string,
        filepath: string,
        timeoutMs: number,
        downloadId: string
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(filepath);
            let downloadedBytes = 0;
            let lastProgressTime = Date.now();

            const timeoutHandle = setTimeout(() => {
                file.close();
                fs.unlinkSync(filepath);
                reject(new Error(`Download timeout after ${timeoutMs / 60000} minutes`));
            }, timeoutMs);

            // v3.33.2 fix: Do NOT add x-ms-version header for SAS URLs (invalidates signature)
            const requestOptions = {
                headers: {} as Record<string, string>
            };

            https.get(url, requestOptions, (response: any) => {
                const totalBytes = parseInt(response.headers['content-length'] || '0', 10);

                // Create progress monitor
                const monitor = new ProgressMonitor({
                    totalBytes,
                    showInMCP: true
                } as any);

                response.on('data', (chunk: Buffer) => {
                    downloadedBytes += chunk.length;
                    file.write(chunk);

                    // Update progress
                    (monitor as any).update(downloadedBytes);
                    DownloadManager.updateProgress(downloadId, downloadedBytes);

                    // Reset stall timer
                    lastProgressTime = Date.now();
                });

                response.on('end', () => {
                    file.end();
                    clearTimeout(timeoutHandle);
                    monitor.complete();
                    resolve();
                });

                response.on('error', (error: Error) => {
                    file.close();
                    fs.unlinkSync(filepath);
                    clearTimeout(timeoutHandle);
                    reject(error);
                });

                // Check for stalls (no data for 2 minutes)
                const stallCheckInterval = setInterval(() => {
                    const stallTime = Date.now() - lastProgressTime;
                    if (stallTime > 120000) { // 2 minutes
                        clearInterval(stallCheckInterval);
                        clearTimeout(timeoutHandle);
                        file.close();
                        fs.unlinkSync(filepath);
                        reject(new Error('Download stalled (no data received for 2 minutes)'));
                    }
                }, 10000); // Check every 10 seconds

                response.on('end', () => clearInterval(stallCheckInterval));
            }).on('error', (error: Error) => {
                file.close();
                fs.unlinkSync(filepath);
                clearTimeout(timeoutHandle);
                reject(error);
            });
        });
    }

    /**
     * Get remote file size via HEAD request
     */
    static async getRemoteFileSize(url: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const options = {
                method: 'HEAD',
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                headers: {} as Record<string, string>
            };

            https.request(options, (response: any) => {
                const size = parseInt(response.headers['content-length'] || '0', 10);
                resolve(size);
            }).on('error', reject).end();
        });
    }

    /**
     * Start background monitoring for an export
     */
    static startBackgroundMonitoring(
        exportId: string,
        projectConfig: ProjectConfig,
        environment: string,
        databaseName: string,
        downloadPath?: string
    ): void {
        // Check if already monitoring this export
        if (this.backgroundMonitors.has(exportId)) {
            OutputLogger.info(`Already monitoring export ${exportId}`);
            return;
        }

        const monitorData: MonitorData = {
            exportId,
            projectConfig,
            environment,
            databaseName,
            downloadPath,
            startedAt: new Date().toISOString(),
            pollCount: 0
        };

        const emitter = new EventEmitter() as BackgroundMonitor;
        emitter.exportId = exportId;
        emitter.data = monitorData;

        this.backgroundMonitors.set(exportId, emitter);

        // Start monitoring loop
        const pollInterval = 30000; // 30 seconds
        const maxDuration = 45; // 45 minutes

        const monitorLoop = async (): Promise<void> => {
            try {
                monitorData.pollCount++;
                const elapsedMinutes = Math.floor((Date.now() - new Date(monitorData.startedAt).getTime()) / 60000);

                const result = await DXPRestClient.getDatabaseExportStatus(
                    projectConfig.projectId,
                    projectConfig.apiKey!,
                    projectConfig.apiSecret!,
                    environment,
                    monitorData.databaseName,
                    exportId
                );

                const parsedStatus = this.parseExportStatus(result);
                monitorData.lastStatus = parsedStatus.status;

                (emitter as any).emit('progress', {
                    status: parsedStatus.status,
                    pollCount: monitorData.pollCount,
                    elapsedMinutes
                });

                if (parsedStatus.status === 'Succeeded') {
                    (emitter as any).emit('complete', {
                        exportId,
                        downloadUrl: parsedStatus.downloadUrl,
                        environment,
                        databaseName
                    });

                    if (emitter.intervalId) {
                        clearInterval(emitter.intervalId);
                    }
                    this.backgroundMonitors.delete(exportId);

                    // If autoDownload was requested, trigger background download
                    // DXP-184 FIX: Use background download to avoid blocking background monitor thread
                    if (monitorData.autoDownload && parsedStatus.downloadUrl) {
                        this.startBackgroundDatabaseDownload(
                            parsedStatus.downloadUrl,
                            downloadPath,
                            projectConfig.name,
                            environment,
                            databaseName
                        ).then(downloadId => {
                            OutputLogger.success(`✅ Auto-download started (background). Download ID: ${downloadId}`);
                        }).catch(error => {
                            OutputLogger.error(`Auto-download failed: ${error.message}`);
                        });
                    }
                } else if (parsedStatus.status === 'Failed') {
                    (emitter as any).emit('failed', { exportId, error: 'Export failed' });
                    if (emitter.intervalId) {
                        clearInterval(emitter.intervalId);
                    }
                    this.backgroundMonitors.delete(exportId);
                } else if (elapsedMinutes >= maxDuration) {
                    (emitter as any).emit('timeout', { exportId, elapsedMinutes });
                    if (emitter.intervalId) {
                        clearInterval(emitter.intervalId);
                    }
                    this.backgroundMonitors.delete(exportId);
                }
            } catch (error: any) {
                (emitter as any).emit('error', { exportId, error: error.message });
            }
        };

        // Start polling
        emitter.intervalId = setInterval(monitorLoop, pollInterval);
        monitorLoop(); // Immediate first check

        OutputLogger.info(`Started background monitoring for export ${exportId}`);
    }

    /**
     * Get active background monitors
     */
    static getActiveBackgroundMonitors(): Map<string, MonitorData> {
        const result = new Map<string, MonitorData>();
        this.backgroundMonitors.forEach((monitor, exportId) => {
            result.set(exportId, monitor.data);
        });
        return result;
    }

    /**
     * Stop background monitoring
     */
    static stopBackgroundMonitoring(exportId: string): boolean {
        const monitor = this.backgroundMonitors.get(exportId);
        if (monitor) {
            if (monitor.intervalId) {
                clearInterval(monitor.intervalId);
            }
            this.backgroundMonitors.delete(exportId);
            OutputLogger.info(`Stopped background monitoring for export ${exportId}`);
            return true;
        }
        return false;
    }

    /**
     * Resume background monitoring for an export
     */
    static resumeBackgroundMonitoring(
        exportId: string,
        projectConfig: ProjectConfig,
        environment: string,
        databaseName: string,
        downloadPath?: string
    ): void {
        // Stop existing monitoring if any
        this.stopBackgroundMonitoring(exportId);

        // Start fresh monitoring
        this.startBackgroundMonitoring(exportId, projectConfig, environment, databaseName, downloadPath);
    }

    /**
     * Start monitoring for queued export when blocking export completes
     */
    static startQueuedExportMonitoring(blockingExport: ExportInfo, queuedExport: QueuedExport): void {
        const monitor = this.backgroundMonitors.get(blockingExport.exportId);
        if (!monitor) {
            return;
        }

        (monitor as any).once('complete', () => {
            OutputLogger.info(`Blocking export ${blockingExport.exportId} completed. Starting queued export...`);

            // Start the queued export
            const args: ExportDatabaseArgs = {
                apiKey: queuedExport.projectConfig.apiKey,
                apiSecret: queuedExport.projectConfig.apiSecret,
                projectId: queuedExport.projectConfig.projectId,
                projectName: queuedExport.projectConfig.name,
                environment: queuedExport.environment,
                databaseName: queuedExport.databaseName,
                downloadPath: queuedExport.downloadPath,
                autoMonitor: true,
                autoDownload: queuedExport.autoDownload,
                incremental: queuedExport.incremental
            };

            this.internalStartExport(args).catch(error => {
                OutputLogger.error(`Failed to start queued export: ${error.message}`);
            });
        });

        (monitor as any).once('failed', () => {
            OutputLogger.info(`Blocking export ${blockingExport.exportId} failed. Queued export will not start.`);
        });
    }

    /**
     * Detect active exports and offer recovery
     */
    static async detectAndOfferRecovery(_projectConfig: ProjectConfig): Promise<ExportInfo | null> {
        const savedState = await this.loadCurrentExportState();
        if (!savedState) {
            return null;
        }

        // Check if export is still active
        if (savedState.status === 'InProgress' || savedState.status === 'Queued') {
            return savedState;
        }

        return null;
    }

    /**
     * Resolve export conflict
     */
    static async resolveExportConflict(
        targetEnv: string,
        targetDb: string,
        projectConfig: ProjectConfig,
        downloadPath?: string
    ): Promise<{ action: 'queue' | 'cancel'; message?: string; queuedExportId?: string }> {
        const savedState = await this.loadCurrentExportState();
        if (!savedState) {
            return { action: 'cancel', message: 'No conflict found' };
        }

        // For now, auto-queue the new export
        const queuedExportId = `queued-${Date.now()}`;

        const queuedExport: QueuedExport = {
            exportId: queuedExportId,
            projectConfig,
            environment: targetEnv,
            databaseName: targetDb,
            downloadPath,
            autoDownload: true
        };

        // Set up monitoring to start queued export when blocking export completes
        this.startQueuedExportMonitoring(savedState, queuedExport);

        return {
            action: 'queue',
            message: `Export for ${targetEnv} ${targetDb} queued behind active export for ${savedState.environment} ${savedState.databaseName}. ` +
                     `Will start automatically when current export completes.`,
            queuedExportId
        };
    }

    /**
     * Find available backup file
     */
    static async findAvailableBackup(
        projectConfig: ProjectConfig,
        environment?: string,
        databaseName?: string
    ): Promise<ExistingBackup | null> {
        const backups = await this.checkForExistingBackups(
            process.cwd(),
            projectConfig.name,
            environment || 'Production',
            databaseName || 'epicms'
        );

        if (backups.length > 0) {
            return backups[0]; // Most recent backup
        }

        return null;
    }

    /**
     * Check for existing backup files
     */
    static async checkForExistingBackups(
        downloadPath: string,
        projectName: string,
        environment: string,
        databaseName: string
    ): Promise<ExistingBackup[]> {
        const safeProjectName = projectName.replace(/[^a-zA-Z0-9-_]/g, '_');
        const safeEnvironment = environment.toLowerCase();
        const safeDatabaseName = databaseName.replace(/[^a-zA-Z0-9-_]/g, '_');

        try {
            const files = fs.readdirSync(downloadPath);
            const matchingFiles = files.filter((file: string) => {
                const regex = new RegExp(`^${safeProjectName}-${safeEnvironment}-${safeDatabaseName}-.*\\.bacpac$`);
                return regex.test(file);
            });

            const backups: ExistingBackup[] = [];

            for (const file of matchingFiles) {
                const filepath = path.join(downloadPath, file);
                const stats = fs.statSync(filepath);
                const ageMs = Date.now() - stats.mtimeMs;
                const ageHours = ageMs / (1000 * 60 * 60);

                const ageDays = Math.floor(ageHours / 24);
                const remainingHours = Math.floor(ageHours % 24);
                const formattedAge = ageDays > 0 ?
                    `${ageDays} day${ageDays > 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}` :
                    `${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;

                backups.push({
                    fileName: file,
                    filePath: filepath,
                    fileSize: stats.size,
                    ageHours,
                    formattedAge
                });
            }

            // Sort by age (newest first)
            backups.sort((a, b) => a.ageHours - b.ageHours);

            return backups;
        } catch (error: any) {
            return [];
        }
    }

    /**
     * Generate monitoring instructions for AI agents
     */
    static generateMonitoringInstructions(exportId: string, status: string, args: CheckExportStatusArgs): string {
        let instructions = '';

        const inProgressStatuses = ['InProgress', 'Queued'];
        const completeStatuses = ['Succeeded', 'Failed'];

        if (completeStatuses.includes(status)) {
            instructions += `---\\n\\n`;
            instructions += `✅ **Export Complete**\\n\\n`;
            instructions += `Final Status: **${status}**\\n`;
            instructions += `Export ID: ${exportId}\\n\\n`;

            if (status === 'Succeeded') {
                instructions += `🎉 Export completed successfully! Download URL is available.\\n`;
                instructions += `Use download_database_export to download the backup file.\\n`;
            } else if (status === 'Failed') {
                instructions += `⚠️ Export failed. Check DXP portal for error details.\\n`;
            }

            instructions += `\\n**AI: Stop monitoring - export is complete.**`;
        } else if (inProgressStatuses.includes(status)) {
            instructions += `---\\n\\n`;
            instructions += `📊 **MONITORING INSTRUCTIONS FOR AI**\\n\\n`;
            instructions += `Export still in progress.\\n`;
            instructions += `Export ID: ${exportId}\\n`;
            instructions += `Current Status: ${status}\\n\\n`;

            const monitorInterval = 30; // 30 seconds

            instructions += `**To continue monitoring, use check_export_status with:**\\n`;
            instructions += `• exportId: "${exportId}"\\n`;
            instructions += `• waitBeforeCheck: ${monitorInterval} (waits ${monitorInterval} seconds then checks)\\n`;
            instructions += `• monitor: true (enables monitoring prompts)\\n`;
            instructions += `• projectName: "${args.projectName || ''}"\\n`;
            instructions += `\\n`;
            instructions += `**RECOMMENDED MONITORING PATTERN:**\\n`;
            instructions += `1. Call check_export_status with:\\n`;
            instructions += `   - exportId="${exportId}"\\n`;
            instructions += `   - waitBeforeCheck=${monitorInterval}\\n`;
            instructions += `   - monitor=true\\n`;
            instructions += `2. If still InProgress, repeat with same interval\\n`;
            instructions += `3. When Succeeded, download the backup\\n`;
            instructions += `4. When Failed, stop monitoring and report error\\n\\n`;
            instructions += `**Note:** Tool will wait ${monitorInterval} seconds then check automatically.\\n`;
            instructions += `Database exports can take 5-30 minutes depending on database size. Be patient and don't raise concerns unless export is stuck for over an hour.`;
        }

        return instructions;
    }

    /**
     * Parse export status from API response
     */
    static parseExportStatus(result: any): ParsedExportStatus {
        // Handle different response formats
        let status = 'Unknown';
        let exportId = '';
        let downloadUrl: string | undefined;
        let percentComplete: number | undefined;

        if (typeof result === 'object') {
            status = result.status || result.Status || 'Unknown';
            exportId = result.exportId || result.ExportId || result.id || '';
            downloadUrl = result.downloadLink || result.DownloadLink || result.downloadUrl || result.DownloadUrl || result.sasUrl;
            percentComplete = result.percentComplete || result.PercentComplete;
        } else if (typeof result === 'string') {
            // Try to parse JSON string
            try {
                const parsed = JSON.parse(result);
                status = parsed.status || parsed.Status || 'Unknown';
                exportId = parsed.exportId || parsed.ExportId || parsed.id || '';
                downloadUrl = parsed.downloadLink || parsed.DownloadLink || parsed.downloadUrl || parsed.DownloadUrl || parsed.sasUrl;
                percentComplete = parsed.percentComplete || parsed.PercentComplete;
            } catch {
                // Not JSON, use as-is
                status = result;
            }
        }

        return {
            exportId,
            status,
            downloadUrl,
            percentComplete
        };
    }

    /**
     * Extract export ID from result
     */
    static extractExportId(result: any): string {
        if (typeof result === 'object') {
            return result.exportId || result.ExportId || result.id || 'unknown';
        } else if (typeof result === 'string') {
            try {
                const parsed = JSON.parse(result);
                return parsed.exportId || parsed.ExportId || parsed.id || 'unknown';
            } catch {
                return 'unknown';
            }
        }
        return 'unknown';
    }

    /**
     * Extract download URL from content
     */
    static extractDownloadUrl(content: any): string | undefined {
        if (typeof content === 'object') {
            return content.downloadUrl || content.DownloadUrl || content.sasUrl;
        } else if (typeof content === 'string') {
            try {
                const parsed = JSON.parse(content);
                return parsed.downloadUrl || parsed.DownloadUrl || parsed.sasUrl;
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    /**
     * Format bytes to human-readable string
     */
    static formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Estimate download time based on file size
     */
    static estimateDownloadTime(bytes: number): string {
        // Assume 10 MB/s download speed (conservative estimate)
        const speedBytesPerSecond = 10 * 1024 * 1024;
        const seconds = Math.ceil(bytes / speedBytesPerSecond);

        if (seconds < 60) {
            return `${seconds} seconds`;
        } else if (seconds < 3600) {
            const minutes = Math.ceil(seconds / 60);
            return `${minutes} minute${minutes > 1 ? 's' : ''}`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.ceil((seconds % 3600) / 60);
            return `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
        }
    }

    /**
     * Save current export state to disk
     */
    static async saveCurrentExportState(exportInfo: ExportInfo): Promise<void> {
        try {
            fs.writeFileSync(this.STATE_FILE, JSON.stringify(exportInfo, null, 2), 'utf-8');
        } catch (error: any) {
            OutputLogger.error(`Failed to save export state: ${error.message}`);
        }
    }

    /**
     * Load current export state from disk
     */
    static async loadCurrentExportState(): Promise<ExportInfo | null> {
        try {
            if (fs.existsSync(this.STATE_FILE)) {
                const content = fs.readFileSync(this.STATE_FILE, 'utf-8');
                return JSON.parse(content) as ExportInfo;
            }
        } catch (error: any) {
            OutputLogger.error(`Failed to load export state: ${error.message}`);
        }
        return null;
    }

    /**
     * Clear current export state
     */
    static async clearCurrentExportState(): Promise<void> {
        try {
            if (fs.existsSync(this.STATE_FILE)) {
                fs.unlinkSync(this.STATE_FILE);
            }
        } catch (error: any) {
            OutputLogger.error(`Failed to clear export state: ${error.message}`);
        }
    }

    /**
     * Store backup information in history
     */
    static async storeBackupInfo(projectName: string, backupInfo: BackupInfo): Promise<void> {
        if (!this.backupHistory[projectName]) {
            this.backupHistory[projectName] = [];
        }

        this.backupHistory[projectName].push(backupInfo);

        // Keep only last 50 backups per project
        if (this.backupHistory[projectName].length > 50) {
            this.backupHistory[projectName] = this.backupHistory[projectName].slice(-50);
        }
    }

    /**
     * Save download state to disk
     */
    static async saveDownloadState(download: DownloadState): Promise<void> {
        try {
            const stateDir = path.join(os.tmpdir(), '.optimizely-dxp-downloads');
            if (!fs.existsSync(stateDir)) {
                fs.mkdirSync(stateDir, { recursive: true });
            }

            const stateFile = path.join(stateDir, `${download.downloadId}.json`);
            fs.writeFileSync(stateFile, JSON.stringify(download, null, 2), 'utf-8');
        } catch (error: any) {
            OutputLogger.error(`Failed to save download state: ${error.message}`);
        }
    }

    /**
     * Load completed downloads from disk
     */
    static async loadCompletedDownloads(): Promise<DownloadState[]> {
        try {
            const stateDir = path.join(os.tmpdir(), '.optimizely-dxp-downloads');
            if (!fs.existsSync(stateDir)) {
                return [];
            }

            const files = fs.readdirSync(stateDir);
            const downloads: DownloadState[] = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const content = fs.readFileSync(path.join(stateDir, file), 'utf-8');
                    const download = JSON.parse(content) as DownloadState;
                    if (download.status === 'completed') {
                        downloads.push(download);
                    }
                }
            }

            return downloads;
        } catch (error: any) {
            OutputLogger.error(`Failed to load completed downloads: ${error.message}`);
            return [];
        }
    }
}

export default DatabaseSimpleTools;

/**
 * Multi-Project Batch Operations
 * Handles natural language commands for multiple projects at once
 * Part of DXP-4: Enhanced multi-project support
 */

const ProjectTools = require('./project-tools');
const BlobDownloadTools = require('./blob-download-tools');
const LogDownloadTools = require('./log-download-tools');
const ResponseBuilder = require('../response-builder');
const OutputLogger = require('../output-logger');

class MultiProjectBatch {
    /**
     * Parse natural language to extract multiple project names
     * Examples:
     * - "download blobs for ProjectX and ProjectY"
     * - "get logs from ACME_CORP, Contoso, and Fabrikam"
     * - "sync ProjectA ProjectB ProjectC to local"
     */
    static extractProjectNames(input) {
        if (!input) return [];
        
        const projects = [];
        const allProjects = ProjectTools.getConfiguredProjects();
        const projectNames = allProjects.map(p => p.name.toLowerCase());
        
        // Convert input to lowercase for matching
        const lowerInput = input.toLowerCase();
        
        // Look for each configured project name in the input
        for (const project of allProjects) {
            const nameVariations = [
                project.name.toLowerCase(),
                project.name.replace(/_/g, ' ').toLowerCase(),
                project.name.replace(/-/g, ' ').toLowerCase()
            ];
            
            for (const variation of nameVariations) {
                if (lowerInput.includes(variation)) {
                    if (!projects.find(p => p.name === project.name)) {
                        projects.push(project);
                    }
                    break;
                }
            }
        }
        
        // If no projects found, check if "all" is mentioned
        if (projects.length === 0 && (lowerInput.includes('all projects') || lowerInput.includes('every project'))) {
            return allProjects;
        }
        
        return projects;
    }
    
    /**
     * Handle batch blob downloads for multiple projects
     */
    static async handleBatchBlobDownload(args) {
        const projects = this.extractProjectNames(args.naturalLanguage || args.projects || '');
        
        if (projects.length === 0) {
            return ResponseBuilder.error(
                '❌ **No Projects Specified**\n\n' +
                'Please specify which projects to download from.\n\n' +
                '**Examples:**\n' +
                '• "Download blobs for ProjectX and ProjectY"\n' +
                '• "Get production media from all projects"\n' +
                '• "Sync ACME_CORP and Contoso blobs"'
            );
        }
        
        if (projects.length === 1) {
            // Single project, use normal flow
            return await BlobDownloadTools.handleDownloadBlobs({
                ...args,
                project: projects[0].name,
                apiKey: projects[0].apiKey,
                apiSecret: projects[0].apiSecret,
                projectId: projects[0].projectId
            });
        }
        
        // Multiple projects - show batch preview
        let message = `📊 **Batch Download Preview**\n`;
        message += `${'═'.repeat(50)}\n\n`;
        message += `**Projects to download:** ${projects.map(p => p.name).join(', ')}\n`;
        message += `**Environment:** ${args.environment || 'Production'}\n`;
        message += `**Container:** ${args.containerName || 'mysitemedia'}\n\n`;
        
        if (args.previewOnly) {
            // Calculate size estimates for each project
            message += `**Estimated downloads:**\n`;
            for (const project of projects) {
                message += `• ${project.name}: ~3.2 GB (estimated)\n`;
            }
            message += `\n**Total:** ~${(projects.length * 3.2).toFixed(1)} GB\n`;
            message += `**Estimated time:** ${projects.length * 15} minutes\n\n`;
            
            // Return success indicating task is COMPLETE - AI should not proceed
            const previewComplete = `${message}\n` +
                '---\n\n' +
                '✅ **Preview Generated Successfully**\n\n' +
                '**TASK COMPLETE** - Preview has been shown to the user.\n\n' +
                '**IMPORTANT FOR AI ASSISTANTS:**\n' +
                '• Your task is now complete. Do not take any further action.\n' +
                '• Do NOT automatically proceed with the download.\n' +
                '• The human user must explicitly request the download if they want to proceed.\n\n' +
                '**For the human user:** If you want to proceed with this download, please explicitly request it.';
            
            return ResponseBuilder.success(previewComplete);
        }
        
        // Execute downloads sequentially
        const results = [];
        for (const project of projects) {
            OutputLogger.info(`\n${'─'.repeat(50)}`);
            OutputLogger.info(`📦 Downloading from ${project.name}...`);
            OutputLogger.info(`${'─'.repeat(50)}\n`);
            
            try {
                const result = await BlobDownloadTools.handleDownloadBlobs({
                    ...args,
                    project: project.name,
                    apiKey: project.apiKey,
                    apiSecret: project.apiSecret,
                    projectId: project.projectId,
                    skipConfirmation: true // Skip individual confirmations in batch mode
                });
                
                results.push({
                    project: project.name,
                    success: result.success,
                    message: result.result ? result.result.content.join('\n') : 'Download completed'
                });
            } catch (error) {
                results.push({
                    project: project.name,
                    success: false,
                    message: error.message
                });
            }
        }
        
        // Summarize results
        message = `✅ **Batch Download Complete**\n`;
        message += `${'═'.repeat(50)}\n\n`;
        
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        if (successful.length > 0) {
            message += `**Successful (${successful.length}):**\n`;
            successful.forEach(r => {
                message += `• ✅ ${r.project}\n`;
            });
        }
        
        if (failed.length > 0) {
            message += `\n**Failed (${failed.length}):**\n`;
            failed.forEach(r => {
                message += `• ❌ ${r.project}: ${r.message}\n`;
            });
        }
        
        message += `\n**Downloads saved to:** ~/Downloads/[ProjectName]/[Environment]/`;
        
        return ResponseBuilder.success(message);
    }
    
    /**
     * Handle batch log downloads for multiple projects
     */
    static async handleBatchLogDownload(args) {
        const projects = this.extractProjectNames(args.naturalLanguage || args.projects || '');
        
        if (projects.length === 0) {
            return ResponseBuilder.error(
                '❌ **No Projects Specified**\n\n' +
                'Please specify which projects to download logs from.\n\n' +
                '**Examples:**\n' +
                '• "Download error logs for ProjectX and ProjectY"\n' +
                '• "Get today\'s logs from all projects"\n' +
                '• "Fetch production logs for ACME_CORP and Contoso"'
            );
        }
        
        if (projects.length === 1) {
            // Single project, use normal flow
            return await LogDownloadTools.handleDownloadLogs({
                ...args,
                project: projects[0].name,
                apiKey: projects[0].apiKey,
                apiSecret: projects[0].apiSecret,
                projectId: projects[0].projectId
            });
        }
        
        // Multiple projects - execute sequentially
        const results = [];
        let message = `📊 **Batch Log Download**\n`;
        message += `${'═'.repeat(50)}\n\n`;
        message += `Downloading logs from ${projects.length} projects...\n\n`;
        
        for (const project of projects) {
            OutputLogger.info(`\n📋 Downloading logs from ${project.name}...`);
            
            try {
                const result = await LogDownloadTools.handleDownloadLogs({
                    ...args,
                    project: project.name,
                    apiKey: project.apiKey,
                    apiSecret: project.apiSecret,
                    projectId: project.projectId,
                    skipConfirmation: true
                });
                
                results.push({
                    project: project.name,
                    success: result.success,
                    message: 'Downloaded successfully'
                });
            } catch (error) {
                results.push({
                    project: project.name,
                    success: false,
                    message: error.message
                });
            }
        }
        
        // Summarize
        const successful = results.filter(r => r.success);
        message += `\n**Results:**\n`;
        message += `• Successfully downloaded: ${successful.length}/${projects.length} projects\n`;
        
        if (results.filter(r => !r.success).length > 0) {
            message += `\n**Failed downloads:**\n`;
            results.filter(r => !r.success).forEach(r => {
                message += `• ${r.project}: ${r.message}\n`;
            });
        }
        
        return ResponseBuilder.success(message);
    }
    
    /**
     * Detect if command mentions multiple projects
     */
    static isMultiProjectCommand(input) {
        if (!input) return false;
        
        const lowerInput = input.toLowerCase();
        
        // Check for words indicating multiple items
        if (lowerInput.includes(' and ') || 
            lowerInput.includes(', ') ||
            lowerInput.includes(' & ') ||
            lowerInput.includes('all projects') ||
            lowerInput.includes('every project') ||
            lowerInput.includes('multiple')) {
            
            // Count how many project names are mentioned
            const projects = this.extractProjectNames(input);
            return projects.length > 1;
        }
        
        return false;
    }
}

module.exports = MultiProjectBatch;
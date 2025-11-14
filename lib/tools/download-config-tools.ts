/**
 * Download Configuration Tools
 * Shows and manages download path configuration
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import ResponseBuilder from '../response-builder';
import DownloadConfig from '../download-config';
import ProjectTools from './project-tools';
import OutputLogger from '../output-logger';

class DownloadConfigTools {
    /**
     * Show current download configuration
     */
    static async handleShowDownloadConfig(_args: any): Promise<any> {
        try {
            // Get current project
            const projectConfig = await ProjectTools.getCurrentProject();
            const projectName = projectConfig ? projectConfig.name : '';

            OutputLogger.info(`📁 Download Path Configuration${projectName ? ` for ${projectName}` : ''}`);

            // Get configuration
            const config = await DownloadConfig.showConfiguration(projectName);

            let message = `# 📁 Download Path Configuration\n\n`;

            if (projectName) {
                message += `**Current Project**: ${projectName}\n\n`;
            }

            // Show environment variables
            message += `## 🔧 Environment Variables\n`;
            const envVars = config['Environment Variables'];
            if (Object.keys(envVars).length > 0) {
                message += `The following environment variables are set:\n\n`;
                for (const [key, value] of Object.entries(envVars)) {
                    message += `• **${key}**\n  \`${value}\`\n`;
                }
            } else {
                message += `No download path environment variables are currently set.\n`;
            }
            message += `\n`;

            // Show resolved paths
            message += `## 📂 Resolved Download Paths\n`;
            message += `These are the paths that will be used for each download type:\n\n`;

            const paths = config['Smart Defaults'];
            for (const [type, path] of Object.entries(paths)) {
                message += `• **${type.charAt(0).toUpperCase() + type.slice(1)}**: \`${path}\`\n`;
            }
            message += `\n`;

            // Show how to configure
            message += `## 💡 How to Configure\n\n`;
            message += `You can set download paths using environment variables:\n\n`;

            message += `### Global Settings\n`;
            message += `\`\`\`bash\n`;
            message += `# Set default for all downloads\n`;
            message += `export OPTIMIZELY_DOWNLOAD_PATH="/path/to/downloads"\n\n`;
            message += `# Set type-specific paths\n`;
            message += `export OPTIMIZELY_DOWNLOAD_PATH_BLOBS="/path/to/blobs"\n`;
            message += `export OPTIMIZELY_DOWNLOAD_PATH_DATABASE="/path/to/backups"\n`;
            message += `export OPTIMIZELY_DOWNLOAD_PATH_LOGS="/path/to/logs"\n`;
            message += `\`\`\`\n\n`;

            if (projectName) {
                const projectKey = projectName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
                message += `### Project-Specific Settings (${projectName})\n`;
                message += `\`\`\`bash\n`;
                message += `# Set default for ${projectName} project\n`;
                message += `export OPTIMIZELY_${projectKey}_DOWNLOAD_PATH="/path/to/${projectName.toLowerCase()}/downloads"\n\n`;
                message += `# Set type-specific paths for ${projectName}\n`;
                message += `export OPTIMIZELY_${projectKey}_DOWNLOAD_PATH_BLOBS="/path/to/${projectName.toLowerCase()}/blobs"\n`;
                message += `export OPTIMIZELY_${projectKey}_DOWNLOAD_PATH_DATABASE="/path/to/${projectName.toLowerCase()}/backups"\n`;
                message += `export OPTIMIZELY_${projectKey}_DOWNLOAD_PATH_LOGS="/path/to/${projectName.toLowerCase()}/logs"\n`;
                message += `\`\`\`\n\n`;
            }

            message += `### Priority Order\n`;
            message += `1. Command-line specified path (highest priority)\n`;
            message += `2. Project + Type specific environment variable\n`;
            message += `3. Project general path + type subdirectory\n`;
            message += `4. Type-specific global environment variable\n`;
            message += `5. Global path + type/project subdirectories\n`;
            message += `6. Settings file configuration\n`;
            message += `7. Smart defaults (lowest priority)\n`;

            return ResponseBuilder.success(message);

        } catch (error: any) {
            return ResponseBuilder.error(`Failed to get download configuration: ${error.message}`);
        }
    }

    /**
     * Set download path for a specific type
     */
    static async handleSetDownloadPath(args: any): Promise<any> {
        try {
            const { type, path, project } = args;

            if (!type || !path) {
                return ResponseBuilder.invalidParams('Both type and path are required');
            }

            // Validate type
            const validTypes = ['blobs', 'database', 'logs', 'all'];
            if (!validTypes.includes(type.toLowerCase())) {
                return ResponseBuilder.invalidParams(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
            }

            // Build environment variable name
            let envVarName: string;
            if (project) {
                const projectKey = project.toUpperCase().replace(/[^A-Z0-9]/g, '_');
                if (type.toLowerCase() === 'all') {
                    envVarName = `OPTIMIZELY_${projectKey}_DOWNLOAD_PATH`;
                } else {
                    envVarName = `OPTIMIZELY_${projectKey}_DOWNLOAD_PATH_${type.toUpperCase()}`;
                }
            } else {
                if (type.toLowerCase() === 'all') {
                    envVarName = 'OPTIMIZELY_DOWNLOAD_PATH';
                } else {
                    envVarName = `OPTIMIZELY_DOWNLOAD_PATH_${type.toUpperCase()}`;
                }
            }

            // Set the environment variable
            DownloadConfig.setEnvironmentVariable(envVarName, path);

            let message = `✅ Download path configured for this session\n\n`;
            message += `**Type**: ${type}\n`;
            if (project) {
                message += `**Project**: ${project}\n`;
            }
            message += `**Path**: ${path}\n`;
            message += `**Environment Variable**: ${envVarName}\n\n`;

            message += `💡 **Note**: This setting only applies to the current session.\n`;
            message += `To make it permanent, add this to your shell profile:\n`;
            message += `\`\`\`bash\n`;
            message += `export ${envVarName}="${path}"\n`;
            message += `\`\`\``;

            return ResponseBuilder.success(message);

        } catch (error: any) {
            return ResponseBuilder.error(`Failed to set download path: ${error.message}`);
        }
    }
}

export default DownloadConfigTools;

/**
 * Configure Project Tool
 * Allows adding/updating project credentials inline
 */

import ProjectTools from './project-tools';
import ResponseBuilder from '../response-builder';

/**
 * Configuration arguments
 */
export interface ConfigureArgs {
    project?: string;
    projectName?: string;
    connectionString?: string;
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
}

class ConfigureProject {
    /**
     * Configure a project with inline credentials
     * Supports both new projects and upgrading Unknown projects
     */
    static async configure(args: ConfigureArgs): Promise<any> {
        const { project, projectName, connectionString, apiKey, apiSecret, projectId } = args;

        // Determine the project name
        const name = project || projectName;

        if (!name) {
            return ResponseBuilder.error('Project name required. Use: configure_project with project="NAME"');
        }

        // Get current projects
        const projects = ProjectTools.getConfiguredProjects();
        const existingProject = projects.find(p =>
            p.name === name ||
            p.name.toLowerCase() === name.toLowerCase()
        );

        // Determine what type of configuration this is
        const isConnectionString = !!connectionString;
        const isDxpCredentials = !!(apiKey && apiSecret);

        if (!isConnectionString && !isDxpCredentials) {
            return ResponseBuilder.error(
                'Credentials required. Provide either:\n' +
                '• connectionString for self-hosted\n' +
                '• apiKey and apiSecret (and optionally projectId) for DXP'
            );
        }

        // Build the configuration
        let config: any = {
            name: name,
            configSource: 'dynamic',
            lastUpdated: new Date().toISOString()
        };

        if (isConnectionString) {
            // Self-hosted configuration
            config.connectionString = connectionString;
            config.isSelfHosted = true;
            config.projectType = 'self-hosted';
            config.projectId = projectId || `self-hosted-${name.toLowerCase().replace(/\s+/g, '-')}`;
            config.environments = ['Production']; // Self-hosted typically has one environment

            // Preserve paths if updating existing project
            if (existingProject) {
                if (existingProject.blobPath) config.blobPath = existingProject.blobPath;
                if (existingProject.logPath) config.logPath = existingProject.logPath;
                if (existingProject.dbPath) config.dbPath = existingProject.dbPath;
            }
        } else {
            // DXP PaaS configuration
            if (!projectId) {
                return ResponseBuilder.error(
                    'DXP projects require a projectId (UUID). Example:\n' +
                    'configure_project project="MyProject" projectId="abc-123..." apiKey="..." apiSecret="..."'
                );
            }

            config.projectId = projectId;
            config.apiKey = apiKey;
            config.apiSecret = apiSecret;
            config.projectType = 'dxp-paas';
            config.environments = ['Integration', 'Preproduction', 'Production'];

            // Preserve paths if updating existing project
            if (existingProject) {
                if (existingProject.blobPath) config.blobPath = existingProject.blobPath;
                if (existingProject.logPath) config.logPath = existingProject.logPath;
                if (existingProject.dbPath) config.dbPath = existingProject.dbPath;
            }
        }

        // Add or update the configuration
        ProjectTools.addConfiguration(config);

        // Build response
        const sections: string[] = [];
        const isUpdate = !!existingProject;

        sections.push(`✅ **Project ${isUpdate ? 'Updated' : 'Configured'} Successfully**`);
        sections.push('');
        sections.push(`**${config.name}**`);

        if (isUpdate && existingProject.isUnknown) {
            sections.push(`Upgraded from: Unknown (Paths Only)`);
        } else if (isUpdate) {
            sections.push(`Status: Configuration updated`);
        }

        sections.push(`Type: ${config.isSelfHosted ? 'Self-Hosted Azure' : 'DXP PaaS'}`);
        sections.push(`Project ID: ${config.projectId}`);

        if (config.isSelfHosted) {
            sections.push(`Connection String: ✅ Configured`);
        } else {
            sections.push(`API Key: ✅ Configured`);
            sections.push(`API Secret: ✅ Configured`);
        }

        if (config.blobPath) sections.push(`Blob Path: ${config.blobPath}`);
        if (config.logPath) sections.push(`Log Path: ${config.logPath}`);

        sections.push('');
        sections.push('💡 The project is now available for use!');
        sections.push(`Example: "list deployments for ${config.name}"`);

        return ResponseBuilder.success(sections.join('\n'));
    }
}

export default ConfigureProject;

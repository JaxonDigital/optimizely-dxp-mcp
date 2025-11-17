/**
 * Project Upgrade Tools
 * Handles upgrading Unknown projects with inline credentials
 */

import ProjectTools from './project-tools';
import ResponseBuilder from '../response-builder';
import OutputLogger from '../output-logger';

/**
 * Upgrade arguments
 */
export interface UpgradeArgs {
    projectName?: string;
    projectId?: string;
    connectionString?: string;
    apiKey?: string;
    apiSecret?: string;
}

class ProjectUpgrade {
    /**
     * Upgrade an Unknown project with connection string or API credentials
     * This allows inline configuration without modifying config files
     */
    static upgradeProject(args: UpgradeArgs): any {
        const { projectName, projectId, connectionString, apiKey, apiSecret } = args;

        // Find the project to upgrade
        const projects = ProjectTools.getConfiguredProjects();
        const projectIdentifier = projectName || projectId;

        if (!projectIdentifier) {
            return ResponseBuilder.error('Project name or ID required to upgrade');
        }

        // Find the target project
        const project = projects.find(p =>
            p.name === projectIdentifier ||
            p.projectId === projectIdentifier ||
            p.name.toLowerCase() === projectIdentifier.toLowerCase()
        );

        if (!project) {
            return ResponseBuilder.error(`Project '${projectIdentifier}' not found`);
        }

        // Check if it's an Unknown project
        if (!project.isUnknown) {
            const type = project.isSelfHosted ? 'Self-Hosted' : 'DXP PaaS';
            return ResponseBuilder.success(`Project '${project.name}' is already configured as ${type}`);
        }

        // Prepare upgraded configuration
        const upgradedConfig: any = {
            ...project,
            configSource: 'dynamic',
            lastUpdated: new Date().toISOString()
        };

        // Upgrade based on provided credentials
        if (connectionString) {
            // Upgrade to Self-Hosted
            upgradedConfig.connectionString = connectionString;
            upgradedConfig.isSelfHosted = true;
            upgradedConfig.isUnknown = false;
            upgradedConfig.projectType = 'self-hosted';
            delete upgradedConfig.needsConfiguration;
            delete upgradedConfig.configurationHint;

            // Update project ID if it was unknown-*
            if (upgradedConfig.projectId.startsWith('unknown-')) {
                upgradedConfig.projectId = upgradedConfig.projectId.replace('unknown-', 'self-hosted-');
            }

            OutputLogger.log(`Upgrading '${project.name}' from Unknown to Self-Hosted`);

        } else if (apiKey && apiSecret) {
            // Upgrade to DXP PaaS
            upgradedConfig.apiKey = apiKey;
            upgradedConfig.apiSecret = apiSecret;
            upgradedConfig.isUnknown = false;
            upgradedConfig.projectType = 'dxp-paas';
            delete upgradedConfig.needsConfiguration;
            delete upgradedConfig.configurationHint;

            // For DXP, we need a proper UUID projectId
            if (!projectId || projectId.startsWith('unknown-')) {
                return ResponseBuilder.error('DXP projects require a valid UUID project ID');
            }

            upgradedConfig.projectId = projectId;

            OutputLogger.log(`Upgrading '${project.name}' from Unknown to DXP PaaS`);

        } else {
            return ResponseBuilder.error('Connection string (for self-hosted) or API key/secret (for DXP) required');
        }

        // Add the upgraded configuration dynamically
        ProjectTools.addConfiguration(upgradedConfig);

        // Return success with updated project info
        const sections: string[] = [];
        sections.push(`✅ **Project Upgraded Successfully**`);
        sections.push('');
        sections.push(`**${project.name}**`);
        sections.push(`Previous Type: Unknown (Paths Only)`);
        sections.push(`New Type: ${upgradedConfig.isSelfHosted ? 'Self-Hosted Azure' : 'DXP PaaS'}`);
        sections.push(`Project ID: ${upgradedConfig.projectId}`);

        if (upgradedConfig.isSelfHosted) {
            sections.push(`Connection String: ✅ Configured`);
        } else {
            sections.push(`API Key: ✅ Configured`);
            sections.push(`API Secret: ✅ Configured`);
        }

        if (project.blobPath) sections.push(`Blob Path: ${project.blobPath}`);
        if (project.logPath) sections.push(`Log Path: ${project.logPath}`);

        sections.push('');
        sections.push('💡 The project is now ready to use with full functionality!');

        return ResponseBuilder.success(sections.join('\n'));
    }

    /**
     * Handle inline credentials in any command
     * This should be called by tools when they detect an Unknown project with inline credentials
     */
    static handleInlineCredentials(project: any, args: any): any | null {
        // Check if inline credentials were provided for an Unknown project
        if (!project.isUnknown) {
            return null; // Not an unknown project, no upgrade needed
        }

        const { connectionString, apiKey, apiSecret } = args;

        if (connectionString || (apiKey && apiSecret)) {
            // Upgrade the project inline
            const upgradeArgs: UpgradeArgs = {
                projectName: project.name,
                connectionString,
                apiKey,
                apiSecret,
                projectId: args.projectId || project.projectId
            };

            return this.upgradeProject(upgradeArgs);
        }

        return null; // No inline credentials provided
    }
}

export default ProjectUpgrade;

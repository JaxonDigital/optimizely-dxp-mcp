/**
 * Project Switch Tool - Explicit project switching for Claude Desktop
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const ProjectTools = require('./project-tools');
const ResponseBuilder = require('../response-builder');

class ProjectSwitchTool {
    /**
     * Switch to a specific project
     */
    static async handleSwitchProject(args) {
        const { projectName } = args;
        
        if (!projectName) {
            return ResponseBuilder.error(
                '❌ Project name is required',
                'switch-project',
                { error: 'Missing projectName parameter' }
            );
        }
        
        // Attempt to switch project
        const result = ProjectTools.switchProject(projectName);
        
        if (!result.success) {
            // Get available projects for helpful error message
            const projects = ProjectTools.getConfiguredProjects();
            const projectNames = projects.map(p => p.name).filter(Boolean);
            
            return ResponseBuilder.error(
                `❌ Project "${projectName}" not found.\n\nAvailable projects:\n${projectNames.map(n => `  • ${n}`).join('\n')}\n\n💡 Tip: Project names are case-insensitive`,
                'switch-project',
                { 
                    requestedProject: projectName,
                    availableProjects: projectNames 
                }
            );
        }
        
        // Set as last used project for session persistence
        ProjectTools.setLastUsedProject(projectName);
        
        // Get project details for confirmation
        const project = result.project;
        
        return ResponseBuilder.success(
            `✅ **Switched to ${project.name}**\n\n` +
            `**Project Details**:\n` +
            `• Project ID: ${project.projectId}\n` +
            `• Environments: ${project.environments.join(', ')}\n` +
            `• Status: Active\n\n` +
            `📌 All subsequent commands will use this project until you switch again.\n\n` +
            `💡 **Tip**: You can also include the project name in any command:\n` +
            `   Example: \`list_deployments --project "${project.name}"\``,
            'switch-project',
            {
                projectName: project.name,
                projectId: project.projectId,
                isDefault: project.isDefault || false
            }
        );
    }
    
    /**
     * Get current active project
     */
    static async handleGetCurrentProject(args) {
        // Check for last used project first
        const lastUsed = process.env.MCP_LAST_USED_PROJECT;
        let currentProject = null;
        
        if (lastUsed) {
            const result = ProjectTools.switchProject(lastUsed);
            if (result.success) {
                currentProject = result.project;
            }
        }
        
        // Fall back to default project
        if (!currentProject) {
            currentProject = ProjectTools.getCurrentProject();
        }
        
        if (!currentProject) {
            return ResponseBuilder.error(
                '❌ No active project. Use `switch_project` to select a project.',
                'current-project',
                {}
            );
        }
        
        return ResponseBuilder.success(
            `📌 **Current Project: ${currentProject.name}**\n\n` +
            `• Project ID: ${currentProject.projectId}\n` +
            `• Environments: ${currentProject.environments.join(', ')}\n` +
            `${currentProject.isDefault ? '• Default: Yes ⭐\n' : ''}\n` +
            `💡 Use \`switch_project\` to change projects`,
            'current-project',
            {
                projectName: currentProject.name,
                projectId: currentProject.projectId,
                isDefault: currentProject.isDefault || false
            }
        );
    }
}

module.exports = ProjectSwitchTool;
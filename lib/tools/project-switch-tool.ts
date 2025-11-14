/**
 * Project Switch Tool - Explicit project switching for Claude Desktop
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import ProjectTools from './project-tools';
import ResponseBuilder from '../response-builder';

/**
 * Similarity suggestion
 */
interface SimilaritySuggestion {
    name: string;
    score: number;
}

/**
 * Project switch arguments
 */
interface ProjectSwitchArgs {
    projectName?: string;
}

class ProjectSwitchTool {
    /**
     * Find project names similar to the input (DXP-36)
     */
    static findSimilarProjectNames(input: string, projectNames: string[], maxSuggestions: number = 3): string[] {
        if (!input || !projectNames || projectNames.length === 0) {
            return [];
        }

        const inputLower = input.toLowerCase();
        const suggestions: SimilaritySuggestion[] = [];

        for (const name of projectNames) {
            const nameLower = name.toLowerCase();
            let score = 0;

            // Exact match (shouldn't happen, but just in case)
            if (nameLower === inputLower) {
                continue;
            }

            // Starts with input
            if (nameLower.startsWith(inputLower)) {
                score = 90;
            }
            // Contains input
            else if (nameLower.includes(inputLower)) {
                score = 70;
            }
            // Input contains project name (partial)
            else if (inputLower.includes(nameLower)) {
                score = 60;
            }
            // Check if input is close to start of project name (abbreviation-like)
            else if (inputLower.length <= 4 && nameLower.length >= inputLower.length) {
                // Check if most characters of input match start of name
                let matches = 0;
                for (let i = 0; i < Math.min(inputLower.length, nameLower.length); i++) {
                    if (inputLower[i] === nameLower[i]) {
                        matches++;
                    }
                }
                if (matches >= inputLower.length - 1) { // Allow 1 mismatch
                    score = 50;
                }
            }
            // Levenshtein-like simple distance
            else {
                const distance = this.simpleEditDistance(inputLower, nameLower);
                const maxLen = Math.max(inputLower.length, nameLower.length);
                const similarity = Math.max(0, (maxLen - distance) / maxLen);

                // Be more lenient with shorter inputs - they often are abbreviations
                const threshold = inputLower.length <= 4 ? 0.4 : 0.5;

                if (similarity > threshold) {
                    score = Math.floor(similarity * 50);
                }
            }

            if (score > 0) {
                suggestions.push({ name, score });
            }
        }

        // Sort by score (highest first) and return top suggestions
        return suggestions
            .sort((a, b) => b.score - a.score)
            .slice(0, maxSuggestions)
            .map(s => s.name);
    }

    /**
     * Simple edit distance calculation for fuzzy matching (DXP-36)
     */
    static simpleEditDistance(str1: string, str2: string): number {
        const len1 = str1.length;
        const len2 = str2.length;

        // Create matrix
        const matrix: number[][] = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

        // Initialize first row and column
        for (let i = 0; i <= len1; i++) matrix[i][0] = i;
        for (let j = 0; j <= len2; j++) matrix[0][j] = j;

        // Fill matrix
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,     // deletion
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j - 1] + cost // substitution
                );
            }
        }

        return matrix[len1][len2];
    }
    /**
     * Switch to a specific project
     */
    static async handleSwitchProject(args: ProjectSwitchArgs): Promise<any> {
        const { projectName } = args;

        if (!projectName) {
            return ResponseBuilder.error(
                '❌ Project name is required',
                { error: 'Missing projectName parameter' }
            );
        }

        try {
            // DXP-36: Improved error handling for project switching

            // First, try to get available projects with error handling
            let projects;
            try {
                projects = ProjectTools.getConfiguredProjects();
            } catch (configError: any) {
                return ResponseBuilder.error(
                    '❌ **Configuration Error**\n\n' +
                    'Unable to load project configurations. This might be due to:\n' +
                    '• Malformed environment variables\n' +
                    '• Invalid project configuration format\n' +
                    '• Missing required configuration fields\n\n' +
                    `**Error details**: ${configError.message}\n\n` +
                    '💡 **Next steps**:\n' +
                    '1. Check your environment variables for proper format\n' +
                    '2. Use `list_projects` to see current configuration status\n' +
                    '3. Refer to setup documentation for correct format',
                    {
                        error: 'Configuration load failed',
                        details: configError.message,
                        requestedProject: projectName
                    }
                );
            }

            if (!projects || projects.length === 0) {
                return ResponseBuilder.error(
                    '❌ **No Projects Configured**\n\n' +
                    'No projects are currently configured in your environment.\n\n' +
                    '💡 **To configure a project**, add an environment variable like:\n' +
                    '```\n' +
                    'MYPROJECT="id=your-project-id;key=your-api-key;secret=your-secret"\n' +
                    '```\n\n' +
                    'Or see the setup guide for detailed instructions.',
                    {
                        error: 'No projects configured',
                        requestedProject: projectName,
                        availableProjects: []
                    }
                );
            }

            // Attempt to switch project
            const result = ProjectTools.switchProject(projectName);

            if (!result.success) {
                // DXP-36: Enhanced error message with fuzzy matching and better suggestions
                const projectNames = projects.map((p: any) => p.name).filter(Boolean);

                // Find closest matches using simple string similarity
                const closeMatches = this.findSimilarProjectNames(projectName, projectNames);

                let errorMessage = `❌ **Project "${projectName}" not found**\n\n`;

                if (closeMatches.length > 0) {
                    errorMessage += `🔍 **Did you mean?**\n${closeMatches.map(name => `  • ${name}`).join('\n')}\n\n`;
                }

                errorMessage += `📋 **Available projects** (${projectNames.length}):\n`;
                if (projectNames.length <= 10) {
                    errorMessage += `${projectNames.map((n: string) => `  • ${n}`).join('\n')}\n\n`;
                } else {
                    errorMessage += `${projectNames.slice(0, 8).map((n: string) => `  • ${n}`).join('\n')}\n  • ... and ${projectNames.length - 8} more\n\n`;
                    errorMessage += `💡 Use \`list_projects\` to see all projects\n\n`;
                }

                errorMessage += `💡 **Tips**:\n`;
                errorMessage += `• Project names are case-insensitive\n`;
                errorMessage += `• You can use partial names if unique\n`;
                errorMessage += `• Check for typos in the project name`;

                return ResponseBuilder.error(
                    errorMessage,
                    {
                        requestedProject: projectName,
                        availableProjects: projectNames,
                        suggestions: closeMatches,
                        totalProjects: projectNames.length
                    }
                );
            }

            // Success! Set as last used project for session persistence
            ProjectTools.setLastUsedProject(projectName);

            // Get project details for confirmation
            const project = result.project!;

            return ResponseBuilder.successWithStructuredData(
                {
                    projectName: project.name,
                    projectId: project.projectId,
                    isDefault: project.isDefault || false
                },
                `✅ **Switched to ${project.name}**\n\n` +
                `**Project Details**:\n` +
                `• Project ID: ${project.projectId}\n` +
                `• Environments: ${project.environments!.join(', ')}\n` +
                `• Status: Active\n\n` +
                `📌 All subsequent commands will use this project until you switch again.\n\n` +
                `💡 **Tip**: You can also include the project name in any command:\n` +
                `   Example: \`list_deployments --project "${project.name}"\``
            );

        } catch (switchError: any) {
            // DXP-36: Handle unexpected errors during project switching
            return ResponseBuilder.error(
                '❌ **Unexpected Error During Project Switch**\n\n' +
                `An unexpected error occurred while switching to project "${projectName}".\n\n` +
                `**Error details**: ${switchError.message}\n\n` +
                '💡 **Troubleshooting**:\n' +
                '1. Check if the project configuration is valid\n' +
                '2. Verify environment variables are properly set\n' +
                '3. Try switching to a different project first\n' +
                '4. Contact support if the issue persists',
                {
                    error: 'Unexpected switch error',
                    details: switchError.message,
                    requestedProject: projectName
                }
            );
        }
    }

    /**
     * Get current active project
     */
    static async handleGetCurrentProject(_args: any = {}): Promise<any> {
        try {
            // DXP-36: Improved error handling for getting current project

            let currentProject: any = null;

            // Check for last used project first
            const lastUsed = process.env.MCP_LAST_USED_PROJECT;

            if (lastUsed) {
                try {
                    const result = ProjectTools.switchProject(lastUsed);
                    if (result.success) {
                        currentProject = result.project;
                    }
                } catch (lastUsedError: any) {
                    // Last used project might be corrupted, continue to fallback
                    if (process.env.DEBUG) {
                        console.error('Error accessing last used project:', lastUsedError.message);
                    }
                }
            }

            // Fall back to default project
            if (!currentProject) {
                try {
                    currentProject = ProjectTools.getCurrentProject();
                } catch (getCurrentError: any) {
                    return ResponseBuilder.error(
                        '❌ **Configuration Error**\n\n' +
                        'Unable to determine current project due to configuration issues.\n\n' +
                        `**Error details**: ${getCurrentError.message}\n\n` +
                        '💡 **Next steps**:\n' +
                        '1. Check your project configuration\n' +
                        '2. Use `list_projects` to see available projects\n' +
                        '3. Use `switch_project` to select a valid project',
                        {
                            error: 'Configuration error',
                            details: getCurrentError.message
                        }
                    );
                }
            }

            if (!currentProject) {
                // DXP-36: More helpful message when no project is active
                let projects;
                try {
                    projects = ProjectTools.getConfiguredProjects();
                } catch (configError: any) {
                    return ResponseBuilder.error(
                        '❌ **No Active Project & Configuration Error**\n\n' +
                        'No project is currently active and there are configuration issues.\n\n' +
                        `**Configuration error**: ${configError.message}\n\n` +
                        '💡 **Next steps**:\n' +
                        '1. Fix your project configuration\n' +
                        '2. Add a valid project environment variable\n' +
                        '3. Refer to setup documentation',
                        {
                            error: 'No active project and config error',
                            details: configError.message
                        }
                    );
                }

                const projectNames = projects.map((p: any) => p.name).filter(Boolean);

                if (projectNames.length === 0) {
                    return ResponseBuilder.error(
                        '❌ **No Projects Configured**\n\n' +
                        'No projects are configured in your environment.\n\n' +
                        '💡 **To configure a project**, add an environment variable like:\n' +
                        '```\n' +
                        'MYPROJECT="id=your-project-id;key=your-api-key;secret=your-secret"\n' +
                        '```\n\n' +
                        'Then use `switch_project MYPROJECT` to activate it.',
                        {
                            error: 'No projects configured',
                            availableProjects: []
                        }
                    );
                } else {
                    return ResponseBuilder.error(
                        `❌ **No Active Project**\n\n` +
                        `${projectNames.length} project(s) are configured but none is currently active.\n\n` +
                        `**Available projects**:\n${projectNames.map((n: string) => `  • ${n}`).join('\n')}\n\n` +
                        `💡 Use \`switch_project <name>\` to activate a project.`,
                        {
                            error: 'No active project',
                            availableProjects: projectNames
                        }
                    );
                }
            }

            return ResponseBuilder.successWithStructuredData(
                {
                    projectName: currentProject.name,
                    projectId: currentProject.projectId,
                    isDefault: currentProject.isDefault || false,
                    source: lastUsed === currentProject.name ? 'last_used' : 'default'
                },
                `📌 **Current Project: ${currentProject.name}**\n\n` +
                `• Project ID: ${currentProject.projectId}\n` +
                `• Environments: ${currentProject.environments.join(', ')}\n` +
                `${currentProject.isDefault ? '• Default: Yes ⭐\n' : ''}\n` +
                `${lastUsed === currentProject.name ? '• Source: Last used project\n' : ''}\n` +
                `💡 Use \`switch_project\` to change projects`
            );

        } catch (unexpectedError: any) {
            // DXP-36: Handle any unexpected errors
            return ResponseBuilder.error(
                '❌ **Unexpected Error**\n\n' +
                'An unexpected error occurred while getting the current project.\n\n' +
                `**Error details**: ${unexpectedError.message}\n\n` +
                '💡 **Troubleshooting**:\n' +
                '1. Check your project configuration\n' +
                '2. Try restarting the MCP server\n' +
                '3. Contact support if the issue persists',
                {
                    error: 'Unexpected error',
                    details: unexpectedError.message
                }
            );
        }
    }
}

export default ProjectSwitchTool;

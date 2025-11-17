/**
 * Project Resolution Fix
 * Fixes critical bug where wrong project's data is accessed
 * Part of DXP-4: Multiple project resolution issues
 */

import OutputLogger from '../output-logger';
import ResponseBuilder from '../response-builder';

/**
 * Project credentials
 */
export interface ProjectCredentials {
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
    connectionString?: string;
    isSelfHosted?: boolean;
}

/**
 * Project information
 */
export interface ProjectInfo {
    name: string;
    projectId?: string;
    apiKey?: string;
    apiSecret?: string;
    connectionString?: string;
    isSelfHosted?: boolean;
    logPath?: string;
    blobPath?: string;
    dbPath?: string;
}

/**
 * Project resolution result
 */
export interface ResolutionResult {
    success: boolean;
    credentials?: ProjectCredentials;
    project?: ProjectInfo;
    source?: string;
    message?: string;
    suggestion?: string;
    requiresSelection?: boolean;
    availableProjects?: ProjectListItem[];
}

/**
 * Simplified project info for selection
 */
export interface ProjectListItem {
    name: string;
    projectId: string;
}

/**
 * Parsed environment variable parameters
 */
interface ParsedParams {
    id?: string;
    key?: string;
    secret?: string;
    logPath?: string;
    blobPath?: string;
    dbPath?: string;
    [key: string]: string | undefined;
}

/**
 * Project resolution arguments
 */
interface ProjectResolutionArgs {
    project?: string;
    projectName?: string;
    projectId?: string;
    apiKey?: string;
    apiSecret?: string;
    connectionString?: string;
    isSelfHosted?: boolean;
}

/**
 * ProjectTools interface (minimal - only methods we use)
 */
interface ProjectTools {
    switchProject(projectIdentifier: string): { success: boolean; project?: ProjectInfo; credentials?: ProjectCredentials };
    getConfiguredProjects(): ProjectInfo[];
}

class ProjectResolutionFix {
    /**
     * Enhanced project resolution that prevents wrong project selection
     * NEVER silently defaults to the wrong project
     */
    static resolveProjectSafely(args: ProjectResolutionArgs, ProjectTools: ProjectTools): ResolutionResult {
        const { project, projectName, projectId, apiKey, apiSecret, connectionString, isSelfHosted } = args;

        // ENHANCED DEBUG: Log all environment variables that look like project configs
        if (process.env.DEBUG === 'true') {
            console.error('[PROJECT-DEBUG] Environment variables with project format:');
            const relevantEnvVars = Object.keys(process.env).filter(key => {
                const value = process.env[key];
                return value && typeof value === 'string' &&
                       (value.includes('id=') && value.includes('key=') && value.includes('secret='));
            });
            console.error(`[PROJECT-DEBUG] Found ${relevantEnvVars.length} relevant env vars:`, relevantEnvVars);

            // Show first relevant env var specifically (e.g. ACME, FABRIKAM, etc.)
            if (relevantEnvVars.length > 0) {
                const firstEnvVar = relevantEnvVars[0];
                const envValue = process.env[firstEnvVar];
                console.error(`[PROJECT-DEBUG] ${firstEnvVar} env var exists, contains:`);
                console.error('  - id=:', envValue!.includes('id='));
                console.error('  - key=:', envValue!.includes('key='));
                console.error('  - secret=:', envValue!.includes('secret='));
                console.error('  - logPath=:', envValue!.includes('logPath='));
            } else {
                console.error('[PROJECT-DEBUG] No project env vars found in process.env');
            }
        }

        // 1. If this is a self-hosted project with connection string, use it directly
        if (isSelfHosted || connectionString) {
            return {
                success: true,
                project: {
                    name: projectName || args.project || 'self-hosted',
                    connectionString: connectionString,
                    isSelfHosted: true
                },
                credentials: {
                    connectionString: connectionString,
                    isSelfHosted: true
                },
                source: 'self_hosted'
            };
        }

        // 2. If full credentials provided, use them directly
        if (apiKey && apiSecret && projectId) {
            return {
                success: true,
                credentials: { apiKey, apiSecret, projectId },
                source: 'direct_credentials'
            };
        }

        // 2. If project explicitly specified, use it
        const requestedProject = project || projectName || projectId;
        if (requestedProject) {
            const result = ProjectTools.switchProject(requestedProject);
            if (result.success) {
                OutputLogger.info(`✅ Using explicitly requested project: ${result.project!.name}`);
                return {
                    success: true,
                    credentials: result.credentials,
                    project: result.project,
                    source: 'explicit_request'
                };
            }
            return {
                success: false,
                message: `Project '${requestedProject}' not found`,
                suggestion: 'Available projects: ' + ProjectTools.getConfiguredProjects().map(p => p.name).join(', ')
            };
        }

        // 3. Check how many projects are configured
        const projects = ProjectTools.getConfiguredProjects();

        // ENHANCED DEBUG: Log project resolution details
        if (process.env.DEBUG === 'true') {
            console.error(`[PROJECT-DEBUG] getConfiguredProjects() returned ${projects.length} projects`);
            projects.forEach((p, i) => {
                console.error(`[PROJECT-DEBUG] Project ${i + 1}: name="${p.name}", id="${p.projectId ? p.projectId.substring(0, 8) + '...' : 'none'}", hasLogPath=${!!p.logPath}`);
                if (p.logPath) {
                    console.error(`[PROJECT-DEBUG]   logPath: ${p.logPath}`);
                }
            });
        }

        if (projects.length === 0) {
            // CRITICAL FIX: Check for any individual environment variables that look like projects
            // This handles the case where ProjectTools.getConfiguredProjects() fails to parse them
            const envProjectNames = Object.keys(process.env).filter(key => {
                const value = process.env[key];
                return value && typeof value === 'string' &&
                       value.includes('id=') && value.includes('key=') && value.includes('secret=');
            });

            if (envProjectNames.length === 1) {
                // Found exactly one project in environment - create a minimal project object
                const envName = envProjectNames[0];
                const envValue = process.env[envName]!;

                // Parse the environment variable manually
                const params: ParsedParams = {};
                const parts = envValue.split(';').filter(p => p.trim());
                parts.forEach(param => {
                    const equalIndex = param.indexOf('=');
                    if (equalIndex !== -1) {
                        const key = param.substring(0, equalIndex).trim();
                        const value = param.substring(equalIndex + 1).trim();
                        if (key && value) {
                            params[key] = value;
                        }
                    }
                });

                // Create a project object directly
                const fallbackProject: ProjectInfo = {
                    name: envName,
                    projectId: params.id,
                    apiKey: params.key,
                    apiSecret: params.secret,
                    logPath: params.logPath,
                    blobPath: params.blobPath,
                    dbPath: params.dbPath
                };

                OutputLogger.info(`✅ Using fallback single project: ${envName}`);
                OutputLogger.info(`📁 Project logPath: ${params.logPath || 'not configured'}`);
                return {
                    success: true,
                    credentials: {
                        apiKey: params.key,
                        apiSecret: params.secret,
                        projectId: params.id
                    },
                    project: fallbackProject,
                    source: 'fallback_single_env'
                };
            }

            return {
                success: false,
                message: 'No projects configured',
                suggestion: 'Configure project credentials in environment variables'
            };
        }

        if (projects.length === 1) {
            // Only one project, safe to use it
            const project = projects[0];
            OutputLogger.info(`✅ Using only configured project: ${project.name}`);
            OutputLogger.info(`🔍 Project details: ID=${project.projectId?.substring(0,8)}..., logPath=${project.logPath || 'NOT SET'}`);
            return {
                success: true,
                credentials: {
                    apiKey: project.apiKey,
                    apiSecret: project.apiSecret,
                    projectId: project.projectId
                },
                project: project,
                source: 'single_project'
            };
        }

        // 4. Multiple projects - REQUIRE explicit selection
        // This is the critical fix - we NEVER silently choose the wrong project
        return {
            success: false,
            requiresSelection: true,
            availableProjects: projects.map(p => ({
                name: p.name,
                projectId: p.projectId ? p.projectId.substring(0, 8) + '...' : 'unknown'
            })),
            message: `Multiple projects configured. Please specify which project to use.`,
            suggestion: `Use --project parameter with one of: ${projects.map(p => p.name).join(', ')}`
        };
    }

    /**
     * Show project selection menu when multiple projects exist
     */
    static showProjectSelection(projects: ProjectInfo[]): any {
        let message = '🏢 **Multiple Projects Available**\n\n';
        message += 'Please specify which project to use:\n\n';

        projects.forEach((project, index) => {
            message += `${index + 1}. **${project.name}**\n`;
            if (project.projectId) {
                message += `   ID: ${project.projectId.substring(0, 8)}...\n`;
            }
        });

        message += '\n**How to specify a project:**\n';
        message += '• Add `--project ProjectName` to your command\n';
        message += '• Example: `download-logs --project ACME_CORP --environment Production`\n';

        return ResponseBuilder.error(message);
    }

    /**
     * Validate that operations are using the correct project
     */
    static validateProjectMatch(requestedProject: string | undefined, actualProject: ProjectInfo | undefined): boolean {
        if (!requestedProject || !actualProject) {
            return true; // No validation needed if not specified
        }

        const requested = requestedProject.toLowerCase();
        const actual = actualProject.name ? actualProject.name.toLowerCase() : '';
        const actualId = actualProject.projectId ? actualProject.projectId.toLowerCase() : '';

        if (actual.includes(requested) || actualId.includes(requested)) {
            return true;
        }

        OutputLogger.warn(`⚠️ Project mismatch detected!`);
        OutputLogger.warn(`  Requested: ${requestedProject}`);
        OutputLogger.warn(`  Using: ${actualProject.name || actualProject.projectId}`);

        return false;
    }

    /**
     * Add project confirmation to download operations
     */
    static addProjectConfirmation(message: string, project: ProjectInfo | undefined): string {
        if (!project) return message;

        const projectInfo = `\n📋 **Project**: ${project.name || 'Unknown'}`;

        // Insert project info at the beginning of the message
        if (message.includes('**')) {
            // Find first section and add after it
            const lines = message.split('\n');
            lines.splice(1, 0, projectInfo);
            return lines.join('\n');
        }

        return projectInfo + '\n' + message;
    }
}

export default ProjectResolutionFix;

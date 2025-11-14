/**
 * Deployment Validator Module
 * Handles edge cases and validation for deployment operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

// import ENVIRONMENTS - unused

// Type definitions
interface DeploymentWarning {
    level: 'low' | 'medium' | 'high' | 'info';
    message: string;
    suggestion: string;
}

interface PathValidationResult {
    valid: boolean;
    error?: string;
    suggestion?: string;
    warnings?: DeploymentWarning[];
    isUpward?: boolean;
    isDownward?: boolean;
}

interface Deployment {
    id?: string;
    status?: string;
    Status?: string;
    startTime?: string;
    targetEnvironment?: string;
    parameters?: {
        targetEnvironment?: string;
        [key: string]: any;
    };
    [key: string]: any;
}

interface StateValidationResult {
    valid: boolean;
    error?: string;
    currentState?: string;
    allowedStates?: string[];
    suggestion?: string;
    warnings?: DeploymentWarning[];
}

interface DeploymentParams {
    sourceApps?: string[] | any;
    deploymentType?: string;
    includeBlob?: any;
    includeDatabase?: any;
    directDeploy?: any;
    useMaintenancePage?: any;
    sourceEnvironment?: string;
    targetEnvironment?: string;
    [key: string]: any;
}

interface ParamsValidationResult {
    valid: boolean;
    errors: string[];
    warnings: DeploymentWarning[];
    sanitized: any;
}

interface ActiveDeploymentInfo {
    id: any;
    status: string;
    startTime: any;
}

interface ConcurrentCheck {
    canProceed: boolean;
    error?: string;
    activeDeployment?: ActiveDeploymentInfo;
    suggestion?: string;
}

interface TimingOptions {
    targetEnvironment?: string;
}

interface TimingValidation {
    valid: boolean;
    warnings: DeploymentWarning[];
    currentTime: string;
    isPeakHours: boolean;
    isWeekend: boolean;
}

class DeploymentValidator {
    /**
     * Validate deployment path (source -> target)
     */
    static validateDeploymentPath(sourceEnvironment: string, targetEnvironment: string): PathValidationResult {
        // Check for same environment
        if (sourceEnvironment === targetEnvironment) {
            return {
                valid: false,
                error: 'Source and target environments cannot be the same',
                suggestion: 'Choose different source and target environments'
            };
        }

        // Define valid deployment paths
        const validPaths: { [key: string]: string[] } = {
            'Integration': ['Preproduction'],
            'Preproduction': ['Production', 'Integration'],
            'Production': ['Preproduction', 'Integration']
        };

        // Check if path is valid
        const allowedTargets = validPaths[sourceEnvironment];
        if (!allowedTargets || !allowedTargets.includes(targetEnvironment)) {
            return {
                valid: false,
                error: `Invalid deployment path: ${sourceEnvironment} → ${targetEnvironment}`,
                suggestion: `Valid paths from ${sourceEnvironment}: ${allowedTargets ? allowedTargets.join(', ') : 'None'}`
            };
        }

        // Add warnings for specific paths
        const warnings = this.getPathWarnings(sourceEnvironment, targetEnvironment);

        return {
            valid: true,
            warnings,
            isUpward: this.isUpwardDeployment(sourceEnvironment, targetEnvironment),
            isDownward: this.isDownwardDeployment(sourceEnvironment, targetEnvironment)
        };
    }

    /**
     * Check if deployment is upward (toward production)
     */
    static isUpwardDeployment(source: string, target: string): boolean {
        return (source === 'Integration' && target === 'Preproduction') ||
               (source === 'Preproduction' && target === 'Production');
    }

    /**
     * Check if deployment is downward (from production)
     */
    static isDownwardDeployment(source: string, target: string): boolean {
        return (source === 'Production') ||
               (source === 'Preproduction' && target === 'Integration');
    }

    /**
     * Get warnings for specific deployment paths
     */
    static getPathWarnings(source: string, target: string): DeploymentWarning[] {
        const warnings: DeploymentWarning[] = [];

        // Warn about production deployments
        if (target === 'Production') {
            warnings.push({
                level: 'high',
                message: '⚠️  Deploying to Production - ensure all tests have passed',
                suggestion: 'Consider using maintenance page during deployment'
            });
        }

        // Warn about content copy from production
        if (source === 'Production' && (target === 'Preproduction' || target === 'Integration')) {
            warnings.push({
                level: 'medium',
                message: '📋 This will copy content from Production',
                suggestion: 'Ensure you want to overwrite existing content in ' + target
            });
        }

        // Warn about integration to preproduction during business hours
        if (source === 'Integration' && target === 'Preproduction') {
            const hour = new Date().getHours();
            if (hour >= 9 && hour <= 17) {
                warnings.push({
                    level: 'low',
                    message: '🕐 Deploying during business hours',
                    suggestion: 'Consider scheduling for off-peak hours if this affects users'
                });
            }
        }

        return warnings;
    }

    /**
     * Validate deployment state for operations
     */
    static validateDeploymentState(deployment: Deployment | null, operation: string): StateValidationResult {
        if (!deployment) {
            return {
                valid: false,
                error: 'Deployment not found',
                suggestion: 'Check the deployment ID and try again'
            };
        }

        const validStates: { [key: string]: string[] } = {
            'complete': ['AwaitingVerification', 'Verification'],
            'reset': ['AwaitingVerification', 'Verification', 'Failed', 'Succeeded'],
            'status': ['*'] // Any state is valid for status check
        };

        const allowedStates = validStates[operation] || [];
        const currentState = deployment.status || deployment.Status;

        // Check if operation is allowed in current state
        if (!allowedStates.includes('*') && !allowedStates.includes(currentState!)) {
            return {
                valid: false,
                error: `Cannot ${operation} deployment in ${currentState} state`,
                currentState,
                allowedStates,
                suggestion: this.getStateSuggestion(currentState!, operation)
            };
        }

        // Add warnings for specific states
        const warnings = this.getStateWarnings(currentState!, operation);

        return {
            valid: true,
            currentState,
            warnings
        };
    }

    /**
     * Get suggestion for invalid state
     */
    static getStateSuggestion(state: string, operation: string): string {
        const suggestions: { [key: string]: string } = {
            'Succeeded': 'Deployment already completed successfully',
            'Failed': 'Use reset to retry this deployment',
            'InProgress': 'Wait for deployment to reach verification state',
            'Running': 'Deployment is still running, please wait',
            'Stopped': 'Deployment was stopped, use reset to retry'
        };

        return suggestions[state] || `Current state (${state}) doesn't allow ${operation}`;
    }

    /**
     * Get warnings for specific states
     */
    static getStateWarnings(state: string, operation: string): DeploymentWarning[] {
        const warnings: DeploymentWarning[] = [];

        if (state === 'AwaitingVerification' && operation === 'complete') {
            warnings.push({
                level: 'high',
                message: '🔍 Ensure you have verified the deployment before completing',
                suggestion: 'Test the deployment in the target environment first'
            });
        }

        if (state === 'Succeeded' && operation === 'reset') {
            warnings.push({
                level: 'medium',
                message: '♻️ Resetting a successful deployment',
                suggestion: 'This will rollback the changes - ensure this is intended'
            });
        }

        return warnings;
    }

    /**
     * Validate deployment parameters
     */
    static validateDeploymentParams(params: DeploymentParams): ParamsValidationResult {
        const errors: string[] = [];
        const warnings: DeploymentWarning[] = [];
        const sanitized: any = { ...params };

        // Validate source apps for code deployment
        if (params.sourceApps) {
            if (!Array.isArray(params.sourceApps)) {
                errors.push('sourceApps must be an array');
            } else if (params.sourceApps.length === 0) {
                errors.push('sourceApps cannot be empty');
            } else {
                // Validate app names
                const validApps = ['cms', 'commerce', 'customapp'];
                const invalidApps = params.sourceApps.filter(app =>
                    !validApps.includes(app.toLowerCase())
                );

                if (invalidApps.length > 0) {
                    warnings.push({
                        level: 'low',
                        message: `Unknown apps: ${invalidApps.join(', ')}`,
                        suggestion: 'Valid apps are: cms, commerce, customapp'
                    });
                }

                // Normalize to lowercase
                sanitized.sourceApps = params.sourceApps.map((app: string) => app.toLowerCase());
            }
        }

        // Validate deployment type
        if (params.deploymentType) {
            const validTypes = ['code', 'content', 'all'];
            if (!validTypes.includes(params.deploymentType)) {
                errors.push(`Invalid deploymentType: ${params.deploymentType}. Must be one of: ${validTypes.join(', ')}`);
            }
        }

        // Validate boolean flags
        const booleanFlags = ['includeBlob', 'includeDatabase', 'directDeploy', 'useMaintenancePage'];
        booleanFlags.forEach(flag => {
            if (params[flag] !== undefined && typeof params[flag] !== 'boolean') {
                warnings.push({
                    level: 'low',
                    message: `${flag} should be boolean, got ${typeof params[flag]}`,
                    suggestion: `Converting to boolean`
                });
                sanitized[flag] = Boolean(params[flag]);
            }
        });

        // Check for conflicting parameters
        if (params.deploymentType === 'code' && (params.includeBlob || params.includeDatabase)) {
            warnings.push({
                level: 'medium',
                message: 'Code deployment with content flags',
                suggestion: 'includeBlob/includeDatabase are ignored for code-only deployments'
            });
            delete sanitized.includeBlob;
            delete sanitized.includeDatabase;
        }

        // Add smart defaults based on deployment direction
        if (!params.deploymentType && params.sourceEnvironment && params.targetEnvironment) {
            const isUpward = this.isUpwardDeployment(params.sourceEnvironment, params.targetEnvironment);
            if (isUpward) {
                sanitized.deploymentType = sanitized.deploymentType || 'code';
                warnings.push({
                    level: 'info',
                    message: `Defaulting to code deployment for upward path`,
                    suggestion: 'Override with deploymentType parameter if needed'
                });
            } else {
                sanitized.deploymentType = sanitized.deploymentType || 'content';
                warnings.push({
                    level: 'info',
                    message: `Defaulting to content deployment for downward path`,
                    suggestion: 'Override with deploymentType parameter if needed'
                });
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            sanitized
        };
    }

    /**
     * Check for concurrent deployments
     */
    static checkConcurrentDeployments(deployments: Deployment[] | null, targetEnvironment: string): ConcurrentCheck {
        if (!deployments || !Array.isArray(deployments)) {
            return { canProceed: true };
        }

        // Check for active deployments to the same environment
        const activeStates = ['InProgress', 'Running', 'AwaitingVerification', 'Verification'];
        const activeDeployments = deployments.filter(d =>
            activeStates.includes(d.status || d.Status || '') &&
            (d.targetEnvironment === targetEnvironment ||
             d.parameters?.targetEnvironment === targetEnvironment)
        );

        if (activeDeployments.length > 0) {
            const deployment = activeDeployments[0];
            return {
                canProceed: false,
                error: `Another deployment is active for ${targetEnvironment}`,
                activeDeployment: {
                    id: deployment.id,
                    status: deployment.status || deployment.Status || '',
                    startTime: deployment.startTime
                },
                suggestion: 'Wait for the current deployment to complete or reset it first'
            };
        }

        return { canProceed: true };
    }

    /**
     * Validate deployment timing
     */
    static validateDeploymentTiming(options: TimingOptions = {}): TimingValidation {
        const warnings: DeploymentWarning[] = [];
        const now = new Date();
        const hour = now.getHours();
        const dayOfWeek = now.getDay();

        // Check for production deployment during peak hours
        if (options.targetEnvironment === 'Production') {
            // Peak hours (9 AM - 6 PM on weekdays)
            if (dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 9 && hour <= 18) {
                warnings.push({
                    level: 'high',
                    message: '⏰ Production deployment during peak business hours',
                    suggestion: 'Consider scheduling for off-peak hours (evenings or weekends)'
                });
            }

            // Friday afternoon warning
            if (dayOfWeek === 5 && hour >= 15) {
                warnings.push({
                    level: 'medium',
                    message: '📅 Friday afternoon production deployment',
                    suggestion: 'Ensure support is available in case of issues over the weekend'
                });
            }
        }

        return {
            valid: true,
            warnings,
            currentTime: now.toISOString(),
            isPeakHours: hour >= 9 && hour <= 18,
            isWeekend: dayOfWeek === 0 || dayOfWeek === 6
        };
    }
}

export default DeploymentValidator;

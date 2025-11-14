/**
 * Deployment Status Constants
 * Standardized deployment status values returned by DXP MCP tools
 *
 * These values come from the Optimizely DXP API via the EpiCloud PowerShell module.
 * They are case-sensitive and should be used exactly as defined here.
 *
 * Related: DXP-69 - Document standardized deployment status values
 * @see CLAUDE.md#deployment-status-values
 */

/** Standard deployment status values */
const DEPLOYMENT_STATUS = Object.freeze({
    /** Deployment is currently running */
    IN_PROGRESS: 'InProgress' as const,

    /** Deployment is ready for verification and can be completed */
    AWAITING_VERIFICATION: 'AwaitingVerification' as const,

    /** Deployment completed successfully */
    SUCCEEDED: 'Succeeded' as const,

    /** Deployment failed */
    FAILED: 'Failed' as const,

    /** Deployment was rolled back/reset */
    RESET: 'Reset' as const
});

/** Alternative status strings for backward compatibility */
const STATUS_ALIASES = Object.freeze({
    // Alternative names for verification state
    VERIFICATION: 'Verification' as const,
    VERIFYING: 'Verifying' as const,

    // Alternative names for completed state
    COMPLETED: 'Completed' as const,
    SUCCESS: 'Success' as const,

    // Alternative names for in-progress state
    DEPLOYING: 'Deploying' as const
});

/** Check if a status indicates the deployment is in progress */
function isInProgress(status: string): boolean {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('progress') ||
           lower.includes('deploying');
}

/** Check if a status indicates the deployment is awaiting verification */
function isAwaitingVerification(status: string): boolean {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('verification') ||
           lower.includes('verifying');
}

/** Check if a status indicates the deployment succeeded */
function isSucceeded(status: string): boolean {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('success') ||
           lower.includes('completed');
}

/** Check if a status indicates the deployment failed */
function isFailed(status: string): boolean {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('fail');
}

/** Check if a status indicates the deployment was reset */
function isReset(status: string): boolean {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('reset');
}

/** Check if a deployment can be completed based on its status */
function canComplete(status: string): boolean {
    return isAwaitingVerification(status);
}

export {
    DEPLOYMENT_STATUS,
    STATUS_ALIASES,
    isInProgress,
    isAwaitingVerification,
    isSucceeded,
    isFailed,
    isReset,
    canComplete
};

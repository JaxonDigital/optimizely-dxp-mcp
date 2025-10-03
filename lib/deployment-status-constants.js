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

/**
 * Standard deployment status values
 * @readonly
 * @enum {string}
 */
const DEPLOYMENT_STATUS = Object.freeze({
    /** Deployment is currently running */
    IN_PROGRESS: 'InProgress',

    /** Deployment is ready for verification and can be completed */
    AWAITING_VERIFICATION: 'AwaitingVerification',

    /** Deployment completed successfully */
    SUCCEEDED: 'Succeeded',

    /** Deployment failed */
    FAILED: 'Failed',

    /** Deployment was rolled back/reset */
    RESET: 'Reset'
});

/**
 * Alternative status strings that might be encountered
 * These are variations that we handle for backward compatibility
 * @readonly
 */
const STATUS_ALIASES = Object.freeze({
    // Alternative names for verification state
    VERIFICATION: 'Verification',
    VERIFYING: 'Verifying',

    // Alternative names for completed state
    COMPLETED: 'Completed',
    SUCCESS: 'Success',

    // Alternative names for in-progress state
    DEPLOYING: 'Deploying'
});

/**
 * Check if a status indicates the deployment is in progress
 * @param {string} status - The deployment status
 * @returns {boolean} True if deployment is running
 */
function isInProgress(status) {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('progress') ||
           lower.includes('deploying');
}

/**
 * Check if a status indicates the deployment is awaiting verification
 * @param {string} status - The deployment status
 * @returns {boolean} True if ready for verification
 */
function isAwaitingVerification(status) {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('verification') ||
           lower.includes('verifying');
}

/**
 * Check if a status indicates the deployment succeeded
 * @param {string} status - The deployment status
 * @returns {boolean} True if deployment succeeded
 */
function isSucceeded(status) {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('success') ||
           lower.includes('completed');
}

/**
 * Check if a status indicates the deployment failed
 * @param {string} status - The deployment status
 * @returns {boolean} True if deployment failed
 */
function isFailed(status) {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('fail');
}

/**
 * Check if a status indicates the deployment was reset
 * @param {string} status - The deployment status
 * @returns {boolean} True if deployment was reset
 */
function isReset(status) {
    if (!status) return false;
    const lower = status.toLowerCase();
    return lower.includes('reset');
}

/**
 * Check if a deployment can be completed based on its status
 * @param {string} status - The deployment status
 * @returns {boolean} True if the deployment can be completed
 */
function canComplete(status) {
    return isAwaitingVerification(status);
}

module.exports = {
    DEPLOYMENT_STATUS,
    STATUS_ALIASES,
    isInProgress,
    isAwaitingVerification,
    isSucceeded,
    isFailed,
    isReset,
    canComplete
};

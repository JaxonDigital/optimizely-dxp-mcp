/**
 * Deployment Tools Module Index
 * Aggregates all deployment operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const DeploymentListOperations = require('./deployment-list');
const DeploymentActionOperations = require('./deployment-actions');
const DeploymentFormatters = require('./deployment-formatters');

class DeploymentTools {
    // List operations
    static async handleListDeployments(args) {
        return DeploymentListOperations.handleListDeployments(args);
    }

    static async handleGetDeploymentStatus(args) {
        return DeploymentListOperations.handleGetDeploymentStatus(args);
    }

    // Action operations
    static async handleStartDeployment(args) {
        return DeploymentActionOperations.handleStartDeployment(args);
    }

    static async handleCompleteDeployment(args) {
        return DeploymentActionOperations.handleCompleteDeployment(args);
    }

    static async handleResetDeployment(args) {
        return DeploymentActionOperations.handleResetDeployment(args);
    }
}

module.exports = {
    DeploymentTools,
    DeploymentListOperations,
    DeploymentActionOperations,
    DeploymentFormatters
};
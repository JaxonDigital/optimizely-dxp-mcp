/**
 * Deployment Tools Module Index
 * Aggregates all deployment operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import DeploymentListOperations from './deployment-list';
import DeploymentActionOperations from './deployment-actions';
import DeploymentFormatters from './deployment-formatters';

class DeploymentTools {
    // List operations
    static async handleListDeployments(args: any): Promise<any> {
        return DeploymentListOperations.handleListDeployments(args);
    }

    static async handleGetDeploymentStatus(args: any): Promise<any> {
        return DeploymentListOperations.handleGetDeploymentStatus(args);
    }

    // Action operations
    static async handleStartDeployment(args: any): Promise<any> {
        return DeploymentActionOperations.handleStartDeployment(args);
    }

    static async handleCompleteDeployment(args: any): Promise<any> {
        return DeploymentActionOperations.handleCompleteDeployment(args);
    }

    static async handleResetDeployment(args: any): Promise<any> {
        return DeploymentActionOperations.handleResetDeployment(args);
    }

    static async handleMonitorDeployment(args: any): Promise<any> {
        return DeploymentActionOperations.handleMonitorDeployment(args);
    }
}

export {
    DeploymentTools,
    DeploymentListOperations,
    DeploymentActionOperations,
    DeploymentFormatters
};

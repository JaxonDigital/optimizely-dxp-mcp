/**
 * Deployment Workflow Prompts
 * Provides intelligent prompting for deployment operations and monitoring
 * Part of Jaxon Digital Optimizely DXP MCP Server
 *
 * This module provides MCP prompts to guide AI assistants through proper
 * deployment workflows, especially continuous monitoring patterns.
 */

import { PromptDefinition, PromptMessage } from './autonomous-deployment-prompts';

/**
 * Deployment workflow stage
 */
export type WorkflowStage = 'start' | 'monitoring' | 'verification' | 'completed' | 'error';

/**
 * Workflow prompt arguments
 */
export interface WorkflowPromptArgs {
    stage?: WorkflowStage;
    deploymentId?: string;
    sourceEnvironment?: string;
    targetEnvironment?: string;
}

class DeploymentWorkflowPrompts {
    /**
     * Get prompt definitions for deployment workflows
     */
    static getPromptDefinitions(): PromptDefinition[] {
        return [
            {
                name: 'deployment-workflow',
                description: 'Guide AI through deployment and monitoring workflow',
                arguments: [
                    {
                        name: 'stage',
                        description: 'Current stage: start, monitoring, verification, completed, error',
                        required: false
                    },
                    {
                        name: 'deploymentId',
                        description: 'Deployment ID for context-specific guidance',
                        required: false
                    },
                    {
                        name: 'sourceEnvironment',
                        description: 'Source environment for deployment',
                        required: false
                    },
                    {
                        name: 'targetEnvironment',
                        description: 'Target environment for deployment',
                        required: false
                    }
                ]
            }
        ];
    }

    /**
     * Get prompt messages for a specific workflow stage
     */
    static getPromptMessages(promptName: string, args: WorkflowPromptArgs = {}): PromptMessage[] {
        if (promptName !== 'deployment-workflow') {
            throw new Error(`Unknown prompt: ${promptName}`);
        }

        const {
            stage = 'start',
            deploymentId,
            sourceEnvironment = 'Preproduction',
            targetEnvironment = 'Production'
        } = args;

        switch (stage) {
            case 'start':
                return this.getStartPrompt(sourceEnvironment, targetEnvironment);
            case 'monitoring':
                return this.getMonitoringPrompt(deploymentId, targetEnvironment);
            case 'verification':
                return this.getVerificationPrompt(deploymentId, targetEnvironment);
            case 'completed':
                return this.getCompletedPrompt(deploymentId);
            case 'error':
                return this.getErrorPrompt(deploymentId);
            default:
                return this.getStartPrompt(sourceEnvironment, targetEnvironment);
        }
    }

    /**
     * Start stage - after deployment initiated
     */
    static getStartPrompt(sourceEnvironment: string, targetEnvironment: string): PromptMessage[] {
        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `I need to deploy from ${sourceEnvironment} to ${targetEnvironment}`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `I'll start the deployment from ${sourceEnvironment} to ${targetEnvironment}. Let me initiate this for you.

[After starting deployment]

✅ **Deployment Started Successfully!**

The deployment is now in progress. I have several monitoring options for you:

## 📊 **Monitoring Options:**

### Option 1: Continuous Monitoring (Recommended)
I'll use the \`monitor_deployment\` tool to automatically check the progress every 30 seconds and notify you of important status changes.

### Option 2: Manual Status Checks
You can check the status anytime by asking me, and I'll use \`get_deployment_status\`.

### Option 3: One-time Check
I'll check once now and you can ask me to check again whenever you'd like.

**Which monitoring approach would you prefer?**

💡 **Note:** I'll use the proper MCP monitoring tools instead of bash loops - this is more efficient and provides better progress tracking.`
                }
            }
        ];
    }

    /**
     * Monitoring stage - during deployment progress
     */
    static getMonitoringPrompt(deploymentId: string | undefined, targetEnvironment: string): PromptMessage[] {
        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: 'Yes, please monitor continuously'
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `Perfect! I'll set up continuous monitoring for your deployment using the \`monitor_deployment\` tool.

## 🔄 **Continuous Monitoring Active**

**Deployment ID:** ${deploymentId || '[deployment-id]'}
**Target:** ${targetEnvironment}
**Check Interval:** Every 30 seconds
**Max Duration:** 30 minutes

I'm now monitoring your deployment in the background. Here's what I'll do:

1. **Check progress** every 30 seconds automatically
2. **Alert you** when the deployment reaches key milestones:
   - 25% complete
   - 50% complete
   - 75% complete
   - Verification state (needs your review)
   - Completed

3. **Handle issues** - If any errors occur, I'll notify you immediately

**Current Status:** Checking now...

[Use \`monitor_deployment\` with deploymentId]

You can:
- Ask "what's the status?" anytime for an immediate update
- Say "stop monitoring" if you want to handle it manually
- The monitoring will automatically stop after 30 minutes or when deployment completes

I'll keep you updated on the progress! 🚀`
                }
            }
        ];
    }

    /**
     * Verification stage - when deployment needs verification
     */
    static getVerificationPrompt(deploymentId: string | undefined, targetEnvironment: string): PromptMessage[] {
        return [
            {
                role: 'system',
                content: {
                    type: 'text',
                    text: 'The deployment has reached verification state'
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `## ✅ **Deployment Ready for Verification!**

Your deployment to ${targetEnvironment} has completed the deployment phase and is now ready for your verification.

**Status:** Awaiting Verification (100% deployed)
**Deployment ID:** ${deploymentId || '[deployment-id]'}

### 🔍 **Verification Steps:**

1. **Review the changes** at the verification URLs
2. **Test critical functionality** to ensure everything works
3. **Check for any visual or functional issues**

### 📝 **Next Actions:**

Once you've verified everything looks good, you have two options:

- **Complete the deployment:** Say "complete deployment" or "looks good, complete it"
- **Rollback if issues found:** Say "rollback" or "reset deployment"

**Note:** The deployment will remain in verification state until you explicitly complete or reset it. There's no automatic timeout.

Have you had a chance to review the verification URLs? Let me know when you're ready to proceed!`
                }
            }
        ];
    }

    /**
     * Completed stage - deployment finished successfully
     */
    static getCompletedPrompt(deploymentId: string | undefined): PromptMessage[] {
        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: 'Complete the deployment'
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `## 🎉 **Deployment Completed Successfully!**

Your deployment has been finalized and is now live in production.

**Deployment ID:** ${deploymentId || '[deployment-id]'}
**Status:** Completed
**Monitoring:** Ended

### ✅ **What's Done:**
- Code successfully deployed to production
- Verification completed
- Changes are now live
- Monitoring has been stopped

### 📊 **Post-Deployment Options:**
- View deployment history: \`list_deployments\`
- Check environment status: \`status\`
- Start a new deployment: \`start_deployment\`

Is there anything else you'd like me to help you with?`
                }
            }
        ];
    }

    /**
     * Error stage - deployment encountered issues
     */
    static getErrorPrompt(deploymentId: string | undefined): PromptMessage[] {
        return [
            {
                role: 'system',
                content: {
                    type: 'text',
                    text: 'Deployment encountered an error'
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `## ⚠️ **Deployment Issue Detected**

The deployment has encountered an issue that needs your attention.

**Deployment ID:** ${deploymentId || '[deployment-id]'}

### 🔧 **Recommended Actions:**

1. **Check detailed status:** Let me get the full deployment status to understand the issue
   - I'll use \`get_deployment_status\` to get complete details

2. **Review logs:** Check deployment logs for specific error messages

3. **Common resolutions:**
   - **Timeout issues:** May need to retry the deployment
   - **Permission errors:** Verify environment access
   - **Package issues:** Check if the deployment package is valid

4. **Recovery options:**
   - **Reset deployment:** Use \`reset_deployment\` to rollback
   - **Retry:** Start a new deployment after addressing the issue

Would you like me to get the detailed status to diagnose the issue?`
                }
            }
        ];
    }
}

export default DeploymentWorkflowPrompts;

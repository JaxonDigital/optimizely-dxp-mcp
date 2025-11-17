/**
 * Autonomous Deployment Phase Prompts (DXP-133)
 * MCP prompts for guiding AI agents through each phase of autonomous deployments
 *
 * These prompts ensure consistent agent behavior across any orchestrator
 * (n8n, LangGraph, etc.) by providing clear guidance for each deployment phase.
 *
 * Related: AA project deployment agent work
 */

/**
 * Prompt argument definition
 */
export interface PromptArgument {
    name: string;
    description: string;
    required: boolean;
}

/**
 * Prompt definition
 */
export interface PromptDefinition {
    name: string;
    description: string;
    arguments: PromptArgument[];
}

/**
 * Message role
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message content
 */
export interface MessageContent {
    type: 'text';
    text: string;
}

/**
 * Prompt message
 */
export interface PromptMessage {
    role: MessageRole;
    content: MessageContent;
}

/**
 * Prompt arguments for baseline analysis
 */
export interface BaselineAnalysisArgs {
    projectName?: string;
    environment?: string;
    minutesBack?: number;
    logType?: string;
}

/**
 * Prompt arguments for start deployment
 */
export interface StartDeploymentArgs {
    projectName?: string;
    sourceEnvironment?: string;
    targetEnvironment?: string;
    deploymentType?: string;
}

/**
 * Prompt arguments for monitor deployment
 */
export interface MonitorDeploymentArgs {
    projectName?: string;
    deploymentId: string;
    interval?: number;
}

/**
 * Prompt arguments for get slot URL
 */
export interface GetSlotUrlArgs {
    projectName?: string;
    deploymentId: string;
}

/**
 * Prompt arguments for slot analysis
 */
export interface SlotAnalysisArgs {
    projectName?: string;
    environment?: string;
    minutesBack?: number;
    logType?: string;
    warmupMinutes?: number;
}

/**
 * Prompt arguments for deployment decision
 */
export interface DeploymentDecisionArgs {
    projectName?: string;
    deploymentId: string;
    baselineHealthScore?: number | string;
    slotHealthScore?: number | string;
    autoExecute?: boolean | string;
}

/**
 * Generic prompt arguments
 */
export type PromptArgs =
    | BaselineAnalysisArgs
    | StartDeploymentArgs
    | MonitorDeploymentArgs
    | GetSlotUrlArgs
    | SlotAnalysisArgs
    | DeploymentDecisionArgs
    | Record<string, any>;

class AutonomousDeploymentPrompts {

    /**
     * Define all available autonomous deployment prompts
     */
    static getPromptDefinitions(): PromptDefinition[] {
        return [
            {
                name: "baseline-analysis",
                description: "Phase 1: Analyze production logs before deployment to establish baseline health",
                arguments: [
                    {
                        name: "projectName",
                        description: "Project name to analyze (default: current/first project)",
                        required: false
                    },
                    {
                        name: "environment",
                        description: "Environment to analyze (default: Production)",
                        required: false
                    },
                    {
                        name: "minutesBack",
                        description: "Minutes of logs to analyze (default: 60)",
                        required: false
                    },
                    {
                        name: "logType",
                        description: "all, web, or application (default: all)",
                        required: false
                    }
                ]
            },
            {
                name: "start-deployment",
                description: "Phase 2: Initiate deployment with proper artifact handling",
                arguments: [
                    {
                        name: "projectName",
                        description: "Project name (default: current/first project)",
                        required: false
                    },
                    {
                        name: "sourceEnvironment",
                        description: "Source environment (Integration, Preproduction, Production)",
                        required: false
                    },
                    {
                        name: "targetEnvironment",
                        description: "Target environment (Integration, Preproduction, Production)",
                        required: false
                    },
                    {
                        name: "deploymentType",
                        description: "code, content, or all (default: code)",
                        required: false
                    }
                ]
            },
            {
                name: "monitor-deployment",
                description: "Phase 3: Monitor deployment progress until AwaitingVerification",
                arguments: [
                    {
                        name: "projectName",
                        description: "Project name (default: current/first project)",
                        required: false
                    },
                    {
                        name: "deploymentId",
                        description: "Deployment ID to monitor",
                        required: true
                    },
                    {
                        name: "interval",
                        description: "Check interval in seconds (default: 30)",
                        required: false
                    }
                ]
            },
            {
                name: "get-slot-url",
                description: "Phase 4: Extract deployment slot URL from deployment status",
                arguments: [
                    {
                        name: "projectName",
                        description: "Project name (default: current/first project)",
                        required: false
                    },
                    {
                        name: "deploymentId",
                        description: "Deployment ID to get slot URL from",
                        required: true
                    }
                ]
            },
            {
                name: "slot-analysis",
                description: "Phase 6: Analyze deployment slot logs after warmup period",
                arguments: [
                    {
                        name: "projectName",
                        description: "Project name (default: current/first project)",
                        required: false
                    },
                    {
                        name: "environment",
                        description: "Environment to analyze (default: Production)",
                        required: false
                    },
                    {
                        name: "minutesBack",
                        description: "Minutes of logs to analyze (default: 15)",
                        required: false
                    },
                    {
                        name: "logType",
                        description: "all, web, or application (default: all)",
                        required: false
                    },
                    {
                        name: "warmupMinutes",
                        description: "Minutes to wait for slot warmup (default: 5)",
                        required: false
                    }
                ]
            },
            {
                name: "deployment-decision",
                description: "Phase 7: Decide whether to complete or reset deployment based on health comparison",
                arguments: [
                    {
                        name: "projectName",
                        description: "Project name (default: current/first project)",
                        required: false
                    },
                    {
                        name: "deploymentId",
                        description: "Deployment ID for decision",
                        required: true
                    },
                    {
                        name: "baselineHealthScore",
                        description: "Baseline health score from Phase 1",
                        required: false
                    },
                    {
                        name: "slotHealthScore",
                        description: "Slot health score from Phase 6",
                        required: false
                    },
                    {
                        name: "autoExecute",
                        description: "true or false - automatically execute decision (default: false)",
                        required: false
                    }
                ]
            }
        ];
    }

    /**
     * Get messages for a specific prompt
     */
    static getPromptMessages(name: string, args: PromptArgs = {}): PromptMessage[] {
        switch (name) {
            case "baseline-analysis":
                return this.getBaselineAnalysisMessages(args as BaselineAnalysisArgs);
            case "start-deployment":
                return this.getStartDeploymentMessages(args as StartDeploymentArgs);
            case "monitor-deployment":
                return this.getMonitorDeploymentMessages(args as MonitorDeploymentArgs);
            case "get-slot-url":
                return this.getSlotUrlMessages(args as GetSlotUrlArgs);
            case "slot-analysis":
                return this.getSlotAnalysisMessages(args as SlotAnalysisArgs);
            case "deployment-decision":
                return this.getDeploymentDecisionMessages(args as DeploymentDecisionArgs);
            default:
                throw new Error(`Unknown prompt: ${name}`);
        }
    }

    /**
     * Parse boolean values from strings or booleans
     * MCP protocol sends arguments as strings
     */
    static parseBoolean(value: any, defaultValue: boolean = false): boolean {
        if (value === undefined || value === null) {
            return defaultValue;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            const lower = value.toLowerCase().trim();
            if (lower === 'false' || lower === '0' || lower === 'no') {
                return false;
            }
            if (lower === 'true' || lower === '1' || lower === 'yes') {
                return true;
            }
        }
        return defaultValue;
    }

    /**
     * Phase 1: Baseline Analysis
     * Analyze production logs before deployment to establish baseline health
     */
    static getBaselineAnalysisMessages(args: BaselineAnalysisArgs = {}): PromptMessage[] {
        const {
            projectName,
            environment = 'Production',
            minutesBack = 60,
            logType = 'all'
        } = args;

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Analyze baseline health of ${environment} before deployment`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# PHASE 1: BASELINE ANALYSIS

**Objective:** Establish production health baseline before deployment

**Steps:**

1. **Call** analyze_logs_streaming with:${projectName ? `\n   - projectName: "${projectName}"` : ''}
   - environment: "${environment}"
   - logType: "${logType}"
   - minutesBack: ${minutesBack}
   - structuredContent: true

2. **Extract** from response data.summary:
   - healthScore (0-100)
   - totalErrors
   - healthy (true/false)

3. **Record** baseline metrics for comparison:
   - Store healthScore as baselineHealthScore
   - Store totalErrors as baselineErrorCount
   - Store timestamp for reference

4. **Return** to orchestrator:
   - baselineHealthScore
   - baselineErrorCount
   - baselineHealthy (boolean)
   - baselineTimestamp

**Success Criteria:**
✅ Health score retrieved (number between 0-100)
✅ Error count recorded
✅ Baseline data structured for Phase 7 comparison

**Next Phase:** Phase 2 (start-deployment) - only proceed if baseline data collected

**Note:** logType "all" analyzes both application AND HTTP logs in one call (2x faster than separate calls)`
                }
            }
        ];
    }

    /**
     * Phase 2: Start Deployment
     * Initiate deployment with proper artifact handling
     */
    static getStartDeploymentMessages(args: StartDeploymentArgs = {}): PromptMessage[] {
        const {
            projectName,
            sourceEnvironment = 'Preproduction',
            targetEnvironment = 'Production',
            deploymentType = 'code'
        } = args;

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Start deployment from ${sourceEnvironment} to ${targetEnvironment}`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# PHASE 2: START DEPLOYMENT

**Objective:** Initiate deployment and capture deployment ID

**Steps:**

1. **Check** for active deployments first:
   - Call list_deployments with activeOnly: true${projectName ? ` and projectName: "${projectName}"` : ''}
   - If active deployments exist, STOP and notify (conflict detected)

2. **Call** start_deployment with:${projectName ? `\n   - projectName: "${projectName}"` : ''}
   - sourceEnvironment: "${sourceEnvironment}"
   - targetEnvironment: "${targetEnvironment}"
   - deploymentType: "${deploymentType}"
   - directDeploy: false (requires verification)

3. **Extract** from response data:
   - deploymentId (critical for all subsequent phases)
   - status (should be "InProgress")
   - percentComplete (should be 0 initially)

4. **Return** to orchestrator:
   - deploymentId
   - deploymentStatus
   - startTime

**Success Criteria:**
✅ Deployment started successfully
✅ deploymentId captured
✅ Status is "InProgress"

**Error Handling:**
- If active deployment exists → abort with conflict error
- If API error → return error details
- If invalid parameters → return validation error

**Next Phase:** Phase 3 (monitor-deployment) with deploymentId

**Important:** Smart defaults apply:
- CODE deployments: Integration → Preproduction → Production (upward)
- CONTENT deployments: Production → Preproduction → Integration (downward)`
                }
            }
        ];
    }

    /**
     * Phase 3: Monitor Deployment
     * Monitor deployment progress until AwaitingVerification
     */
    static getMonitorDeploymentMessages(args: MonitorDeploymentArgs): PromptMessage[] {
        const {
            projectName,
            deploymentId,
            interval = 30
        } = args;

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Monitor deployment ${deploymentId || '[deployment-id]'} until ready for verification`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# PHASE 3: MONITOR DEPLOYMENT

**Objective:** Monitor deployment until AwaitingVerification status

**Deployment ID:** ${deploymentId || '[deployment-id]'}

**Steps:**

1. **Use** monitor_deployment tool (recommended):${projectName ? `\n   - projectName: "${projectName}"` : ''}
   - deploymentId: "${deploymentId || '[deployment-id]'}"
   - interval: ${interval}
   - maxDuration: 30
   - autoComplete: false (manual verification required)

2. **OR** manual polling loop:
   - Call get_deployment_status every ${interval} seconds${projectName ? ` with projectName: "${projectName}"` : ''}
   - Continue until status is "AwaitingVerification"
   - Max polling duration: 30 minutes

3. **Watch** for status values:
   - "InProgress" → keep monitoring
   - "AwaitingVerification" → proceed to Phase 4
   - "Succeeded" → deployment already completed (direct deploy)
   - "Failed" → abort and report error
   - "Reset" → deployment was rolled back

4. **Return** to orchestrator when AwaitingVerification:
   - deploymentId
   - status: "AwaitingVerification"
   - percentComplete: 100
   - verificationUrls (if available)

**Success Criteria:**
✅ Status changed to "AwaitingVerification"
✅ percentComplete is 100
✅ Monitoring stopped

**Error Handling:**
- If status "Failed" → abort with deployment error
- If timeout (>30 min) → abort with timeout error
- If API error → retry up to 3 times

**Next Phase:** Phase 4 (get-slot-url) to extract slot URL

**Note:** Typical deployment takes 5-15 minutes. Status "Completing" may appear briefly during finalization.`
                }
            }
        ];
    }

    /**
     * Phase 4: Get Slot URL
     * Extract deployment slot URL from deployment status
     */
    static getSlotUrlMessages(args: GetSlotUrlArgs): PromptMessage[] {
        const {
            projectName,
            deploymentId
        } = args;

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Extract slot URL from deployment ${deploymentId || '[deployment-id]'}`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# PHASE 4: GET SLOT URL

**Objective:** Extract deployment slot URL for testing

**Deployment ID:** ${deploymentId || '[deployment-id]'}

**Steps:**

1. **Call** get_deployment_status with:${projectName ? `\n   - projectName: "${projectName}"` : ''}
   - deploymentId: "${deploymentId || '[deployment-id]'}"

2. **Extract** from response data:
   - Look for verificationUrls field
   - Slot URL format: https://[project]-[env]-slot.dxp.episerver.net
   - Typically under data.verificationUrls or similar field

3. **Validate** slot URL:
   - Must contain "-slot" in domain
   - Must be HTTPS
   - Must be accessible (200 OK response)

4. **Return** to orchestrator:
   - slotUrl (full URL)
   - deploymentId
   - environment

**Success Criteria:**
✅ Slot URL extracted successfully
✅ URL format validated
✅ URL is accessible

**Error Handling:**
- If no verificationUrls found → check deployment status details
- If URL not accessible → retry after 30 seconds
- If validation fails → return error with details

**Next Phase:** Phase 5 (warmup - handled by orchestrator) then Phase 6 (slot-analysis)

**Phase 5 Note:** Orchestrator should:
- Wait 2-5 minutes for slot warmup
- Optionally send test requests to slot URL
- This phase is handled externally, not by MCP prompt`
                }
            }
        ];
    }

    /**
     * Phase 6: Slot Analysis
     * Analyze deployment slot logs after warmup period
     */
    static getSlotAnalysisMessages(args: SlotAnalysisArgs = {}): PromptMessage[] {
        const {
            projectName,
            environment = 'Production',
            minutesBack = 15,
            logType = 'all',
            warmupMinutes = 5
        } = args;

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Analyze deployment slot health after warmup in ${environment}`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# PHASE 6: SLOT ANALYSIS

**Objective:** Analyze deployment slot health after warmup period

**Steps:**

1. **Wait** for slot warmup (if not already done):
   - Recommended warmup: ${warmupMinutes} minutes
   - This allows slot to initialize and handle initial requests

2. **Call** analyze_logs_streaming with:${projectName ? `\n   - projectName: "${projectName}"` : ''}
   - environment: "${environment}"
   - slot: true (CRITICAL - analyzes slot logs, not production!)
   - logType: "${logType}"
   - minutesBack: ${minutesBack}
   - structuredContent: true

3. **Extract** from response data.summary:
   - healthScore (0-100)
   - totalErrors
   - healthy (true/false)

4. **Record** slot metrics for comparison:
   - Store healthScore as slotHealthScore
   - Store totalErrors as slotErrorCount
   - Store timestamp for reference

5. **Return** to orchestrator:
   - slotHealthScore
   - slotErrorCount
   - slotHealthy (boolean)
   - slotTimestamp

**Success Criteria:**
✅ Slot logs analyzed (slot: true parameter used)
✅ Health score retrieved (0-100)
✅ Error count recorded
✅ Slot data structured for Phase 7 comparison

**Error Handling:**
- If no slot logs found → slot may not be warmed up yet, wait longer
- If errors are 0 but logs exist → slot is healthy
- If API error → retry up to 3 times

**Next Phase:** Phase 7 (deployment-decision) with baseline and slot health scores

**CRITICAL:** Must use slot: true parameter to analyze slot logs instead of production logs!

**Note:** logType "all" analyzes both application AND HTTP logs in one call (2x faster)`
                }
            }
        ];
    }

    /**
     * Phase 7: Deployment Decision
     * Decide whether to complete or reset deployment based on health comparison
     */
    static getDeploymentDecisionMessages(args: DeploymentDecisionArgs): PromptMessage[] {
        const {
            deploymentId,
            baselineHealthScore,
            slotHealthScore,
            autoExecute = false
        } = args;

        const autoExec = this.parseBoolean(autoExecute, false);

        const executionInstructions = autoExec ? `
**Auto-Execute Enabled:**
- If recommendation is "proceed" → automatically call complete_deployment
- If recommendation is "rollback" → automatically call reset_deployment
- If recommendation is "investigate" → return decision to orchestrator for human review` : `
**Manual Execution (autoExecute: false):**
- Return decision recommendation to orchestrator
- Orchestrator decides whether to execute automatically or request human approval
- DO NOT automatically call complete_deployment or reset_deployment`;

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Make deployment decision for ${deploymentId || '[deployment-id]'} based on health comparison`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# PHASE 7: DEPLOYMENT DECISION (AUTHORITY)

**Objective:** Decide whether to complete or reset deployment

**Deployment ID:** ${deploymentId || '[deployment-id]'}

**Steps:**

1. **Prepare** baseline and slot data:
   - baselineHealthScore: ${baselineHealthScore || '[from Phase 1]'}
   - slotHealthScore: ${slotHealthScore || '[from Phase 6]'}
   - Both should be numbers between 0-100

2. **Call** compare_logs with:
   - baseline: { data: { summary: { healthScore: baselineHealthScore, totalErrors: baselineErrors }}}
   - slot: { data: { summary: { healthScore: slotHealthScore, totalErrors: slotErrors }}}
   - thresholds (optional): {
       maxErrorIncrease: 0.5,  // 50% error increase = critical
       maxScoreDecrease: 20,    // 20 point drop = warning
       maxLatencyIncrease: 100  // 100ms increase = warning
     }

3. **Extract** decision from response data:
   - decision: "safe", "warning", or "critical"
   - recommendation: "proceed", "investigate", or "rollback"
   - reasons: array of explanation strings

4. **Make decision:**
   - If recommendation is "proceed" → complete deployment
   - If recommendation is "investigate" → flag for human review
   - If recommendation is "rollback" → reset deployment

${executionInstructions}

5. **Return** to orchestrator:
   - decision (safe/warning/critical)
   - recommendation (proceed/investigate/rollback)
   - reasons (array of strings)
   - action taken (completed/reset/pending-review)
   - deploymentId

**Success Criteria:**
✅ compare_logs called successfully
✅ Decision made based on thresholds
✅ Action executed (if autoExecute: true) or returned

**Decision Logic:**
- **SAFE (proceed):** No threshold violations, deploy is healthy
- **WARNING (investigate):** Minor issues, human review recommended
- **CRITICAL (rollback):** Major issues, automatic rollback recommended

**Default Thresholds:**
- maxErrorIncrease: 50% (0.5)
- maxScoreDecrease: 20 points
- maxLatencyIncrease: 100ms

**Error Handling:**
- If compare_logs fails → default to "investigate" (human review)
- If execution fails → retry once, then escalate
- If baseline/slot data missing → cannot make decision, abort

**Next Steps:**
- If completed → deployment is live in production
- If reset → deployment rolled back, start over
- If investigate → human must review and decide

**Note:** This is the DECISION AUTHORITY phase. The agent makes the final go/no-go decision here.`
                }
            }
        ];
    }
}

export default AutonomousDeploymentPrompts;

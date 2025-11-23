/**
 * AI Guidance Tools
 * Provides guidance and best practices for AI clients interacting with the MCP
 */

import fs from 'fs';
import path from 'path';
import ResponseBuilder from '../response-builder';
import DatabaseExportPrompts from '../prompts/database-export-prompts';

/**
 * AI guidance arguments
 */
interface AIGuidanceArgs {
    topic?: string;
    stage?: string;
    exportId?: string;
    environment?: string;
    databaseName?: string;
}

/**
 * AI compliance check arguments
 */
interface AIComplianceArgs {
    action?: string;
    parameters?: Record<string, any>;
}

/**
 * Prompt message
 */
interface PromptMessage {
    role: string;
    content: {
        text: string;
    };
}

class AIGuidanceTools {
    /**
     * Get AI client guidance and best practices
     */
    static async getAIGuidance(args: AIGuidanceArgs = {}): Promise<any> {
        try {
            const { topic } = args;

            // Check for database export workflow request
            if (topic && topic.toLowerCase().includes('database') && topic.toLowerCase().includes('export')) {
                return await this.getDatabaseExportWorkflow(args);
            }

            // Read the AI_CLIENT_GUIDE.md file
            const guidePath = path.join(__dirname, '..', '..', 'AI_CLIENT_GUIDE.md');
            let guideContent = '';

            try {
                guideContent = fs.readFileSync(guidePath, 'utf8');
            } catch (error) {
                // If file doesn't exist, provide inline guidance
                guideContent = this.getInlineGuidance();
            }

            // If specific topic requested, extract relevant section
            if (topic) {
                const section = this.extractSection(guideContent, topic);
                if (section) {
                    return ResponseBuilder.success(section);
                }
            }

            // Return full guide
            return ResponseBuilder.success(guideContent);

        } catch (error: any) {
            return ResponseBuilder.error('Failed to retrieve AI guidance', error.message);
        }
    }

    /**
     * Get comprehensive database export workflow guidance
     */
    static async getDatabaseExportWorkflow(args: AIGuidanceArgs = {}): Promise<any> {
        try {
            const {
                exportId,
                environment = 'Production',
                databaseName = 'epicms'
            } = args;

            // Use the new unified prompt system
            try {
                // Get the prompt messages based on stage
                const promptArgs: any = { environment, databaseName };
                if (exportId) {
                    promptArgs.exportId = exportId;
                }

                const messages = DatabaseExportPrompts.getPromptMessages('export-database', promptArgs) as PromptMessage[];

                // Extract the assistant's guidance message
                const assistantMessage = messages.find(m => m.role === 'assistant');
                const workflowGuide = assistantMessage ? assistantMessage.content.text : 'Failed to get workflow guidance';

                return ResponseBuilder.success(`${workflowGuide}

---

## 🔗 RELATED GUIDANCE

For additional context:
- Use \`get_ai_guidance\` for general AI interaction rules
- Use \`get_ai_guidance({ topic: "confirmation" })\` for confirmation patterns
- Use \`get_ai_guidance({ topic: "errors" })\` for error handling guidance

## 🎯 WORKFLOW STAGES

You can get stage-specific guidance:
- \`get_ai_guidance({ topic: "database export", stage: "start" })\` - Initial preview phase
- \`get_ai_guidance({ topic: "database export", stage: "monitoring", exportId: "xxx" })\` - Monitoring phase
- \`get_ai_guidance({ topic: "database export", stage: "completed", exportId: "xxx" })\` - Download phase
- \`get_ai_guidance({ topic: "database export", stage: "error" })\` - Error handling

**This is your complete guide to transparent database export workflows!**`);
            } catch (promptError: any) {
                throw new Error(promptError.message || 'Failed to get database export workflow');
            }

        } catch (error: any) {
            return ResponseBuilder.error('Failed to retrieve database export workflow', error.message);
        }
    }

    /**
     * Get inline guidance if file not available
     */
    static getInlineGuidance(): string {
        return `# AI Client Integration Guide - Quick Reference

## 🚨 CRITICAL RULES - VIOLATIONS WILL BE REPORTED

### 🛑 ABSOLUTE PROHIBITION: Auto-Confirming Operations
- **NEVER** automatically set \`skipConfirmation: true\` after seeing a preview
- **NEVER** proceed with download after seeing "AWAITING USER CONFIRMATION"
- **ALWAYS** STOP and wait when you see "WAITING FOR USER CONFIRMATION"
- **VIOLATION**: If you call download with skipConfirmation after preview = PROTOCOL VIOLATION

### 🛑 DATABASE EXPORT RULES - NEVER AUTO-ACCEPT
- **NEVER** set \`autoDownload: true\` unless user explicitly requests
- **ALWAYS** use \`previewOnly: true\` FIRST to show what will happen
- **ALWAYS** wait for explicit user confirmation before actual export
- **IMPORTANT**: When user chooses "Option 2" or "create fresh export" after seeing existing backup, USE \`forceNew: true\`
- **CRITICAL**: After export completes, NEVER call db_export again to download - that creates a NEW export!
- **PREFERRED**: Use \`monitor: false\` to disable automatic monitoring - makes debugging easier
- **VIOLATION**: Auto-adding autoDownload without user request = PROTOCOL VIOLATION
- **VIOLATION**: Calling db_export without previewOnly first = PROTOCOL VIOLATION
- **VIOLATION**: Calling db_export to download completed export = CREATES DUPLICATE!

### ⚠️ When You See "AWAITING USER CONFIRMATION"
**YOU MUST:**
1. STOP immediately
2. DO NOT call the download tool again
3. DO NOT add skipConfirmation: true
4. WAIT for the human to explicitly say "yes", "proceed", "confirm", etc.

### Confirmation Flow (MANDATORY)
1. User requests download
2. AI calls tool with previewOnly: true OR without skipConfirmation
3. MCP shows preview with "AWAITING USER CONFIRMATION"
4. **AI MUST STOP HERE** ← CRITICAL
5. User explicitly confirms (e.g., "yes", "proceed", "download")
6. ONLY THEN: AI calls tool WITH skipConfirmation: true

### Common Mistakes to Avoid
- ❌ Auto-confirming after CONFIRMATION_REQUIRED error
- ❌ Setting skipConfirmation: true without user confirmation
- ❌ Ignoring time parameters (using days when user said hours)
- ❌ Downloading without showing preview first

Remember: Always prioritize user control over automation speed.`;
    }

    /**
     * Extract specific section from guide
     */
    static extractSection(content: string, topic: string): string | null {
        const topicLower = topic.toLowerCase();

        // Define section mappings
        const sections: Record<string, RegExp> = {
            'confirmation': /## .* Confirmation[\s\S]*?(?=##|$)/i,
            'downloads': /### download[\s\S]*?(?=###|$)/i,
            'errors': /### .* Errors[\s\S]*?(?=###|$)/i,
            'parameters': /### .* Parameters[\s\S]*?(?=###|$)/i,
            'workflow': /## .* Workflow[\s\S]*?(?=##|$)/i,
            'mistakes': /## .* Mistakes[\s\S]*?(?=##|$)/i
        };

        // Find matching section
        for (const [key, regex] of Object.entries(sections)) {
            if (topicLower.includes(key)) {
                const match = content.match(regex);
                if (match) {
                    return match[0].trim();
                }
            }
        }

        // If no specific section found, return summary
        return this.getInlineGuidance();
    }

    /**
     * Check if AI is following best practices
     */
    static checkAICompliance(args: AIComplianceArgs = {}): any {
        const { action, parameters } = args;
        const issues: string[] = [];

        // Check for common compliance issues
        if (action === 'download' && parameters?.skipConfirmation === true) {
            issues.push('⚠️ skipConfirmation should not be set to true without user confirmation');
        }

        if (action === 'download' && !parameters?.previewOnly && !parameters?.skipConfirmation) {
            issues.push('✅ Good: Not auto-confirming download');
        }

        if (parameters?.environment === undefined && action !== 'list') {
            issues.push('ℹ️ No environment specified, will default to Production');
        }

        const response = issues.length > 0
            ? issues.join('\n')
            : '✅ Parameters appear compliant with best practices';

        return ResponseBuilder.success(response);
    }
}

export default AIGuidanceTools;

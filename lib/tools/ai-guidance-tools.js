/**
 * AI Guidance Tools
 * Provides guidance and best practices for AI clients interacting with the MCP
 */

const fs = require('fs');
const path = require('path');
const ResponseBuilder = require('../response-builder');
const DatabaseExportPrompts = require('../prompts/database-export-prompts');

class AIGuidanceTools {
    /**
     * Get AI client guidance and best practices
     */
    static async getAIGuidance(args = {}) {
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

        } catch (error) {
            return ResponseBuilder.error('Failed to retrieve AI guidance', error.message);
        }
    }

    /**
     * Get comprehensive database export workflow guidance
     */
    static async getDatabaseExportWorkflow(args = {}) {
        try {
            const {
                stage = 'start',
                exportId,
                environment = 'Production',
                databaseName = 'epicms'
            } = args;

            // Use the new unified prompt system
            try {
                // Get the prompt messages based on stage
                const promptArgs = { environment, databaseName };
                if (exportId) {
                    promptArgs.exportId = exportId;
                }

                const messages = DatabaseExportPrompts.getPromptMessages('export-database', promptArgs);

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
            } catch (promptError) {
                throw new Error(promptError.message || 'Failed to get database export workflow');
            }

        } catch (error) {
            return ResponseBuilder.error('Failed to retrieve database export workflow', error.message);
        }
    }
    
    /**
     * Get inline guidance if file not available
     */
    static getInlineGuidance() {
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
- **CRITICAL**: After export completes, NEVER call export_database again to download - that creates a NEW export!
- **PREFERRED**: Use \`monitor: false\` to disable automatic monitoring - makes debugging easier
- **VIOLATION**: Auto-adding autoDownload without user request = PROTOCOL VIOLATION
- **VIOLATION**: Calling export_database without previewOnly first = PROTOCOL VIOLATION
- **VIOLATION**: Calling export_database to download completed export = CREATES DUPLICATE!

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

### Correct Download Pattern
\`\`\`javascript
// Step 1: Get preview
download_logs({
    startDateTime: '2025-09-15T01:00:00-05:00',
    endDateTime: '2025-09-15T01:30:00-05:00',
    previewOnly: true
})

// Step 2: Wait for user confirmation
// User: "yes, proceed"

// Step 3: Download with confirmation
download_logs({
    startDateTime: '2025-09-15T01:00:00-05:00',
    endDateTime: '2025-09-15T01:30:00-05:00',
    skipConfirmation: true
})
\`\`\`

### CRITICAL: Date/Time Format Requirements
**ALWAYS convert human-readable times to ISO 8601 format:**
- User says: "1am Eastern on September 15th"
- You use: \`startDateTime: '2025-09-15T01:00:00-04:00'\` (Sept = EDT = -04:00)
- User says: "1:30am Eastern on January 15th"
- You use: \`endDateTime: '2025-01-15T01:30:00-05:00'\` (Jan = EST = -05:00)

**Eastern Time Zone Offsets (IMPORTANT):**
- **March - November**: Use \`-04:00\` (EDT - Daylight Time)
- **November - March**: Use \`-05:00\` (EST - Standard Time)
- When user says "Eastern", check the date to use correct offset!

**Supported ISO 8601 formats:**
- With timezone: \`2025-09-15T01:00:00-04:00\` (EDT in September)
- UTC: \`2025-09-15T05:00:00Z\` (1am EDT = 5am UTC)
- Local time: \`2025-09-15T01:00:00\` (uses system timezone)

### Key Parameters
- \`skipConfirmation\`: Default false, only set true after user confirms
- \`previewOnly\`: Use to get preview without triggering confirmation error
- \`environment\`: Defaults to Production
- \`forceNew\`: Forces new database export even if recent backup exists
- \`startDateTime\`/\`endDateTime\`: Use ISO 8601 format ONLY
- \`daysBack\`, \`hoursBack\`, \`minutesBack\`: For relative time ranges

### 📊 DATABASE EXPORT FLOW (CRITICAL)

**🚨 USE COMPREHENSIVE WORKFLOW GUIDE:**
- **GET COMPLETE GUIDANCE**: Use \`get_ai_guidance({ topic: "database export" })\` for step-by-step workflow
- **STAGE-SPECIFIC HELP**: Get prompts for each phase (start, monitoring, completed, error)
- **TRANSPARENT MONITORING**: Every status check visible to user

**🚨 FIRST CALL MUST BE PREVIEW - NO EXCEPTIONS:**
- **ALWAYS start with:** \`export_database({ previewOnly: true })\`
- **NEVER start with:** \`export_database({ autoDownload: true })\`
- **NEVER skip preview:** User needs to see what will happen first!

**🚨 OPTION NUMBERING - DO NOT CHANGE:**
- MCP returns: "1. Use existing backup" and "2. Create fresh backup"
- **KEEP AS 1 and 2** - do NOT change to Option 0/Option 1
- User saying "1" = use existing (STOP, no further action)
- User saying "2" = create fresh (use forceNew: true)

**🚨 PARAMETER RULES - NEVER VIOLATE:**
- **previewOnly: true** = ONLY show what would happen, NO actual export
- **previewOnly: false** = ACTUALLY start the export operation
- **autoDownload: true** = NEVER use on first call - ONLY after user confirms
- **NEVER say "showing preview" with previewOnly: false** - that's a contradiction!

**CORRECT PARAMETER COMBINATIONS:**
1. **Initial call (ALWAYS)**: \`{ previewOnly: true }\`
   - Shows existing backups or what would be exported
   - NO actual export starts

2. **After user sees preview and chooses Option 1 (use existing)**:
   - STOP - no further calls needed
   - ⚠️ MCP shows "1. Use existing" NOT "Option 0"

3. **After user sees preview and chooses Option 2 (create fresh)**:
   - \`{ forceNew: true }\` (previewOnly defaults to false)
   - This ACTUALLY starts the export
   - ⚠️ MCP shows "2. Create fresh" NOT "Option 1"

4. **User explicitly says "auto-download"**:
   - \`{ autoDownload: true }\` (only if user specifically requests)

**❌ WRONG (AI confusion):**
\\\`\\\`\\\`javascript
// AI says: "Let me show you a preview"
export_database({ previewOnly: false })  // WRONG! This starts export, not preview!
\\\`\\\`\\\`

**✅ CORRECT:**
\\\`\\\`\\\`javascript
// AI says: "Let me show you a preview"
export_database({ previewOnly: true })   // Correct! Actually shows preview
\\\`\\\`\\\`

**Complete Example Flow:**
1. User: "export database"
2. AI: "Let me check for existing backups"
   → \`export_database({ previewOnly: true })\`
3. System shows existing backup with options
4. User: "2" or "create fresh"
5. AI: "Starting fresh export..."
   → \`export_database({ forceNew: true, monitor: false })\`  // Disable auto-monitoring!
6. Export starts, returns export ID
7. AI: "Checking status in 2 minutes..." (wait 2 minutes)
8. AI: Use export_database tool with ONLY exportId parameter → shows status
9. If not complete, repeat step 7-8 until "Succeeded"
10. When complete, show download options

**🔍 MONITORING APPROACH - TRANSPARENT & DEBUGGABLE:**
- **USE WORKFLOW GUIDE**: \`get_ai_guidance({ topic: "database export", stage: "monitoring", exportId: "xxx" })\`
- **PREFER**: Manual status checks every 2-3 minutes (user sees each check)
- **AVOID**: Behind-the-scenes automatic monitoring (hard to debug when stuck)
- **REASON**: User needs to see progress and can stop if something goes wrong
- **EXAMPLE**: "Checking export status... (2 minutes elapsed)" → show status → repeat

**⚠️ CRITICAL - After Export Completes:**
- When export is complete and user says "yes" to download
- **DO NOT CALL export_database AGAIN** - that creates a NEW export!
- Instead use export_database tool with exportId and autoDownload: true parameters
- Or wait for download tool implementation

### When You See Errors
- \`CONFIRMATION_REQUIRED\`: Stop and ask user for confirmation
- Authentication errors: Suggest \`test_connection\`
- Missing containers: Use \`list_storage_containers\`

Remember: Always prioritize user control over automation speed.`;
    }
    
    /**
     * Extract specific section from guide
     */
    static extractSection(content, topic) {
        const topicLower = topic.toLowerCase();
        
        // Define section mappings
        const sections = {
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
    static checkAICompliance(args = {}) {
        const { action, parameters } = args;
        const issues = [];
        
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

module.exports = AIGuidanceTools;
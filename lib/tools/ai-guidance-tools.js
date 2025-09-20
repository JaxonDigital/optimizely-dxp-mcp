/**
 * AI Guidance Tools
 * Provides guidance and best practices for AI clients interacting with the MCP
 */

const fs = require('fs');
const path = require('path');
const ResponseBuilder = require('../response-builder');

class AIGuidanceTools {
    /**
     * Get AI client guidance and best practices
     */
    static async getAIGuidance(args = {}) {
        try {
            const { topic } = args;
            
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
     * Get inline guidance if file not available
     */
    static getInlineGuidance() {
        return `# AI Client Integration Guide - Quick Reference

## 🚨 CRITICAL RULES - VIOLATIONS WILL BE REPORTED

### 🛑 ABSOLUTE PROHIBITION: Auto-Confirming Downloads
- **NEVER** automatically set \`skipConfirmation: true\` after seeing a preview
- **NEVER** proceed with download after seeing "AWAITING USER CONFIRMATION"
- **ALWAYS** STOP and wait when you see "WAITING FOR USER CONFIRMATION"
- **VIOLATION**: If you call download with skipConfirmation after preview = PROTOCOL VIOLATION

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
- \`startDateTime\`/\`endDateTime\`: Use ISO 8601 format ONLY
- \`daysBack\`, \`hoursBack\`, \`minutesBack\`: For relative time ranges

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
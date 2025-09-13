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

## 🚨 CRITICAL RULES

### NEVER Auto-Confirm Downloads
- **NEVER** automatically set \`skipConfirmation: true\`
- **ALWAYS** show preview to user first
- When you see \`CONFIRMATION_REQUIRED\` error, **STOP** and ask the user

### Confirmation Flow
1. User requests download
2. AI calls tool WITHOUT skipConfirmation
3. MCP returns preview/confirmation request
4. AI shows preview to user
5. User explicitly confirms ← REQUIRED
6. AI calls tool WITH skipConfirmation: true

### Common Mistakes to Avoid
- ❌ Auto-confirming after CONFIRMATION_REQUIRED error
- ❌ Setting skipConfirmation: true without user confirmation
- ❌ Ignoring time parameters (using days when user said hours)
- ❌ Downloading without showing preview first

### Correct Download Pattern
\`\`\`javascript
// Step 1: Get preview
download_logs({ daysBack: 7, previewOnly: true })

// Step 2: Wait for user confirmation
// User: "yes, proceed"

// Step 3: Download with confirmation
download_logs({ daysBack: 7, skipConfirmation: true })
\`\`\`

### Key Parameters
- \`skipConfirmation\`: Default false, only set true after user confirms
- \`previewOnly\`: Use to get preview without triggering confirmation error
- \`environment\`: Defaults to Production
- \`daysBack\`: Default 1 for logs

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
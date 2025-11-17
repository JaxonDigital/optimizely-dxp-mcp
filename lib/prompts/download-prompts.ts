/**
 * Download Workflow Prompts
 * MCP prompts for guided download operations and confirmation decisions
 */

import { PromptDefinition, PromptMessage } from './autonomous-deployment-prompts';

/**
 * Download prompt arguments
 */
export interface DownloadPromptArgs {
    download_type?: string;
    use_case?: string;
}

class DownloadPrompts {

    /**
     * Define all available download prompts
     */
    static getPromptDefinitions(): PromptDefinition[] {
        return [
            {
                name: "download_confirmation_required",
                description: "Explains when to require user confirmation for downloads",
                arguments: [
                    {
                        name: "download_type",
                        description: "Type of download (logs, database, blobs, all)",
                        required: false
                    }
                ]
            },
            {
                name: "incremental_download_explanation",
                description: "Explains incremental downloads for logs and storage",
                arguments: [
                    {
                        name: "use_case",
                        description: "Intended use case (monitoring, analysis, backup)",
                        required: false
                    }
                ]
            }
        ];
    }

    /**
     * Get messages for a specific prompt
     */
    static getPromptMessages(name: string, args: DownloadPromptArgs = {}): PromptMessage[] {
        switch (name) {
            case "download_confirmation_required":
                return this.getDownloadConfirmationMessages(args);
            case "incremental_download_explanation":
                return this.getIncrementalDownloadMessages(args);
            default:
                throw new Error(`Unknown prompt: ${name}`);
        }
    }

    /**
     * Download confirmation guidance messages
     */
    static getDownloadConfirmationMessages(args: DownloadPromptArgs = {}): PromptMessage[] {
        const downloadType = args.download_type || 'all types';

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `When should I require user confirmation for ${downloadType} downloads?`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# Download Confirmation Guidance

Understanding when to require user confirmation for downloads helps balance user experience with safety.

## Overview

All download tools in the DXP MCP server support a \`skipConfirmation\` parameter. This guide helps you decide when it's safe to skip confirmations and when they're critical.

---

## When Confirmations Are CRITICAL

**ALWAYS require confirmation for:**

### 🔴 Production Database Exports
- **Size:** Typically 100MB - 5GB
- **Time:** 5-15 minutes to export + download time
- **Disk:** Requires 2x size for safety (working space + final file)
- **Impact:** Large files, significant disk space, time-consuming
- **Why:** User should know this will take time and space

### 🔴 Full Log Downloads
- **Size:** Potentially gigabytes for active sites
- **Time:** Varies by log count (can be hours for months of logs)
- **Disk:** Can fill available disk space
- **Impact:** Network bandwidth, storage concerns
- **Why:** User should understand scope before starting

### 🔴 First-Time Downloads
- **Size:** Unknown until preview
- **Time:** Unknown
- **Impact:** Unpredictable
- **Why:** Always preview first-time operations

### 🔴 Large Blob/Asset Downloads
- **Size:** Media libraries can be 10GB+
- **Time:** Hours for large asset collections
- **Impact:** Significant resources
- **Why:** User should plan for large downloads

---

## When It's Safe to Skip Confirmations

**You can skip confirmations when:**

### ✅ Small Incremental Downloads
\`\`\`
download_logs({
  incrementalMode: true,
  skipConfirmation: true
})
\`\`\`
- Only new/changed files downloaded
- Size is predictable and small
- User expects automated updates

### ✅ Automated Workflows
\`\`\`
// Scheduled backup script
db_export({
  monitor: true,
  autoDownload: true,
  skipConfirmation: true  // User set up automation intentionally
})
\`\`\`
- User configured automation
- Expected behavior
- Regular occurrence

### ✅ Retry of Previously Confirmed Download
\`\`\`
// Download was confirmed earlier but failed partway
download_db_export({
  exportId: "abc-123",
  skipConfirmation: true  // Already reviewed size/scope
})
\`\`\`
- User already saw preview
- Just resuming/retrying
- No new information to confirm

### ✅ Small Known Files
- Individual logs (< 100MB)
- Small exports (< 50MB)
- Quick operations (< 1 minute)

---

## How to Estimate Download Size

**Before deciding to skip confirmation, estimate the size:**

### Database Exports
\`\`\`javascript
// Preview first to see size
db_export({
  environment: "Production",
  previewOnly: true  // Shows estimated size
})
\`\`\`
**Typical sizes:**
- Integration: 50MB - 500MB
- Preproduction: 100MB - 2GB
- Production: 500MB - 5GB (can be larger)

### Log Downloads
\`\`\`javascript
// Check log count and total size
get_available_logs({
  environment: "Production",
  logType: "http"
})
\`\`\`
**Estimation:**
- HTTP logs: ~50MB per day for active sites
- Application logs: ~10MB per day (sparse, event-driven)
- 30 days of HTTP logs: ~1.5GB

### Blob/Asset Downloads
\`\`\`javascript
// List containers to see sizes
list_storage_containers({
  environment: "Production"
})
\`\`\`
**Common scenarios:**
- Media libraries: 1GB - 50GB
- Asset folders: 100MB - 5GB
- Individual blobs: Varies widely

---

## Disk Space Considerations

**Before any large download:**

### Check Available Disk Space
\`\`\`bash
# Linux/macOS
df -h ~/downloads

# Windows
dir
\`\`\`

### Reserve 2x Download Size
- **Why:** Temporary files, extraction space, safety margin
- **Example:** 2GB database export = need 4GB free space minimum
- **Better:** Reserve 3x for comfort (6GB for 2GB download)

### Default Download Location
- **Path:** \`./downloads/\` (relative to MCP server)
- **Change:** Use \`downloadPath\` parameter
- **Check:** Ensure destination has enough space

---

## Best Practices

### 1. Always Use Preview First
\`\`\`javascript
// BAD: Skip confirmation without knowing size
db_export({ skipConfirmation: true })

// GOOD: Preview first, then decide
db_export({ previewOnly: true })
// ... review output ...
db_export({ skipConfirmation: false })  // Explicit confirmation
\`\`\`

### 2. Check Incremental Mode
\`\`\`javascript
// For logs, use incremental by default
download_logs({
  incrementalMode: true,  // Only new files
  skipConfirmation: true  // Safe for incremental
})
\`\`\`

### 3. Communicate Download Size to User
\`\`\`javascript
// When showing preview to user
"This will download approximately 2.5GB of logs from Production.
This may take 10-15 minutes and requires ~5GB free disk space.
Proceed with download?"
\`\`\`

### 4. Use Background Downloads for Large Files
\`\`\`javascript
download_db_export({
  exportId: "abc-123",
  background: true,  // Don't block waiting
  skipConfirmation: false  // Still confirm first
})
\`\`\`

---

## Common Scenarios

### Scenario 1: User asks "Download production database"
\`\`\`
❌ BAD: db_export({ environment: "Production", skipConfirmation: true })
✅ GOOD:
  1. db_export({ environment: "Production", previewOnly: true })
  2. Show user estimated size and time
  3. Wait for user confirmation
  4. db_export({ environment: "Production" })
\`\`\`

### Scenario 2: User asks "Get latest logs"
\`\`\`
✅ GOOD: download_logs({ incrementalMode: true, skipConfirmation: true })
Why: Incremental is safe, only downloads new files
\`\`\`

### Scenario 3: User asks "Download all HTTP logs from last month"
\`\`\`
❌ BAD: download_logs({ skipConfirmation: true })
✅ GOOD:
  1. get_available_logs({ logType: "http" })
  2. Calculate: ~30 days × 50MB = ~1.5GB
  3. Inform user: "This will download ~1.5GB (30 days of HTTP logs)"
  4. Wait for confirmation
  5. download_logs({ logType: "http" })
\`\`\`

### Scenario 4: Automated backup script
\`\`\`
✅ GOOD:
db_export({
  environment: "Production",
  monitor: true,
  autoDownload: true,
  skipConfirmation: true  // User set up automation
})
\`\`\`
Why: User intentionally configured automation, expects this behavior

---

## Decision Tree

\`\`\`
Is this download > 100MB?
  ├─ YES → Require confirmation
  └─ NO → Check if first-time
      ├─ YES → Require confirmation
      └─ NO → Safe to skip

Is this download from Production?
  ├─ YES → Require confirmation (safety)
  └─ NO → Check size (see above)

Is this incremental download?
  ├─ YES → Safe to skip
  └─ NO → Check size (see above)

Is this automated workflow?
  ├─ YES → Safe to skip (user expects it)
  └─ NO → Require confirmation
\`\`\`

---

## Summary

**Default Rule:** When in doubt, require confirmation.

**Skip confirmation when:**
- ✅ Small files (< 100MB)
- ✅ Incremental downloads
- ✅ Automated workflows
- ✅ Retry of confirmed operation

**Always confirm when:**
- 🔴 Production database exports
- 🔴 Full log downloads
- 🔴 First-time operations
- 🔴 Large files (> 100MB)
- 🔴 Unknown size

**Best practice:** Use \`previewOnly: true\` first, show user the preview, then proceed.`
                }
            }
        ];
    }

    /**
     * Incremental download explanation messages
     */
    static getIncrementalDownloadMessages(args: DownloadPromptArgs = {}): PromptMessage[] {
        const useCase = args.use_case || 'general';

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Explain incremental downloads for ${useCase} use case`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# Incremental Download Explanation

Understanding incremental downloads helps you save time, bandwidth, and disk space when repeatedly downloading logs and storage blobs.

## Overview

**Incremental downloads** only fetch files that are new or changed since the last download, instead of downloading everything every time.

**Key benefits:**
- ⏱️ **Time savings:** Minutes instead of hours for large archives
- 💾 **Disk space:** Only store new/changed files
- 🌐 **Bandwidth:** Drastically reduced network usage
- 🔄 **Automation-friendly:** Perfect for scheduled monitoring

---

## How Incremental Downloads Work

### First Download (Baseline)
\`\`\`javascript
download_logs({
  environment: "Production",
  incremental: true
})
\`\`\`

**What happens:**
1. Downloads all available log files
2. Creates manifest file: \`./downloads/.download-manifest.json\`
3. Manifest tracks every downloaded file with metadata (name, size, modified date)

**Result:** Same as full download on first run

---

### Subsequent Downloads (Incremental)
\`\`\`javascript
// Next day, week, or month
download_logs({
  environment: "Production",
  incremental: true  // Same command
})
\`\`\`

**What happens:**
1. Reads manifest to see what was previously downloaded
2. Queries server for available files
3. Compares server files against manifest
4. **Only downloads:**
   - Files not in manifest (new files)
   - Files with different size or modified date (changed files)
5. Updates manifest with new/changed files

**Result:** Dramatically faster, only fetches what's new

---

## Manifest File System

### Manifest Location
**Default:** \`./downloads/.download-manifest.json\`

**Custom location:**
\`\`\`javascript
download_logs({
  incremental: true,
  manifest: "./custom/path/.manifest.json"
})
\`\`\`

### Manifest Contents
\`\`\`json
{
  "downloads": {
    "production-http-2025-11-09-14-PT1H.json": {
      "downloaded": "2025-11-09T15:30:00Z",
      "size": 52428800,
      "modified": "2025-11-09T15:00:00Z"
    },
    "production-app-2025-11-09-14-PT1H.json": {
      "downloaded": "2025-11-09T15:30:00Z",
      "size": 1048576,
      "modified": "2025-11-09T15:00:00Z"
    }
  }
}
\`\`\`

### Multiple Manifests
Use different manifest files for different download scenarios:
\`\`\`javascript
// Daily monitoring (incremental)
download_logs({
  incremental: true,
  manifest: "./monitoring/.manifest.json"
})

// Monthly archive (separate manifest)
download_logs({
  incremental: true,
  manifest: "./archive/.manifest.json"
})
\`\`\`

---

## When to Use Incremental Downloads

### ✅ **Perfect For:**

#### Daily Log Monitoring
\`\`\`javascript
// Every morning
download_logs({
  environment: "Production",
  logType: "http",
  incremental: true
})
\`\`\`
- Only downloads logs from last 24 hours
- Fast (seconds vs minutes)
- Keeps historical data

#### Continuous Deployment Monitoring
\`\`\`javascript
// After each deployment
download_logs({
  environment: "Production",
  incremental: true
})
\`\`\`
- Only fetches logs since last check
- Perfect for CI/CD pipelines

#### Large Log Archives
\`\`\`javascript
// Monthly compliance download
download_logs({
  startDate: "2025-01-01",
  endDate: "2025-11-09",
  incremental: true
})
\`\`\`
- First month: downloads all (slow)
- Subsequent months: only new logs (fast)

#### Blob/Asset Synchronization
\`\`\`javascript
// Keep local copy of production media
download_blobs({
  environment: "Production",
  containerName: "media",
  incremental: true
})
\`\`\`
- Only downloads new/modified assets
- Perfect for backup workflows

---

### ❌ **NOT Recommended For:**

#### First-Time Downloads
\`\`\`javascript
// No benefit - incremental = full on first run
download_logs({ incremental: true })
\`\`\`
**Why:** No manifest exists yet, so all files are "new"
**Better:** Use \`incremental: false\` for clarity

#### One-Time Operations
\`\`\`javascript
// Investigating specific incident
download_logs({
  startDate: "2025-11-09",
  endDate: "2025-11-09",
  incremental: false  // Just get what I need once
})
\`\`\`
**Why:** Won't download again, manifest adds overhead
**Better:** Full download for one-off tasks

#### When You Need Fresh Complete Copy
\`\`\`javascript
// Corrupted local files, need clean slate
download_logs({
  incremental: false  // Force full download
})
\`\`\`
**Why:** Incremental would skip files already in manifest
**Better:** Delete manifest or use \`incremental: false\`

---

## Workflow Examples

### Example 1: Daily Error Monitoring
\`\`\`javascript
// Monday
download_logs({
  environment: "Production",
  logType: "application",
  incremental: true
})
// Downloads: All logs (no manifest yet)
// Time: 10 minutes
// Size: 500MB

// Tuesday (24 hours later)
download_logs({
  environment: "Production",
  logType: "application",
  incremental: true
})
// Downloads: Only logs from last 24 hours
// Time: 30 seconds
// Size: 20MB

// Wednesday
download_logs({
  environment: "Production",
  logType: "application",
  incremental: true
})
// Downloads: Only logs from last 24 hours
// Time: 30 seconds
// Size: 18MB
\`\`\`

**Savings:** 9.5 minutes per day after first run

---

### Example 2: Weekly Production Backup
\`\`\`javascript
// Week 1
download_blobs({
  environment: "Production",
  containerName: "media",
  incremental: true,
  manifest: "./backups/.manifest.json"
})
// Downloads: 50GB of media
// Time: 2 hours

// Week 2 (7 days later)
download_blobs({
  environment: "Production",
  containerName: "media",
  incremental: true,
  manifest: "./backups/.manifest.json"
})
// Downloads: Only new/modified files (2GB)
// Time: 10 minutes
\`\`\`

**Savings:** 1 hour 50 minutes per week

---

### Example 3: CI/CD Pipeline Integration
\`\`\`javascript
// After deployment to Production
download_logs({
  environment: "Production",
  hoursBack: 1,  // Only last hour
  incremental: true,
  manifest: "./ci-logs/.manifest.json"
})

// Analyze logs for errors
// Report results to CI/CD
\`\`\`

**Benefits:**
- Fast feedback (seconds)
- No duplicate analysis
- Historical comparison

---

## Troubleshooting

### Problem: "Downloaded 0 files"
**Cause:** All files already in manifest
**Solution:**
- ✅ Expected behavior if no new logs
- ✅ Check server has new files
- ❌ Don't delete manifest unless needed

---

### Problem: Manifest is corrupt
**Symptoms:**
- JSON parse errors
- Unexpected behavior

**Solution:**
\`\`\`bash
# Delete manifest and start fresh
rm ./downloads/.download-manifest.json

# Next download will be full
download_logs({ incremental: true })
\`\`\`

---

### Problem: Manually deleted files
**Scenario:** You deleted local files but manifest still has them

**Issue:** Incremental won't re-download (manifest thinks you have them)

**Solution:**
\`\`\`bash
# Option 1: Delete manifest (forces full re-download)
rm ./downloads/.download-manifest.json

# Option 2: Edit manifest to remove deleted entries (advanced)
# Edit .download-manifest.json and remove specific entries
\`\`\`

---

### Problem: Want fresh copy
**Scenario:** Need to re-download everything

**Solution:**
\`\`\`javascript
// Option 1: Use incremental: false
download_logs({ incremental: false })

// Option 2: Delete manifest first
// rm ./downloads/.download-manifest.json
download_logs({ incremental: true })

// Option 3: Use different manifest
download_logs({
  incremental: true,
  manifest: "./fresh/.manifest.json"
})
\`\`\`

---

## Tools That Support Incremental Mode

### download_logs
\`\`\`javascript
download_logs({
  environment: "Production",
  logType: "http",
  incremental: true  // ← Incremental mode
})
\`\`\`

### download_blobs
\`\`\`javascript
download_blobs({
  environment: "Production",
  containerName: "media",
  incremental: true  // ← Incremental mode
})
\`\`\`

### Custom manifest paths
\`\`\`javascript
download_logs({
  incremental: true,
  manifest: "./custom/.manifest.json"  // ← Custom location
})
\`\`\`

---

## Best Practices

### 1. Use Incremental for Repeated Operations
\`\`\`javascript
// BAD: Full download every time
download_logs({ incremental: false })  // Every day

// GOOD: Incremental for monitoring
download_logs({ incremental: true })  // Only new logs
\`\`\`

### 2. Separate Manifests for Different Workflows
\`\`\`javascript
// Monitoring workflow
download_logs({
  incremental: true,
  manifest: "./monitoring/.manifest.json"
})

// Compliance archive workflow
download_logs({
  incremental: true,
  manifest: "./compliance/.manifest.json"
})
\`\`\`

### 3. Check Manifest Location
\`\`\`javascript
// Ensure manifest path exists
// Default: ./downloads/.download-manifest.json

// For custom paths, create directory first
mkdir -p ./custom/path
download_logs({
  incremental: true,
  manifest: "./custom/path/.manifest.json"
})
\`\`\`

### 4. Don't Delete Manifest Unnecessarily
- Manifest enables incremental benefits
- Only delete if corrupt or need fresh start
- Consider using different manifest for different use cases

### 5. Combine with Other Parameters
\`\`\`javascript
download_logs({
  environment: "Production",
  logType: "http",
  hoursBack: 48,        // Only last 48 hours
  incremental: true,    // But still track what's downloaded
  background: true      // Non-blocking
})
\`\`\`

---

## Summary

**Default behavior:** \`incremental: false\` (full download every time)

**When to use \`incremental: true\`:**
- ✅ Daily/weekly monitoring
- ✅ Continuous deployment checks
- ✅ Large archive synchronization
- ✅ Backup workflows

**When NOT to use incremental:**
- ❌ One-time downloads
- ❌ First download (no benefit)
- ❌ Need fresh complete copy

**Key benefits:**
- ⏱️ Time savings: Minutes → Seconds
- 💾 Disk space: Only new data
- 🌐 Bandwidth: Drastically reduced
- 🔄 Automation: Perfect for CI/CD

**Remember:** Incremental = full download on first run, then only new/changed files thereafter.`
                }
            }
        ];
    }
}

export default DownloadPrompts;

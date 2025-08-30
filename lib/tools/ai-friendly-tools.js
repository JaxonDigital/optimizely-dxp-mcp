/**
 * AI-Friendly Tool Wrappers
 * 
 * These tools provide goal-oriented, high-level interfaces that are optimized
 * for AI agents rather than human developers. They handle complete workflows
 * internally and reduce the cognitive load on AI decision-making.
 * 
 * Based on principles from "Why Human APIs Fail as MCP Tools"
 * 
 * @module ai-friendly-tools
 */

const ResponseBuilder = require('../response-builder');
const OutputLogger = require('../output-logger');
const SimpleTools = require('./simple-tools');
const DatabaseSimpleTools = require('./database-simple-tools');
const DeploymentTools = require('./deployment');
const BlobDownloadTools = require('./blob-download-tools');
const LogDownloadTools = require('./log-download-tools');
const LogAnalyzer = require('./log-analyzer');
const { getTelemetry } = require('../telemetry');

/**
 * Complete deployment workflow in a single call
 * Handles start, monitoring, and completion automatically
 */
async function performDeployment(args) {
    const startTime = Date.now();
    const telemetry = getTelemetry();
    
    try {
        OutputLogger.info('🤖 AI-Friendly Deployment: Starting intelligent deployment workflow');
        
        // Parse natural language intent
        const intent = parseDeploymentIntent(args.description || args.intent);
        
        // Use existing simple deploy with monitoring
        const deployArgs = {
            sourceEnvironment: intent.source,
            targetEnvironment: intent.target,
            deploymentType: intent.type,
            waitForCompletion: true, // Always wait for AI workflows
            ...args // Allow override
        };
        
        // SimpleTools.handleDeploy already handles the complete workflow
        const result = await SimpleTools.handleDeploy(deployArgs);
        
        // Add AI-friendly context
        const response = {
            ...result,
            summary: generateDeploymentSummary(intent, result),
            nextActions: suggestNextActions('deployment', result)
        };
        
        // Track telemetry for AI-friendly tool
        telemetry.trackToolUsage('perform_deployment', {
            source: intent.source,
            target: intent.target,
            type: intent.type,
            success: !result.error
        });
        
        return response;
        
    } catch (error) {
        // Track failure
        telemetry.trackToolUsage('perform_deployment', {
            success: false,
            error: error.message
        });
        
        return ResponseBuilder.error(
            `Deployment workflow failed: ${error.message}`,
            { 
                suggestion: 'Try "check environment status" to diagnose issues',
                alternativeTools: ['diagnose_issue', 'check_environment']
            }
        );
    }
}

/**
 * Complete database operation workflow
 * Handles export, monitoring, download, and restore in one call
 */
async function manageDatabaseOperation(args) {
    const telemetry = getTelemetry();
    
    try {
        const action = parseDatabaseAction(args.action || args.description);
        
        OutputLogger.info(`🤖 AI-Friendly Database: ${action.operation} for ${action.environment}`);
        
        switch (action.operation) {
            case 'backup':
            case 'export':
                // Use existing export with auto-download
                const exportResult = await DatabaseSimpleTools.handleExportDatabase({
                    environment: action.environment,
                    autoDownload: true,
                    waitForCompletion: true,
                    ...args
                });
                
                // Track telemetry
                telemetry.trackToolUsage('manage_database', {
                    operation: action.operation,
                    environment: action.environment,
                    success: !exportResult.error
                });
                
                return exportResult;
                
            case 'restore':
                telemetry.trackToolUsage('manage_database', {
                    operation: action.operation,
                    environment: action.environment,
                    attempted: true,
                    success: false
                });
                // This would handle restore workflow
                return ResponseBuilder.error(
                    'Database restore is not yet available',
                    { suggestion: 'Use "copy_content" to copy database between environments' }
                );
                
            case 'copy':
                // Handle database copy between environments
                const ContentTools = require('./content-tools');
                const copyResult = await ContentTools.handleCopyContent({
                    sourceEnvironment: action.source || 'Production',
                    targetEnvironment: action.target || 'Preproduction',
                    includeDatabase: true,
                    includeBlobs: false
                });
                
                // Track telemetry
                telemetry.trackToolUsage('manage_database', {
                    operation: action.operation,
                    source: action.source || 'Production',
                    target: action.target || 'Preproduction',
                    success: !copyResult.error
                });
                
                return copyResult;
                
            default:
                return ResponseBuilder.error(
                    `Unknown database action: ${action.operation}`,
                    { validActions: ['backup', 'export', 'restore', 'copy'] }
                );
        }
        
    } catch (error) {
        telemetry.trackToolUsage('manage_database', {
            operation: action.operation || 'unknown',
            success: false,
            error: error.message
        });
        
        return ResponseBuilder.error(
            `Database operation failed: ${error.message}`,
            { suggestion: 'Try "list recent exports" to see available backups' }
        );
    }
}

/**
 * Synchronize content between environments
 * Handles database, blobs, or both in a single operation
 */
async function synchronizeContent(args) {
    const telemetry = getTelemetry();
    
    try {
        const sync = parseContentSync(args.what || args.description);
        
        OutputLogger.info(`🤖 AI-Friendly Sync: ${sync.type} from ${sync.source} to ${sync.target}`);
        
        const operations = [];
        
        // Handle database sync
        if (sync.includeDatabase) {
            operations.push({
                type: 'database',
                status: 'pending'
            });
        }
        
        // Handle blob sync
        if (sync.includeBlobs) {
            operations.push({
                type: 'blobs',
                status: 'pending'
            });
        }
        
        // Execute operations
        const results = {
            operations: operations,
            summary: '',
            success: true
        };
        
        for (const op of operations) {
            try {
                if (op.type === 'database') {
                    OutputLogger.info('📊 Syncing database...');
                    const dbResult = await manageDatabaseOperation({
                        action: `copy from ${sync.source} to ${sync.target}`
                    });
                    op.status = 'completed';
                    op.result = dbResult;
                } else if (op.type === 'blobs') {
                    OutputLogger.info('📁 Syncing blobs...');
                    const blobResult = await BlobDownloadTools.handleDownloadBlobs({
                        environment: sync.source,
                        downloadPath: sync.blobPath,
                        previewOnly: false,
                        skipConfirmation: true
                    });
                    op.status = 'completed';
                    op.result = blobResult;
                }
            } catch (error) {
                op.status = 'failed';
                op.error = error.message;
                results.success = false;
            }
        }
        
        results.summary = generateSyncSummary(sync, results);
        results.nextActions = suggestNextActions('sync', results);
        
        // Track telemetry
        telemetry.trackToolUsage('sync_content', {
            type: sync.type,
            source: sync.source,
            target: sync.target,
            success: results.success
        });
        
        return ResponseBuilder.success(
            results.summary,
            results
        );
        
    } catch (error) {
        telemetry.trackToolUsage('sync_content', {
            success: false,
            error: error.message
        });
        
        return ResponseBuilder.error(
            `Content sync failed: ${error.message}`,
            { suggestion: 'Check environment status first' }
        );
    }
}

/**
 * Diagnose and analyze environment issues
 * Combines log analysis, deployment history, and status checks
 */
async function diagnoseEnvironmentIssue(args) {
    const telemetry = getTelemetry();
    
    try {
        const symptom = args.symptom || args.description || 'general health check';
        
        OutputLogger.info(`🤖 AI-Friendly Diagnosis: Analyzing "${symptom}"`);
        
        const diagnosis = {
            symptom: symptom,
            checks: [],
            findings: [],
            recommendations: []
        };
        
        // 1. Check environment status
        OutputLogger.info('🔍 Checking environment status...');
        const status = await SimpleTools.handleStatus({});
        diagnosis.checks.push({
            type: 'status',
            result: status
        });
        
        // 2. Check recent deployments
        OutputLogger.info('🔍 Checking recent deployments...');
        const deployments = await DeploymentTools.handleListDeployments({
            limit: 5
        });
        diagnosis.checks.push({
            type: 'deployments',
            result: deployments
        });
        
        // 3. Analyze logs if performance/error related
        if (symptom.match(/slow|error|fail|crash|down|500|timeout/i)) {
            OutputLogger.info('🔍 Analyzing logs for issues...');
            const logAnalysis = await LogAnalyzer.analyzeLogs({
                environment: 'Production',
                daysBack: 1,
                quickAnalysis: true
            });
            diagnosis.checks.push({
                type: 'logs',
                result: logAnalysis
            });
            
            // Extract findings from log analysis
            if (logAnalysis.data && logAnalysis.data.summary) {
                if (logAnalysis.data.summary.errorRate > 0.01) {
                    diagnosis.findings.push(`High error rate: ${(logAnalysis.data.summary.errorRate * 100).toFixed(2)}%`);
                }
                if (logAnalysis.data.patterns.httpErrors > 100) {
                    diagnosis.findings.push(`Frequent HTTP errors: ${logAnalysis.data.patterns.httpErrors} occurrences`);
                }
            }
        }
        
        // Generate diagnosis summary
        diagnosis.summary = generateDiagnosisSummary(symptom, diagnosis);
        diagnosis.recommendations = generateRecommendations(symptom, diagnosis);
        diagnosis.nextActions = suggestNextActions('diagnosis', diagnosis);
        
        // Track telemetry
        telemetry.trackToolUsage('diagnose_issue', {
            symptom: symptom,
            findings: diagnosis.findings.length,
            success: true
        });
        
        return ResponseBuilder.success(
            diagnosis.summary,
            diagnosis
        );
        
    } catch (error) {
        telemetry.trackToolUsage('diagnose_issue', {
            success: false,
            error: error.message
        });
        
        return ResponseBuilder.error(
            `Diagnosis failed: ${error.message}`,
            { suggestion: 'Try checking individual components: "status", "list deployments", "analyze logs"' }
        );
    }
}

/**
 * Check overall environment health
 * Quick comprehensive check of all systems
 */
async function checkEnvironmentHealth(args) {
    const telemetry = getTelemetry();
    
    try {
        const environment = args.environment || 'Production';
        
        OutputLogger.info(`🤖 AI-Friendly Health Check: ${environment}`);
        
        // Use quick status for fast response
        const status = await SimpleTools.handleQuick({
            environment: environment
        });
        
        // Interpret status for AI
        const health = {
            environment: environment,
            healthy: true,
            issues: [],
            metrics: {}
        };
        
        // Parse status for issues
        if (status.content && status.content[0] && status.content[0].text) {
            const statusText = status.content[0].text;
            
            // Check for common issues
            if (statusText.includes('❌')) {
                health.healthy = false;
                health.issues.push('One or more environments have issues');
            }
            
            if (statusText.includes('In Progress')) {
                health.issues.push('Deployment currently in progress');
            }
            
            if (statusText.includes('Verification')) {
                health.issues.push('Deployment awaiting verification');
            }
        }
        
        health.summary = health.healthy ? 
            `✅ ${environment} is healthy` : 
            `⚠️ ${environment} has ${health.issues.length} issue(s)`;
            
        health.nextActions = health.healthy ? 
            ['No action needed'] : 
            suggestNextActions('health', health);
        
        // Track telemetry
        telemetry.trackToolUsage('check_health', {
            environment: environment,
            healthy: health.healthy,
            issues: health.issues.length
        });
        
        return ResponseBuilder.success(
            health.summary,
            health
        );
        
    } catch (error) {
        telemetry.trackToolUsage('check_health', {
            success: false,
            error: error.message
        });
        
        return ResponseBuilder.error(
            `Health check failed: ${error.message}`,
            { suggestion: 'Try "test_connection" to verify connectivity' }
        );
    }
}

// Helper functions

function parseDeploymentIntent(description) {
    if (!description) {
        return {
            source: 'Preproduction',
            target: 'Production',
            type: 'code'
        };
    }
    
    const text = description.toLowerCase();
    
    // Parse target
    let target = 'Production';
    if (text.includes('staging') || text.includes('pre')) {
        target = 'Preproduction';
    } else if (text.includes('int')) {
        target = 'Integration';
    }
    
    // Parse source (intelligent defaults)
    let source = target === 'Production' ? 'Preproduction' : 
                 target === 'Preproduction' ? 'Integration' : 
                 'Preproduction';
                 
    if (text.includes('from prod')) {
        source = 'Production';
    } else if (text.includes('from pre') || text.includes('from staging')) {
        source = 'Preproduction';
    } else if (text.includes('from int')) {
        source = 'Integration';
    }
    
    // Parse type
    let type = 'code'; // Default for upward
    if (source === 'Production' || text.includes('content') || text.includes('data')) {
        type = 'content';
    }
    if (text.includes('code')) {
        type = 'code';
    }
    if (text.includes('everything') || text.includes('all')) {
        type = 'all';
    }
    
    return { source, target, type };
}

function parseDatabaseAction(description) {
    if (!description) {
        return {
            operation: 'backup',
            environment: 'Production'
        };
    }
    
    const text = description.toLowerCase();
    
    // Parse operation
    let operation = 'backup';
    if (text.includes('restore')) {
        operation = 'restore';
    } else if (text.includes('copy')) {
        operation = 'copy';
    } else if (text.includes('export')) {
        operation = 'export';
    }
    
    // Parse environment
    let environment = 'Production';
    if (text.includes('staging') || text.includes('pre')) {
        environment = 'Preproduction';
    } else if (text.includes('int')) {
        environment = 'Integration';
    }
    
    // Parse source/target for copy
    const result = { operation, environment };
    
    if (operation === 'copy') {
        const fromMatch = text.match(/from (\w+)/);
        const toMatch = text.match(/to (\w+)/);
        
        if (fromMatch) {
            result.source = fromMatch[1].includes('prod') ? 'Production' :
                           fromMatch[1].includes('pre') ? 'Preproduction' : 
                           'Integration';
        }
        if (toMatch) {
            result.target = toMatch[1].includes('prod') ? 'Production' :
                           toMatch[1].includes('pre') ? 'Preproduction' : 
                           'Integration';
        }
    }
    
    return result;
}

function parseContentSync(description) {
    const text = (description || 'all from production to staging').toLowerCase();
    
    const sync = {
        type: 'all',
        source: 'Production',
        target: 'Preproduction',
        includeDatabase: true,
        includeBlobs: true
    };
    
    // Parse what to sync
    if (text.includes('database') || text.includes('db')) {
        sync.type = 'database';
        sync.includeBlobs = false;
    } else if (text.includes('blob') || text.includes('file') || text.includes('media')) {
        sync.type = 'blobs';
        sync.includeDatabase = false;
    }
    
    // Parse direction
    if (text.includes('from prod')) {
        sync.source = 'Production';
    } else if (text.includes('from pre') || text.includes('from staging')) {
        sync.source = 'Preproduction';
    } else if (text.includes('from int')) {
        sync.source = 'Integration';
    }
    
    if (text.includes('to prod')) {
        sync.target = 'Production';
    } else if (text.includes('to pre') || text.includes('to staging')) {
        sync.target = 'Preproduction';
    } else if (text.includes('to int')) {
        sync.target = 'Integration';
    }
    
    return sync;
}

function generateDeploymentSummary(intent, result) {
    if (result.error) {
        return `❌ Deployment from ${intent.source} to ${intent.target} failed`;
    }
    return `✅ Successfully deployed ${intent.type} from ${intent.source} to ${intent.target}`;
}

function generateSyncSummary(sync, results) {
    const successful = results.operations.filter(op => op.status === 'completed').length;
    const failed = results.operations.filter(op => op.status === 'failed').length;
    
    if (failed === 0) {
        return `✅ Successfully synchronized ${sync.type} from ${sync.source} to ${sync.target}`;
    } else if (successful === 0) {
        return `❌ Failed to synchronize ${sync.type}`;
    } else {
        return `⚠️ Partially synchronized: ${successful} succeeded, ${failed} failed`;
    }
}

function generateDiagnosisSummary(symptom, diagnosis) {
    if (diagnosis.findings.length === 0) {
        return `✅ No issues found related to "${symptom}"`;
    }
    return `⚠️ Found ${diagnosis.findings.length} issue(s) related to "${symptom}"`;
}

function generateRecommendations(symptom, diagnosis) {
    const recommendations = [];
    
    diagnosis.findings.forEach(finding => {
        if (finding.includes('error rate')) {
            recommendations.push('Review application logs for error details');
            recommendations.push('Check recent code deployments');
        }
        if (finding.includes('HTTP errors')) {
            recommendations.push('Check web server configuration');
            recommendations.push('Review load balancer health');
        }
    });
    
    if (recommendations.length === 0 && symptom.includes('slow')) {
        recommendations.push('Check database performance');
        recommendations.push('Review CDN configuration');
        recommendations.push('Analyze application metrics');
    }
    
    return recommendations;
}

function suggestNextActions(context, result) {
    switch (context) {
        case 'deployment':
            if (result.error) {
                return [
                    'diagnose_issue "deployment failed"',
                    'check_environment',
                    'rollback_deployment'
                ];
            }
            return [
                'check_environment',
                'monitor_performance',
                'view_logs'
            ];
            
        case 'sync':
            if (!result.success) {
                return [
                    'diagnose_issue "sync failed"',
                    'check_environment source',
                    'retry_sync'
                ];
            }
            return [
                'verify_content',
                'check_environment target',
                'run_tests'
            ];
            
        case 'diagnosis':
            if (result.findings.length > 0) {
                return [
                    'view_detailed_logs',
                    'check_recent_deployments',
                    'contact_support'
                ];
            }
            return [
                'monitor_environment',
                'schedule_maintenance'
            ];
            
        case 'health':
            if (result.issues.length > 0) {
                return [
                    'diagnose_issue',
                    'view_deployment_status',
                    'check_logs'
                ];
            }
            return [
                'continue_monitoring'
            ];
            
        default:
            return [];
    }
}

module.exports = {
    performDeployment,
    manageDatabaseOperation,
    synchronizeContent,
    diagnoseEnvironmentIssue,
    checkEnvironmentHealth
};
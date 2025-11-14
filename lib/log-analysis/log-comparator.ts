/**
 * Log Comparator Module
 * Compares baseline vs slot log analysis for deployment decisions
 * Part of DXP-112 implementation
 */

interface LogAnalysisResult {
    errors?: {
        total: number;
    };
    performance?: {
        avgResponseTime?: number | null;
        p95ResponseTime?: number | null;
        p99ResponseTime?: number | null;
    };
    summary?: {
        healthScore: number;
    };
}

interface ComparisonThresholds {
    maxErrorIncrease?: number;
    maxScoreDecrease?: number;
    maxLatencyIncrease?: number;
}

interface ComparisonResult {
    decision: 'safe' | 'warning' | 'critical';
    recommendation: 'proceed' | 'investigate' | 'rollback';
    baseline: {
        totalErrors: number;
        healthScore: number;
        avgLatency: number | null;
        p95Latency: number | null;
    };
    slot: {
        totalErrors: number;
        healthScore: number;
        avgLatency: number | null;
        p95Latency: number | null;
    };
    deltas: {
        errorDelta: number;
        errorDeltaPercent: number;
        scoreDelta: number;
        latencyDelta: number;
    };
    reasons: string[];
    thresholdsApplied: {
        maxErrorIncrease: number;
        maxScoreDecrease: number;
        maxLatencyIncrease: number;
    };
}

/**
 * Compare two log analysis results and provide deployment recommendation
 * @param {Object} baseline - Baseline log analysis result
 * @param {Object} slot - Slot log analysis result
 * @param {Object} thresholds - Optional threshold overrides
 * @returns {Object} Comparison result with decision and recommendation
 */
function compareLogs(
    baseline: LogAnalysisResult,
    slot: LogAnalysisResult,
    thresholds: ComparisonThresholds = {}
): ComparisonResult {
    // Apply default thresholds
    const maxErrorIncrease = thresholds.maxErrorIncrease ?? 0.5;  // 50%
    const maxScoreDecrease = thresholds.maxScoreDecrease ?? 20;   // 20 points
    const maxLatencyIncrease = thresholds.maxLatencyIncrease ?? 100; // 100ms

    // Extract key metrics
    const baselineErrors = baseline.errors?.total ?? 0;
    const slotErrors = slot.errors?.total ?? 0;
    const baselineScore = baseline.summary?.healthScore ?? 100;
    const slotScore = slot.summary?.healthScore ?? 100;
    const baselineLatency = baseline.performance?.p95ResponseTime ?? 0;
    const slotLatency = slot.performance?.p95ResponseTime ?? 0;

    // Calculate deltas
    const errorDelta = slotErrors - baselineErrors;
    const errorDeltaPercent = baselineErrors > 0
        ? errorDelta / baselineErrors
        : (slotErrors > 0 ? 1.0 : 0);  // If baseline=0, slot>0 = 100% increase
    const scoreDelta = slotScore - baselineScore;
    const latencyDelta = slotLatency - baselineLatency;

    // Evaluate thresholds
    const reasons: string[] = [];
    let decision: 'safe' | 'warning' | 'critical' = 'safe';

    // Check error rate increase
    if (errorDeltaPercent > maxErrorIncrease) {
        const percentText = (errorDeltaPercent * 100).toFixed(1);
        reasons.push(`Error rate increased by ${percentText}% (${baselineErrors} → ${slotErrors})`);
        decision = 'critical';
    }

    // Check health score decrease
    if (scoreDelta < 0 && Math.abs(scoreDelta) > maxScoreDecrease) {
        reasons.push(`Health score dropped from ${baselineScore} to ${slotScore} (${scoreDelta} points)`);
        decision = decision === 'critical' ? 'critical' : 'warning';
    }

    // Check latency increase
    if (latencyDelta > maxLatencyIncrease) {
        reasons.push(`P95 latency increased by ${latencyDelta}ms (${baselineLatency}ms → ${slotLatency}ms)`);
        decision = decision === 'critical' ? 'critical' : 'warning';
    }

    // If no issues found, add positive reasons
    if (reasons.length === 0) {
        if (scoreDelta > 0) {
            reasons.push(`Health score improved from ${baselineScore} to ${slotScore}`);
        }
        if (errorDelta <= 0) {
            reasons.push(`Error rate maintained or decreased (${baselineErrors} → ${slotErrors})`);
        }
        if (latencyDelta <= 0) {
            reasons.push(`Latency maintained or improved (${baselineLatency}ms → ${slotLatency}ms)`);
        }
    }

    // Make recommendation
    let recommendation: 'proceed' | 'investigate' | 'rollback';
    if (decision === 'safe') {
        recommendation = 'proceed';
    } else if (decision === 'warning') {
        recommendation = 'investigate';
    } else {
        recommendation = 'rollback';
    }

    return {
        decision,
        recommendation,
        baseline: {
            totalErrors: baselineErrors,
            healthScore: baselineScore,
            avgLatency: baseline.performance?.avgResponseTime ?? 0,
            p95Latency: baselineLatency
        },
        slot: {
            totalErrors: slotErrors,
            healthScore: slotScore,
            avgLatency: slot.performance?.avgResponseTime ?? 0,
            p95Latency: slotLatency
        },
        deltas: {
            errorDelta,
            errorDeltaPercent: parseFloat((errorDeltaPercent * 100).toFixed(2)),
            scoreDelta,
            latencyDelta
        },
        reasons,
        thresholdsApplied: {
            maxErrorIncrease: maxErrorIncrease * 100,  // Convert to percentage for display
            maxScoreDecrease,
            maxLatencyIncrease
        }
    };
}

export default {
    compareLogs
};

/**
 * Gate 6 — Canary Deployment Health
 * ─────────────────────────────────────────────────────────────────────────────
 * If a canary deployment is active, it must be healthy before the release
 * can expand. If no canary is configured, this gate passes automatically.
 *
 * Weight: 10 pts
 * Severity: MEDIUM
 *
 * Rules:
 *   N/A → no canary configured (auto-PASSED, noted)
 *   FAILED  → canary active but not healthy
 *   FAILED  → canary health score < 80%
 *   WARNING → canary healthy but health score 80–94%
 *   PASSED  → canary healthy with health score >= 95%
 */

import { get, daysSince } from '../utils.js';

export function runCanaryGate(flags) {
  const canaryActive  = get(flags, 'quality.canary.active', false);
  const canaryHealthy = get(flags, 'quality.canary.healthy', false);
  const healthScore   = get(flags, 'quality.canary.healthScore', null);
  const trafficPct    = get(flags, 'quality.canary.trafficPercentage', 0);
  const startedAt     = get(flags, 'quality.canary.startedAt', null);

  const base = {
    id: 6,
    name: 'Canary Health',
    icon: '🐤',
    severity: 'MEDIUM',
    weight: 10,
  };

  // No canary deployment — gate passes automatically
  if (!canaryActive) {
    return {
      ...base,
      status: 'PASSED',
      score: base.weight,
      message: 'No canary deployment configured — gate passes automatically',
      detail:
        'No active canary was declared in `quality.canary`. ' +
        'If you roll out to >10% without canary validation, consider enabling one.',
      remediation: null,
    };
  }

  // Canary active but explicitly marked unhealthy
  if (!canaryHealthy) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `Canary at ${trafficPct}% traffic is UNHEALTHY`,
      detail:
        `The canary deployment serving ${trafficPct}% of traffic is marked unhealthy ` +
        `(\`quality.canary.healthy: false\`). Expanding a failing canary ` +
        `to more users is not permitted.`,
      remediation:
        '1. Immediately diagnose the canary failure (logs, metrics, traces)\n' +
        '2. Roll back the canary if errors are user-impacting\n' +
        '3. Fix the root cause, redeploy the canary\n' +
        '4. Confirm health before re-running GateKeeper',
    };
  }

  // Canary healthy but health score is poor
  if (healthScore !== null && healthScore < 80) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `Canary health score ${healthScore}% is critically low (minimum: 80%)`,
      detail:
        `Despite being marked \`healthy: true\`, the canary health score of ` +
        `${healthScore}% is below the 80% floor. This suggests significant degradation ` +
        `that the binary health flag has not captured.`,
      remediation:
        '1. Check the metrics behind the health score (latency, error rate, saturation)\n' +
        '2. Investigate the degradation causes\n' +
        '3. Improve score to ≥ 95% before proceeding\n' +
        '4. Update `quality.canary.healthScore` with the latest value',
    };
  }

  // Canary healthy but health score is mediocre (80–94%)
  if (healthScore !== null && healthScore < 95) {
    const agedays = daysSince(startedAt);
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `Canary healthy but health score is ${healthScore}% — below the 95% target`,
      detail:
        `The canary has been running for ${agedays} day(s) at ${trafficPct}% traffic. ` +
        `Health score ${healthScore}% is acceptable but below the ideal ≥ 95% threshold. ` +
        `Monitor closely before expanding rollout.`,
      remediation:
        '1. Review which metrics are pulling the health score below 95%\n' +
        '2. Allow more time for health trends to stabilise\n' +
        '3. Consider expanding rollout only after score improves',
    };
  }

  // Canary healthy, good score
  const agedays = daysSince(startedAt);
  const scoreText = healthScore !== null ? `${healthScore}% health score` : 'healthy';
  return {
    ...base,
    status: 'PASSED',
    score: base.weight,
    message: `Canary at ${trafficPct}% traffic — ${scoreText} after ${agedays} day(s)`,
    detail:
      `The canary deployment is healthy and performing well at ${trafficPct}% traffic. ` +
      `${healthScore !== null ? `Health score: ${healthScore}%.` : ''} Canary evidence supports broader rollout.`,
    remediation: null,
  };
}

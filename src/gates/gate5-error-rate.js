/**
 * Gate 5 — Error Rate
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that the current production/staging error rate is within
 * acceptable bounds before expanding the release.
 *
 * Weight: 18 pts
 * Severity: HIGH
 *
 * Rules:
 *   FAILED  → errorRatePercent > maximumErrorRatePercent
 *   WARNING → errorRatePercent between 50% and 100% of the maximum threshold
 *   PASSED  → errorRatePercent < 50% of the threshold (healthy baseline)
 *   PASSED  → errorRatePercent < threshold (acceptable, with note)
 */

import { get } from '../utils.js';

export function runErrorRateGate(flags) {
  const errorRate = get(flags, 'quality.errorRatePercent', null);
  const maxRate   = get(flags, 'quality.maximumErrorRatePercent', 1.0);

  const base = {
    id: 5,
    name: 'Error Rate',
    icon: '📉',
    severity: 'HIGH',
    weight: 18,
  };

  // Missing data
  if (errorRate === null || errorRate === undefined) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: 'Error rate not reported — cannot assess baseline health',
      detail:
        'The `quality.errorRatePercent` field is missing from flags.json. ' +
        'GateKeeper cannot verify service health before expanding rollout.',
      remediation:
        '1. Add error rate monitoring (Datadog, New Relic, CloudWatch, etc.)\n' +
        '2. Populate `quality.errorRatePercent` with the current 24h average\n' +
        '3. Set `quality.maximumErrorRatePercent` to your SLO threshold (e.g., 1.0)',
    };
  }

  const threshold50pct = maxRate * 0.5;

  // Above maximum — FAILED
  if (errorRate > maxRate) {
    const overage = ((errorRate / maxRate) * 100 - 100).toFixed(0);
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `Error rate ${errorRate}% exceeds the ${maxRate}% maximum (${overage}% over limit)`,
      detail:
        `The current error rate of ${errorRate}% breaches the configured maximum of ` +
        `${maxRate}%. Expanding the rollout while errors are elevated would worsen ` +
        `user impact and violate SLO targets.`,
      remediation:
        '1. Investigate the root cause of elevated errors immediately\n' +
        '2. Check recent deployments, config changes, and upstream dependencies\n' +
        '3. Resolve or mitigate the error source\n' +
        '4. Wait for error rate to drop below the threshold for a sustained period\n' +
        '5. Update `quality.errorRatePercent` and re-run GateKeeper',
    };
  }

  // Between 50% and 100% of maximum — WARNING
  if (errorRate >= threshold50pct) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `Error rate ${errorRate}% is elevated — ${((errorRate / maxRate) * 100).toFixed(0)}% of the ${maxRate}% limit`,
      detail:
        `The error rate is within limits but higher than the healthy baseline. ` +
        `At ${errorRate}%, the service is at ${((errorRate / maxRate) * 100).toFixed(0)}% of its maximum ` +
        `tolerated error rate. Further rollout expansion should be monitored closely.`,
      remediation:
        '1. Investigate what is causing the elevated error rate\n' +
        '2. Monitor for 30 minutes before expanding rollout further\n' +
        '3. Consider reducing rollout percentage temporarily if errors trend up',
    };
  }

  // Healthy — PASSED
  return {
    ...base,
    status: 'PASSED',
    score: base.weight,
    message: `Error rate ${errorRate}% — well within the ${maxRate}% limit`,
    detail:
      `The current error rate is ${errorRate}%, only ${((errorRate / maxRate) * 100).toFixed(0)}% ` +
      `of the maximum threshold. Service baseline is healthy.`,
    remediation: null,
  };
}

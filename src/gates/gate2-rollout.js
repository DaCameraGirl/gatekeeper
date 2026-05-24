/**
 * Gate 2 — Rollout Percentage
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that the configured rollout percentage is within safe bounds,
 * and cross-checks it against blast radius / canary health.
 *
 * Weight: 10 pts
 * Severity: HIGH
 *
 * Rules:
 *   FAILED  → rolloutPercentage > maxRolloutPercentage
 *   FAILED  → rolloutPercentage === 100 with no healthy canary and blast ≠ 'low'
 *   WARNING → rolloutPercentage > 75 AND blast radius is 'high' or 'critical'
 *   PASSED  → everything else
 */

import { get } from '../utils.js';

export function runRolloutGate(flags) {
  const rollout     = get(flags, 'flags.rolloutPercentage', 0);
  const maxRollout  = get(flags, 'flags.maxRolloutPercentage', 100);
  const blastRadius = get(flags, 'risk.blastRadius', 'unknown');
  const canaryActive  = get(flags, 'quality.canary.active', false);
  const canaryHealthy = get(flags, 'quality.canary.healthy', false);

  const base = {
    id: 2,
    name: 'Rollout Percentage',
    icon: '📊',
    severity: 'HIGH',
    weight: 10,
  };

  // Hard failure: exceeds configured maximum
  if (rollout > maxRollout) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `Rollout ${rollout}% exceeds the configured maximum of ${maxRollout}%`,
      detail:
        `The rollout percentage (${rollout}%) is above the ceiling defined in ` +
        `\`flags.flags.maxRolloutPercentage\` (${maxRollout}%). ` +
        `This gate prevents accidental over-exposure.`,
      remediation:
        `1. Lower \`flags.flags.rolloutPercentage\` to ≤ ${maxRollout}%\n` +
        `2. Or, if the higher value is intentional, raise \`maxRolloutPercentage\` ` +
        `with explicit approval from the release manager`,
    };
  }

  // Hard failure: 100% rollout with no canary validation and non-trivial blast radius
  if (rollout === 100 && (!canaryActive || !canaryHealthy) && blastRadius !== 'low') {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: 'Full 100% rollout attempted without a healthy canary deployment',
      detail:
        `A full (100%) rollout to a "${blastRadius}" blast-radius feature requires ` +
        `a passing canary deployment first. No healthy canary was detected. ` +
        `This gate prevents untested 100% rollouts.`,
      remediation:
        '1. Start a canary deployment at 5–10% traffic\n' +
        '2. Observe error rates and latency for at least 30 minutes\n' +
        '3. Set `quality.canary.active = true` and `healthy = true` once stable\n' +
        '4. Then raise `rolloutPercentage` to 100%',
    };
  }

  // Warning: aggressive rollout on high/critical blast feature
  if (rollout > 75 && (blastRadius === 'high' || blastRadius === 'critical')) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `High rollout (${rollout}%) on a "${blastRadius}" blast-radius feature`,
      detail:
        `Rolling out to ${rollout}% of users on a "${blastRadius}" blast-radius feature ` +
        `carries elevated risk. Consider a staged rollout to limit exposure.`,
      remediation:
        `1. Consider reducing rollout to 25–50% first\n` +
        `2. Monitor error rates for 30 minutes at each stage\n` +
        `3. Ensure rollback plan is tested and documented`,
    };
  }

  // All clear
  return {
    ...base,
    status: 'PASSED',
    score: base.weight,
    message: `Rollout at ${rollout}% — within bounds (max: ${maxRollout}%)`,
    detail: `The rollout percentage is within configured limits and consistent with the blast radius profile.`,
    remediation: null,
  };
}

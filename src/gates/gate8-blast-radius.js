/**
 * Gate 8 — Blast Radius Assessment
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates the potential user and business impact of a failed release.
 * Cross-checks blast radius classification against rollback plan quality,
 * criticality flags, and percentage of the user base affected.
 *
 * Weight: 6 pts
 * Severity: MEDIUM
 *
 * Rules:
 *   FAILED  → blast radius 'critical' with no rollback plan
 *   FAILED  → critical path system with no rollback plan
 *   WARNING → blast radius 'high' or 'critical' (even with rollback)
 *   WARNING → >25% of user base affected with no rollback plan
 *   PASSED  → 'low' or 'medium' blast radius with rollback plan
 */

import { get } from '../utils.js';

export function runBlastRadiusGate(flags) {
  const blastRadius       = get(flags, 'risk.blastRadius', 'unknown');
  const usersAffected     = get(flags, 'risk.estimatedUsersAffected', 0);
  const totalUsers        = get(flags, 'risk.totalUserBase', 0);
  const criticalPath      = get(flags, 'risk.criticalPath', false);
  const hasRollbackPlan   = get(flags, 'risk.hasRollbackPlan', false);
  const rollbackMinutes   = get(flags, 'risk.rollbackTimeMinutes', null);
  const financialImpact   = get(flags, 'risk.financialImpact', false);
  const dataPrivacy       = get(flags, 'risk.dataPrivacy', false);

  const base = {
    id: 8,
    name: 'Blast Radius',
    icon: '💥',
    severity: 'MEDIUM',
    weight: 6,
  };

  const impactPct = totalUsers > 0 ? ((usersAffected / totalUsers) * 100).toFixed(1) : null;
  const extraFlags = [
    financialImpact ? 'financial impact' : null,
    dataPrivacy ? 'data-privacy risk' : null,
    criticalPath ? 'critical path system' : null,
  ].filter(Boolean).join(', ');

  const rollbackNote = hasRollbackPlan
    ? `Rollback plan: available (${rollbackMinutes ?? '?'} min estimated).`
    : 'No rollback plan documented.';

  // Critical blast + no rollback = hard failure
  if ((blastRadius === 'critical' || criticalPath) && !hasRollbackPlan) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `"${blastRadius}" blast radius on a critical system with no rollback plan`,
      detail:
        `This release has a "${blastRadius}" blast radius${criticalPath ? ' on a critical-path system' : ''}. ` +
        `${extraFlags ? `Risk factors: ${extraFlags}.` : ''} ` +
        `A rollback plan is mandatory for this risk profile. None is documented.`,
      remediation:
        '1. Document a concrete rollback procedure in `risk.rollbackProcedure`\n' +
        '2. Set `risk.hasRollbackPlan: true` after the procedure is tested\n' +
        '3. Set `risk.rollbackTimeMinutes` with a realistic time estimate\n' +
        '4. Get sign-off from a senior engineer or release manager',
    };
  }

  // High/critical blast radius — warning even with rollback
  if (blastRadius === 'high' || blastRadius === 'critical') {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `"${blastRadius}" blast radius — ${impactPct ? impactPct + '% of users' : usersAffected.toLocaleString() + ' users'} affected`,
      detail:
        `Blast radius is classified as "${blastRadius}". ` +
        `${impactPct ? `Estimated ${impactPct}% of the ${totalUsers.toLocaleString()}-user base affected.` : ''} ` +
        `${extraFlags ? `Risk factors: ${extraFlags}. ` : ''}` +
        rollbackNote,
      remediation:
        '1. Ensure rollback procedure is tested and ready\n' +
        '2. Set up elevated monitoring before and during rollout\n' +
        '3. Have the on-call engineer standing by during rollout\n' +
        '4. Consider a staged rollout with traffic at ≤ 10% initially',
    };
  }

  // High user impact with no rollback
  if (impactPct !== null && parseFloat(impactPct) > 25 && !hasRollbackPlan) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `${impactPct}% of users affected with no documented rollback plan`,
      detail:
        `An estimated ${usersAffected.toLocaleString()} users (${impactPct}% of ${totalUsers.toLocaleString()}) ` +
        `may be affected by this release, but no rollback plan is documented. ` +
        `${extraFlags ? `Risk factors: ${extraFlags}.` : ''}`,
      remediation:
        '1. Document a rollback procedure in `risk.rollbackProcedure`\n' +
        '2. Test the rollback in staging\n' +
        '3. Set `risk.hasRollbackPlan: true` and `risk.rollbackTimeMinutes`',
    };
  }

  // Clear
  return {
    ...base,
    status: 'PASSED',
    score: base.weight,
    message: `"${blastRadius}" blast radius${impactPct ? ` — ${impactPct}% of users` : ''}. ${rollbackNote}`,
    detail:
      `Blast radius is "${blastRadius}". ` +
      `${impactPct ? `Estimated ${impactPct}% of users affected. ` : ''}` +
      `${extraFlags ? `Risk factors: ${extraFlags}. ` : ''}` +
      rollbackNote,
    remediation: null,
  };
}

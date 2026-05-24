/**
 * Gate 3 — Environment Readiness
 * ─────────────────────────────────────────────────────────────────────────────
 * Confirms that the release has been validated in lower environments before
 * reaching production. Staging validation is REQUIRED for a passing grade.
 *
 * Weight: 22 pts  (highest of the scoring gates — env discipline matters most)
 * Severity: HIGH
 *
 * Rules:
 *   FAILED  → no environment validated at all
 *   FAILED  → staging not validated but production is targeted
 *   WARNING → only development validated (staging skipped)
 *   PASSED  → staging validated
 */

import { get, daysSince } from '../utils.js';

export function runEnvironmentGate(flags) {
  const envs       = get(flags, 'flags.environments', {});
  const stagingVal = get(flags, 'flags.environments.staging.validatedAt', null);
  const devVal     = get(flags, 'flags.environments.development.validatedAt', null);
  const prodTarget = get(flags, 'flags.environments.production.enabled', false);

  const base = {
    id: 3,
    name: 'Environment Readiness',
    icon: '🌍',
    severity: 'HIGH',
    weight: 22,
  };

  const hasAnyValidation = stagingVal || devVal;

  // No environment has been validated at all
  if (!hasAnyValidation) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: 'No environment has been validated — zero testing evidence',
      detail:
        'Neither development nor staging has a recorded `validatedAt` timestamp. ' +
        'GateKeeper requires at minimum staging validation before any production gating.',
      remediation:
        '1. Deploy to development and run integration tests\n' +
        '2. Set `flags.environments.development.validatedAt` with the timestamp\n' +
        '3. Deploy to staging and run full regression + smoke tests\n' +
        '4. Set `flags.environments.staging.validatedAt` with the timestamp\n' +
        '5. Only then target production',
    };
  }

  // Staging skipped — only dev validated, but production is being targeted
  if (!stagingVal && prodTarget) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: 'Production targeted but staging has never been validated',
      detail:
        `Development was validated on ${devVal}, but staging has no ` +
        '`validatedAt` record and production is already enabled in flags. ' +
        'Skipping staging is not permitted when production is targeted.',
      remediation:
        '1. Deploy to staging and run the full test suite\n' +
        '2. Set `flags.environments.staging.validatedAt` with ISO timestamp\n' +
        '3. Disable `production.enabled` until staging validation completes',
    };
  }

  // Staging validated — check how stale it is
  if (stagingVal) {
    const staledays = daysSince(stagingVal);

    // Stale staging: more than 14 days old
    if (staledays > 14) {
      return {
        ...base,
        status: 'WARNING',
        score: Math.floor(base.weight / 2),
        message: `Staging validation is ${staledays} days old — may be stale`,
        detail:
          `Staging was last validated ${staledays} days ago (${stagingVal}). ` +
          `For active development with frequent changes, validation older than 14 days ` +
          `may not reflect the current state of the branch.`,
        remediation:
          '1. Re-deploy current branch to staging\n' +
          '2. Run smoke tests and integration suite\n' +
          '3. Update `flags.environments.staging.validatedAt` to today\'s timestamp',
      };
    }

    return {
      ...base,
      status: 'PASSED',
      score: base.weight,
      message: `Staging validated ${staledays} day(s) ago — environment chain is sound`,
      detail:
        `Staging was validated on ${stagingVal} (${staledays} day(s) ago). ` +
        `Environment readiness chain: development ✓ → staging ✓ → production ready.`,
      remediation: null,
    };
  }

  // Only dev validated, no production target yet — warning
  return {
    ...base,
    status: 'WARNING',
    score: Math.floor(base.weight / 2),
    message: 'Only development validated — staging is required before production',
    detail:
      `Development was validated on ${devVal} but staging has not been validated. ` +
      `This is acceptable only if production is not yet targeted.`,
    remediation:
      '1. Deploy to staging\n' +
      '2. Run the full test suite\n' +
      '3. Update `flags.environments.staging.validatedAt`',
  };
}

/**
 * Gate 7 — Flag Staleness
 * ─────────────────────────────────────────────────────────────────────────────
 * Long-lived feature flags are a code smell and an operational hazard.
 * This gate enforces maximum flag age to prevent flag debt accumulation.
 *
 * Weight: 8 pts
 * Severity: MEDIUM
 *
 * Rules:
 *   FAILED  → flag age > 90 days (dangerously stale)
 *   WARNING → flag age 60–90 days (approaching stale)
 *   PASSED  → flag age < 60 days
 */

import { get, daysSince } from '../utils.js';

const STALE_DAYS    = 90;   // FAILED threshold
const WARNING_DAYS  = 60;   // WARNING threshold

export function runFlagAgeGate(flags) {
  const createdAt     = get(flags, 'release.createdAt', null);
  const lastModified  = get(flags, 'release.lastModified', null);
  const targetDate    = get(flags, 'release.targetDate', null);
  const feature       = get(flags, 'release.feature', 'unknown');

  const base = {
    id: 7,
    name: 'Flag Staleness',
    icon: '⏳',
    severity: 'MEDIUM',
    weight: 8,
  };

  // No creation date — cannot assess
  if (!createdAt) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: 'Flag creation date not set — cannot assess age',
      detail:
        'The `release.createdAt` field is missing. GateKeeper cannot determine ' +
        'how long this feature flag has been active.',
      remediation:
        '1. Add `release.createdAt` with the ISO timestamp of when the flag was first created\n' +
        '2. Add `release.lastModified` to track activity',
    };
  }

  const agedays = daysSince(createdAt);

  // Check target date overdue
  const overdue = targetDate && new Date(targetDate) < new Date();
  const overdueNote = overdue
    ? ` The target release date (${targetDate}) has already passed.`
    : '';

  // Dangerously stale
  if (agedays > STALE_DAYS) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `Flag "${feature}" is ${agedays} days old — exceeds the ${STALE_DAYS}-day maximum`,
      detail:
        `This feature flag has been active for ${agedays} days, exceeding the ` +
        `${STALE_DAYS}-day staleness limit.${overdueNote} Long-lived flags accumulate ` +
        `hidden dependencies, complicate testing, and increase the blast radius of removal.`,
      remediation:
        '1. Schedule a dedicated flag cleanup task\n' +
        '2. Decide: ship the feature fully (remove flag) or delete the code\n' +
        '3. If still in progress, document why and update `release.targetDate`\n' +
        '4. Reduce flag age risk by setting a hard expiry in your flag management system',
    };
  }

  // Approaching stale
  if (agedays >= WARNING_DAYS) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `Flag "${feature}" is ${agedays} days old — approaching the ${STALE_DAYS}-day limit`,
      detail:
        `This flag has ${STALE_DAYS - agedays} days remaining before it becomes stale.${overdueNote} ` +
        `Plan for cleanup to avoid flag debt.`,
      remediation:
        '1. Update `release.targetDate` if the deadline has slipped\n' +
        '2. Schedule a cleanup ticket to remove the flag after full rollout\n' +
        `3. Aim to complete rollout within the next ${STALE_DAYS - agedays} days`,
    };
  }

  // Fresh flag
  const lastMod = lastModified ? ` Last modified: ${daysSince(lastModified)} day(s) ago.` : '';
  return {
    ...base,
    status: 'PASSED',
    score: base.weight,
    message: `Flag "${feature}" is ${agedays} days old — within acceptable age`,
    detail:
      `The feature flag is ${agedays} days old, well within the ${STALE_DAYS}-day limit.${lastMod}`,
    remediation: null,
  };
}

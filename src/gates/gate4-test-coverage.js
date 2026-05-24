/**
 * Gate 4 — Test Coverage
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates that the codebase meets the minimum test coverage threshold
 * declared in flags.json.
 *
 * Weight: 20 pts
 * Severity: HIGH
 *
 * Rules:
 *   FAILED  → coverage < minimumCoverageThreshold
 *   WARNING → coverage within 5 percentage points of threshold (barely passing)
 *   PASSED  → coverage >= threshold (and comfortably above)
 */

import { get } from '../utils.js';

export function runTestCoverageGate(flags) {
  const coverage  = get(flags, 'quality.testCoverage', null);
  const threshold = get(flags, 'quality.minimumCoverageThreshold', 80);

  const base = {
    id: 4,
    name: 'Test Coverage',
    icon: '🧪',
    severity: 'HIGH',
    weight: 20,
  };

  // Coverage data not provided
  if (coverage === null || coverage === undefined) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: 'Test coverage not reported in flags.json',
      detail:
        'The `quality.testCoverage` field is missing. ' +
        'GateKeeper cannot verify coverage meets the minimum threshold.',
      remediation:
        '1. Run your test suite with a coverage reporter (e.g., `jest --coverage`, `nyc`)\n' +
        '2. Add `quality.testCoverage` to `flags.json` with the percentage value\n' +
        '3. Add `quality.minimumCoverageThreshold` (recommended: 80)',
    };
  }

  const delta = coverage - threshold;

  // Below threshold — FAILED
  if (coverage < threshold) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `Coverage ${coverage.toFixed(1)}% is below the ${threshold}% threshold (gap: ${Math.abs(delta).toFixed(1)}%)`,
      detail:
        `The reported test coverage (${coverage.toFixed(1)}%) does not meet the ` +
        `configured minimum of ${threshold}%. This gate protects against releases ` +
        `with insufficient automated test coverage.`,
      remediation:
        `1. Identify uncovered modules with your coverage reporter\n` +
        `2. Add unit and integration tests to close the ${Math.abs(delta).toFixed(1)}% gap\n` +
        `3. Focus on critical paths first (payment flows, auth, data mutations)\n` +
        `4. Update \`quality.testCoverage\` after re-running the coverage report`,
    };
  }

  // Barely passing — WARNING
  if (delta < 5) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `Coverage ${coverage.toFixed(1)}% — within 5% of the ${threshold}% minimum (margin: +${delta.toFixed(1)}%)`,
      detail:
        `Test coverage is only ${delta.toFixed(1)}% above the minimum threshold. ` +
        `While technically passing, this is uncomfortably close to the floor. ` +
        `Any regression in coverage on the next PR may fail this gate.`,
      remediation:
        `1. Aim for at least 85% coverage as a comfortable buffer\n` +
        `2. Add tests for recently modified modules\n` +
        `3. Consider raising the \`minimumCoverageThreshold\` to lock in gains`,
    };
  }

  // Solid pass
  return {
    ...base,
    status: 'PASSED',
    score: base.weight,
    message: `Coverage ${coverage.toFixed(1)}% — ${delta.toFixed(1)}% above the ${threshold}% minimum`,
    detail:
      `Test coverage is comfortably above the required threshold. ` +
      `The codebase has solid automated test coverage for this release.`,
    remediation: null,
  };
}

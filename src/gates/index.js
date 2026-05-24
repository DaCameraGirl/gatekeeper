/**
 * GateKeeper Gate Runner
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates all 9 policy gates and returns a unified results object.
 * Gate 1 (Kill Switch) is a hard BLOCKER — if it fails, remaining gates are
 * still evaluated for the audit trail but the outcome is always BLOCKED.
 */

import { runKillSwitchGate   } from './gate1-kill-switch.js';
import { runRolloutGate      } from './gate2-rollout.js';
import { runEnvironmentGate  } from './gate3-environment.js';
import { runTestCoverageGate } from './gate4-test-coverage.js';
import { runErrorRateGate    } from './gate5-error-rate.js';
import { runCanaryGate       } from './gate6-canary.js';
import { runFlagAgeGate      } from './gate7-flag-age.js';
import { runBlastRadiusGate  } from './gate8-blast-radius.js';
import { runDependenciesGate } from './gate9-dependencies.js';
import { calculateStatus     } from '../utils.js';

const GATE_RUNNERS = [
  runKillSwitchGate,
  runRolloutGate,
  runEnvironmentGate,
  runTestCoverageGate,
  runErrorRateGate,
  runCanaryGate,
  runFlagAgeGate,
  runBlastRadiusGate,
  runDependenciesGate,
];

/**
 * Run all 9 gates against the flags data.
 *
 * @param {object} flags - Parsed flags.json
 * @returns {{ gateResults: Array, summary: object }}
 */
export async function runAllGates(flags) {
  console.log('\n⚙️  Running 9 policy gates...\n');

  const gateResults = [];

  for (const runGate of GATE_RUNNERS) {
    let result;
    try {
      result = runGate(flags);
    } catch (err) {
      // Gate threw unexpectedly — treat as a warning, never crash GateKeeper
      result = {
        id: GATE_RUNNERS.indexOf(runGate) + 1,
        name: runGate.name.replace('run', '').replace('Gate', ''),
        icon: '⚠️',
        status: 'WARNING',
        severity: 'HIGH',
        weight: 0,
        score: 0,
        message: `Gate evaluation failed: ${err.message}`,
        detail: `An unexpected error occurred while running this gate. This is a GateKeeper bug — please report it.`,
        remediation: 'Check flags.json structure and file an issue on the GateKeeper repo.',
      };
    }

    const icon = result.status === 'PASSED' ? '✅'
               : result.status === 'WARNING' ? '⚠️'
               : '❌';

    console.log(`  ${icon}  Gate ${result.id}: ${result.name} — ${result.message}`);
    gateResults.push(result);
  }

  const { status, score, reason } = calculateStatus(gateResults);

  const passed   = gateResults.filter(g => g.status === 'PASSED');
  const warnings = gateResults.filter(g => g.status === 'WARNING');
  const failures = gateResults.filter(g => g.status === 'FAILED');

  const summary = {
    status,
    score,
    reason,
    counts: {
      passed: passed.length,
      warnings: warnings.length,
      failed: failures.length,
      total: gateResults.length,
    },
    blockers: failures,
    warnings,
    passing: passed,
  };

  console.log(`\n📊 Gate results: ${passed.length} passed · ${warnings.length} warned · ${failures.length} failed`);
  console.log(`📈 Score: ${score}/100 → ${status}\n`);

  return { gateResults, summary };
}

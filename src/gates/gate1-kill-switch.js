/**
 * Gate 1 — Kill Switch
 * ─────────────────────────────────────────────────────────────────────────────
 * CRITICAL BLOCKER. If the kill switch is active, GateKeeper halts
 * immediately and issues a BLOCKED verdict regardless of all other gates.
 *
 * Weight: N/A (binary blocker — does not participate in numeric scoring)
 * Severity: CRITICAL
 */

export function runKillSwitchGate(flags) {
  const isActive = flags?.flags?.killSwitch === true;

  if (isActive) {
    return {
      id: 1,
      name: 'Kill Switch',
      icon: '☠️',
      status: 'FAILED',
      severity: 'CRITICAL',
      weight: 0,          // binary blocker — excluded from numeric score
      score: 0,
      message: 'Emergency kill switch is ACTIVE — all deployments halted',
      detail:
        'The `flags.flags.killSwitch` field is set to `true`. ' +
        'This is an emergency override that immediately blocks all release activity ' +
        'until an authorised on-call lead clears it.',
      remediation:
        '1. Confirm the triggering incident has been fully resolved\n' +
        '2. Get sign-off from the on-call lead or release manager\n' +
        '3. Set `flags.flags.killSwitch` to `false` in `flags.json`\n' +
        '4. Update your incident post-mortem or runbook\n' +
        '5. Push the change and re-run GateKeeper',
    };
  }

  return {
    id: 1,
    name: 'Kill Switch',
    icon: '🔓',
    status: 'PASSED',
    severity: 'CRITICAL',
    weight: 0,
    score: 0,
    message: 'Kill switch is inactive — deployments are permitted',
    detail: 'No emergency override is active. This gate is clear.',
    remediation: null,
  };
}

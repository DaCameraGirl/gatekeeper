/**
 * Gate 9 — Dependency Vulnerabilities
 * ─────────────────────────────────────────────────────────────────────────────
 * Ensures that the dependency audit is current and that no critical-severity
 * vulnerabilities are present in the release dependency tree.
 *
 * Weight: 6 pts
 * Severity: MEDIUM
 *
 * Rules:
 *   FAILED  → any CRITICAL vulnerabilities detected
 *   FAILED  → audit is stale (> 30 days old) and high vulnerabilities exist
 *   WARNING → HIGH vulnerabilities present (but audit is fresh)
 *   WARNING → audit is stale (> 30 days) with no critical/high issues
 *   PASSED  → fresh audit, 0 critical, 0 high vulnerabilities
 */

import { get, daysSince } from '../utils.js';

const MAX_AUDIT_AGE_DAYS = 30;

export function runDependenciesGate(flags) {
  const lastAuditDate  = get(flags, 'dependencies.lastAuditDate', null);
  const criticalVulns  = get(flags, 'dependencies.criticalVulnerabilities', null);
  const highVulns      = get(flags, 'dependencies.highVulnerabilities', null);
  const mediumVulns    = get(flags, 'dependencies.mediumVulnerabilities', 0);
  const auditTool      = get(flags, 'dependencies.auditTool', 'npm audit');

  const base = {
    id: 9,
    name: 'Dependency Vulnerabilities',
    icon: '🔒',
    severity: 'MEDIUM',
    weight: 6,
  };

  // No audit data at all
  if (lastAuditDate === null && criticalVulns === null) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: 'No dependency audit data found in flags.json',
      detail:
        'The `dependencies` section is missing or incomplete. ' +
        'GateKeeper cannot verify that the dependency tree is vulnerability-free.',
      remediation:
        `1. Run \`npm audit --json\` or your preferred audit tool\n` +
        '2. Populate `dependencies.lastAuditDate`, `criticalVulnerabilities`, ' +
        '`highVulnerabilities`, and `mediumVulnerabilities` in flags.json\n' +
        '3. Address any critical or high vulnerabilities before re-running',
    };
  }

  const auditAge    = daysSince(lastAuditDate);
  const auditStale  = auditAge > MAX_AUDIT_AGE_DAYS;
  const auditNote   = lastAuditDate
    ? `Audit was run ${auditAge} day(s) ago using ${auditTool}.`
    : 'No audit date recorded.';

  // Critical vulnerabilities — hard failure regardless of age
  if (criticalVulns > 0) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `${criticalVulns} CRITICAL vulnerability${criticalVulns > 1 ? 'ies' : ''} detected in dependencies`,
      detail:
        `${auditNote} Critical vulnerabilities cannot be shipped. ` +
        `They represent immediate risk of exploit and must be resolved before release.`,
      remediation:
        `1. Run \`npm audit\` or \`${auditTool}\` to identify affected packages\n` +
        '2. Update or replace the vulnerable packages\n' +
        '3. If no fix is available, evaluate whether a workaround or patched fork exists\n' +
        '4. As a last resort, get explicit CISO/security team sign-off with a documented exception\n' +
        '5. Re-run the audit, update `dependencies.criticalVulnerabilities` to 0, and re-run GateKeeper',
    };
  }

  // Stale audit with high vulnerabilities
  if (auditStale && highVulns > 0) {
    return {
      ...base,
      status: 'FAILED',
      score: 0,
      message: `Audit is ${auditAge} days old (max: ${MAX_AUDIT_AGE_DAYS}) with ${highVulns} HIGH vulnerabilities`,
      detail:
        `The dependency audit is stale (${auditAge} days old) and ${highVulns} high-severity ` +
        `vulnerabilities were detected. Stale audits with high vulnerabilities cannot be trusted.`,
      remediation:
        '1. Run a fresh dependency audit now\n' +
        '2. Update `dependencies.lastAuditDate` with today\'s timestamp\n' +
        '3. Resolve or document exceptions for the high-severity issues\n' +
        '4. Update vulnerability counts in flags.json',
    };
  }

  // Fresh audit but high vulnerabilities present
  if (!auditStale && highVulns > 0) {
    const medNote = mediumVulns > 0 ? ` (plus ${mediumVulns} medium)` : '';
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `${highVulns} HIGH vulnerability${highVulns > 1 ? 'ies' : ''}${medNote} — no critical issues`,
      detail:
        `${auditNote} ${highVulns} high-severity vulnerabilities are present. ` +
        `While not an immediate blocker, high vulnerabilities increase attack surface.`,
      remediation:
        '1. Prioritise resolving the high-severity vulnerabilities in the next sprint\n' +
        '2. Check if patches are available: `npm audit fix`\n' +
        '3. Open security tickets for each affected package\n' +
        '4. Document the accepted risk if a patch is not yet available',
    };
  }

  // Stale audit but no high/critical issues
  if (auditStale) {
    return {
      ...base,
      status: 'WARNING',
      score: Math.floor(base.weight / 2),
      message: `Dependency audit is ${auditAge} days old — refresh recommended`,
      detail:
        `${auditNote} New vulnerabilities may have been disclosed since the last audit. ` +
        `Run a fresh audit to confirm the dependency tree is still clean.`,
      remediation:
        '1. Run `npm audit` or your audit tool\n' +
        '2. Update `dependencies.lastAuditDate` in flags.json\n' +
        '3. Re-run GateKeeper to clear this warning',
    };
  }

  // All clear
  const medNote = mediumVulns > 0 ? ` (${mediumVulns} medium-severity noted)` : '';
  return {
    ...base,
    status: 'PASSED',
    score: base.weight,
    message: `0 critical, 0 high vulnerabilities. ${auditNote}`,
    detail:
      `${auditNote} No critical or high vulnerabilities detected in the dependency tree.${medNote} ` +
      `Dependency security posture is acceptable for this release.`,
    remediation: null,
  };
}

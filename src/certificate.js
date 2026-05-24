/**
 * GateKeeper Release Readiness Certificate
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the full markdown PR comment — GateKeeper's official output.
 * This is what engineers see on every PR. It should look authoritative,
 * be easy to scan, and contain every piece of information needed to act.
 */

import { scoreBar, statusEmoji, gateEmoji, severityLabel, fmtDate, nowISO } from './utils.js';

// GATEKEEPER_AVATAR_URL: The raw GitHub URL to the SVG in the repo.
// Falls back to a text-only header if not available.
const AVATAR_URL =
  'https://raw.githubusercontent.com/DaCameraGirl/gatekeeper/main/assets/gatekeeper.svg';

const VERSION = '1.0.0';

/**
 * Generate the full markdown certificate.
 *
 * @param {object} params
 * @param {object} params.flags         - Parsed flags.json
 * @param {Array}  params.gateResults   - All 9 gate result objects
 * @param {object} params.summary       - { status, score, counts, blockers, warnings, passing }
 * @param {object} params.aiAssessment  - { riskLevel, assessment, remediations, caveats, fullResponse }
 * @param {object} params.prContext     - { number, branch, title, author, headSha, repo }
 * @param {object} params.schemaCheck   - { valid, issues, summary } from DeepSeek
 * @returns {string} Complete markdown string
 */
export function generateCertificate({
  flags,
  gateResults,
  summary,
  aiAssessment,
  prContext,
  schemaCheck,
}) {
  const { status, score } = summary;
  const timestamp = nowISO();
  const bar = scoreBar(score, 100, 20);

  const feature  = flags.release?.feature  ?? 'unknown';
  const version  = flags.release?.version  ?? '?';
  const owner    = flags.release?.owner    ?? 'unknown';
  const jira     = flags.release?.jiraTicket ? ` · [${flags.release.jiraTicket}]` : '';

  const statusBadge = {
    BLOCKED:      '## 🔴 RELEASE STATUS: **BLOCKED**',
    'WITH-CAUTION': '## 🟡 RELEASE STATUS: **WITH CAUTION**',
    CLEARED:      '## 🟢 RELEASE STATUS: **CLEARED**',
  }[status] ?? '## ⚪ RELEASE STATUS: **UNKNOWN**';

  const statusDesc = {
    BLOCKED:        'This release is **BLOCKED**. Critical gates have failed. Do not deploy until all blockers are resolved.',
    'WITH-CAUTION': 'This release may proceed **WITH CAUTION**. Review all warnings before deploying to production.',
    CLEARED:        'This release is **CLEARED** for production. All gates passed. Proceed with standard deployment protocol.',
  }[status] ?? '';

  const riskColor = {
    LOW: '🟢',
    MEDIUM: '🟡',
    HIGH: '🟠',
    CRITICAL: '🔴',
  }[aiAssessment.riskLevel] ?? '⚪';

  // ─── Header ─────────────────────────────────────────────────────────────────

  const header = `<img align="right" width="110" src="${AVATAR_URL}" alt="GateKeeper" title="GateKeeper — Autonomous Release Intelligence"/>

# 🤖 GateKeeper Release Certificate

**Autonomous DevOps Release Intelligence** · v${VERSION} · Powered by Claude AI & DeepSeek

---`;

  // ─── Score Banner ────────────────────────────────────────────────────────────

  const banner = `\`\`\`
╔══════════════════════════════════════════════════════════════════════╗
║  🤖  G A T E K E E P E R   R E L E A S E   C E R T I F I C A T E  ║
╠══════════════════════════════════════════════════════════════════════╣
║  Feature:  ${padRight(feature, 22)}  Version: ${padRight(version, 12)}       ║
║  Owner:    ${padRight(owner, 22)}  PR:      #${padRight(String(prContext.number), 11)}      ║
║  Branch:   ${padRight(prContext.branch, 35)}          ║
║  Assessed: ${padRight(timestamp, 35)}          ║
╠══════════════════════════════════════════════════════════════════════╣
║  Score: ${bar}  ${padRight(String(score) + '/100', 7)}                        ║
║  Status: ${padRight(status, 14)}  AI Risk: ${padRight(aiAssessment.riskLevel, 8)}                  ║
╚══════════════════════════════════════════════════════════════════════╝
\`\`\``;

  // ─── Status Statement ────────────────────────────────────────────────────────

  const statusSection = `${statusBadge}

${statusDesc}

> **Score:** ${score}/100 · **Gates:** ${summary.counts.passed} passed · ${summary.counts.warnings} warnings · ${summary.counts.failed} failed · **AI Risk Level:** ${riskColor} ${aiAssessment.riskLevel}`;

  // ─── Blockers Table ──────────────────────────────────────────────────────────

  let blockersSection = '';
  if (summary.blockers.length > 0) {
    const rows = summary.blockers.map(b =>
      `| ${b.id} | **${b.name}** | ${severityLabel(b.severity)} | ${b.message} |`
    ).join('\n');

    const remediationBlocks = summary.blockers.map(b => `
**Gate ${b.id} — ${b.name}**

> ${b.detail}

${b.remediation ? b.remediation.split('\n').map(l => `> ${l}`).join('\n') : ''}
`).join('\n');

    blockersSection = `
## 🚨 Critical Blockers

> These must be resolved before this release can proceed.

| # | Gate | Severity | Issue |
|---|------|----------|-------|
${rows}

<details>
<summary>📋 Blocker Details & Fix Instructions</summary>

${remediationBlocks}
</details>`;
  }

  // ─── Warnings Section ────────────────────────────────────────────────────────

  let warningsSection = '';
  if (summary.warnings.length > 0) {
    const rows = summary.warnings.map(w =>
      `| ${gateEmoji(w.status)} | **Gate ${w.id}** | ${w.name} | ${w.message} |`
    ).join('\n');

    const remediationBlocks = summary.warnings.map(w => `
**Gate ${w.id} — ${w.name}**

> ${w.detail}

${w.remediation ? w.remediation.split('\n').map(l => `> ${l}`).join('\n') : ''}
`).join('\n');

    warningsSection = `
## ⚠️ Warnings

> Non-blocking issues that should be reviewed before or after deployment.

| | Gate # | Gate Name | Issue |
|-|--------|-----------|-------|
${rows}

<details>
<summary>📋 Warning Details & Recommendations</summary>

${remediationBlocks}
</details>`;
  }

  // ─── Passed Gates ────────────────────────────────────────────────────────────

  const passedRows = summary.passing.map(g =>
    `| ✅ | Gate ${g.id} | **${g.name}** | ${g.message} |`
  ).join('\n');

  const passedSection = `
<details>
<summary>✅ Passed Gates (${summary.counts.passed}/${gateResults.length})</summary>

| | Gate # | Name | Result |
|-|--------|------|--------|
${passedRows || '| — | — | — | No gates passed |'}

</details>`;

  // ─── Claude AI Risk Assessment ───────────────────────────────────────────────

  const aiSection = `
## 🧠 Claude AI Risk Assessment

> *Powered by ${MODEL_DISPLAY} — qualitative risk analysis beyond automated policy gates*

${riskColor} **Risk Level: ${aiAssessment.riskLevel}**

${aiAssessment.assessment}`;

  // ─── Remediation Steps ───────────────────────────────────────────────────────

  const allRemediations = [
    ...aiAssessment.remediations,
    ...summary.blockers.flatMap(b =>
      (b.remediation ?? '').split('\n').filter(l => l.trim().match(/^\d+\./)).map(l => l.replace(/^\d+\.\s*/, ''))
    ),
  ].filter(Boolean);

  // Deduplicate
  const uniqueRemediations = [...new Set(allRemediations)].slice(0, 10);

  const remediationSection = uniqueRemediations.length > 0 ? `
## 🔧 Remediation Steps

> Ordered by priority. Complete these before re-running GateKeeper.

${uniqueRemediations.map((r, i) => `${i + 1}. ${r}`).join('\n')}` : '';

  // ─── Schema Check ────────────────────────────────────────────────────────────

  let schemaSection = '';
  if (schemaCheck && schemaCheck.issues.length > 0) {
    schemaSection = `
<details>
<summary>🔎 flags.json Schema Issues (${schemaCheck.issues.length})</summary>

${schemaCheck.summary}

${schemaCheck.issues.map(i => `- ⚠️ ${i}`).join('\n')}

</details>`;
  }

  // ─── Caveats ────────────────────────────────────────────────────────────────

  let caveatsSection = '';
  if (aiAssessment.caveats && aiAssessment.caveats.length > 0) {
    caveatsSection = `
<details>
<summary>ℹ️ Assessment Caveats</summary>

${aiAssessment.caveats.map(c => `- ${c}`).join('\n')}

</details>`;
  }

  // ─── Gate Summary Table ──────────────────────────────────────────────────────

  const gateTableRows = gateResults.map(g => {
    const scoreDisplay = g.id === 1
      ? (g.status === 'PASSED' ? '✓' : '✗ BLOCKED')
      : `${g.score}/${g.weight}`;
    return `| ${gateEmoji(g.status)} | ${g.id} | ${g.name} | ${g.severity} | ${scoreDisplay} | ${g.message} |`;
  }).join('\n');

  const gateTableSection = `
<details>
<summary>📋 Full Gate Summary (9 gates)</summary>

| | # | Gate | Severity | Score | Result |
|-|---|------|----------|-------|--------|
${gateTableRows}

</details>`;

  // ─── Footer ──────────────────────────────────────────────────────────────────

  const footer = `
---

<sub>🤖 **GateKeeper v${VERSION}** · Autonomous Release Intelligence · ${timestamp}<br/>
Powered by **Claude Sonnet** (risk brain) + **DeepSeek** (structured analysis)<br/>
Repository: \`${prContext.repo}\` · PR: #${prContext.number} · Commit: \`${prContext.headSha?.slice(0, 7) ?? 'unknown'}\`<br/>
*This certificate is automatically generated. Do not edit manually — it will be overwritten on the next push.*</sub>`;

  // ─── Assemble ────────────────────────────────────────────────────────────────

  return [
    header,
    banner,
    statusSection,
    blockersSection,
    warningsSection,
    passedSection,
    aiSection,
    remediationSection,
    schemaSection,
    caveatsSection,
    gateTableSection,
    footer,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function padRight(str, len) {
  const s = String(str ?? '');
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

const MODEL_DISPLAY = 'Claude Sonnet';

/**
 * GateKeeper Claude Brain
 * ─────────────────────────────────────────────────────────────────────────────
 * Claude is GateKeeper's risk intelligence engine.
 *
 * Claude receives the full release context — flags, gate results, DeepSeek's
 * pre-analysis — and produces a deep, qualitative risk assessment that goes
 * beyond what the deterministic policy gates can capture:
 *
 *   • Holistic risk judgment ("the score is 78 but the kill switch was recently
 *     deactivated — treat this as higher risk than the number suggests")
 *   • Systemic risk patterns across multiple gates
 *   • Precise, actionable remediation steps tailored to THIS release
 *   • A final verdict with rationale
 *
 * Model: claude-sonnet-4-6 (fast, capable, cost-efficient for this task)
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('GateKeeper: ANTHROPIC_API_KEY environment variable is not set.');
  }
  return new Anthropic({ apiKey });
}

// ─── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are GateKeeper's risk intelligence engine — a senior staff-level DevOps and release engineering expert with deep experience in SRE, platform engineering, and production incident response.

Your job is to assess the release risk for a software feature deployment and produce a Release Readiness Assessment. You receive:
- The full flags.json configuration for the release
- Results from 9 automated policy gates (pass/warn/fail + scores)
- A pre-analysis from a junior analyst
- The PR context (branch, author, PR number)

Your assessment must:
1. Go BEYOND what the policy gates check — identify risks the rules didn't catch
2. Reason about compounding risks (two medium risks together = high risk)
3. Consider the business context (financial features, user-facing changes, data privacy)
4. Give concrete, specific remediation steps — not generic advice
5. Be honest about uncertainty — if you can't assess something from the flags data, say so
6. Conclude with a clear RISK LEVEL: LOW / MEDIUM / HIGH / CRITICAL

You write like a senior engineer talking to their team — direct, no fluff, technically precise. Your assessment will be embedded in a PR comment that blocks or allows a release, so accuracy matters more than politeness.`;

// ─── Main Assessment ──────────────────────────────────────────────────────────

/**
 * Run Claude's full risk assessment.
 *
 * @param {object} flags - Parsed flags.json
 * @param {Array}  gateResults - All 9 gate result objects
 * @param {object} summary - { status, score, counts, blockers, warnings }
 * @param {string} preAnalysis - DeepSeek's pre-processed context
 * @param {object} prContext - { number, branch, title, author, headSha }
 * @returns {Promise<{ riskLevel: string, assessment: string, remediations: string[], caveats: string[] }>}
 */
export async function assessRisk(flags, gateResults, summary, preAnalysis, prContext) {
  console.log('🧠 Claude: Running full risk assessment...');

  const client = getClient();

  const gateTable = gateResults.map(g =>
    `Gate ${g.id} (${g.name}): ${g.status} — ${g.message}`
  ).join('\n');

  const blockerList = summary.blockers.length > 0
    ? summary.blockers.map(b => `• ${b.name}: ${b.message}`).join('\n')
    : 'None';

  const warningList = summary.warnings.length > 0
    ? summary.warnings.map(w => `• ${w.name}: ${w.message}`).join('\n')
    : 'None';

  const userMessage = `## Release Assessment Request

### PR Context
- **PR:** #${prContext.number} — "${prContext.title}"
- **Branch:** ${prContext.branch}
- **Author:** ${prContext.author}
- **Commit SHA:** ${prContext.headSha}

### Gate Summary
- **Overall Score:** ${summary.score}/100
- **Gate Status:** ${summary.status}
- **Passed:** ${summary.counts.passed}/9 | **Warned:** ${summary.counts.warnings}/9 | **Failed:** ${summary.counts.failed}/9

### Gate Results
\`\`\`
${gateTable}
\`\`\`

### Critical Blockers
${blockerList}

### Warnings
${warningList}

### flags.json
\`\`\`json
${JSON.stringify(flags, null, 2)}
\`\`\`

### Pre-Analysis (from junior analyst)
${preAnalysis}

---

Please provide your full risk assessment. Structure your response as follows:

**RISK LEVEL:** [LOW / MEDIUM / HIGH / CRITICAL]

**ASSESSMENT:**
[3-5 paragraphs of substantive risk analysis. Be specific to this release — reference actual field values from flags.json. Identify any compounding risks, patterns the gates missed, and positive signals.]

**TOP REMEDIATION STEPS:**
[Numbered list of the 3-7 most important actions, ordered by priority. Be concrete — reference specific flags.json fields or commands where applicable.]

**CAVEATS:**
[Any assumptions you made or information you'd need to do a more complete assessment.]`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';

    // Parse the structured sections from Claude's response
    const riskLevelMatch = raw.match(/\*\*RISK LEVEL:\*\*\s*([A-Z]+)/);
    const riskLevel      = riskLevelMatch?.[1] ?? inferRiskLevel(summary.status, summary.score);

    const assessmentMatch = raw.match(/\*\*ASSESSMENT:\*\*([\s\S]*?)(?:\*\*TOP REMEDIATION|$)/);
    const assessment      = assessmentMatch?.[1]?.trim() ?? raw;

    const remediationMatch = raw.match(/\*\*TOP REMEDIATION STEPS:\*\*([\s\S]*?)(?:\*\*CAVEATS|$)/);
    const remediationRaw   = remediationMatch?.[1]?.trim() ?? '';
    const remediations     = remediationRaw
      .split('\n')
      .filter(l => l.trim().match(/^\d+\./))
      .map(l => l.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);

    const caveatsMatch = raw.match(/\*\*CAVEATS:\*\*([\s\S]*?)$/);
    const caveatsRaw   = caveatsMatch?.[1]?.trim() ?? '';
    const caveats      = caveatsRaw
      .split('\n')
      .filter(l => l.trim().startsWith('-') || l.trim().startsWith('•'))
      .map(l => l.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean);

    // Also store the full raw response for the certificate
    return {
      riskLevel,
      assessment,
      remediations,
      caveats,
      fullResponse: raw,
    };
  } catch (err) {
    console.error(`  ❌ Claude risk assessment failed: ${err.message}`);

    // Graceful degradation — return a minimal assessment
    return {
      riskLevel: inferRiskLevel(summary.status, summary.score),
      assessment: `Claude risk assessment failed due to API error: ${err.message}. The gate results above represent the automated assessment only.`,
      remediations: summary.blockers.map(b => b.remediation).filter(Boolean),
      caveats: ['Full AI risk assessment was not available due to an API error.'],
      fullResponse: '',
    };
  }
}

/** Infer risk level from gate scores when Claude is unavailable */
function inferRiskLevel(status, score) {
  if (status === 'BLOCKED') return 'CRITICAL';
  if (score < 60) return 'HIGH';
  if (score < 80) return 'MEDIUM';
  return 'LOW';
}

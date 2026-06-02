/**
 * GateKeeper — Autonomous AI DevOps Release Gate Agent
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I am GateKeeper. Every release passes through me."
 *
 * What I do, on every PR:
 *   1. Read flags.json from the repo
 *   2. Validate the schema with DeepSeek
 *   3. Run 9 deterministic policy gates
 *   4. Pre-process context with DeepSeek
 *   5. Call Claude for a full qualitative risk assessment
 *   6. Generate a Release Readiness Certificate
 *   7. Post it as a PR comment (updating any previous run)
 *   8. Set a GitHub commit status (blocks the PR check if BLOCKED)
 *   9. Exit non-zero if BLOCKED (or WITH-CAUTION in strict mode)
 *
 * Stack: Node.js · Anthropic SDK (Claude) · OpenAI SDK (DeepSeek)
 * Trigger: GitHub Actions on pull_request
 *
 * Author: GateKeeper 🤖
 */

import { envBool,
         envString,
         loadFlags }             from './utils.js';
import { runAllGates }           from './gates/index.js';
import { validateFlagsSchema,
         preprocessContext }     from './brain/deepseek.js';
import { assessRisk }            from './brain/claude.js';
import { generateCertificate }   from './certificate.js';
import { postPRComment,
         setCommitStatus }       from './github.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  🤖  G A T E K E E P E R  —  RELEASE GATE AGENT     ║');
  console.log('║      Autonomous DevOps Release Intelligence          ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  // ── Read environment ──────────────────────────────────────────────────────

  const prContext = {
    number:  parseInt(process.env.PR_NUMBER ?? '0', 10),
    branch:  process.env.PR_BRANCH  ?? 'unknown',
    title:   process.env.PR_TITLE   ?? 'unknown',
    author:  process.env.PR_AUTHOR  ?? 'unknown',
    headSha: process.env.PR_HEAD_SHA ?? '',
    repo:    process.env.GITHUB_REPOSITORY ?? 'unknown/unknown',
  };

  const flagsPath = envString('FLAGS_JSON_PATH', './flags.json');
  const dryRun    = envBool('GATEKEEPER_DRY_RUN', false);
  const strict    = envBool('GATEKEEPER_STRICT', false);

  console.log(`📦 Repository:  ${prContext.repo}`);
  console.log(`🔀 PR:          #${prContext.number} — "${prContext.title}"`);
  console.log(`🌿 Branch:      ${prContext.branch}`);
  console.log(`👤 Author:      ${prContext.author}`);
  console.log(`🔑 Commit SHA:  ${prContext.headSha.slice(0, 7) || 'N/A'}`);
  console.log(`📄 flags.json:  ${flagsPath}`);
  console.log(`🔒 Strict mode: ${strict}`);
  console.log(`🏁 Dry run:     ${dryRun}`);
  console.log('');

  // ── Step 1: Load flags.json ───────────────────────────────────────────────

  console.log('📂 Step 1/7: Loading flags.json...');
  let flags;
  try {
    flags = loadFlags(flagsPath);
    console.log(`  ✅ Loaded: feature="${flags.release?.feature}", version="${flags.release?.version}"`);
  } catch (err) {
    console.error(`  ❌ ${err.message}`);
    return 1;
  }

  // ── Step 2: Schema validation (DeepSeek) ─────────────────────────────────

  console.log('\n🔎 Step 2/7: Validating flags.json schema (DeepSeek)...');
  let schemaCheck = { valid: true, issues: [], summary: 'Validation skipped.' };
  try {
    schemaCheck = await validateFlagsSchema(flags);
    if (!schemaCheck.valid) {
      console.warn(`  ⚠️  Schema issues found: ${schemaCheck.issues.length}`);
      schemaCheck.issues.forEach(i => console.warn(`     - ${i}`));
    } else {
      console.log(`  ✅ Schema valid. ${schemaCheck.summary}`);
    }
  } catch (err) {
    console.warn(`  ⚠️  Schema check failed: ${err.message}`);
  }

  // ── Step 3: Run 9 Policy Gates ────────────────────────────────────────────

  console.log('\n⚙️  Step 3/7: Running 9 policy gates...');
  const { gateResults, summary } = await runAllGates(flags);

  // ── Step 4: Pre-process context (DeepSeek) ────────────────────────────────

  console.log('🔍 Step 4/7: Pre-processing gate context (DeepSeek)...');
  let preAnalysis = 'Pre-analysis not available.';
  try {
    preAnalysis = await preprocessContext(flags, gateResults, summary);
    console.log('  ✅ Context pre-processed.');
  } catch (err) {
    console.warn(`  ⚠️  Pre-processing failed: ${err.message}`);
  }

  // ── Step 5: Claude Risk Assessment ───────────────────────────────────────

  console.log('\n🧠 Step 5/7: Running Claude AI risk assessment...');
  let aiAssessment = {
    riskLevel: 'UNKNOWN',
    assessment: 'AI assessment not available.',
    remediations: [],
    caveats: [],
    fullResponse: '',
  };
  try {
    aiAssessment = await assessRisk(flags, gateResults, summary, preAnalysis, prContext);
    console.log(`  ✅ Risk assessment complete. Risk level: ${aiAssessment.riskLevel}`);
  } catch (err) {
    console.warn(`  ⚠️  Claude assessment failed: ${err.message}`);
  }

  // ── Step 6: Generate Certificate ─────────────────────────────────────────

  console.log('\n📜 Step 6/7: Generating Release Readiness Certificate...');
  const certificate = generateCertificate({
    flags,
    gateResults,
    summary,
    aiAssessment,
    prContext,
    schemaCheck,
  });
  console.log(`  ✅ Certificate generated (${certificate.length.toLocaleString()} chars).`);

  // ── Step 7: Post to GitHub ────────────────────────────────────────────────

  let commentUrl = '';

  if (dryRun) {
    console.log('\n🏁 Step 7/7: DRY RUN — skipping GitHub API calls.');
    console.log('\n──── CERTIFICATE PREVIEW (DRY RUN) ────────────────────\n');
    console.log(certificate.slice(0, 3000));
    if (certificate.length > 3000) console.log('\n... [truncated for dry run preview] ...');
    console.log('\n────────────────────────────────────────────────────────\n');
  } else {
    console.log('\n🚀 Step 7/7: Posting certificate to GitHub...');

    if (!prContext.number) {
      console.warn('  ⚠️  PR_NUMBER is not set — skipping PR comment. Set PR_NUMBER env var.');
    } else {
      try {
        const { commentId, commentUrl: url } = await postPRComment(prContext.number, certificate);
        commentUrl = url;
        console.log(`  ✅ Certificate posted: ${commentUrl}`);
      } catch (err) {
        console.error(`  ❌ Failed to post PR comment: ${err.message}`);
        // Non-fatal — continue to set commit status
      }
    }

    if (prContext.headSha) {
      try {
        await setCommitStatus(prContext.headSha, summary.status, summary.score, commentUrl);
      } catch (err) {
        console.error(`  ❌ Failed to set commit status: ${err.message}`);
      }
    } else {
      console.warn('  ⚠️  PR_HEAD_SHA not set — skipping commit status.');
    }
  }

  // ── Final Summary ─────────────────────────────────────────────────────────

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════╗');
  const statusLine = ` ${statusIcon(summary.status)}  VERDICT: ${summary.status.padEnd(14)} Score: ${summary.score}/100`;
  console.log(`║  ${statusLine.padEnd(52)}║`);
  console.log(`║     Gates: ${summary.counts.passed} passed · ${summary.counts.warnings} warned · ${summary.counts.failed} failed`.padEnd(53) + '║');
  console.log(`║     AI Risk: ${aiAssessment.riskLevel}`.padEnd(53) + '║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  // ── Exit Code ─────────────────────────────────────────────────────────────

  const shouldFail =
    summary.status === 'BLOCKED' ||
    (strict && summary.status === 'WITH-CAUTION');

  if (shouldFail) {
    console.log(`💥 GateKeeper exiting with code 1 — release is ${summary.status}.`);
    return 1;
  }

  console.log('✅ GateKeeper exiting cleanly — release check complete.');
  return 0;
}

function statusIcon(status) {
  return { BLOCKED: '🔴', 'WITH-CAUTION': '🟡', CLEARED: '🟢' }[status] ?? '⚪';
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().then(code => {
  process.exitCode = code ?? 0;
}).catch(err => {
  console.error('\n💥 GateKeeper encountered a fatal error:');
  console.error(err);
  process.exitCode = 1;
});

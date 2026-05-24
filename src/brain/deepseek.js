/**
 * GateKeeper DeepSeek Brain
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses DeepSeek (OpenAI-compatible API) for structured, cost-efficient tasks:
 *   1. Validate and summarise the flags.json schema
 *   2. Pre-process gate context into a compact summary for Claude
 *   3. Classify risk signals into a structured object
 *
 * DeepSeek is used here because these tasks are structured and well-defined —
 * cheap inference, deterministic outputs. Claude handles the qualitative risk
 * judgment that requires real reasoning depth.
 */

import OpenAI from 'openai';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const MODEL = 'deepseek-chat';

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('GateKeeper: DEEPSEEK_API_KEY environment variable is not set.');
  }
  return new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
}

// ─── Schema Validation ─────────────────────────────────────────────────────────

/**
 * Use DeepSeek to validate the flags.json structure and surface any
 * schema issues, missing required fields, or suspicious values.
 *
 * @param {object} flags - Parsed flags.json
 * @returns {Promise<{ valid: boolean, issues: string[], summary: string }>}
 */
export async function validateFlagsSchema(flags) {
  console.log('🔍 DeepSeek: Validating flags.json schema...');

  const client = getClient();

  const prompt = `You are a DevOps configuration validator. Analyse this flags.json and identify:
1. Missing required fields (release.feature, release.version, release.owner, flags.killSwitch, flags.rolloutPercentage, quality.testCoverage, quality.errorRatePercent, risk.blastRadius)
2. Values that look suspicious or inconsistent (e.g., rollout 100% but no canary, dates in the past, negative values)
3. Internal inconsistencies (e.g., kill switch true but feature enabled)

Return ONLY a valid JSON object with exactly these fields:
{
  "valid": true/false,
  "issues": ["list of specific issues found, each as a short string"],
  "summary": "one sentence summary of the overall flags.json health"
}

flags.json content:
${JSON.stringify(flags, null, 2)}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    const result = JSON.parse(content);

    return {
      valid: result.valid ?? true,
      issues: Array.isArray(result.issues) ? result.issues : [],
      summary: result.summary ?? 'Schema validation complete.',
    };
  } catch (err) {
    console.warn(`  ⚠️  DeepSeek schema validation failed: ${err.message} — continuing without it.`);
    return { valid: true, issues: [], summary: 'Schema validation skipped (DeepSeek error).' };
  }
}

// ─── Gate Context Pre-Processing ──────────────────────────────────────────────

/**
 * Use DeepSeek to create a compact, structured pre-analysis of the gate results
 * that Claude will use as context for its full risk assessment.
 * This reduces token load on Claude and improves coherence.
 *
 * @param {object} flags - Parsed flags.json
 * @param {Array}  gateResults - Results from all 9 gates
 * @param {object} summary - Score + status from gate runner
 * @returns {Promise<string>} Structured context string for Claude
 */
export async function preprocessContext(flags, gateResults, summary) {
  console.log('🔍 DeepSeek: Pre-processing gate context for Claude...');

  const client = getClient();

  const gateDigest = gateResults.map(g => ({
    gate: `${g.id}. ${g.name}`,
    status: g.status,
    message: g.message,
  }));

  const prompt = `You are a senior DevOps analyst preparing a briefing for an AI risk assessor.

Given the following release gate results and flags configuration, produce a concise, structured pre-analysis in plain text. Focus on:
1. The most significant risk signals (failures and warnings)
2. Cross-cutting patterns (e.g., "staging passed but no canary + 100% rollout is inconsistent")
3. Risk amplifiers (financial impact + high blast radius + stale audit = compounding risk)
4. Any red flags that the individual gates might have underweighted in isolation
5. Positive signals that reduce overall risk

Keep the output to 200-300 words. Use bullet points. Be specific, not generic.

RELEASE: ${flags.release?.feature ?? 'unknown'} v${flags.release?.version ?? '?'}
SCORE: ${summary.score}/100 | STATUS: ${summary.status}
GATE RESULTS: ${JSON.stringify(gateDigest)}
FLAGS SNAPSHOT: rollout=${flags.flags?.rolloutPercentage}%, blastRadius=${flags.risk?.blastRadius}, errorRate=${flags.quality?.errorRatePercent}%, testCoverage=${flags.quality?.testCoverage}%, killSwitch=${flags.flags?.killSwitch}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 600,
    });

    return response.choices[0]?.message?.content?.trim() ?? 'Pre-analysis not available.';
  } catch (err) {
    console.warn(`  ⚠️  DeepSeek context pre-processing failed: ${err.message} — continuing without it.`);
    return 'Pre-analysis skipped due to DeepSeek API error.';
  }
}

/**
 * GateKeeper Utilities
 * Shared helpers used across the entire agent.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Environment parsing

/** Read a string env var with blank values treated as unset. */
export function envString(name, defaultValue = '') {
  const value = process.env[name];
  if (value === undefined || value === null || value.trim() === '') {
    return defaultValue;
  }
  return stripMatchingQuotes(value.trim());
}

/** Read a boolean env var with support for common truthy/falsy spellings. */
export function envBool(name, defaultValue = false) {
  const value = envString(name, '');
  if (value === '') return defaultValue;

  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;

  throw new Error(
    `GateKeeper: ${name} must be a boolean value (` +
    'true/false, yes/no, on/off, or 1/0).'
  );
}

function stripMatchingQuotes(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === last && (first === '"' || first === "'"))
    ? value.slice(1, -1)
    : value;
}

// ─── Flag Loading ──────────────────────────────────────────────────────────────

/**
 * Load and parse flags.json from the given path.
 * Throws with a clear message if the file is missing or malformed.
 */
export function loadFlags(flagsPath) {
  const abs = resolve(process.cwd(), flagsPath);
  let raw;
  try {
    raw = readFileSync(abs, 'utf-8');
  } catch (err) {
    throw new Error(
      `GateKeeper: Cannot read flags.json at "${abs}".\n` +
      `Make sure the file exists and FLAGS_JSON_PATH is set correctly.\n` +
      `Original error: ${err.message}`
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `GateKeeper: flags.json at "${abs}" is not valid JSON.\n` +
      `Parse error: ${err.message}`
    );
  }
}

// ─── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Calculate overall release score and status from gate results.
 *
 * Gate 1 (kill switch) is special — if it FAILED the status is BLOCKED
 * immediately, regardless of other gates.
 *
 * For all other gates:
 *   PASSED  → full weight
 *   WARNING → half weight (rounded down)
 *   FAILED  → 0 points
 *
 * Status thresholds:
 *   BLOCKED      = kill switch active  OR  score < 50
 *   WITH-CAUTION = score 50-79  OR  any non-kill-switch gate FAILED
 *   CLEARED      = score >= 80  AND  no gates FAILED
 */
export function calculateStatus(gateResults) {
  const killSwitch = gateResults.find(g => g.id === 1);

  if (killSwitch && killSwitch.status === 'FAILED') {
    return {
      status: 'BLOCKED',
      score: 0,
      reason: 'Emergency kill switch is active — all deployments halted.',
    };
  }

  // Gates 2–9 contribute to the 0-100 score
  const scoringGates = gateResults.filter(g => g.id !== 1);
  let totalWeight = 0;
  let earnedScore = 0;

  for (const gate of scoringGates) {
    totalWeight += gate.weight;
    if (gate.status === 'PASSED') earnedScore += gate.weight;
    else if (gate.status === 'WARNING') earnedScore += Math.floor(gate.weight / 2);
    // FAILED → 0
  }

  // Normalise to 0-100
  const score = totalWeight > 0 ? Math.round((earnedScore / totalWeight) * 100) : 0;

  const anyFailed = gateResults.some(g => g.status === 'FAILED');

  let status;
  if (score < 50) {
    status = 'BLOCKED';
  } else if (score < 80 || anyFailed) {
    status = 'WITH-CAUTION';
  } else {
    status = 'CLEARED';
  }

  return { status, score, reason: null };
}

// ─── Formatting ────────────────────────────────────────────────────────────────

/**
 * ASCII progress bar for the certificate header.
 * e.g. scoreBar(72, 100, 20) → "██████████████░░░░░░"
 */
export function scoreBar(score, max = 100, width = 24) {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/** Status → emoji badge */
export function statusEmoji(status) {
  return { BLOCKED: '🔴', 'WITH-CAUTION': '🟡', CLEARED: '🟢' }[status] ?? '⚪';
}

/** Gate result → row emoji */
export function gateEmoji(status) {
  return { PASSED: '✅', WARNING: '⚠️', FAILED: '❌' }[status] ?? '❓';
}

/** Severity → display label */
export function severityLabel(severity) {
  return {
    CRITICAL: '🔴 CRITICAL',
    HIGH: '🟠 HIGH',
    MEDIUM: '🟡 MEDIUM',
    LOW: '🔵 LOW',
    INFO: '⚪ INFO',
  }[severity] ?? severity;
}

/** ISO date → readable string */
export function fmtDate(iso) {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toUTCString().replace(' GMT', ' UTC');
  } catch {
    return iso;
  }
}

/** Days since a date string */
export function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** Safe nested property access */
export function get(obj, path, defaultVal = undefined) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj) ?? defaultVal;
}

/** Timestamp for certificate footer */
export function nowISO() {
  return new Date().toISOString();
}

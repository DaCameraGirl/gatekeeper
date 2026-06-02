/**
 * GateKeeper Tool Executor
 * When Claude decides to use a tool, this file actually runs it.
 * Every tool here does REAL work — API calls, file generation, gate runs.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { resolve, join, dirname, relative, isAbsolute, extname } from 'path';
import { promisify } from 'util';
import { loadFlags, calculateStatus } from '../utils.js';
import { runAllGates } from '../gates/index.js';
import { validateFlagsSchema, preprocessContext } from '../brain/deepseek.js';
import {
  loadMemory, saveMemory, rememberFact, rememberProject,
  setUserInfo, forgetFact, clearChatHistory, buildMemoryContext
} from '../memory/store.js';

const execAsync = promisify(exec);

// Resolve a file path relative to the project root (where the server was started)
const PROJECT_ROOT = process.cwd();
function resolvePath(filePath = '.') {
  if (!filePath || filePath === '.') return PROJECT_ROOT;
  if (isAbsolute(filePath)) return filePath;
  return resolve(PROJECT_ROOT, filePath);
}

const GITHUB_API = 'https://api.github.com';

// ─── GitHub Tools ─────────────────────────────────────────────────────────────

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return { 'Accept': 'application/vnd.github+json', 'User-Agent': 'GateKeeper/1.0' };
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GateKeeper/1.0',
  };
}

async function ghFetch(path, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, { ...options, headers: { ...githubHeaders(), ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${body.message || JSON.stringify(body)}`);
  return body;
}

async function tool_github_create_issue({ repo, title, body, labels = [] }) {
  const data = await ghFetch(`/repos/${repo}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, labels }),
  });
  return {
    success: true,
    issue_number: data.number,
    url: data.html_url,
    title: data.title,
    message: `✅ Issue #${data.number} created: ${data.html_url}`,
  };
}

async function tool_github_list_issues({ repo, state = 'open', label }) {
  const params = new URLSearchParams({ state, per_page: '20' });
  if (label) params.set('labels', label);
  const data = await ghFetch(`/repos/${repo}/issues?${params}`);
  const issues = data.filter(i => !i.pull_request).map(i => ({
    number: i.number,
    title: i.title,
    state: i.state,
    labels: i.labels.map(l => l.name),
    url: i.html_url,
    created_at: i.created_at,
    assignee: i.assignee?.login ?? 'unassigned',
  }));
  return { success: true, count: issues.length, issues };
}

async function tool_github_get_pr_status({ repo, pr_number }) {
  const [pr, checks] = await Promise.all([
    ghFetch(`/repos/${repo}/pulls/${pr_number}`),
    ghFetch(`/repos/${repo}/commits/${pr_number}/check-runs`).catch(() => ({ check_runs: [] })),
  ]);
  return {
    success: true,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    mergeable: pr.mergeable,
    mergeable_state: pr.mergeable_state,
    author: pr.user.login,
    branch: pr.head.ref,
    url: pr.html_url,
    reviews: pr.requested_reviewers?.map(r => r.login) ?? [],
    checks: checks.check_runs?.map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion })) ?? [],
  };
}

async function tool_github_list_prs({ repo, state = 'open' }) {
  const data = await ghFetch(`/repos/${repo}/pulls?state=${state}&per_page=20`);
  return {
    success: true,
    count: data.length,
    prs: data.map(p => ({
      number: p.number,
      title: p.title,
      author: p.user.login,
      branch: p.head.ref,
      state: p.state,
      url: p.html_url,
      created_at: p.created_at,
    })),
  };
}

async function tool_github_comment_on_pr({ repo, pr_number, comment }) {
  const data = await ghFetch(`/repos/${repo}/issues/${pr_number}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: comment }),
  });
  return { success: true, comment_url: data.html_url, message: `✅ Comment posted: ${data.html_url}` };
}

async function tool_github_list_workflows({ repo }) {
  const [workflows, runs] = await Promise.all([
    ghFetch(`/repos/${repo}/actions/workflows`),
    ghFetch(`/repos/${repo}/actions/runs?per_page=10`),
  ]);
  return {
    success: true,
    workflows: workflows.workflows?.map(w => ({
      name: w.name,
      state: w.state,
      path: w.path,
    })) ?? [],
    recent_runs: runs.workflow_runs?.map(r => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      branch: r.head_branch,
      created_at: r.created_at,
    })) ?? [],
  };
}

async function tool_github_generate_commit_message({ repo, base = 'main', head, raw_diff, style = 'conventional' }) {
  let diffContent = raw_diff;

  if (!diffContent && repo && head) {
    const data = await ghFetch(`/repos/${repo}/compare/${base}...${head}`);
    diffContent = data.files?.map(f =>
      `--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch ?? '(binary file)'}`
    ).join('\n') || '(no changes)';

    if (!diffContent || diffContent === '(no changes)') {
      return { success: true, diff: '(no changes between branches)', instruction: 'No changes found to generate a commit message for.' };
    }
  }

  if (!diffContent) {
    return { success: false, error: 'Provide either raw_diff text or repo + base + head to fetch from GitHub.' };
  }

  const maxDiffLen = 8000;
  const truncated = diffContent.length > maxDiffLen;
  const displayDiff = truncated ? diffContent.slice(0, maxDiffLen) + '\n… [diff truncated]' : diffContent;

  const styleGuide = {
    conventional: 'Format: type(scope): description\n\nBody (if needed)\n\nFooter (if needed)\nTypes: feat, fix, chore, docs, refactor, test, style, perf, ci, build, revert',
    simple: 'Short, descriptive. Like: "Add login form validation" or "Fix payment timeout bug"',
    detailed: 'Subject line + blank line + bullet-point body + optional footers with references',
  };

  return {
    success: true,
    diff: displayDiff,
    truncated,
    style,
    style_guide: styleGuide[style] || styleGuide.conventional,
    total_files_changed: diffContent.match(/^--- a\//gm)?.length ?? null,
    instruction: `Here is the git diff. Generate a ${style} commit message based on these changes. Use the style guide provided. Be specific about what changed and why. Sign off as GateKeeper 🤖.`,
  };
}

// ─── Jira Tools ───────────────────────────────────────────────────────────────

function jiraHeaders() {
  const email  = process.env.JIRA_EMAIL;
  const token  = process.env.JIRA_API_TOKEN;
  if (!email || !token) return null;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  return {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

function jiraBase() {
  const domain = process.env.JIRA_DOMAIN;
  if (!domain) throw new Error('JIRA_DOMAIN not set in .env (e.g. yourcompany.atlassian.net)');
  return `https://${domain}/rest/api/3`;
}

async function jiraFetch(path, options = {}) {
  const headers = jiraHeaders();
  if (!headers) throw new Error('Jira not configured. Add JIRA_EMAIL, JIRA_API_TOKEN, JIRA_DOMAIN to .env');
  const res = await fetch(`${jiraBase()}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Jira API ${res.status}: ${body.errorMessages?.join(', ') || JSON.stringify(body)}`);
  return body;
}

async function tool_jira_create_ticket({ project_key, summary, description, issue_type = 'Task', priority = 'Medium', labels = [] }) {
  const data = await jiraFetch('/issue', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        project: { key: project_key },
        summary,
        description: {
          type: 'doc', version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
        },
        issuetype: { name: issue_type },
        priority: { name: priority },
        labels,
      },
    }),
  });
  const domain = process.env.JIRA_DOMAIN;
  return {
    success: true,
    ticket_key: data.key,
    url: `https://${domain}/browse/${data.key}`,
    message: `✅ Jira ticket created: ${data.key} — https://${domain}/browse/${data.key}`,
  };
}

async function tool_jira_search_issues({ jql, max_results = 10 }) {
  const data = await jiraFetch(`/search?jql=${encodeURIComponent(jql)}&maxResults=${max_results}&fields=summary,status,priority,assignee,created`);
  return {
    success: true,
    total: data.total,
    issues: data.issues?.map(i => ({
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status?.name,
      priority: i.fields.priority?.name,
      assignee: i.fields.assignee?.displayName ?? 'Unassigned',
    })) ?? [],
  };
}

async function tool_jira_update_ticket({ ticket_key, transition, comment, priority }) {
  const results = [];

  if (transition) {
    const transitions = await jiraFetch(`/issue/${ticket_key}/transitions`);
    const match = transitions.transitions?.find(t => t.name.toLowerCase().includes(transition.toLowerCase()));
    if (match) {
      await jiraFetch(`/issue/${ticket_key}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: match.id } }),
      });
      results.push(`Status → ${match.name}`);
    }
  }

  if (comment) {
    await jiraFetch(`/issue/${ticket_key}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] },
      }),
    });
    results.push('Comment added');
  }

  if (priority) {
    await jiraFetch(`/issue/${ticket_key}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { priority: { name: priority } } }),
    });
    results.push(`Priority → ${priority}`);
  }

  return { success: true, ticket_key, updates: results, message: `✅ ${ticket_key} updated: ${results.join(', ')}` };
}

// ─── Slack Tools ──────────────────────────────────────────────────────────────

function slackHeaders() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not set in .env');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function slackPost(endpoint, body) {
  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: slackHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

async function tool_slack_send_message({ channel, message, username = 'GateKeeper 🤖' }) {
  const ch = channel.startsWith('#') ? channel : `#${channel}`;
  const data = await slackPost('chat.postMessage', {
    channel: ch,
    text: message,
    username,
    icon_url: 'https://raw.githubusercontent.com/DaCameraGirl/gatekeeper/main/assets/gatekeeper.svg',
  });
  return { success: true, channel: data.channel, ts: data.ts, message: `✅ Message sent to ${ch}` };
}

async function tool_slack_list_channels({ limit = 20 }) {
  const data = await slackPost('conversations.list', { limit, exclude_archived: true, types: 'public_channel,private_channel' });
  return {
    success: true,
    channels: data.channels?.map(c => ({ name: c.name, id: c.id, is_private: c.is_private, members: c.num_members })) ?? [],
  };
}

// ─── Memory Tools ─────────────────────────────────────────────────────────────

async function tool_remember({ type, content, topic = 'general', user_info, project }) {
  const memory = loadMemory();

  if (type === 'user_info' && user_info) {
    setUserInfo(memory, user_info);
    return { success: true, message: `✅ Got it — I'll remember that.`, saved: user_info };
  }
  if (type === 'project' && project) {
    rememberProject(memory, project);
    return { success: true, message: `✅ Project "${project.name}" saved to memory.`, saved: project };
  }
  rememberFact(memory, content, topic);
  return { success: true, message: `✅ Remembered: "${content}"`, topic };
}

async function tool_recall_memory({ filter } = {}) {
  const memory = loadMemory();
  let facts = memory.facts || [];
  if (filter) {
    facts = facts.filter(f =>
      f.topic?.toLowerCase().includes(filter.toLowerCase()) ||
      f.content?.toLowerCase().includes(filter.toLowerCase())
    );
  }
  return {
    success: true,
    user: memory.user,
    projects: memory.projects || [],
    facts,
    lastSeen: memory.lastSeen,
  };
}

async function tool_forget({ topic }) {
  const memory = loadMemory();
  forgetFact(memory, topic);
  return { success: true, message: `✅ Forgotten anything related to "${topic}".` };
}

async function tool_clear_chat_history() {
  clearChatHistory();
  return { success: true, message: '✅ Chat history cleared. Fresh start.' };
}

// ─── Web Search ───────────────────────────────────────────────────────────────

async function tool_web_search({ query, max_results = 5 }) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY not set in .env — get a free key at tavily.com');

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results,
      search_depth: 'basic',
      include_answer: true,
    }),
  });

  if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
  const data = await res.json();

  return {
    success: true,
    query,
    answer: data.answer ?? null,
    results: (data.results ?? []).map(r => ({
      title: r.title,
      url: r.url,
      content: r.content?.slice(0, 400),
      published: r.published_date ?? null,
    })),
  };
}

async function tool_firecrawl_search({ query, max_results = 5, scrape = false }) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY not set in .env');

  const body = { query, limit: Math.min(max_results, 10) };
  if (scrape) body.scrapeOptions = { formats: ['markdown'] };

  const res = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firecrawl search failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();

  const results = (data.data ?? []).map(r => ({
    title: r.metadata?.title ?? r.title ?? '',
    url: r.url,
    description: r.metadata?.description ?? r.description ?? '',
    content: scrape ? r.markdown?.slice(0, 2000) ?? r.content?.slice(0, 2000) : null,
    published: r.metadata?.publishedDate ?? r.publishedDate ?? null,
  }));

  return {
    success: true,
    query,
    source: 'Firecrawl',
    result_count: results.length,
    results,
  };
}

// ─── Release Gate Tool ────────────────────────────────────────────────────────
//
// Full three-stage pipeline:
//   Stage 1 — 9 deterministic policy gates (always runs)
//   Stage 2 — DeepSeek schema validation + context compression (if key set)
//   Stage 3 — Return everything to the chat Claude for deep risk reasoning
//
// DeepSeek acts as prep cook: validates the schema and compresses the gate
// context into a tight briefing. The chat Claude then reasons over it with
// full context rather than raw gate data.

async function tool_run_release_gate({ flags_json }) {
  let flags;
  try {
    flags = JSON.parse(flags_json);
  } catch (e) {
    return { success: false, error: `Invalid JSON: ${e.message}` };
  }

  // ── Stage 1: Run all 9 policy gates ────────────────────────────────────────
  const origLog = console.log;
  console.log = () => {};
  const { gateResults, summary } = await runAllGates(flags);
  console.log = origLog;

  const baseResult = {
    success: true,
    status: summary.status,
    score: summary.score,
    passed: summary.counts.passed,
    warnings: summary.counts.warnings,
    failed: summary.counts.failed,
    blockers: summary.blockers.map(b => ({ gate: b.name, message: b.message, fix: b.remediation })),
    warnings_detail: summary.warnings.map(w => ({ gate: w.name, message: w.message })),
    gate_results: gateResults.map(g => ({ id: g.id, name: g.name, status: g.status, message: g.message })),
    deepseek_used: false,
  };

  // ── Stage 2: DeepSeek enrichment (if key is available) ─────────────────────
  if (!process.env.DEEPSEEK_API_KEY) {
    baseResult.deepseek_note = 'DeepSeek schema validation and context analysis skipped — DEEPSEEK_API_KEY not set.';
    return baseResult;
  }

  let schemaValidation = null;
  let preAnalysis = null;

  try {
    // Run both DeepSeek calls in parallel — they're independent
    [schemaValidation, preAnalysis] = await Promise.all([
      validateFlagsSchema(flags),
      preprocessContext(flags, gateResults, summary),
    ]);
  } catch (err) {
    // Degrade gracefully — gate results still valid without DeepSeek
    baseResult.deepseek_note = `DeepSeek enrichment failed: ${err.message}. Gate results above are still valid.`;
    return baseResult;
  }

  // ── Stage 3: Return enriched result to chat Claude ─────────────────────────
  return {
    ...baseResult,
    deepseek_used: true,

    // Schema health — surface before risk reasoning
    schema: {
      valid: schemaValidation.valid,
      issues: schemaValidation.issues,        // e.g. ["rollout 100% but no canary set"]
      summary: schemaValidation.summary,
    },

    // Compressed, structured briefing — gives chat Claude much better context
    // to reason over than raw gate data alone
    pre_analysis: preAnalysis,

    // Instruction for chat Claude on how to use this data
    _instruction: `You now have three layers of release intelligence:
1. gate_results — 9 deterministic policy checks (pass/warn/fail)
2. schema — DeepSeek's structural validation of the flags.json
3. pre_analysis — DeepSeek's compressed risk briefing identifying cross-cutting patterns

Use all three layers in your assessment. The pre_analysis is your starting point — it already identifies compounding risks and patterns the individual gates may have missed. Build your risk verdict on top of it. Be specific: reference actual flag values, gate names, and field names from the data.`,
  };
}

// ─── File Access Tools ────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 512 * 1024; // 512 KB — refuse to read huge files in one shot

async function tool_read_file({ path: filePath, start_line, end_line }) {
  const absPath = resolvePath(filePath);

  if (!existsSync(absPath)) throw new Error(`File not found: ${filePath}`);

  const stat = statSync(absPath);
  if (stat.isDirectory()) throw new Error(`"${filePath}" is a directory — use list_directory instead.`);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(
      `File is ${(stat.size / 1024).toFixed(0)} KB — too large to read all at once. ` +
      `Use start_line and end_line to read a specific section.`
    );
  }

  const raw = readFileSync(absPath, 'utf-8');
  const lines = raw.split('\n');
  const totalLines = lines.length;

  if (start_line !== undefined || end_line !== undefined) {
    const from = Math.max((start_line ?? 1) - 1, 0);
    const to   = Math.min(end_line ?? totalLines, totalLines);
    const slice = lines.slice(from, to);
    return {
      success: true,
      path: filePath,
      content: slice.map((l, i) => `${from + i + 1}\t${l}`).join('\n'),
      total_lines: totalLines,
      shown: `lines ${from + 1}–${to}`,
    };
  }

  // Cap full-file reads at 150 lines to control token cost
  const MAX_LINES = 150;
  const truncated = totalLines > MAX_LINES;
  const shown = truncated ? lines.slice(0, MAX_LINES) : lines;
  return {
    success: true,
    path: filePath,
    content: shown.map((l, i) => `${i + 1}\t${l}`).join('\n'),
    total_lines: totalLines,
    shown: truncated ? `lines 1–${MAX_LINES} (use start_line/end_line for more)` : `all ${totalLines} lines`,
    size_bytes: stat.size,
  };
}

async function tool_write_file({ path: filePath, content, mode = 'overwrite' }) {
  const absPath = resolvePath(filePath);

  // Ensure parent directory exists
  const parentDir = dirname(absPath);
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

  if (mode === 'append') {
    const existing = existsSync(absPath) ? readFileSync(absPath, 'utf-8') : '';
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(absPath, existing + separator + content, 'utf-8');
  } else {
    writeFileSync(absPath, content, 'utf-8');
  }

  const stat = statSync(absPath);
  return {
    success: true,
    path: filePath,
    mode,
    size_bytes: stat.size,
    message: `✅ ${mode === 'append' ? 'Appended to' : 'Wrote'} ${filePath} (${stat.size} bytes)`,
  };
}

async function tool_list_directory({ path: dirPath = '.', recursive = false, show_hidden = false }) {
  const absPath = resolvePath(dirPath);

  if (!existsSync(absPath)) throw new Error(`Path not found: ${dirPath}`);
  const stat = statSync(absPath);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Cannot list: ${dirPath}`);
  if (stat.isFile()) throw new Error(`"${dirPath}" is a file — use read_file instead.`);

  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

  function listDir(dir, depth = 0) {
    if (depth > 3) return [];
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }

    const results = [];
    for (const entry of entries) {
      if (!show_hidden && entry.name.startsWith('.')) continue;
      if (SKIP.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);
      const relPath  = relative(absPath, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        results.push({ type: 'dir', name: relPath + '/' });
        if (recursive) results.push(...listDir(fullPath, depth + 1));
      } else {
        try {
          const s = statSync(fullPath);
          results.push({
            type: 'file',
            name: relPath,
            size: s.size,
            ext: extname(entry.name),
            modified: s.mtime.toISOString().slice(0, 10),
          });
        } catch { /* skip unreadable files */ }
      }
    }
    return results;
  }

  const entries = listDir(absPath);
  const dirs  = entries.filter(e => e.type === 'dir');
  const files = entries.filter(e => e.type === 'file');

  return {
    success: true,
    path: dirPath,
    entry_count: entries.length,
    dirs: dirs.map(d => d.name),
    files: files.map(f => `${f.name} (${f.size}B)`),
    entries,
  };
}

const TEXT_EXTS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.json', '.yml', '.yaml', '.toml', '.env', '.env.example',
  '.md', '.txt', '.sh', '.bat', '.ps1',
  '.html', '.css', '.scss', '.svg',
  '.py', '.rb', '.go', '.rs', '.java', '.cs',
  '.sql', '.graphql', '.proto',
  '.dockerfile', '.gitignore', '.npmignore',
  '', // no extension — might be a script
]);

async function tool_search_files({ pattern, path: searchPath = '.', file_pattern, max_results = 20 }) {
  const absPath = resolvePath(searchPath);
  if (!existsSync(absPath)) throw new Error(`Path not found: ${searchPath}`);

  let regex;
  try { regex = new RegExp(pattern, 'i'); }
  catch { throw new Error(`Invalid regex pattern: ${pattern}`); }

  const fileRegex = file_pattern
    ? new RegExp('^' + file_pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i')
    : null;

  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
  const results = [];

  function searchDir(dir) {
    if (results.length >= max_results) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (results.length >= max_results) break;
      if (SKIP.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!TEXT_EXTS.has(ext)) continue;
        if (fileRegex && !fileRegex.test(entry.name)) continue;

        let content;
        try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

        const relFile = relative(absPath, fullPath).replace(/\\/g, '/');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length && results.length < max_results; i++) {
          if (regex.test(lines[i])) {
            results.push({
              file: relFile,
              line: i + 1,
              content: lines[i].trim().slice(0, 200),
            });
          }
        }
      }
    }
  }

  const stat = statSync(absPath);
  if (stat.isFile()) {
    const content = readFileSync(absPath, 'utf-8');
    content.split('\n').forEach((line, i) => {
      if (results.length < max_results && regex.test(line)) {
        results.push({ file: searchPath, line: i + 1, content: line.trim().slice(0, 200) });
      }
    });
  } else {
    searchDir(absPath);
  }

  return {
    success: true,
    pattern,
    path: searchPath,
    results,
    count: results.length,
    truncated: results.length >= max_results,
    message: results.length === 0
      ? `No matches found for "${pattern}"`
      : `Found ${results.length} match${results.length === 1 ? '' : 'es'}${results.length >= max_results ? ' (more exist — increase max_results)' : ''}`,
  };
}

// ─── Terminal Tool ────────────────────────────────────────────────────────────

const MAX_COMMAND_TIMEOUT = 60_000; // 60s hard cap
const MAX_OUTPUT_CHARS    = 8_000;  // Truncate very long outputs

async function tool_run_terminal_command({ command, working_dir = '.', timeout = 30_000 }) {
  const cwd = resolvePath(working_dir);

  if (!existsSync(cwd)) throw new Error(`Working directory not found: ${working_dir}`);
  const stat = statSync(cwd);
  if (!stat.isDirectory()) throw new Error(`"${working_dir}" is not a directory.`);

  const actualTimeout = Math.min(Math.max(timeout, 1_000), MAX_COMMAND_TIMEOUT);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: actualTimeout,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });

    const combined = [stdout, stderr ? `[stderr]\n${stderr}` : ''].filter(Boolean).join('\n').trimEnd();
    const truncated = combined.length > MAX_OUTPUT_CHARS;

    return {
      success: true,
      command,
      working_dir: working_dir === '.' ? '(project root)' : working_dir,
      exit_code: 0,
      output: truncated ? combined.slice(0, MAX_OUTPUT_CHARS) + '\n… [output truncated]' : combined,
      truncated,
      message: `✅ Command finished`,
    };
  } catch (err) {
    const combined = [(err.stdout || ''), err.stderr ? `[stderr]\n${err.stderr}` : ''].filter(Boolean).join('\n').trimEnd();
    const isTimeout = err.killed || err.signal === 'SIGTERM';
    return {
      success: false,
      command,
      working_dir: working_dir === '.' ? '(project root)' : working_dir,
      exit_code: err.code ?? 1,
      output: combined.slice(0, 4_000) || '(no output)',
      error: isTimeout ? `Command timed out after ${actualTimeout / 1000}s` : err.message,
      message: isTimeout
        ? `⏱ Command timed out after ${actualTimeout / 1000}s`
        : `❌ Command failed (exit ${err.code ?? 1})`,
    };
  }
}

// ─── DevOps Generation Tools ──────────────────────────────────────────────────
// These return generated content — Claude does the actual generation
// by returning it in the tool result, which then flows back to the user.

async function tool_generate_github_actions_workflow({ purpose, language = 'Node.js', extras = '' }) {
  return {
    success: true,
    instruction: `Generate a complete GitHub Actions workflow YAML for: ${purpose}. Language: ${language}. Extra requirements: ${extras}. Return the full YAML with comments.`,
    note: 'Claude will generate the YAML based on these requirements.',
  };
}

async function tool_generate_dockerfile({ language, app_type, extras = '' }) {
  return {
    success: true,
    instruction: `Generate a production-ready Dockerfile for a ${language} ${app_type} application. ${extras}`,
    note: 'Claude will generate the Dockerfile.',
  };
}

async function tool_generate_kubernetes_manifest({ app_name, image, replicas = 2, port = 3000, manifest_types = ['Deployment', 'Service'] }) {
  return {
    success: true,
    instruction: `Generate Kubernetes YAML manifests for app "${app_name}" using image "${image}", ${replicas} replicas, port ${port}. Include: ${manifest_types.join(', ')}.`,
    note: 'Claude will generate the manifests.',
  };
}

// ─── Main Executor ────────────────────────────────────────────────────────────

const TOOL_MAP = {
  github_create_issue:             tool_github_create_issue,
  github_list_issues:              tool_github_list_issues,
  github_get_pr_status:            tool_github_get_pr_status,
  github_list_prs:                 tool_github_list_prs,
  github_comment_on_pr:            tool_github_comment_on_pr,
  github_list_workflows:           tool_github_list_workflows,
  jira_create_ticket:              tool_jira_create_ticket,
  jira_search_issues:              tool_jira_search_issues,
  jira_update_ticket:              tool_jira_update_ticket,
  slack_send_message:              tool_slack_send_message,
  slack_list_channels:             tool_slack_list_channels,
  remember:                        tool_remember,
  recall_memory:                   tool_recall_memory,
  forget:                          tool_forget,
  clear_chat_history:              tool_clear_chat_history,
  web_search:                      tool_web_search,
  firecrawl_search:                tool_firecrawl_search,
  run_release_gate:                tool_run_release_gate,
  github_generate_commit_message:  tool_github_generate_commit_message,
  generate_github_actions_workflow: tool_generate_github_actions_workflow,
  generate_dockerfile:             tool_generate_dockerfile,
  generate_kubernetes_manifest:    tool_generate_kubernetes_manifest,
  read_file:                       tool_read_file,
  write_file:                      tool_write_file,
  list_directory:                  tool_list_directory,
  search_files:                    tool_search_files,
  run_terminal_command:            tool_run_terminal_command,
};

/**
 * Execute a tool by name with the given input.
 * Returns { result, error } — never throws.
 */
export async function executeTool(name, input) {
  const fn = TOOL_MAP[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try {
    const result = await fn(input);
    return { result };
  } catch (err) {
    return { error: err.message };
  }
}

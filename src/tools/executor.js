/**
 * GateKeeper Tool Executor
 * When Claude decides to use a tool, this file actually runs it.
 * Every tool here does REAL work — API calls, file generation, gate runs.
 */

import { loadFlags, calculateStatus } from '../utils.js';
import { runAllGates } from '../gates/index.js';

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

// ─── Release Gate Tool ────────────────────────────────────────────────────────

async function tool_run_release_gate({ flags_json }) {
  let flags;
  try {
    flags = JSON.parse(flags_json);
  } catch (e) {
    return { success: false, error: `Invalid JSON: ${e.message}` };
  }

  // Suppress console output during gate run
  const origLog = console.log;
  console.log = () => {};
  const { gateResults, summary } = await runAllGates(flags);
  console.log = origLog;

  return {
    success: true,
    status: summary.status,
    score: summary.score,
    passed: summary.counts.passed,
    warnings: summary.counts.warnings,
    failed: summary.counts.failed,
    blockers: summary.blockers.map(b => ({ gate: b.name, message: b.message, fix: b.remediation })),
    warnings_detail: summary.warnings.map(w => ({ gate: w.name, message: w.message })),
    gate_results: gateResults.map(g => ({ id: g.id, name: g.name, status: g.status, message: g.message })),
  };
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
  web_search:                      tool_web_search,
  run_release_gate:                tool_run_release_gate,
  generate_github_actions_workflow: tool_generate_github_actions_workflow,
  generate_dockerfile:             tool_generate_dockerfile,
  generate_kubernetes_manifest:    tool_generate_kubernetes_manifest,
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

/**
 * GateKeeper Chat Server — Agent Edition
 * Full tool-calling loop: GateKeeper doesn't just talk, he acts.
 */

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TOOLS } from './src/tools/definitions.js';
import { executeTool } from './src/tools/executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, 'public')));
app.use('/assets', express.static(join(__dirname, 'assets')));

const SYSTEM_PROMPT = `You are GateKeeper — a senior DevOps engineer with 15 years of experience and access to real tools. You don't just give advice, you take action.

You have tools to:
- Create and manage GitHub issues and PRs
- Create and update Jira tickets
- Send Slack messages and alerts
- Run full release gate assessments on flags.json
- Generate GitHub Actions workflows, Dockerfiles, and Kubernetes manifests

When the user asks you to do something, DO IT using your tools. Don't describe what you'd do — actually do it. After using a tool, tell the user what you did and what happened.

Your expertise:
- Release management, deployment pipelines, CI/CD
- Feature flags, canary deployments, rollout strategies
- Docker, Kubernetes, cloud infrastructure (AWS/GCP/Azure)
- Incident response, monitoring, SLOs/SLAs
- GitHub Actions, Jenkins, GitLab CI
- Security, dependency management, vulnerability scanning
- API integrations: Jira, Slack, GitHub, Workday, ServiceNow, Salesforce

When assessing a release: be direct about what's wrong and exactly how to fix it.
When generating configs: produce complete, production-ready output — no placeholders.
When taking actions: confirm what you did with URLs and ticket numbers.

You sign off as GateKeeper. You are confident, precise, and get things done.`;

// ─── Agent Loop ───────────────────────────────────────────────────────────────

/**
 * Run the full agent loop with tool calling.
 * Streams progress to the client via SSE as tools execute,
 * then streams the final text response.
 */
async function runAgentLoop(messages, res) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const agentMessages = [...messages];

  let iterations = 0;
  const MAX_ITERATIONS = 10; // Prevent infinite loops

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: agentMessages,
    });

    // ── Case 1: Tool use — GateKeeper is taking action ─────────────────────
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const textBlocks    = response.content.filter(b => b.type === 'text');

      // Stream any thinking text before tools
      for (const tb of textBlocks) {
        if (tb.text) {
          res.write(`data: ${JSON.stringify({ type: 'text', text: tb.text })}\n\n`);
        }
      }

      // Add assistant message with tool_use blocks to history
      agentMessages.push({ role: 'assistant', content: response.content });

      // Execute each tool and collect results
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        // Notify client which tool is running
        res.write(`data: ${JSON.stringify({
          type: 'tool_start',
          tool: toolUse.name,
          label: formatToolLabel(toolUse.name, toolUse.input),
        })}\n\n`);

        const { result, error } = await executeTool(toolUse.name, toolUse.input);

        const toolResult = error
          ? { type: 'tool_result', tool_use_id: toolUse.id, content: `Error: ${error}`, is_error: true }
          : { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) };

        // Notify client of result
        res.write(`data: ${JSON.stringify({
          type: 'tool_done',
          tool: toolUse.name,
          success: !error,
          summary: error || result?.message || '✅ Done',
        })}\n\n`);

        toolResults.push(toolResult);
      }

      // Add tool results to history and loop
      agentMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    // ── Case 2: Final text response — stream it ─────────────────────────────
    if (response.stop_reason === 'end_turn') {
      const textBlocks = response.content.filter(b => b.type === 'text');

      for (const block of textBlocks) {
        // Stream text word-by-word for live feel
        const words = block.text.split('');
        let buffer = '';

        for (const char of words) {
          buffer += char;
          if (buffer.length >= 4 || char === '\n') {
            res.write(`data: ${JSON.stringify({ type: 'text', text: buffer })}\n\n`);
            buffer = '';
          }
        }
        if (buffer) {
          res.write(`data: ${JSON.stringify({ type: 'text', text: buffer })}\n\n`);
        }
      }

      break;
    }

    // Unexpected stop reason — break to avoid loop
    break;
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

function formatToolLabel(name, input) {
  const labels = {
    web_search:                       `Searching the web for "${input.query}"`,
    github_create_issue:              `Creating GitHub issue: "${input.title}"`,
    github_list_issues:               `Fetching issues from ${input.repo}`,
    github_get_pr_status:             `Checking PR #${input.pr_number} in ${input.repo}`,
    github_list_prs:                  `Listing PRs in ${input.repo}`,
    github_comment_on_pr:             `Commenting on PR #${input.pr_number}`,
    github_list_workflows:            `Checking GitHub Actions in ${input.repo}`,
    jira_create_ticket:               `Creating Jira ticket in ${input.project_key}`,
    jira_search_issues:               `Searching Jira: ${input.jql}`,
    jira_update_ticket:               `Updating ${input.ticket_key}`,
    slack_send_message:               `Sending Slack message to ${input.channel}`,
    slack_list_channels:              `Listing Slack channels`,
    run_release_gate:                 `Running release gate assessment`,
    generate_github_actions_workflow: `Generating GitHub Actions workflow`,
    generate_dockerfile:              `Generating Dockerfile for ${input.language}`,
    generate_kubernetes_manifest:     `Generating Kubernetes manifests for ${input.app_name}`,
  };
  return labels[name] || `Running ${name}`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await runAgentLoop(messages, res);
  } catch (err) {
    console.error('Agent loop error:', err.message);
    res.write(`data: ${JSON.stringify({ type: 'error', text: `❌ ${err.message}` })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 GateKeeper is online → http://localhost:${PORT}\n`);
  console.log(`   GitHub:  ${process.env.GITHUB_TOKEN ? '✅ Connected' : '⚠️  No GITHUB_TOKEN'}`);
  console.log(`   Jira:    ${process.env.JIRA_API_TOKEN ? '✅ Connected' : '⚠️  No JIRA_API_TOKEN'}`);
  console.log(`   Slack:   ${process.env.SLACK_BOT_TOKEN ? '✅ Connected' : '⚠️  No SLACK_BOT_TOKEN'}`);
  console.log(`   Web:     ${process.env.TAVILY_API_KEY ? '✅ Search enabled' : '⚠️  No TAVILY_API_KEY (free at tavily.com)'}
   Claude:  ${process.env.ANTHROPIC_API_KEY ? '✅ Ready' : '❌ No ANTHROPIC_API_KEY — set this first'}`);
  console.log('');
});

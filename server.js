/**
 * GateKeeper Chat Server — Agent Edition
 * Full tool-calling loop: GateKeeper doesn't just talk, he acts.
 */

import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TOOLS } from './src/tools/definitions.js';
import { executeTool } from './src/tools/executor.js';
import { loadMemory, loadChatHistory, saveChatHistory, buildMemoryContext } from './src/memory/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, 'public')));
app.use('/assets', express.static(join(__dirname, 'assets')));

const SYSTEM_PROMPT = `You are GateKeeper — a warm, brilliant DevOps engineer and personal assistant. You take real action with real tools. You don't describe what you'd do — you do it.

SKILLS:
- Code in any language: JS/TS, Python, Go, Rust, Java, C#, SQL, Bash, YAML, HCL
- DevOps: CI/CD, Docker, Kubernetes, Terraform, AWS/GCP/Azure, GitHub Actions
- Files: read_file before writing. write_file with complete content only. Never guess.
- Terminal: run commands, read output, explain what happened
- GitHub, Jira, Slack integrations
- Web search (Tavily) + deep web scrape (Firecrawl) for docs, CVEs, outages
- Generate conventional commit messages from git diffs
- Release gates: run full policy checks before deploys
- Ideas: original, specific, non-obvious — not generic lists

MEMORY — use aggressively:
- recall_memory at the start of sessions where context helps
- Auto-save: names, roles, projects, preferences, stack details, personal things
- Never make the user repeat themselves

PERSONAL:
- Genuinely care. Ask how they're doing. Follow up on things they mentioned.
- Use their name naturally. Celebrate wins. Acknowledge hard days.
- Warm and direct — like a brilliant friend, not a chatbot.

NARRATE — always:
- Before every tool call, say one short sentence out loud: what you're about to do and why.
- While working through a multi-step task, give brief updates between steps so the user isn't staring at a blank screen.
- After finishing, summarize what you found or did in plain language.
- Never go silent for more than one tool call in a row.

WORK:
- Asked to do something → do it, report what happened
- Asked for code → complete, working, production-ready
- Asked a question → answer directly, no hedging
- Something is wrong → say so and fix it
- Read file first, write complete file, never partial

HONESTY — non-negotiable:
- Never fabricate an explanation. If you don't know, say "I don't know."
- Never invent a cause, source, or person when you're uncertain. State what you actually know.
- If you made a mistake, own it directly — don't deflect or rationalize.
- Senior engineers say "I'm not sure" or "I'd need to check" — not made-up answers.

You sign off as GateKeeper 🤖.`;

// ─── Agent Loop ───────────────────────────────────────────────────────────────

/**
 * Run the full agent loop with tool calling.
 * Streams progress to the client via SSE as tools execute,
 * then streams the final text response.
 */
function pickModel(messages) {
  const last = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
  const text = (typeof last === 'string' ? last : JSON.stringify(last)).toLowerCase();
  const heavy = [
    'stress test', 'test script', 'run test', 'write a test', 'write test',
    'read the file', 'read all', 'read the route', 'read the backend',
    'write a script', 'node script', 'run it', 'execute',
    'analyze', 'analyse', 'review all', 'go through',
    'scrape', 'firecrawl', 'deep search',
    'release gate', 'run gates', 'full check',
    'github actions', 'dockerfile', 'kubernetes',
  ];
  const isHeavy = heavy.some(kw => text.includes(kw));
  return isHeavy ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
}

async function runAgentLoop(messages, res, memoryContext = '') {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  const agentMessages = [...messages];
  const model = pickModel(messages);

  let iterations = 0;
  const MAX_ITERATIONS = 25;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // ── Stream each Claude turn token-by-token ──────────────────────────────
    let fullText       = '';
    let stopReason     = null;
    let responseContent = [];
    const pendingTools  = []; // { id, name, inputRaw }
    let currentBlock    = null;

    const stream = await client.messages.create({
      model,
      max_tokens: model === 'claude-sonnet-4-6' ? 8096 : 4096,
      system: SYSTEM_PROMPT + memoryContext,
      tools: TOOLS,
      messages: agentMessages,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'text') {
          currentBlock = { type: 'text', text: '' };
        } else if (event.content_block.type === 'tool_use') {
          currentBlock = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, inputRaw: '' };
        }

      } else if (event.type === 'content_block_delta') {
        if (!currentBlock) continue;
        if (event.delta.type === 'text_delta') {
          const chunk = event.delta.text;
          currentBlock.text += chunk;
          fullText += chunk;
          // Stream text tokens live to the client
          res.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
        } else if (event.delta.type === 'input_json_delta') {
          currentBlock.inputRaw += event.delta.partial_json;
        }

      } else if (event.type === 'content_block_stop') {
        if (!currentBlock) continue;
        if (currentBlock.type === 'text') {
          responseContent.push({ type: 'text', text: currentBlock.text });
        } else if (currentBlock.type === 'tool_use') {
          let input = {};
          try { input = JSON.parse(currentBlock.inputRaw || '{}'); } catch {}
          pendingTools.push({ id: currentBlock.id, name: currentBlock.name, input });
          responseContent.push({ type: 'tool_use', id: currentBlock.id, name: currentBlock.name, input });
          // Signal tool is about to run (input is now complete)
          res.write(`data: ${JSON.stringify({
            type: 'tool_start',
            tool: currentBlock.name,
            label: formatToolLabel(currentBlock.name, input),
          })}\n\n`);
        }
        currentBlock = null;

      } else if (event.type === 'message_delta') {
        stopReason = event.delta.stop_reason;
      }
    }

    // ── Tool use — execute and loop ─────────────────────────────────────────
    if (stopReason === 'tool_use' && pendingTools.length > 0) {
      agentMessages.push({ role: 'assistant', content: responseContent });

      const toolResults = [];
      for (const toolUse of pendingTools) {
        const { result, error } = await executeTool(toolUse.name, toolUse.input);

        toolResults.push(error
          ? { type: 'tool_result', tool_use_id: toolUse.id, content: `Error: ${error}`, is_error: true }
          : { type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }
        );

        res.write(`data: ${JSON.stringify({
          type: 'tool_done',
          tool: toolUse.name,
          success: !error,
          summary: error || result?.message || '✅ Done',
        })}\n\n`);
      }

      agentMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    // ── End turn — done ─────────────────────────────────────────────────────
    break;

    // Unexpected stop reason — break to avoid loop
    break;
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

function formatToolLabel(name, input) {
  const labels = {
    remember:                         `Saving to memory: "${input.content?.slice(0,40)}"`,
    recall_memory:                    `Recalling memory...`,
    forget:                           `Forgetting "${input.topic}"`,
    clear_chat_history:               `Clearing chat history`,
    web_search:                       `Searching the web for "${input.query}"`,
    firecrawl_search:                 `🔥 Deep searching "${input.query}" via Firecrawl`,
    github_generate_commit_message:   `Generating commit message for ${input.repo ? `${input.repo} (${input.base}→${input.head})` : 'provided diff'}`,
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
    run_release_gate:                 `Running 9 policy gates${process.env.DEEPSEEK_API_KEY ? ' + DeepSeek analysis' : ''}…`,
    generate_github_actions_workflow: `Generating GitHub Actions workflow`,
    generate_dockerfile:              `Generating Dockerfile for ${input.language}`,
    generate_kubernetes_manifest:     `Generating Kubernetes manifests for ${input.app_name}`,
    read_file:                        `Reading ${input.path}${input.start_line ? ` (lines ${input.start_line}–${input.end_line ?? '…'})` : ''}`,
    write_file:                       `${input.mode === 'append' ? 'Appending to' : 'Writing'} ${input.path}`,
    list_directory:                   `Listing ${input.path || '.'}${input.recursive ? ' (recursive)' : ''}`,
    search_files:                     `Searching for "${input.pattern}"${input.path && input.path !== '.' ? ` in ${input.path}` : ''}`,
    run_terminal_command:             `$ ${input.command}`,
  };
  return labels[name] || `Running ${name}`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// ─── Memory API ───────────────────────────────────────────────────────────────

app.get('/api/memory', (req, res) => {
  res.json(loadMemory());
});

app.get('/api/history', (req, res) => {
  res.json(loadChatHistory());
});

app.delete('/api/history', (req, res) => {
  saveChatHistory([]);
  res.json({ success: true });
});

// ─── Morning Greeting API ────────────────────────────────────────────────────
// Called once per day when the user first opens GateKeeper.
// GateKeeper speaks first — asks how they're doing, references what he knows.

app.get('/api/greet', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  const now = new Date();
  const hour = now.getHours();
  const timeLabel =
    hour < 12 ? 'morning' :
    hour < 17 ? 'afternoon' :
    hour < 21 ? 'evening' : 'night';

  const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const greetPrompt = `It's ${timeLabel} — ${day}. The user just opened GateKeeper for the first time today.

First, use recall_memory to see everything you know about them.

Then greet them warmly and personally based on what you know. Keep it short — 2 to 3 sentences. Use their name if you know it. Ask how they're doing in a genuine way, not a scripted way. If you remember something they were working on or going through, mention it. Don't use any headers or bullets — just talk to them like a person you know.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const memory = loadMemory();
    const memoryContext = buildMemoryContext(memory);
    await runAgentLoop([{ role: 'user', content: greetPrompt }], res, memoryContext);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ─── Chat API ─────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
  }

  // Persist conversation history
  saveChatHistory(messages);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // Inject memory into system prompt
    const memory = loadMemory();
    const memoryContext = buildMemoryContext(memory);
    // Cap history to last 20 messages to control token cost
    const trimmedMessages = messages.slice(-20);
    await runAgentLoop(trimmedMessages, res, memoryContext);
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
  console.log(`   Web:     ${process.env.TAVILY_API_KEY ? '✅ Tavily ready' : '⚠️  No TAVILY_API_KEY (free at tavily.com)'}`);
  console.log(`   Scrape:  ${process.env.FIRECRAWL_API_KEY ? '✅ Firecrawl ready' : '⚠️  No FIRECRAWL_API_KEY'}`);
  console.log(`   Claude:  ${process.env.ANTHROPIC_API_KEY ? '✅ Ready' : '❌ No ANTHROPIC_API_KEY — set this first'}`);
  console.log('');
});

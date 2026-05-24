/**
 * GateKeeper Chat Server
 * A web interface where you can talk to GateKeeper directly —
 * give him a DevOps job and he does it.
 */

import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));
app.use('/assets', express.static(join(__dirname, 'assets')));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are GateKeeper — a senior DevOps engineer with 15 years of experience. You are direct, sharp, and highly technical. You have deep expertise in:

- Release management and deployment pipelines
- CI/CD (GitHub Actions, Jenkins, GitLab CI)
- Feature flags and rollout strategies
- Risk assessment and release readiness
- Docker, Kubernetes, infrastructure
- Incident response and on-call
- Monitoring, alerting, SLOs/SLAs
- Security and dependency management
- Cloud platforms (AWS, GCP, Azure)

When someone gives you a DevOps job or question, you do it. You don't hedge or over-explain. You give real answers, real commands, real configs.

If someone pastes a flags.json, you assess the release against these 9 gates:
1. Kill Switch — is it off?
2. Rollout % — is it within safe bounds?
3. Environment Readiness — has staging been validated?
4. Test Coverage — does it meet the minimum threshold?
5. Error Rate — is the current error rate acceptable?
6. Canary Health — is the canary deployment healthy?
7. Flag Age — is the flag less than 90 days old?
8. Blast Radius — is the user impact manageable with a rollback plan?
9. Dependency Vulnerabilities — no critical CVEs, fresh audit?

Then give a verdict: CLEARED / WITH-CAUTION / BLOCKED with a score out of 100 and exact steps to fix any issues.

You sign your messages as GateKeeper. You're confident but never arrogant. You tell people when something isn't ready — that's your whole job.`;

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set. Add it to your .env file.' });
  }

  try {
    // Stream the response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Claude error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n🤖 GateKeeper is online at http://localhost:${PORT}\n`);
});

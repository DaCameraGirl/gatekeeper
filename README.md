<div align="center">

<img src="assets/gatekeeper.svg" width="160" alt="GateKeeper"/>

# 🤖 GateKeeper

### Autonomous AI DevOps Release Gate Agent

*Every release passes through me.*
 
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-trigger-2088FF?logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![Claude](https://img.shields.io/badge/Claude_AI-risk_brain-orange?logo=anthropic)](https://anthropic.com)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-structured_tasks-blue)](https://deepseek.com)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?logo=nodedotjs)](https://nodejs.org)

</div>

---

## What is GateKeeper?

GateKeeper is a **fully autonomous AI DevOps agent** — not a linter, not a checklist, not a chatbot. He's the senior DevOps engineer who reviews every release before it ships. He fires automatically on every PR, runs a battery of policy gates, calls Claude for a qualitative risk assessment, and posts an official Release Readiness Certificate directly on the PR.

He blocks bad releases. He clears good ones. He explains exactly why, and tells you exactly how to fix it.

---

## How It Works

```
PR Opened/Updated
       │
       ▼
 ┌─────────────────────────────────────────────────────────┐
 │                    🤖 GateKeeper                        │
 │                                                         │
 │  1. Read flags.json from the repo                       │
 │  2. Validate schema              → DeepSeek             │
 │  3. Run 9 policy gates           → Deterministic logic  │
 │  4. Pre-process gate context     → DeepSeek             │
 │  5. Full risk assessment         → Claude Sonnet        │
 │  6. Generate Release Certificate → certificate.js       │
 │  7. Post PR comment + commit status → GitHub API        │
 └─────────────────────────────────────────────────────────┘
       │
       ▼
 PR Comment: Release Readiness Certificate
 Commit Status: ✅ CLEARED | ⚠️ WITH-CAUTION | ❌ BLOCKED
```

---

## The 9 Policy Gates

| # | Gate | Weight | Severity | What It Checks |
|---|------|--------|----------|----------------|
| 1 | 🔓 Kill Switch | BLOCKER | CRITICAL | Emergency override — blocks all releases if active |
| 2 | 📊 Rollout Percentage | 10 pts | HIGH | Safe rollout bounds, canary cross-check |
| 3 | 🌍 Environment Readiness | 22 pts | HIGH | Staging must be validated before production |
| 4 | 🧪 Test Coverage | 20 pts | HIGH | Meets minimum coverage threshold |
| 5 | 📉 Error Rate | 18 pts | HIGH | Production error rate within SLO bounds |
| 6 | 🐤 Canary Health | 10 pts | MEDIUM | Canary deployment health and score |
| 7 | ⏳ Flag Staleness | 8 pts | MEDIUM | Feature flags must not exceed 90 days old |
| 8 | 💥 Blast Radius | 6 pts | MEDIUM | User impact + rollback plan validation |
| 9 | 🔒 Dependency Vulnerabilities | 6 pts | MEDIUM | No critical CVEs, fresh audit |

**Score = weighted sum of gates 2–9 (0–100)**

| Score | Status | Exit Code |
|-------|--------|-----------|
| Kill switch active | 🔴 **BLOCKED** | `1` |
| < 50 | 🔴 **BLOCKED** | `1` |
| 50–79 or any FAILED | 🟡 **WITH-CAUTION** | `0` (or `1` in strict mode) |
| ≥ 80, no failures | 🟢 **CLEARED** | `0` |

---

## The Release Certificate

Every PR gets a certificate that looks like this:

```
╔══════════════════════════════════════════════════════════════════════╗
║  🤖  G A T E K E E P E R   R E L E A S E   C E R T I F I C A T E  ║
╠══════════════════════════════════════════════════════════════════════╣
║  Feature:  payment-v2              Version: 2.1.0                   ║
║  Owner:    payments-team           PR:      #42                     ║
║  Branch:   feat/payment-v2                                          ║
║  Assessed: 2024-03-15T12:00:00.000Z                                 ║
╠══════════════════════════════════════════════════════════════════════╣
║  Score: ████████████████░░░░  82/100                                ║
║  Status: CLEARED         AI Risk: LOW                               ║
╚══════════════════════════════════════════════════════════════════════╝
```

The certificate includes:
- **Status banner** with score and AI risk level
- **Blockers table** — what's failing and why
- **Warnings** — non-blocking issues to address
- **Claude's full risk assessment** — qualitative analysis beyond the gates
- **Exact remediation steps** — prioritised, specific, actionable
- **Full gate summary** — every gate with score and detail
- **Signed with timestamp** — audit trail on every comment

---

## Setup

### 1. Add the workflow to your repo

The workflow file is already at `.github/workflows/gatekeeper.yml`. Copy GateKeeper into your repo or use it as a Git submodule.

### 2. Add secrets to GitHub

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (Claude) |
| `DEEPSEEK_API_KEY` | Your DeepSeek API key |

`GITHUB_TOKEN` is provided automatically by GitHub Actions.

### 3. Add flags.json to your repo

Copy `flags.json` from this repo and fill in the values for your release.
GateKeeper reads it from the PR branch on every run.

```json
{
  "release": {
    "feature": "your-feature-name",
    "version": "1.0.0",
    "owner": "your-team"
  },
  "flags": {
    "killSwitch": false,
    "rolloutPercentage": 10,
    "environments": {
      "staging": { "enabled": true, "validatedAt": "2024-03-14T10:00:00Z" }
    }
  },
  "quality": {
    "testCoverage": 85.0,
    "minimumCoverageThreshold": 80.0,
    "errorRatePercent": 0.2,
    "maximumErrorRatePercent": 1.0
  },
  "risk": {
    "blastRadius": "medium",
    "hasRollbackPlan": true,
    "rollbackTimeMinutes": 5
  },
  "dependencies": {
    "lastAuditDate": "2024-03-13T00:00:00Z",
    "criticalVulnerabilities": 0,
    "highVulnerabilities": 0
  }
}
```

### 4. (Optional) Require GateKeeper as a status check

In **Settings → Branches → Branch protection rules**, add:

```
🤖 GateKeeper / Release Gate
```

as a required status check to block merges on `BLOCKED` releases.

---

## Local Development

```bash
# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your API keys

# Run GateKeeper locally (dry run — no GitHub API calls)
GATEKEEPER_DRY_RUN=true PR_NUMBER=1 PR_BRANCH=feat/test \
  PR_TITLE="Test PR" PR_AUTHOR=you PR_HEAD_SHA=abc123 \
  GITHUB_REPOSITORY=you/repo node src/index.js
```

---

## flags.json Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `release.feature` | string | ✅ | Feature name (slug) |
| `release.version` | string | ✅ | Semver version |
| `release.owner` | string | ✅ | Team or individual owner |
| `release.createdAt` | ISO date | recommended | When the flag was first created |
| `release.lastModified` | ISO date | recommended | Last modification timestamp |
| `release.targetDate` | ISO date | optional | Planned release date |
| `flags.killSwitch` | boolean | ✅ | Emergency blocker switch |
| `flags.rolloutPercentage` | number | ✅ | Current rollout % (0-100) |
| `flags.maxRolloutPercentage` | number | optional | Maximum allowed rollout % |
| `flags.environments.*` | object | recommended | Per-environment validation records |
| `quality.testCoverage` | number | recommended | Test coverage % |
| `quality.minimumCoverageThreshold` | number | recommended | Minimum acceptable coverage % |
| `quality.errorRatePercent` | number | recommended | Current error rate % |
| `quality.maximumErrorRatePercent` | number | recommended | Maximum acceptable error rate % |
| `quality.canary.*` | object | optional | Canary deployment details |
| `risk.blastRadius` | string | recommended | `low` / `medium` / `high` / `critical` |
| `risk.estimatedUsersAffected` | number | optional | Estimated affected user count |
| `risk.totalUserBase` | number | optional | Total user base for % calculation |
| `risk.hasRollbackPlan` | boolean | recommended | Whether a rollback plan exists |
| `risk.rollbackTimeMinutes` | number | optional | Estimated rollback time |
| `dependencies.lastAuditDate` | ISO date | recommended | When `npm audit` was last run |
| `dependencies.criticalVulnerabilities` | number | recommended | Count of CRITICAL CVEs |
| `dependencies.highVulnerabilities` | number | recommended | Count of HIGH CVEs |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Anthropic API key (required) |
| `DEEPSEEK_API_KEY` | — | DeepSeek API key (required) |
| `GITHUB_TOKEN` | auto | GitHub token (auto in Actions) |
| `GITHUB_REPOSITORY` | auto | `owner/repo` format |
| `PR_NUMBER` | — | PR number (auto in Actions) |
| `PR_HEAD_SHA` | — | PR head commit SHA |
| `PR_BRANCH` | — | PR branch name |
| `PR_TITLE` | — | PR title |
| `PR_AUTHOR` | — | PR author username |
| `FLAGS_JSON_PATH` | `./flags.json` | Path to flags.json |
| `GATEKEEPER_STRICT` | `false` | `true` = WITH-CAUTION also exits 1 |
| `GATEKEEPER_DRY_RUN` | `false` | `true` = skip GitHub API, print to console |

---

## Architecture

```
src/
├── index.js          — Main orchestrator (7-step pipeline)
├── utils.js          — Shared utilities (scoring, formatting)
├── certificate.js    — Release certificate markdown generator
├── github.js         — GitHub API (PR comments, commit status)
├── brain/
│   ├── claude.js     — Claude Sonnet risk assessment
│   └── deepseek.js   — DeepSeek schema validation + context pre-processing
└── gates/
    ├── index.js      — Gate runner (runs all 9, calculates score)
    ├── gate1-kill-switch.js    — Emergency kill switch
    ├── gate2-rollout.js        — Rollout percentage bounds
    ├── gate3-environment.js    — Environment readiness chain
    ├── gate4-test-coverage.js  — Test coverage threshold
    ├── gate5-error-rate.js     — Production error rate
    ├── gate6-canary.js         — Canary deployment health
    ├── gate7-flag-age.js       — Feature flag staleness
    ├── gate8-blast-radius.js   — Blast radius + rollback
    └── gate9-dependencies.js   — Dependency vulnerabilities
```

---

<div align="center">

🤖 **GateKeeper** · Autonomous Release Intelligence

*Built with Claude AI · Powered by DeepSeek · Deployed via GitHub Actions*

</div>

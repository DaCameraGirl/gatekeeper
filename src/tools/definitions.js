/**
 * GateKeeper Tool Definitions
 * Every tool GateKeeper can use to take REAL action — not just talk about it.
 * These are passed to Claude's tool_use API.
 */

export const TOOLS = [

  // ── GitHub ──────────────────────────────────────────────────────────────────

  {
    name: 'github_create_issue',
    description: 'Create a GitHub issue in any repo. Use this when the user wants to log a bug, task, or DevOps action item.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Full repo name e.g. DaCameraGirl/gatekeeper' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body in markdown' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels to apply e.g. ["bug","devops"]' },
      },
      required: ['repo', 'title', 'body'],
    },
  },

  {
    name: 'github_list_issues',
    description: 'List open issues in a GitHub repo. Use when the user wants to see what work is open.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Full repo name e.g. DaCameraGirl/gatekeeper' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Filter by state' },
        label: { type: 'string', description: 'Filter by label' },
      },
      required: ['repo'],
    },
  },

  {
    name: 'github_get_pr_status',
    description: 'Check the status of a pull request — CI checks, review status, merge readiness.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Full repo name' },
        pr_number: { type: 'number', description: 'PR number' },
      },
      required: ['repo', 'pr_number'],
    },
  },

  {
    name: 'github_list_prs',
    description: 'List open pull requests in a repo.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Full repo name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'] },
      },
      required: ['repo'],
    },
  },

  {
    name: 'github_comment_on_pr',
    description: 'Post a comment on a GitHub pull request.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        pr_number: { type: 'number' },
        comment: { type: 'string', description: 'The comment body in markdown' },
      },
      required: ['repo', 'pr_number', 'comment'],
    },
  },

  {
    name: 'github_list_workflows',
    description: 'List GitHub Actions workflows and their recent run status for a repo.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Full repo name' },
      },
      required: ['repo'],
    },
  },

  // ── Jira ────────────────────────────────────────────────────────────────────

  {
    name: 'jira_create_ticket',
    description: 'Create a Jira ticket. Use for bugs, tasks, stories, or DevOps action items.',
    input_schema: {
      type: 'object',
      properties: {
        project_key: { type: 'string', description: 'Jira project key e.g. DEV, OPS, PAY' },
        summary: { type: 'string', description: 'Ticket summary/title' },
        description: { type: 'string', description: 'Full ticket description' },
        issue_type: { type: 'string', enum: ['Task', 'Bug', 'Story', 'Epic', 'Subtask'], description: 'Issue type' },
        priority: { type: 'string', enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'] },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['project_key', 'summary', 'description', 'issue_type'],
    },
  },

  {
    name: 'jira_search_issues',
    description: 'Search Jira issues using JQL. Use to find tickets by status, assignee, project, or keyword.',
    input_schema: {
      type: 'object',
      properties: {
        jql: { type: 'string', description: 'JQL query e.g. project=OPS AND status=Open AND priority=High' },
        max_results: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['jql'],
    },
  },

  {
    name: 'jira_update_ticket',
    description: 'Update a Jira ticket status, priority, assignee, or add a comment.',
    input_schema: {
      type: 'object',
      properties: {
        ticket_key: { type: 'string', description: 'Jira ticket key e.g. OPS-123' },
        transition: { type: 'string', description: 'Status transition e.g. "In Progress", "Done", "Blocked"' },
        comment: { type: 'string', description: 'Comment to add to the ticket' },
        priority: { type: 'string', enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'] },
      },
      required: ['ticket_key'],
    },
  },

  // ── Slack ───────────────────────────────────────────────────────────────────

  {
    name: 'slack_send_message',
    description: 'Send a message to a Slack channel or user. Use for notifications, alerts, or updates.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (#devops) or user ID' },
        message: { type: 'string', description: 'Message text (supports Slack mrkdwn)' },
        username: { type: 'string', description: 'Override bot display name (default: GateKeeper)' },
      },
      required: ['channel', 'message'],
    },
  },

  {
    name: 'slack_list_channels',
    description: 'List available Slack channels.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max channels to return' },
      },
      required: [],
    },
  },

  // ── Release Gate ─────────────────────────────────────────────────────────────

  {
    name: 'run_release_gate',
    description: 'Run a full GateKeeper release assessment on a flags.json. Returns score, status, and all 9 gate results. Use when the user provides flags.json content or asks for a release assessment.',
    input_schema: {
      type: 'object',
      properties: {
        flags_json: { type: 'string', description: 'The raw JSON string contents of flags.json' },
      },
      required: ['flags_json'],
    },
  },

  // ── Web Search ───────────────────────────────────────────────────────────────

  {
    name: 'web_search',
    description: 'Search the web for current information — docs, CVEs, outages, pricing, release notes, anything. Use this whenever the user asks about something that requires up-to-date or real-world information.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        max_results: { type: 'number', description: 'Number of results to return (default 5)' },
      },
      required: ['query'],
    },
  },

  // ── DevOps Utilities ─────────────────────────────────────────────────────────

  {
    name: 'generate_github_actions_workflow',
    description: 'Generate a complete GitHub Actions workflow YAML for CI/CD, testing, deployment, or automation. Returns the full YAML ready to use.',
    input_schema: {
      type: 'object',
      properties: {
        purpose: { type: 'string', description: 'What the workflow should do e.g. "deploy to AWS on push to main"' },
        language: { type: 'string', description: 'Language/runtime e.g. Node.js, Python, Go, Java' },
        extras: { type: 'string', description: 'Additional requirements e.g. "run tests, lint, build Docker image, push to ECR"' },
      },
      required: ['purpose'],
    },
  },

  {
    name: 'generate_dockerfile',
    description: 'Generate a production-ready Dockerfile for a given stack.',
    input_schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Language/runtime e.g. Node.js, Python, Go' },
        app_type: { type: 'string', description: 'Type of app e.g. Express API, FastAPI, React SPA' },
        extras: { type: 'string', description: 'Any special requirements' },
      },
      required: ['language', 'app_type'],
    },
  },

  {
    name: 'generate_kubernetes_manifest',
    description: 'Generate Kubernetes YAML manifests (Deployment, Service, Ingress, HPA, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        app_name: { type: 'string' },
        image: { type: 'string', description: 'Docker image e.g. myapp:latest' },
        replicas: { type: 'number' },
        port: { type: 'number' },
        manifest_types: { type: 'array', items: { type: 'string' }, description: '["Deployment","Service","Ingress","HPA"]' },
      },
      required: ['app_name', 'image'],
    },
  },

];

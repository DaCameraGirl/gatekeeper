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

  // ── Memory ───────────────────────────────────────────────────────────────────

  {
    name: 'remember',
    description: 'Save something important to long-term memory. Use when the user shares their name, preferences, a project they work on, or says "remember this". This persists across ALL future conversations.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['fact', 'project', 'user_info', 'preference'], description: 'What kind of thing to remember' },
        content: { type: 'string', description: 'The thing to remember — be specific and complete' },
        topic: { type: 'string', description: 'Short topic label e.g. "deployment", "preferences", "project"' },
        user_info: {
          type: 'object',
          description: 'If type=user_info, structured user details',
          properties: {
            name: { type: 'string' },
            role: { type: 'string' },
          },
        },
        project: {
          type: 'object',
          description: 'If type=project, project details',
          properties: {
            name: { type: 'string' },
            repo: { type: 'string' },
            stack: { type: 'string' },
            notes: { type: 'string' },
          },
        },
      },
      required: ['type', 'content'],
    },
  },

  {
    name: 'recall_memory',
    description: 'Recall everything GateKeeper remembers about the user and their projects. Use when the user asks what you remember, or when context from past conversations would help.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional topic to filter memories by' },
      },
      required: [],
    },
  },

  {
    name: 'forget',
    description: 'Delete something from memory that the user wants forgotten.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic or keyword of what to forget' },
      },
      required: ['topic'],
    },
  },

  {
    name: 'clear_chat_history',
    description: 'Clear the conversation history so GateKeeper starts fresh. Use when the user says "start over", "new conversation", or "forget our chat".',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
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

  // ── Firecrawl Search ───────────────────────────────────────────────────────────

  {
    name: 'firecrawl_search',
    description: 'Deep web search using Firecrawl — scrape, crawl, and extract full page content as clean markdown. Better than Tavily for getting detailed page content, documentation scraping, or extracting structured data from websites. Falls back gracefully if FIRECRAWL_API_KEY is not set.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        max_results: { type: 'number', description: 'Number of results to return (default 5, max 10)' },
        scrape: { type: 'boolean', description: 'If true, scrape full page content for each result. Default false (titles + descriptions only).' },
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

  // ── File Access ───────────────────────────────────────────────────────────────

  {
    name: 'read_file',
    description: 'Read the contents of a file. Use this to inspect code, configs, logs, or any text file. Supports line ranges for large files.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path — relative to project root or absolute. e.g. "server.js", "src/tools/executor.js", "C:/Users/enter/project/app.py"' },
        start_line: { type: 'number', description: 'First line to read (1-based). Omit to read from the beginning.' },
        end_line: { type: 'number', description: 'Last line to read (inclusive). Omit to read to the end.' },
      },
      required: ['path'],
    },
  },

  {
    name: 'write_file',
    description: 'Write content to a file — create it or overwrite it. Use this to edit code, update configs, create new files. Use mode=append to add to the end without overwriting.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path — relative to project root or absolute.' },
        content: { type: 'string', description: 'The full content to write to the file.' },
        mode: { type: 'string', enum: ['overwrite', 'append'], description: '"overwrite" replaces the file (default). "append" adds content to the end.' },
      },
      required: ['path', 'content'],
    },
  },

  {
    name: 'list_directory',
    description: 'List files and subdirectories at a given path. Use this to explore project structure before reading files. node_modules and .git are always excluded.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path — relative to project root or absolute. Defaults to "." (project root).' },
        recursive: { type: 'boolean', description: 'If true, recurse into subdirectories (max depth 3). Default false.' },
        show_hidden: { type: 'boolean', description: 'If true, include files and dirs starting with ".". Default false.' },
      },
      required: [],
    },
  },

  {
    name: 'search_files',
    description: 'Search for a text pattern across files in a directory. Like grep — finds matching lines with file path and line number. Use this to find function definitions, config values, or any text in a codebase.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Text or regex pattern to search for e.g. "async function", "ANTHROPIC_API_KEY", "import.*express"' },
        path: { type: 'string', description: 'Directory or file to search in. Defaults to "." (project root).' },
        file_pattern: { type: 'string', description: 'Filter which files to search e.g. "*.js", "*.yml", "*.json"' },
        max_results: { type: 'number', description: 'Max matching lines to return (default 20)' },
      },
      required: ['pattern'],
    },
  },

  // ── GitHub Commit Message Generator ───────────────────────────────────────────

  {
    name: 'github_generate_commit_message',
    description: 'Fetch a git diff (from GitHub compare or raw diff text) and generate a conventional commit message. Use this when the user wants a commit message for their changes — pass either a repo + branch pair to fetch from GitHub, or paste raw diff text directly.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Full repo name e.g. DaCameraGirl/gatekeeper — required if not providing raw_diff' },
        base: { type: 'string', description: 'Base branch/ref to compare against e.g. main, dev, or a commit SHA. Default: main' },
        head: { type: 'string', description: 'Head branch/ref with the changes e.g. fix-login-bug, my-feature-branch. Required if repo is set.' },
        raw_diff: { type: 'string', description: 'Raw git diff text — use this instead of repo/base/head if you already have the diff content.' },
        style: { type: 'string', enum: ['conventional', 'simple', 'detailed'], description: 'Commit message style. conventional: "feat(scope): msg". simple: "Add feature". detailed: multi-line with body + footer. Default: conventional.' },
      },
      required: [],
    },
  },

  // ── Terminal ──────────────────────────────────────────────────────────────────

  {
    name: 'run_terminal_command',
    description: 'Execute a shell command and return the output. Use this to run npm scripts, git commands, install packages, run tests, check system state, or any shell operation. Commands run in the project directory by default.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to run e.g. "npm test", "git log --oneline -5", "node -e \\"console.log(1+1)\\"", "ls -la"' },
        working_dir: { type: 'string', description: 'Directory to run the command in. Defaults to "." (project root).' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000, max 60000).' },
      },
      required: ['command'],
    },
  },

];

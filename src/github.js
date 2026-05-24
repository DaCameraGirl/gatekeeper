/**
 * GateKeeper GitHub Integration
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all GitHub API operations:
 *   1. Post (or update) the Release Certificate as a PR comment
 *   2. Set a commit status to block or allow the PR check
 *   3. Find and replace a previous GateKeeper comment (idempotent re-runs)
 */

const GITHUB_API = 'https://api.github.com';
const GATEKEEPER_MARKER = '<!-- gatekeeper-certificate -->';

/**
 * Build authenticated GitHub API request headers.
 */
function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GateKeeper: GITHUB_TOKEN environment variable is not set.');
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'GateKeeper/1.0',
  };
}

/**
 * Parse "owner/repo" from GITHUB_REPOSITORY env var.
 */
function parseRepo() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !repo.includes('/')) {
    throw new Error(`GateKeeper: GITHUB_REPOSITORY "${repo}" is not in "owner/repo" format.`);
  }
  const [owner, repoName] = repo.split('/');
  return { owner, repo: repoName };
}

// ─── PR Comment ───────────────────────────────────────────────────────────────

/**
 * Find an existing GateKeeper PR comment (for idempotent updates).
 */
async function findExistingComment(owner, repo, prNumber) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`;
  const res = await fetch(url, { headers: headers() });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error fetching comments: ${res.status} ${body}`);
  }

  const comments = await res.json();
  return comments.find(c => c.body?.includes(GATEKEEPER_MARKER)) ?? null;
}

/**
 * Post or update the GateKeeper certificate as a PR comment.
 * Uses the hidden HTML marker to detect and replace previous runs.
 *
 * @param {number} prNumber
 * @param {string} certificateMarkdown
 * @returns {Promise<{ commentId: number, commentUrl: string }>}
 */
export async function postPRComment(prNumber, certificateMarkdown) {
  const { owner, repo } = parseRepo();
  const body = `${GATEKEEPER_MARKER}\n\n${certificateMarkdown}`;

  // Check for an existing GateKeeper comment to update
  let existingComment = null;
  try {
    existingComment = await findExistingComment(owner, repo, prNumber);
  } catch (err) {
    console.warn(`  ⚠️  Could not search for existing comments: ${err.message}`);
  }

  if (existingComment) {
    console.log(`  📝 Updating existing GateKeeper comment #${existingComment.id}...`);
    const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${existingComment.id}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ body }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`GitHub API error updating comment: ${res.status} ${errBody}`);
    }

    const data = await res.json();
    return { commentId: data.id, commentUrl: data.html_url };
  }

  // Create new comment
  console.log(`  💬 Posting new GateKeeper certificate to PR #${prNumber}...`);
  const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ body }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub API error posting comment: ${res.status} ${errBody}`);
  }

  const data = await res.json();
  return { commentId: data.id, commentUrl: data.html_url };
}

// ─── Commit Status ────────────────────────────────────────────────────────────

/**
 * Set a GitHub commit status to reflect GateKeeper's verdict.
 * This powers the "Required Checks" gate on protected branches.
 *
 * @param {string} sha    - The HEAD commit SHA of the PR
 * @param {string} status - GateKeeper status: BLOCKED | WITH-CAUTION | CLEARED
 * @param {number} score  - 0-100 score
 * @param {string} commentUrl - URL to the certificate comment
 */
export async function setCommitStatus(sha, status, score, commentUrl) {
  const { owner, repo } = parseRepo();

  const stateMap = {
    BLOCKED:        'failure',
    'WITH-CAUTION': 'success',   // warns but doesn't block the PR check
    CLEARED:        'success',
  };

  const descMap = {
    BLOCKED:        `GateKeeper: BLOCKED — Score ${score}/100. Critical gates failed.`,
    'WITH-CAUTION': `GateKeeper: WITH-CAUTION — Score ${score}/100. Warnings present.`,
    CLEARED:        `GateKeeper: CLEARED — Score ${score}/100. All gates passed.`,
  };

  // In strict mode, WITH-CAUTION also fails the check
  const strict = process.env.GATEKEEPER_STRICT === 'true';
  const ghState = strict && status === 'WITH-CAUTION' ? 'failure' : (stateMap[status] ?? 'failure');

  console.log(`  🚦 Setting commit status: ${ghState} (${status})`);

  const url = `${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      state: ghState,
      description: (descMap[status] ?? `GateKeeper: ${status}`).slice(0, 140),
      context: '🤖 GateKeeper / Release Gate',
      target_url: commentUrl,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    // Non-fatal — commit status is nice-to-have, not required
    console.warn(`  ⚠️  Could not set commit status: ${res.status} ${errBody}`);
    return;
  }

  console.log(`  ✅ Commit status set to "${ghState}"`);
}

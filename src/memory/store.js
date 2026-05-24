/**
 * GateKeeper Memory Store
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistent memory that survives across conversations.
 * GateKeeper remembers:
 *   - Your name and preferences
 *   - Your projects and repos
 *   - Past decisions and context
 *   - Things you've explicitly told him to remember
 *   - Recurring issues and patterns he's noticed
 *
 * Stored as JSON on disk — simple, portable, no database needed.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR  = join(__dirname, '../../.gatekeeper');
const MEMORY_FILE = join(MEMORY_DIR, 'memory.json');
const CHAT_FILE   = join(MEMORY_DIR, 'history.json');

// Ensure memory directory exists
if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });

// ─── Memory Schema ────────────────────────────────────────────────────────────

const DEFAULT_MEMORY = {
  user: {
    name: null,
    role: null,
    preferences: [],
  },
  projects: [],       // { name, repo, stack, notes }
  facts: [],          // { content, savedAt, topic }
  patterns: [],       // recurring issues GateKeeper has noticed
  lastSeen: null,
};

// ─── Load / Save ──────────────────────────────────────────────────────────────

export function loadMemory() {
  try {
    if (!existsSync(MEMORY_FILE)) return { ...DEFAULT_MEMORY };
    return JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
  } catch {
    return { ...DEFAULT_MEMORY };
  }
}

export function saveMemory(memory) {
  memory.lastSeen = new Date().toISOString();
  writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf-8');
}

// ─── Chat History ─────────────────────────────────────────────────────────────

const MAX_HISTORY_MESSAGES = 40; // Keep last 40 messages (20 turns)

export function loadChatHistory() {
  try {
    if (!existsSync(CHAT_FILE)) return [];
    return JSON.parse(readFileSync(CHAT_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveChatHistory(messages) {
  // Keep only the last N messages to avoid bloat
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  writeFileSync(CHAT_FILE, JSON.stringify(trimmed, null, 2), 'utf-8');
}

export function clearChatHistory() {
  writeFileSync(CHAT_FILE, '[]', 'utf-8');
}

// ─── Memory Operations ────────────────────────────────────────────────────────

export function rememberFact(memory, content, topic = 'general') {
  memory.facts.push({ content, topic, savedAt: new Date().toISOString() });
  // Keep max 100 facts
  if (memory.facts.length > 100) memory.facts = memory.facts.slice(-100);
  saveMemory(memory);
}

export function rememberProject(memory, project) {
  const existing = memory.projects.findIndex(p =>
    p.name?.toLowerCase() === project.name?.toLowerCase() ||
    p.repo === project.repo
  );
  if (existing >= 0) {
    memory.projects[existing] = { ...memory.projects[existing], ...project, updatedAt: new Date().toISOString() };
  } else {
    memory.projects.push({ ...project, addedAt: new Date().toISOString() });
  }
  saveMemory(memory);
}

export function setUserInfo(memory, info) {
  memory.user = { ...memory.user, ...info };
  saveMemory(memory);
}

export function forgetFact(memory, topic) {
  memory.facts = memory.facts.filter(f => !f.content.toLowerCase().includes(topic.toLowerCase()));
  saveMemory(memory);
}

// ─── Memory Summary for System Prompt ────────────────────────────────────────

export function buildMemoryContext(memory) {
  const parts = [];

  if (memory.user?.name) {
    parts.push(`User's name: ${memory.user.name}`);
  }
  if (memory.user?.role) {
    parts.push(`Their role: ${memory.user.role}`);
  }
  if (memory.user?.preferences?.length > 0) {
    parts.push(`Their preferences: ${memory.user.preferences.join(', ')}`);
  }
  if (memory.projects?.length > 0) {
    const projectList = memory.projects.map(p =>
      `${p.name}${p.repo ? ` (${p.repo})` : ''}${p.stack ? ` — ${p.stack}` : ''}${p.notes ? `: ${p.notes}` : ''}`
    ).join('\n  - ');
    parts.push(`Their projects:\n  - ${projectList}`);
  }
  if (memory.facts?.length > 0) {
    const recent = memory.facts.slice(-20);
    const factList = recent.map(f => `[${f.topic}] ${f.content}`).join('\n  - ');
    parts.push(`Things to remember:\n  - ${factList}`);
  }
  if (memory.lastSeen) {
    parts.push(`Last conversation: ${new Date(memory.lastSeen).toLocaleDateString()}`);
  }

  if (parts.length === 0) return '';

  return `\n\n--- MEMORY (what you know about this user) ---\n${parts.join('\n')}\n--- END MEMORY ---`;
}

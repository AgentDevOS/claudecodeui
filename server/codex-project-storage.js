import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';

const AI_SOFT_DIR = '.aisoft';
const SESSIONS_DIR = 'sessions';
const CODEX_DIR = 'codex';

function sanitizeSessionId(sessionId) {
  return String(sessionId || '').replace(/[/\\]|\.\./g, '').trim();
}

export function getCodexProjectSessionsDir(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error('A valid project path is required for Codex session storage');
  }

  return path.join(projectPath, AI_SOFT_DIR, SESSIONS_DIR, CODEX_DIR);
}

export function getCodexProjectSessionFilePath(projectPath, sessionId) {
  const safeSessionId = sanitizeSessionId(sessionId);
  if (!safeSessionId) {
    throw new Error('A valid session ID is required for Codex session storage');
  }

  return path.join(getCodexProjectSessionsDir(projectPath), `${safeSessionId}.jsonl`);
}

async function ensureCodexProjectSessionsDir(projectPath) {
  await fs.mkdir(getCodexProjectSessionsDir(projectPath), { recursive: true });
}

function shouldPersistMessage(message) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  switch (message.kind) {
    case 'text':
    case 'thinking':
    case 'tool_use':
    case 'tool_result':
    case 'error':
      return true;
    case 'status':
      return message.text === 'token_budget' && message.tokenBudget != null;
    default:
      return false;
  }
}

function isVisibleHistoryMessage(message) {
  return ['text', 'thinking', 'tool_use', 'tool_result'].includes(message?.kind);
}

function isSearchableMessage(message) {
  return message?.kind === 'text' && (message.role === 'user' || message.role === 'assistant');
}

async function readSessionMessages(projectPath, sessionId) {
  const filePath = getCodexProjectSessionFilePath(projectPath, sessionId);

  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const messages = [];
  const fileStream = fsSync.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      messages.push(JSON.parse(line));
    } catch {
      // Skip malformed lines written during interrupted sessions.
    }
  }

  return messages;
}

export async function appendCodexMessage(projectPath, message) {
  if (!shouldPersistMessage(message)) {
    return false;
  }

  await ensureCodexProjectSessionsDir(projectPath);
  const filePath = getCodexProjectSessionFilePath(projectPath, message.sessionId);
  await fs.appendFile(filePath, `${JSON.stringify(message)}\n`, 'utf8');
  return true;
}

export async function listCodexSessions(projectPath, { limit = 5 } = {}) {
  const sessionsDir = getCodexProjectSessionsDir(projectPath);

  try {
    await fs.access(sessionsDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  const sessionFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort();

  const sessions = [];

  for (const fileName of sessionFiles) {
    const sessionId = fileName.replace(/\.jsonl$/, '');
    const messages = await readSessionMessages(projectPath, sessionId);
    if (messages.length === 0) {
      continue;
    }

    let firstUserMessage = null;
    let lastActivity = null;
    let messageCount = 0;

    for (const message of messages) {
      if (isVisibleHistoryMessage(message)) {
        messageCount += 1;
      }

      if (!firstUserMessage && message.kind === 'text' && message.role === 'user' && typeof message.content === 'string') {
        firstUserMessage = message.content.trim();
      }

      if (message.timestamp) {
        lastActivity = message.timestamp;
      }
    }

    sessions.push({
      id: sessionId,
      summary: firstUserMessage
        ? (firstUserMessage.length > 50 ? `${firstUserMessage.substring(0, 50)}...` : firstUserMessage)
        : 'Codex Session',
      messageCount,
      lastActivity,
      provider: 'codex',
    });
  }

  sessions.sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  return limit > 0 ? sessions.slice(0, limit) : sessions;
}

export async function getCodexSessionHistory(projectPath, sessionId, limit = null, offset = 0) {
  const messages = await readSessionMessages(projectPath, sessionId);
  const sortedMessages = messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  let tokenUsage = null;
  for (let i = sortedMessages.length - 1; i >= 0; i -= 1) {
    const message = sortedMessages[i];
    if (message.kind === 'status' && message.text === 'token_budget' && message.tokenBudget) {
      tokenUsage = message.tokenBudget;
      break;
    }
  }

  const visibleMessages = sortedMessages.filter((message) => message.kind !== 'status');
  const total = visibleMessages.length;

  if (limit !== null) {
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    return {
      messages: visibleMessages.slice(startIndex, endIndex),
      total,
      hasMore: startIndex > 0,
      offset,
      limit,
      tokenUsage,
    };
  }

  return {
    messages: visibleMessages,
    total,
    hasMore: false,
    offset,
    limit,
    tokenUsage,
  };
}

export async function deleteCodexSessionFile(projectPath, sessionId) {
  const filePath = getCodexProjectSessionFilePath(projectPath, sessionId);
  await fs.unlink(filePath);
  return true;
}

export async function searchCodexProjectSessions(
  projectPath,
  {
    allWordsMatch,
    buildSnippet,
    limit,
    getTotalMatches,
    addMatches,
    isAborted,
  },
) {
  const sessions = await listCodexSessions(projectPath, { limit: 0 });
  const results = [];

  for (const session of sessions) {
    if (getTotalMatches() >= limit || isAborted()) {
      break;
    }

    const messages = await readSessionMessages(projectPath, session.id);
    const matches = [];

    for (const message of messages) {
      if (getTotalMatches() >= limit || isAborted()) {
        break;
      }

      if (!isSearchableMessage(message) || typeof message.content !== 'string' || !message.content.trim()) {
        continue;
      }

      const textLower = message.content.toLowerCase();
      if (!allWordsMatch(textLower)) {
        continue;
      }

      if (matches.length < 2) {
        const { snippet, highlights } = buildSnippet(message.content, textLower);
        matches.push({
          role: message.role,
          snippet,
          highlights,
          timestamp: message.timestamp || null,
          provider: 'codex',
        });
        addMatches(1);
      }
    }

    if (matches.length > 0) {
      results.push({
        sessionId: session.id,
        provider: 'codex',
        sessionSummary: session.summary || 'Codex Session',
        matches,
      });
    }
  }

  return results;
}

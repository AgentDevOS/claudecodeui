/**
 * OpenAI Codex SDK Integration
 * =============================
 *
 * This module provides integration with the OpenAI Codex SDK for non-interactive
 * chat sessions. It mirrors the pattern used in claude-sdk.js for consistency.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { Codex } from '@openai/codex-sdk';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { codexAdapter } from './providers/codex/adapter.js';
import { createNormalizedMessage } from './providers/types.js';

// Track active sessions
const activeCodexSessions = new Map();

function createTimingTracker() {
  const startedAt = Date.now();
  const marks = {};

  return {
    mark(name) {
      if (marks[name] == null) {
        marks[name] = Date.now() - startedAt;
      }
    },
    snapshot(extra = {}) {
      return {
        ...marks,
        totalMs: Date.now() - startedAt,
        ...extra,
      };
    },
  };
}

function classifyCodexBottleneck(timing) {
  const firstEventMs = timing.firstEventMs ?? null;
  const firstTextMs = timing.firstTextMs ?? null;
  const totalMs = timing.totalMs ?? null;

  if (firstEventMs != null && firstEventMs >= 3000) {
    return 'startup_or_model_queue';
  }

  if (
    firstEventMs != null &&
    firstTextMs != null &&
    firstTextMs - firstEventMs >= 2000
  ) {
    return 'reasoning_or_tooling_before_text';
  }

  if (
    firstTextMs != null &&
    totalMs != null &&
    totalMs - firstTextMs >= 4000
  ) {
    return 'long_generation_or_tool_tail';
  }

  if (firstTextMs == null && totalMs != null && totalMs >= 3000) {
    return 'no_text_before_completion';
  }

  return 'balanced';
}

function logCodexTiming(sessionId, timing) {
  console.info('[CodexTiming]', {
    sessionId,
    ...timing,
  });
}

function diffStreamingText(previousText = '', nextText = '') {
  if (!nextText) {
    return '';
  }

  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length);
  }

  return nextText;
}

function moveActiveSession(previousSessionId, nextSessionId) {
  if (!previousSessionId || !nextSessionId || previousSessionId === nextSessionId) {
    return;
  }

  const session = activeCodexSessions.get(previousSessionId);
  if (!session) {
    return;
  }

  activeCodexSessions.delete(previousSessionId);
  activeCodexSessions.set(nextSessionId, session);
}

/**
 * Transform Codex SDK event to WebSocket message format
 * @param {object} event - SDK event
 * @returns {object} - Transformed event for WebSocket
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return { type: event.type, item: null };
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: item.text
            }
          };

        case 'reasoning':
          return {
            type: 'item',
            itemType: 'reasoning',
            message: {
              role: 'assistant',
              content: item.text,
              isReasoning: true
            }
          };

        case 'command_execution':
          return {
            type: 'item',
            itemType: 'command_execution',
            command: item.command,
            output: item.aggregated_output,
            exitCode: item.exit_code,
            status: item.status
          };

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex SDK options
 * @param {string} permissionMode - 'default', 'acceptEdits', or 'bypassPermissions'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    sessionSummary,
    cwd,
    projectPath,
    model,
    permissionMode = 'default'
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);

  let codex;
  let thread;
  let currentSessionId = sessionId;
  let terminalFailure = null;
  const abortController = new AbortController();
  const timing = createTimingTracker();
  const streamedAgentTexts = new Map();
  let emittedSessionCreated = false;
  let eventCount = 0;
  let streamedTextEvents = 0;
  let streamedTextChars = 0;

  try {
    // Initialize Codex SDK
    codex = new Codex();
    timing.mark('sdkInitMs');

    // Thread options with sandbox and approval settings
    const threadOptions = {
      workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode,
      approvalPolicy,
      model
    };

    // Start or resume thread
    if (sessionId) {
      thread = codex.resumeThread(sessionId, threadOptions);
    } else {
      thread = codex.startThread(threadOptions);
    }

    // New threads don't have a real ID until the first `thread.started` event arrives.
    currentSessionId = thread.id || sessionId || `new-session-codex-${Date.now()}`;
    timing.mark('threadReadyMs');

    // Track the session
    activeCodexSessions.set(currentSessionId, {
      thread,
      codex,
      status: 'running',
      abortController,
      startedAt: new Date().toISOString()
    });

    if (sessionId) {
      sendMessage(ws, createNormalizedMessage({
        kind: 'session_created',
        newSessionId: currentSessionId,
        sessionId: currentSessionId,
        provider: 'codex',
      }));
      emittedSessionCreated = true;
    }

    // Execute with streaming
    const streamedTurn = await thread.runStreamed(command, {
      signal: abortController.signal
    });
    timing.mark('streamOpenMs');

    for await (const event of streamedTurn.events) {
      eventCount += 1;
      timing.mark('firstEventMs');

      // Check if session was aborted
      const session = activeCodexSessions.get(currentSessionId);
      if (!session || session.status === 'aborted') {
        break;
      }

      if (event.type === 'thread.started' && event.thread_id) {
        const actualSessionId = event.thread_id;
        moveActiveSession(currentSessionId, actualSessionId);
        currentSessionId = actualSessionId;

        if (!emittedSessionCreated) {
          sendMessage(ws, createNormalizedMessage({
            kind: 'session_created',
            newSessionId: currentSessionId,
            sessionId: currentSessionId,
            provider: 'codex',
          }));
          emittedSessionCreated = true;
        }
        continue;
      }

      if (event.type === 'item.updated' && event.item?.type === 'agent_message') {
        const nextText = event.item.text || '';
        const previousText = streamedAgentTexts.get(event.item.id) || '';
        const delta = diffStreamingText(previousText, nextText);

        streamedAgentTexts.set(event.item.id, nextText);

        if (delta) {
          streamedTextEvents += 1;
          streamedTextChars += delta.length;
          timing.mark('firstTextMs');
          sendMessage(ws, createNormalizedMessage({
            kind: 'stream_delta',
            content: delta,
            sessionId: currentSessionId,
            provider: 'codex',
          }));
        }
        continue;
      }

      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const nextText = event.item.text || '';
        const previousText = streamedAgentTexts.get(event.item.id) || '';
        const delta = diffStreamingText(previousText, nextText);

        if (delta) {
          streamedTextEvents += 1;
          streamedTextChars += delta.length;
          timing.mark('firstTextMs');
          sendMessage(ws, createNormalizedMessage({
            kind: 'stream_delta',
            content: delta,
            sessionId: currentSessionId,
            provider: 'codex',
          }));
        }

        if (streamedAgentTexts.has(event.item.id) || delta) {
          sendMessage(ws, createNormalizedMessage({
            kind: 'stream_end',
            sessionId: currentSessionId,
            provider: 'codex',
          }));
          streamedAgentTexts.delete(event.item.id);
          continue;
        }
      }

      if (event.type === 'item.started' || event.type === 'item.updated') {
        continue;
      }

      const transformed = transformCodexEvent(event);

      // Normalize the transformed event into NormalizedMessage(s) via adapter
      const normalizedMsgs = codexAdapter.normalizeMessage(transformed, currentSessionId);
      for (const msg of normalizedMsgs) {
        sendMessage(ws, msg);
      }

      if (event.type === 'turn.failed' && !terminalFailure) {
        terminalFailure = event.error || new Error('Turn failed');
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: currentSessionId,
          sessionName: sessionSummary,
          error: terminalFailure
        });
      }

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed' && event.usage) {
        const totalTokens = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0);
        sendMessage(ws, createNormalizedMessage({ kind: 'status', text: 'token_budget', tokenBudget: { used: totalTokens, total: 200000 }, sessionId: currentSessionId, provider: 'codex' }));
      }
    }

    // Send completion event
    if (!terminalFailure) {
      const timingSnapshot = timing.snapshot({
        eventCount,
        streamedTextEvents,
        streamedTextChars,
      });
      timingSnapshot.bottleneck = classifyCodexBottleneck(timingSnapshot);
      logCodexTiming(currentSessionId, timingSnapshot);

      sendMessage(ws, createNormalizedMessage({
        kind: 'complete',
        actualSessionId: thread.id || currentSessionId,
        sessionId: currentSessionId,
        provider: 'codex',
        timing: timingSnapshot,
      }));
      notifyRunStopped({
        userId: ws?.userId || null,
        provider: 'codex',
        sessionId: currentSessionId,
        sessionName: sessionSummary,
        stopReason: 'completed'
      });
    }

  } catch (error) {
    const session = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');

    if (!wasAborted) {
      console.error('[Codex] Error:', error);
      const timingSnapshot = timing.snapshot({
        eventCount,
        streamedTextEvents,
        streamedTextChars,
      });
      timingSnapshot.bottleneck = classifyCodexBottleneck(timingSnapshot);
      logCodexTiming(currentSessionId, {
        ...timingSnapshot,
        failed: true,
      });

      sendMessage(ws, createNormalizedMessage({
        kind: 'error',
        content: error.message,
        sessionId: currentSessionId,
        provider: 'codex',
        timing: timingSnapshot,
      }));
      if (!terminalFailure) {
        notifyRunFailed({
          userId: ws?.userId || null,
          provider: 'codex',
          sessionId: currentSessionId,
          sessionName: sessionSummary,
          error
        });
      }
    }

  } finally {
    // Update session status
    if (currentSessionId) {
      const session = activeCodexSessions.get(currentSessionId);
      if (session) {
        session.status = session.status === 'aborted' ? 'aborted' : 'completed';
      }
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = activeCodexSessions.get(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = activeCodexSessions.get(sessionId);
  return session?.status === 'running';
}

/**
 * Get all active sessions
 * @returns {Array} - Array of active session info
 */
export function getActiveCodexSessions() {
  const sessions = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessions.push({
        id,
        status: session.status,
        startedAt: session.startedAt
      });
    }
  }

  return sessions;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function' && (typeof ws.readyState === 'number' || typeof ws.ping === 'function')) {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    } else if (typeof ws.send === 'function') {
      // Plain internal writers should receive the normalized object directly.
      ws.send(data);
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startedAt = new Date(session.startedAt).getTime();
      if (now - startedAt > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

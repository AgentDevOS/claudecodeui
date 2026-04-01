import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import { deliveryWorkflowsDb, sessionNamesDb } from '../database/db.js';
import { queryCodex } from '../openai-codex.js';
import { broadcastDeliveryWorkflowUpdate } from '../utils/delivery-websocket.js';
import { startWorkflowRuntime, stopWorkflowRuntime, getWorkflowRuntime } from './delivery-runtime-manager.js';

const activeJobs = new Map();

function excerpt(text, maxLength = 220) {
  if (!text) {
    return '';
  }

  const normalized = String(text).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function sameLanguageInstruction(reference = "the user's request") {
  return `Write all human-readable content in the same language as ${reference}. If it is Chinese, use Simplified Chinese.`;
}

function conciseWorkflowOutputInstruction() {
  return [
    'Keep any chat-facing output minimal.',
    'Do not narrate your inspection, planning, validation, or intermediate progress.',
    'Do not emit step-by-step work logs unless an error blocks completion.',
    "If you send a final response, keep it to 1-2 short sentences summarizing the artifact result in the same language as the user's request.",
  ].join('\n');
}

function getStageSessionName(workflow, stage) {
  const useChineseLabels = /[\u4e00-\u9fff]/.test(workflow.title || workflow.requirementText || '');
  const stageLabels = useChineseLabels
    ? {
        requirement: '需求评审',
        prototype: '原型设计',
        development: '开发实现',
        uat: 'UAT',
        delivery: '交付',
      }
    : {
        requirement: 'Requirement Review',
        prototype: 'Prototype',
        development: 'Development',
        uat: 'UAT',
        delivery: 'Delivery',
      };

  const baseTitle = workflow.title || excerpt(workflow.requirementText, 40) || 'Delivery Workflow';
  return `${baseTitle} · ${stageLabels[stage] || stage}`;
}

function workflowRoot(projectPath, workflowId) {
  return path.join(projectPath, '.cloudcli', 'delivery', workflowId);
}

function getWorkflowPaths(workflow) {
  const root = workflowRoot(workflow.projectPath, workflow.id);
  const prototypeDir = path.join(workflow.projectPath, 'prototype');

  return {
    root,
    requirement: {
      dir: path.join(root, 'requirement'),
      json: path.join(root, 'requirement', 'requirement.json'),
      md: path.join(root, 'requirement', 'requirement.md'),
    },
    prototype: {
      dir: prototypeDir,
      entryHtml: path.join(prototypeDir, 'index.html'),
      json: path.join(prototypeDir, 'prototype.json'),
    },
    development: {
      dir: path.join(root, 'development'),
      summary: path.join(root, 'development', 'summary.md'),
      report: path.join(root, 'development', 'report.json'),
      uatDir: path.join(root, 'published', 'uat'),
    },
  };
}

async function ensureWorkflowDirectories(paths) {
  await fs.mkdir(paths.requirement.dir, { recursive: true });
  await fs.mkdir(paths.prototype.dir, { recursive: true });
  await fs.mkdir(paths.development.dir, { recursive: true });
  await fs.mkdir(paths.development.uatDir, { recursive: true });
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveManifestPath(projectPath, candidatePath, cwdHint = null) {
  if (!candidatePath || typeof candidatePath !== 'string') {
    return null;
  }

  if (path.isAbsolute(candidatePath)) {
    return candidatePath;
  }

  if (cwdHint) {
    const hintBase = path.isAbsolute(cwdHint) ? cwdHint : path.resolve(projectPath, cwdHint);
    return path.resolve(hintBase, candidatePath);
  }

  return path.resolve(projectPath, candidatePath);
}

async function publishStaticDirectory(sourceDir, targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
}

function createBaseData(workflow) {
  const root = workflowRoot(workflow.projectPath, workflow.id);
  return {
    rootDir: root,
    publicUrls: {
      prototypePreview: `/preview/${workflow.id}/prototype/`,
      uatPreview: `/preview/${workflow.id}/uat/`,
      runtime: `/runtime/${workflow.id}/`,
      runtimeWebSocket: `/runtime-ws/${workflow.id}`,
    },
  };
}

class DeliveryExecutionWriter {
  constructor(workflow) {
    this.workflow = workflow;
    this.errors = [];
  }

  send(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.kind === 'session_created' && message.sessionId) {
      const currentWorkflow = deliveryWorkflowsDb.getWorkflowById(this.workflow.id, this.workflow.userId) || this.workflow;
      const updatedWorkflow = deliveryWorkflowsDb.updateWorkflow(this.workflow.id, {
        activeSessionId: message.sessionId,
        data: buildWorkflowDataWithSession(currentWorkflow, message.sessionId),
      }, this.workflow.userId);

      sessionNamesDb.setName(
        message.sessionId,
        'codex',
        getStageSessionName(this.workflow, this.workflow.stage),
      );
      broadcastDeliveryWorkflowUpdate(updatedWorkflow, {
        eventType: 'session_attached',
        activeSessionId: message.sessionId,
      });
    }

    if (message.kind === 'error' && message.content) {
      this.errors.push(String(message.content));
    }
  }
}

function buildRequirementPrompt(workflow, paths, feedbackItems = []) {
  const revisionSection = feedbackItems.length > 0
    ? `
Revision requests to address:
${feedbackItems.map((item, index) => `${index + 1}. ${item.content}`).join('\n')}
`
    : '';

  return `
You are working inside the project at ${workflow.projectPath}.

The user submitted this product request:
${workflow.requirementText}

${revisionSection}

Create requirement artifacts for a delivery workflow. Do not implement code yet.

Required outputs:
1. Write ${paths.requirement.md}
2. Write ${paths.requirement.json}

The JSON file must be valid JSON with this schema:
{
  "title": "short title",
  "summary": "one paragraph summary",
  "scope": ["key scope item"],
  "acceptanceCriteria": ["testable outcome"],
  "assumptions": ["assumption"],
  "risks": ["risk or open issue"]
}

The markdown file should be a human-readable requirement brief matching the JSON.
${sameLanguageInstruction("the user's request")}
${conciseWorkflowOutputInstruction()}
Do not create prototype files.
Do not modify the main project source code.
`.trim();
}

function buildPrototypePrompt(workflow, paths, feedbackItems = []) {
  const revisionSection = feedbackItems.length > 0
    ? `
Revision requests to address:
${feedbackItems.map((item, index) => `${index + 1}. ${item.content}`).join('\n')}
`
    : '';

  return `
You are working inside the project at ${workflow.projectPath}.

Read the confirmed requirement from:
- ${paths.requirement.md}
- ${paths.requirement.json}

${revisionSection}

Create a lightweight browser prototype without modifying the main project source code.

Requirements:
- Create the prototype as real HTML/CSS/JS files under ${paths.prototype.dir}
- The main entry file must be ${paths.prototype.entryHtml}
- It must work when served under the base path /preview/${workflow.id}/prototype/
- Prefer simple static HTML/CSS/JS with relative asset paths
- Write valid JSON metadata to ${paths.prototype.json}
- The primary deliverable is the runnable HTML prototype, not a text summary
- ${sameLanguageInstruction('the confirmed requirement')}

The JSON file must use this schema:
{
  "title": "prototype title",
  "summary": "short description",
  "highlights": ["notable prototype decision"],
  "limitations": ["known limitation"]
}

Do not modify the main project source code.
${conciseWorkflowOutputInstruction()}
`.trim();
}

function buildDevelopmentPrompt(workflow, paths, feedbackItems) {
  const feedbackSection = feedbackItems.length > 0
    ? `
UAT feedback to address:
${feedbackItems.map((item, index) => `${index + 1}. ${item.content}`).join('\n')}
`
    : '';

  const sourceDirectoryRules = `
Source code placement rules for newly generated business code:
- Mini Program code must go under ${path.join(workflow.projectPath, 'src', 'miniprogram')}
- Web code must go under ${path.join(workflow.projectPath, 'src', 'web')}
- App code must go under ${path.join(workflow.projectPath, 'src', 'app')}
- Backend service code must go under ${path.join(workflow.projectPath, 'src', 'backend')}
- Admin web code must go under ${path.join(workflow.projectPath, 'src', 'admin')}
- Do not place newly generated business source files outside those src subdirectories unless it is a minimal integration change to existing infrastructure
`;

  return `
You are working inside the project at ${workflow.projectPath}.

Confirmed requirement files:
- ${paths.requirement.md}
- ${paths.requirement.json}

Approved prototype files:
- ${paths.prototype.entryHtml}
- ${paths.prototype.json}

${feedbackSection}

Implement the requested changes in the main project. Run relevant tests and build commands when possible.
${sourceDirectoryRules}

The final UAT front-end preview will be served from /preview/${workflow.id}/uat/
Any local runtime service will be exposed from /runtime/${workflow.id}/
If the app uses WebSockets, assume the public WS path is /runtime-ws/${workflow.id}

Required outputs:
1. Write a human-readable summary to ${paths.development.summary}
2. Write valid JSON to ${paths.development.report}
3. ${sameLanguageInstruction('the confirmed requirement and any UAT feedback')}

The report JSON must follow this schema:
{
  "summary": "overall outcome summary",
  "testResults": [
    {
      "name": "command or test group",
      "status": "passed|failed|skipped",
      "details": "short details"
    }
  ],
  "preview": {
    "type": "static",
    "publishDir": "relative-or-absolute-path-to-built-frontend",
    "cwd": "optional-relative-or-absolute-working-directory"
  } | null,
  "runtime": {
    "type": "process",
    "startCommand": "command to start local runtime",
    "cwd": "optional-relative-or-absolute-working-directory",
    "healthPath": "/health-or-root"
  } | null
}

If no static UAT preview is available, set preview to null.
If no local runtime is needed, set runtime to null.
Do not write placeholders. Only report commands and paths that actually exist after your work.
${conciseWorkflowOutputInstruction()}
`.trim();
}

function addWorkflowEvent(workflow, stage, eventType, summary, payload = {}) {
  deliveryWorkflowsDb.addEvent({
    workflowId: workflow.id,
    stage,
    eventType,
    summary,
    payload,
  });
}

function buildRequirementData(workflow, paths, requirementJson, requirementMd) {
  return {
    ...(workflow.data || {}),
    requirement: {
      attempt: workflow.stageAttempt,
      generatedAt: new Date().toISOString(),
      jsonPath: paths.requirement.json,
      markdownPath: paths.requirement.md,
      content: requirementJson,
      markdown: requirementMd,
    },
    publicUrls: {
      ...(workflow.data?.publicUrls || createBaseData(workflow).publicUrls),
    },
  };
}

function buildWorkflowDataWithSession(workflow, sessionId) {
  const existingData = workflow.data || {};
  const existingSessionIds = Array.isArray(existingData.sessionIds) ? existingData.sessionIds : [];
  const sessionIds = existingSessionIds.includes(sessionId)
    ? existingSessionIds
    : [...existingSessionIds, sessionId];

  return {
    ...existingData,
    sessionIds,
  };
}

function buildPrototypeData(workflow, paths, prototypeJson, prototypeMd) {
  return {
    ...(workflow.data || {}),
    prototype: {
      attempt: workflow.stageAttempt,
      generatedAt: new Date().toISOString(),
      dir: paths.prototype.dir,
      entryHtmlPath: paths.prototype.entryHtml,
      jsonPath: paths.prototype.json,
      content: prototypeJson,
      previewUrl: `/preview/${workflow.id}/prototype/`,
    },
    publicUrls: {
      ...(workflow.data?.publicUrls || createBaseData(workflow).publicUrls),
      prototypePreview: `/preview/${workflow.id}/prototype/`,
    },
  };
}

function buildDevelopmentData(workflow, paths, summaryMarkdown, reportJson, previewInfo, runtimeInfo) {
  return {
    ...(workflow.data || {}),
    development: {
      attempt: workflow.stageAttempt,
      generatedAt: new Date().toISOString(),
      summaryPath: paths.development.summary,
      reportPath: paths.development.report,
      summaryMarkdown,
      report: reportJson,
    },
    uat: {
      preview: previewInfo,
      runtime: runtimeInfo,
      previewUrl: previewInfo?.publicUrl || null,
      runtimeUrl: runtimeInfo?.publicUrl || null,
      readyAt: new Date().toISOString(),
    },
    publicUrls: {
      ...(workflow.data?.publicUrls || createBaseData(workflow).publicUrls),
      uatPreview: previewInfo?.publicUrl || `/preview/${workflow.id}/uat/`,
      runtime: runtimeInfo?.publicUrl || `/runtime/${workflow.id}/`,
      runtimeWebSocket: runtimeInfo?.webSocketUrl || `/runtime-ws/${workflow.id}`,
    },
  };
}

async function runRequirementStage(workflow) {
  const paths = getWorkflowPaths(workflow);
  await ensureWorkflowDirectories(paths);
  const feedbackItems = deliveryWorkflowsDb.getFeedback(workflow.id, 'requirement');

  const writer = new DeliveryExecutionWriter(workflow);
  await queryCodex(buildRequirementPrompt(workflow, paths, feedbackItems), {
    projectPath: workflow.projectPath,
    cwd: workflow.projectPath,
    sessionId: null,
    permissionMode: 'bypassPermissions',
    sessionSummary: getStageSessionName(workflow, 'requirement'),
  }, writer);

  if (!(await exists(paths.requirement.json)) || !(await exists(paths.requirement.md))) {
    throw new Error(writer.errors.at(-1) || 'Codex did not create requirement artifacts');
  }

  const requirementJson = await readJson(paths.requirement.json);
  const requirementMd = await readText(paths.requirement.md);
  const latestSummary = requirementJson.summary || requirementJson.title || excerpt(requirementMd);
  const data = buildRequirementData(workflow, paths, requirementJson, requirementMd);

  return deliveryWorkflowsDb.updateWorkflow(workflow.id, {
    status: 'waiting_confirm',
    latestSummary,
    errorMessage: null,
    data,
  }, workflow.userId);
}

async function runPrototypeStage(workflow) {
  const paths = getWorkflowPaths(workflow);
  await ensureWorkflowDirectories(paths);
  const feedbackItems = deliveryWorkflowsDb.getFeedback(workflow.id, 'prototype');

  const writer = new DeliveryExecutionWriter(workflow);
  await queryCodex(buildPrototypePrompt(workflow, paths, feedbackItems), {
    projectPath: workflow.projectPath,
    cwd: workflow.projectPath,
    sessionId: null,
    permissionMode: 'bypassPermissions',
    sessionSummary: getStageSessionName(workflow, 'prototype'),
  }, writer);

  if (!(await exists(paths.prototype.entryHtml)) || !(await exists(paths.prototype.json))) {
    throw new Error(writer.errors.at(-1) || 'Codex did not create prototype artifacts');
  }

  const prototypeJson = await readJson(paths.prototype.json);
  const prototypeHtml = await readText(paths.prototype.entryHtml);
  const data = buildPrototypeData(workflow, paths, prototypeJson, prototypeHtml);
  const latestSummary = prototypeJson.summary || prototypeJson.title || excerpt(prototypeHtml);

  return deliveryWorkflowsDb.updateWorkflow(workflow.id, {
    status: 'waiting_confirm',
    latestSummary,
    errorMessage: null,
    data,
  }, workflow.userId);
}

async function runDevelopmentStage(workflow) {
  const paths = getWorkflowPaths(workflow);
  await ensureWorkflowDirectories(paths);

  const feedbackItems = deliveryWorkflowsDb.getFeedback(workflow.id, 'uat');
  const writer = new DeliveryExecutionWriter(workflow);
  await queryCodex(buildDevelopmentPrompt(workflow, paths, feedbackItems), {
    projectPath: workflow.projectPath,
    cwd: workflow.projectPath,
    sessionId: null,
    permissionMode: 'bypassPermissions',
    sessionSummary: getStageSessionName(workflow, 'development'),
  }, writer);

  if (!(await exists(paths.development.report)) || !(await exists(paths.development.summary))) {
    throw new Error(writer.errors.at(-1) || 'Codex did not create development artifacts');
  }

  const reportJson = await readJson(paths.development.report);
  const summaryMarkdown = await readText(paths.development.summary);

  let previewInfo = null;
  if (reportJson.preview?.type === 'static' && reportJson.preview.publishDir) {
    const sourceDir = resolveManifestPath(workflow.projectPath, reportJson.preview.publishDir, reportJson.preview.cwd);
    if (!(sourceDir && await exists(sourceDir))) {
      throw new Error(`Static preview directory not found: ${reportJson.preview.publishDir}`);
    }
    await publishStaticDirectory(sourceDir, paths.development.uatDir);
    previewInfo = {
      type: 'static',
      sourceDir,
      publishedDir: paths.development.uatDir,
      publicUrl: `/preview/${workflow.id}/uat/`,
    };
  }

  let runtimeInfo = null;
  if (reportJson.runtime?.type === 'process' && reportJson.runtime.startCommand) {
    runtimeInfo = await startWorkflowRuntime(workflow, reportJson.runtime);
  } else {
    await stopWorkflowRuntime(workflow.id);
  }

  const data = buildDevelopmentData(workflow, paths, summaryMarkdown, reportJson, previewInfo, runtimeInfo);
  const latestSummary = reportJson.summary || excerpt(summaryMarkdown);

  return deliveryWorkflowsDb.updateWorkflow(workflow.id, {
    stage: 'uat',
    status: 'waiting_feedback',
    latestSummary,
    errorMessage: null,
    data,
  }, workflow.userId);
}

async function executeWorkflowStage(workflowId) {
  const workflow = deliveryWorkflowsDb.getWorkflowById(workflowId);
  if (!workflow) {
    return null;
  }

  addWorkflowEvent(workflow, workflow.stage, 'stage_started', `Started ${workflow.stage} stage`, {
    sourceStage: workflow.stage,
    stageAttempt: workflow.stageAttempt,
  });
  broadcastDeliveryWorkflowUpdate(workflow, { eventType: 'stage_started' });

  try {
    let updatedWorkflow;
    if (workflow.stage === 'requirement') {
      updatedWorkflow = await runRequirementStage(workflow);
    } else if (workflow.stage === 'prototype') {
      updatedWorkflow = await runPrototypeStage(workflow);
    } else if (workflow.stage === 'development') {
      updatedWorkflow = await runDevelopmentStage(workflow);
    } else {
      throw new Error(`Unsupported workflow stage: ${workflow.stage}`);
    }

    addWorkflowEvent(updatedWorkflow, updatedWorkflow.stage, 'stage_completed', `Completed ${workflow.stage} stage`, {
      sourceStage: workflow.stage,
      resultingStage: updatedWorkflow.stage,
      resultingStatus: updatedWorkflow.status,
    });
    broadcastDeliveryWorkflowUpdate(updatedWorkflow, { eventType: 'stage_completed' });
    return updatedWorkflow;
  } catch (error) {
    const failedWorkflow = deliveryWorkflowsDb.updateWorkflow(workflow.id, {
      status: 'failed',
      errorMessage: error.message,
    }, workflow.userId);

    addWorkflowEvent(failedWorkflow, workflow.stage, 'stage_failed', error.message, {
      sourceStage: workflow.stage,
      stageAttempt: workflow.stageAttempt,
    });
    broadcastDeliveryWorkflowUpdate(failedWorkflow, { eventType: 'stage_failed', error: error.message });
    return failedWorkflow;
  }
}

export function queueWorkflowStage(workflowId) {
  if (activeJobs.has(workflowId)) {
    return activeJobs.get(workflowId);
  }

  const job = executeWorkflowStage(workflowId).finally(() => {
    activeJobs.delete(workflowId);
  });

  activeJobs.set(workflowId, job);
  return job;
}

export function isWorkflowRunning(workflowId) {
  return activeJobs.has(workflowId);
}

export async function createDeliveryWorkflow({ userId, projectName, projectPath, title, requirementText, provider = 'codex' }) {
  const existingWorkflow = deliveryWorkflowsDb.getLatestOpenWorkflowByProject(userId, projectName);
  if (existingWorkflow) {
    return deliveryWorkflowsDb.getWorkflowById(existingWorkflow.id, userId);
  }

  const id = `wf_${crypto.randomUUID()}`;
  const workflow = deliveryWorkflowsDb.createWorkflow({
    id,
    userId,
    projectName,
    projectPath,
    title,
    requirementText,
    provider,
    stage: 'requirement',
    status: 'running',
    data: createBaseData({ id, projectPath }),
  });

  addWorkflowEvent(workflow, workflow.stage, 'workflow_created', 'Workflow created', {});
  broadcastDeliveryWorkflowUpdate(workflow, { eventType: 'workflow_created' });
  void queueWorkflowStage(workflow.id);

  return deliveryWorkflowsDb.getWorkflowById(workflow.id, userId);
}

export function getDeliveryWorkflowForUser(workflowId, userId) {
  const workflow = deliveryWorkflowsDb.getWorkflowById(workflowId, userId);
  if (!workflow) {
    return null;
  }

  return {
    ...workflow,
    events: deliveryWorkflowsDb.getEvents(workflowId),
    feedback: deliveryWorkflowsDb.getFeedback(workflowId),
    runtimeState: getWorkflowRuntime(workflowId),
  };
}

export function getDeliveryWorkflowForSession(sessionId, userId) {
  const workflow = deliveryWorkflowsDb.getWorkflowByActiveSessionId(userId, sessionId)
    || deliveryWorkflowsDb.getWorkflowsByUser(userId).find((item) => (
      Array.isArray(item.data?.sessionIds) && item.data.sessionIds.includes(sessionId)
    ));
  if (!workflow) {
    return null;
  }

  return {
    ...workflow,
    events: deliveryWorkflowsDb.getEvents(workflow.id),
    feedback: deliveryWorkflowsDb.getFeedback(workflow.id),
    runtimeState: getWorkflowRuntime(workflow.id),
  };
}

export function getDeliveryWorkflowsForProject(userId, projectName) {
  return deliveryWorkflowsDb.getWorkflowsByProject(userId, projectName).map((workflow) => ({
    ...workflow,
    runtimeState: getWorkflowRuntime(workflow.id),
  }));
}

export async function confirmDeliveryWorkflow(workflowId, userId) {
  const workflow = deliveryWorkflowsDb.getWorkflowById(workflowId, userId);
  if (!workflow) {
    return null;
  }

  if (workflow.status !== 'waiting_confirm') {
    throw new Error('Workflow is not waiting for confirmation');
  }

  let nextStage;
  if (workflow.stage === 'requirement') {
    nextStage = 'prototype';
  } else if (workflow.stage === 'prototype') {
    nextStage = 'development';
  } else {
    throw new Error(`Confirmation is not supported for stage: ${workflow.stage}`);
  }

  const updated = deliveryWorkflowsDb.updateWorkflow(workflowId, {
    stage: nextStage,
    status: 'running',
    stageAttempt: workflow.stageAttempt + 1,
    errorMessage: null,
  }, userId);

  addWorkflowEvent(updated, nextStage, 'stage_confirmed', `Confirmed ${workflow.stage} stage`, {
    confirmedStage: workflow.stage,
    nextStage,
  });
  broadcastDeliveryWorkflowUpdate(updated, { eventType: 'stage_confirmed' });
  void queueWorkflowStage(workflowId);

  return updated;
}

export async function submitDeliveryWorkflowFeedback(workflowId, userId, content) {
  const workflow = deliveryWorkflowsDb.getWorkflowById(workflowId, userId);
  if (!workflow) {
    return null;
  }

  if (!(workflow.stage === 'uat' && workflow.status === 'waiting_feedback')) {
    throw new Error('Workflow is not ready for UAT feedback');
  }

  deliveryWorkflowsDb.addFeedback({
    workflowId,
    stage: 'uat',
    content,
    resolvedInAttempt: workflow.stageAttempt + 1,
  });

  const updated = deliveryWorkflowsDb.updateWorkflow(workflowId, {
    stage: 'development',
    status: 'running',
    stageAttempt: workflow.stageAttempt + 1,
    errorMessage: null,
  }, userId);

  addWorkflowEvent(updated, 'development', 'feedback_submitted', 'Submitted UAT feedback', {
    content,
  });
  broadcastDeliveryWorkflowUpdate(updated, { eventType: 'feedback_submitted' });
  void queueWorkflowStage(workflowId);

  return updated;
}

export async function reviseDeliveryWorkflow(workflowId, userId, content) {
  const workflow = deliveryWorkflowsDb.getWorkflowById(workflowId, userId);
  if (!workflow) {
    return null;
  }

  if (!(workflow.status === 'waiting_confirm' && (workflow.stage === 'requirement' || workflow.stage === 'prototype'))) {
    throw new Error('Workflow is not ready for revision feedback');
  }

  deliveryWorkflowsDb.addFeedback({
    workflowId,
    stage: workflow.stage,
    content,
    resolvedInAttempt: workflow.stageAttempt + 1,
  });

  const updated = deliveryWorkflowsDb.updateWorkflow(workflowId, {
    status: 'running',
    stageAttempt: workflow.stageAttempt + 1,
    errorMessage: null,
  }, userId);

  addWorkflowEvent(updated, workflow.stage, 'revision_submitted', `Submitted ${workflow.stage} revision request`, {
    content,
    stage: workflow.stage,
  });
  broadcastDeliveryWorkflowUpdate(updated, { eventType: 'revision_submitted' });
  void queueWorkflowStage(workflowId);

  return updated;
}

export async function retryDeliveryWorkflow(workflowId, userId) {
  const workflow = deliveryWorkflowsDb.getWorkflowById(workflowId, userId);
  if (!workflow) {
    return null;
  }

  if (workflow.status !== 'failed') {
    throw new Error('Workflow is not in a failed state');
  }

  if (!['requirement', 'prototype', 'development'].includes(workflow.stage)) {
    throw new Error(`Retry is not supported for stage: ${workflow.stage}`);
  }

  const updated = deliveryWorkflowsDb.updateWorkflow(workflowId, {
    status: 'running',
    stageAttempt: workflow.stageAttempt + 1,
    errorMessage: null,
  }, userId);

  addWorkflowEvent(updated, workflow.stage, 'stage_retried', `Retried ${workflow.stage} stage`, {
    retriedStage: workflow.stage,
    previousError: workflow.errorMessage,
  });
  broadcastDeliveryWorkflowUpdate(updated, { eventType: 'stage_retried' });
  void queueWorkflowStage(workflowId);

  return updated;
}

export async function completeDeliveryWorkflow(workflowId, userId) {
  const workflow = deliveryWorkflowsDb.getWorkflowById(workflowId, userId);
  if (!workflow) {
    return null;
  }

  if (!(workflow.stage === 'uat' && workflow.status === 'waiting_feedback')) {
    throw new Error('Workflow is not ready to be completed');
  }

  await stopWorkflowRuntime(workflowId);

  const nextData = {
    ...(workflow.data || {}),
    delivery: {
      completedAt: new Date().toISOString(),
    },
  };

  const updated = deliveryWorkflowsDb.updateWorkflow(workflowId, {
    stage: 'delivery',
    status: 'completed',
    errorMessage: null,
    data: nextData,
  }, userId);

  addWorkflowEvent(updated, 'delivery', 'workflow_completed', 'Workflow marked as delivered', {});
  broadcastDeliveryWorkflowUpdate(updated, { eventType: 'workflow_completed' });
  return updated;
}

export function getWorkflowPreviewDirectory(workflowId, target) {
  const workflow = deliveryWorkflowsDb.getWorkflowById(workflowId);
  if (!workflow) {
    return null;
  }

  if (target === 'prototype') {
    return workflow.data?.prototype?.dir || null;
  }

  if (target === 'uat') {
    return workflow.data?.uat?.preview?.publishedDir || null;
  }

  return null;
}

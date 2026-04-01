import type { ChatMessage } from '../types/types';
import type { SessionWorkflow, WorkflowFeedbackItem } from '../hooks/useWorkflowSessionState';
import { resolveAppUrl } from '../../../lib/utils.js';

type WorkflowCopy = {
  created: string;
  runningRequirement: string;
  runningRequirementRevision: string;
  runningPrototype: string;
  runningPrototypeRevision: string;
  runningDevelopment: string;
  runningDevelopmentFeedback: string;
  deliveryCompleted: string;
  requirementReady: string;
  requirementUpdated: string;
  prototypeReady: string;
  prototypeUpdated: string;
  developmentReady: string;
  developmentUpdated: string;
  requirementCardHint: string;
  prototypeCardHint: string;
  developmentCardHint: string;
  currentFeedback: string;
  summary: string;
  scope: string;
  acceptanceCriteria: string;
  assumptions: string;
  risks: string;
  highlights: string;
  limitations: string;
  testResults: string;
  links: string;
  prototypePreview: string;
  uatPreview: string;
  runtime: string;
  failedPrefix: string;
  statusPassed: string;
  statusFailed: string;
  statusSkipped: string;
};

type TimelineEntry = {
  message: ChatMessage;
  time: number;
  order: number;
};

function getCopy(locale?: string): WorkflowCopy {
  const isChinese = locale?.toLowerCase().startsWith('zh');
  if (isChinese) {
    return {
      created: '已创建交付流程，正在整理需求。',
      runningRequirement: '正在整理需求，请稍候。',
      runningRequirementRevision: '正在根据你的反馈更新需求，请稍候。',
      runningPrototype: '正在生成原型 HTML，请稍候。',
      runningPrototypeRevision: '正在根据你的反馈更新原型 HTML，请稍候。',
      runningDevelopment: '正在开发并执行测试，请稍候。',
      runningDevelopmentFeedback: '正在根据你的验收反馈继续修复并执行测试，请稍候。',
      deliveryCompleted: '已标记为最终交付。',
      requirementReady: '需求要点已整理，请确认。',
      requirementUpdated: '已根据你的反馈更新需求，请确认。',
      prototypeReady: '原型 HTML 已生成，请确认是否进入开发。',
      prototypeUpdated: '已根据你的反馈更新原型 HTML，请确认是否进入开发。',
      developmentReady: '开发与测试结果已生成，请查看并继续验收。',
      developmentUpdated: '已根据你的反馈完成修复，并更新了开发与测试结果。',
      requirementCardHint: '请查看上方需求概要卡片；如无问题，点击确认继续。',
      prototypeCardHint: '请查看上方原型卡片和预览入口；如无问题，点击确认继续。',
      developmentCardHint: '请查看上方交付概要卡片，并继续验收。',
      currentFeedback: '本轮反馈',
      summary: '概述',
      scope: '范围',
      acceptanceCriteria: '验收标准',
      assumptions: '假设',
      risks: '风险',
      highlights: '亮点',
      limitations: '限制',
      testResults: '测试结果',
      links: '入口',
      prototypePreview: '原型预览',
      uatPreview: 'UAT 预览',
      runtime: '运行时',
      failedPrefix: '当前阶段执行失败：',
      statusPassed: '通过',
      statusFailed: '失败',
      statusSkipped: '跳过',
    };
  }

  return {
    created: 'Delivery workflow created. Preparing the requirement summary.',
    runningRequirement: 'Preparing the requirement summary.',
    runningRequirementRevision: 'Updating the requirement summary based on your feedback.',
    runningPrototype: 'Preparing the prototype HTML.',
    runningPrototypeRevision: 'Updating the prototype HTML based on your feedback.',
    runningDevelopment: 'Implementing the requested changes and running tests.',
    runningDevelopmentFeedback: 'Applying your UAT feedback and rerunning verification.',
    deliveryCompleted: 'This workflow has been marked as delivered.',
    requirementReady: 'Requirement summary is ready for confirmation.',
    requirementUpdated: 'Requirement summary has been updated based on your feedback.',
    prototypeReady: 'Prototype HTML is ready for confirmation.',
    prototypeUpdated: 'Prototype HTML has been updated based on your feedback.',
    developmentReady: 'Development and test results are ready for review.',
    developmentUpdated: 'Development and test results have been updated based on your feedback.',
    requirementCardHint: 'Review the requirement summary card above, then confirm or send revisions.',
    prototypeCardHint: 'Review the prototype card and preview link above, then confirm or send revisions.',
    developmentCardHint: 'Review the delivery summary card above and continue with UAT.',
    currentFeedback: 'Feedback applied in this round',
    summary: 'Summary',
    scope: 'Scope',
    acceptanceCriteria: 'Acceptance Criteria',
    assumptions: 'Assumptions',
    risks: 'Risks',
    highlights: 'Highlights',
    limitations: 'Limitations',
    testResults: 'Test Results',
    links: 'Links',
    prototypePreview: 'Prototype Preview',
    uatPreview: 'UAT Preview',
    runtime: 'Runtime',
    failedPrefix: 'This stage failed:',
    statusPassed: 'Passed',
    statusFailed: 'Failed',
    statusSkipped: 'Skipped',
  };
}

function toTimestamp(value: unknown, fallback = 0) {
  if (!value) {
    return fallback;
  }

  const timestamp = new Date(value as string | number | Date).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function pushEntry(entries: TimelineEntry[], message: ChatMessage, time: number, order: number) {
  entries.push({ message, time, order });
}

function formatList(items: unknown[]) {
  const normalized = items
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return '';
  }

  return normalized.map((item) => `- ${item}`).join('\n');
}

function formatStageFeedback(copy: WorkflowCopy, feedbackItems: WorkflowFeedbackItem[]) {
  if (!feedbackItems.length) {
    return '';
  }

  return `${copy.currentFeedback}:\n${formatList(feedbackItems.map((item) => item.content))}`;
}

function getMatchingFeedback(
  feedback: WorkflowFeedbackItem[] | undefined,
  stage: string,
  attempt: unknown,
) {
  const targetAttempt = typeof attempt === 'number' ? attempt : Number(attempt);
  if (!Number.isFinite(targetAttempt)) {
    return [];
  }

  return (feedback || []).filter((item) => item.stage === stage && item.resolvedInAttempt === targetAttempt);
}

function formatRequirementMessage(
  workflow: SessionWorkflow,
  copy: WorkflowCopy,
) {
  const requirement = workflow.data?.requirement?.content;
  if (!requirement) {
    return '';
  }

  const feedbackItems = getMatchingFeedback(
    workflow.feedback,
    'requirement',
    workflow.data?.requirement?.attempt,
  );

  const parts = [
    `**${feedbackItems.length ? copy.requirementUpdated : copy.requirementReady}**`,
    formatStageFeedback(copy, feedbackItems),
    copy.requirementCardHint,
  ].filter(Boolean);

  return parts.join('\n\n');
}

function formatPrototypeMessage(
  workflow: SessionWorkflow,
  copy: WorkflowCopy,
) {
  const prototype = workflow.data?.prototype?.content;
  if (!prototype) {
    return '';
  }

  const feedbackItems = getMatchingFeedback(
    workflow.feedback,
    'prototype',
    workflow.data?.prototype?.attempt,
  );

  const prototypePreviewUrl = typeof workflow.data?.prototype?.previewUrl === 'string'
    ? workflow.data.prototype.previewUrl.trim()
    : typeof workflow.data?.publicUrls?.prototypePreview === 'string'
      ? workflow.data.publicUrls.prototypePreview.trim()
      : '';
  const resolvedPrototypePreviewUrl = resolveAppUrl(prototypePreviewUrl);

  const parts = [
    `**${feedbackItems.length ? copy.prototypeUpdated : copy.prototypeReady}**`,
    formatStageFeedback(copy, feedbackItems),
    resolvedPrototypePreviewUrl ? `[${copy.prototypePreview}](${resolvedPrototypePreviewUrl})` : '',
    copy.prototypeCardHint,
  ].filter(Boolean);

  return parts.join('\n\n');
}

function formatDevelopmentMessage(
  workflow: SessionWorkflow,
  copy: WorkflowCopy,
) {
  const report = workflow.data?.development?.report;
  if (!report) {
    return '';
  }

  const feedbackItems = getMatchingFeedback(
    workflow.feedback,
    'uat',
    workflow.data?.development?.attempt,
  );

  const parts = [
    `**${feedbackItems.length ? copy.developmentUpdated : copy.developmentReady}**`,
    formatStageFeedback(copy, feedbackItems),
    copy.developmentCardHint,
  ].filter(Boolean);

  return parts.join('\n\n');
}

function getRunningStatus(workflow: SessionWorkflow, copy: WorkflowCopy) {
  if (workflow.status === 'failed') {
    return `${copy.failedPrefix} ${workflow.errorMessage || ''}`.trim();
  }

  if (workflow.status === 'completed' && workflow.stage === 'delivery') {
    return copy.deliveryCompleted;
  }

  if (workflow.status !== 'running') {
    return '';
  }

  if (workflow.stage === 'requirement') {
    return getMatchingFeedback(workflow.feedback, 'requirement', workflow.stageAttempt).length
      ? copy.runningRequirementRevision
      : copy.runningRequirement;
  }

  if (workflow.stage === 'prototype') {
    return getMatchingFeedback(workflow.feedback, 'prototype', workflow.stageAttempt).length
      ? copy.runningPrototypeRevision
      : copy.runningPrototype;
  }

  if (workflow.stage === 'development') {
    return getMatchingFeedback(workflow.feedback, 'uat', workflow.stageAttempt).length
      ? copy.runningDevelopmentFeedback
      : copy.runningDevelopment;
  }

  return '';
}

export function buildWorkflowChatMessages(workflow: SessionWorkflow, locale?: string): ChatMessage[] {
  const copy = getCopy(locale);
  const entries: TimelineEntry[] = [];
  const createdAt = toTimestamp(workflow.createdAt, Date.now());

  pushEntry(entries, {
    type: 'user',
    content: workflow.requirementText,
    timestamp: workflow.createdAt || new Date(createdAt).toISOString(),
  }, createdAt, 0);

  const feedbackItems = [...(workflow.feedback || [])].sort(
    (left, right) => toTimestamp(left.createdAt) - toTimestamp(right.createdAt),
  );

  feedbackItems.forEach((item, index) => {
    const time = toTimestamp(item.createdAt, createdAt + index + 1);
    pushEntry(entries, {
      type: 'user',
      content: item.content,
      timestamp: item.createdAt || new Date(time).toISOString(),
    }, time, 10 + index);
  });

  const requirementMessage = formatRequirementMessage(workflow, copy);
  if (requirementMessage) {
    const time = toTimestamp(workflow.data?.requirement?.generatedAt, createdAt + 1000);
    pushEntry(entries, {
      type: 'assistant',
      content: requirementMessage,
      timestamp: workflow.data?.requirement?.generatedAt || new Date(time).toISOString(),
    }, time, 200);
  }

  const prototypeMessage = formatPrototypeMessage(workflow, copy);
  if (prototypeMessage) {
    const time = toTimestamp(workflow.data?.prototype?.generatedAt, createdAt + 2000);
    pushEntry(entries, {
      type: 'assistant',
      content: prototypeMessage,
      timestamp: workflow.data?.prototype?.generatedAt || new Date(time).toISOString(),
    }, time, 300);
  }

  const developmentMessage = formatDevelopmentMessage(workflow, copy);
  if (developmentMessage) {
    const time = toTimestamp(workflow.data?.development?.generatedAt, createdAt + 3000);
    pushEntry(entries, {
      type: 'assistant',
      content: developmentMessage,
      timestamp: workflow.data?.development?.generatedAt || new Date(time).toISOString(),
    }, time, 400);
  }

  const runningStatus = getRunningStatus(workflow, copy);
  if (runningStatus) {
    const time = toTimestamp(workflow.updatedAt, createdAt + 4000);
    pushEntry(entries, {
      type: workflow.status === 'failed' ? 'error' : 'assistant',
      content: runningStatus,
      timestamp: workflow.updatedAt || new Date(time).toISOString(),
      isTaskNotification: workflow.status !== 'failed',
      taskStatus: workflow.status === 'failed' ? undefined : (workflow.status === 'completed' ? 'completed' : 'running'),
    }, time, 500);
  } else if (!workflow.data?.requirement?.content) {
    pushEntry(entries, {
      type: 'assistant',
      content: copy.created,
      timestamp: workflow.createdAt || new Date(createdAt).toISOString(),
      isTaskNotification: true,
      taskStatus: 'running',
    }, createdAt, 1);
  }

  return entries
    .sort((left, right) => {
      if (left.time !== right.time) {
        return left.time - right.time;
      }
      return left.order - right.order;
    })
    .map((entry) => entry.message);
}

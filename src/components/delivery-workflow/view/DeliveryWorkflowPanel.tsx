import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import { resolveAppUrl } from '../../../lib/utils.js';

type DeliveryWorkflowMessage = {
  type?: string;
  projectName?: string;
  workflowId?: string;
};

type DeliveryWorkflow = {
  id: string;
  title?: string | null;
  requirementText: string;
  stage: string;
  status: string;
  latestSummary?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  data?: Record<string, any>;
  events?: Array<{
    id: number;
    stage: string;
    eventType: string;
    summary?: string | null;
    payload?: Record<string, any>;
    createdAt: string;
  }>;
  feedback?: Array<{
    id: number;
    content: string;
    createdAt: string;
  }>;
};

type DeliveryWorkflowPanelProps = {
  selectedProject: Project;
  latestMessage: unknown;
};

const STAGE_LABELS: Record<string, string> = {
  requirement: 'Requirement',
  prototype: 'Prototype',
  development: 'Development',
  uat: 'UAT',
  delivery: 'Delivery',
};

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting_confirm: 'Waiting for Confirmation',
  waiting_feedback: 'Waiting for UAT Feedback',
  failed: 'Failed',
  completed: 'Completed',
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function getStageLabel(stage: string, t: (key: string, options?: Record<string, unknown>) => string) {
  return t(`deliveryWorkflow.stages.${stage}`, { defaultValue: STAGE_LABELS[stage] || stage });
}

function getStatusLabel(status: string, t: (key: string, options?: Record<string, unknown>) => string) {
  return t(`deliveryWorkflow.statuses.${status}`, { defaultValue: STATUS_LABELS[status] || status });
}

function getEventSummary(
  event: NonNullable<DeliveryWorkflow['events']>[number],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const currentStageLabel = getStageLabel(event.stage, t);
  const confirmedStage = typeof event.payload?.confirmedStage === 'string' ? event.payload.confirmedStage : event.stage;
  const confirmedStageLabel = getStageLabel(confirmedStage, t);
  const sourceStage = typeof event.payload?.sourceStage === 'string'
    ? event.payload.sourceStage
    : event.eventType === 'stage_completed' && event.stage === 'uat'
      ? 'development'
      : event.stage;
  const sourceStageLabel = getStageLabel(sourceStage, t);

  switch (event.eventType) {
    case 'workflow_created':
      return t('deliveryWorkflow.events.workflowCreated');
    case 'stage_started':
      return t('deliveryWorkflow.events.stageStarted', { stage: currentStageLabel });
    case 'stage_completed':
      return t('deliveryWorkflow.events.stageCompleted', { stage: sourceStageLabel });
    case 'stage_confirmed':
      return t('deliveryWorkflow.events.stageConfirmed', { stage: confirmedStageLabel });
    case 'feedback_submitted':
      return t('deliveryWorkflow.events.feedbackSubmitted');
    case 'stage_retried':
      return t('deliveryWorkflow.events.stageRetried', { stage: currentStageLabel });
    case 'revision_submitted':
      return t('deliveryWorkflow.events.revisionSubmitted', { stage: currentStageLabel });
    case 'workflow_completed':
      return t('deliveryWorkflow.events.workflowCompleted');
    case 'stage_failed':
      return event.summary || t('deliveryWorkflow.events.stageFailed', { stage: currentStageLabel });
    default:
      return event.summary || event.eventType;
  }
}

function formatTimestamp(value?: string, locale?: string) {
  if (!value) {
    return 'Unknown';
  }

  try {
    return new Date(value).toLocaleString(locale);
  } catch {
    return value;
  }
}

async function parseJsonResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function getStatusTone(status: string) {
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed') return 'bg-red-500/15 text-red-700 dark:text-red-300';
  if (status === 'running') return 'bg-blue-500/15 text-blue-700 dark:text-blue-300';
  return 'bg-muted text-muted-foreground';
}

function WorkflowLinks({ workflow }: { workflow: DeliveryWorkflow }) {
  const { t } = useTranslation('common');
  const prototypeUrl = resolveAppUrl(workflow.data?.publicUrls?.prototypePreview);
  const uatUrl = resolveAppUrl(workflow.data?.uat?.previewUrl || workflow.data?.publicUrls?.uatPreview);
  const runtimeUrl = resolveAppUrl(workflow.data?.uat?.runtimeUrl || workflow.data?.publicUrls?.runtime);

  return (
    <div className="grid gap-2">
      {prototypeUrl && (
        <a className="text-sm text-blue-600 hover:underline dark:text-blue-400" href={prototypeUrl} target="_blank" rel="noreferrer">
          {t('deliveryWorkflow.links.prototypePreview')}
        </a>
      )}
      {uatUrl && workflow.stage !== 'requirement' && (
        <a className="text-sm text-blue-600 hover:underline dark:text-blue-400" href={uatUrl} target="_blank" rel="noreferrer">
          {t('deliveryWorkflow.links.uatPreview')}
        </a>
      )}
      {runtimeUrl && workflow.stage !== 'requirement' && workflow.stage !== 'prototype' && (
        <a className="text-sm text-blue-600 hover:underline dark:text-blue-400" href={runtimeUrl} target="_blank" rel="noreferrer">
          {t('deliveryWorkflow.links.runtimeEndpoint')}
        </a>
      )}
    </div>
  );
}

export default function DeliveryWorkflowPanel({ selectedProject, latestMessage }: DeliveryWorkflowPanelProps) {
  const { t, i18n } = useTranslation('common');
  const [workflows, setWorkflows] = useState<DeliveryWorkflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<DeliveryWorkflow | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [requirementText, setRequirementText] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selectedWorkflowIdRef = useRef<string | null>(null);

  const selectedProjectPath = selectedProject.path || selectedProject.fullPath;

  useEffect(() => {
    selectedWorkflowIdRef.current = selectedWorkflowId;
  }, [selectedWorkflowId]);

  const refreshWorkflows = useCallback(async (preserveSelection = true) => {
    setIsLoadingList(true);
    try {
      const response = await api.delivery.list(selectedProject.name);
      const data = await parseJsonResponse(response);
      const nextWorkflows = (data.workflows || []) as DeliveryWorkflow[];
      setWorkflows(nextWorkflows);

      const currentSelectedId = selectedWorkflowIdRef.current;
      const nextSelectedId = preserveSelection
        ? currentSelectedId && nextWorkflows.some((workflow) => workflow.id === currentSelectedId)
          ? currentSelectedId
          : nextWorkflows[0]?.id || null
        : nextWorkflows[0]?.id || null;

      selectedWorkflowIdRef.current = nextSelectedId;
      setSelectedWorkflowId((current) => (current === nextSelectedId ? current : nextSelectedId));
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('deliveryWorkflow.errors.loadWorkflows'));
    } finally {
      setIsLoadingList(false);
    }
  }, [selectedProject.name, t]);

  const refreshSelectedWorkflow = useCallback(async (workflowId: string | null) => {
    if (!workflowId) {
      setSelectedWorkflow(null);
      return;
    }

    setIsLoadingDetail(true);
    try {
      const response = await api.delivery.get(workflowId);
      const data = await parseJsonResponse(response);
      setSelectedWorkflow((data.workflow || null) as DeliveryWorkflow | null);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('deliveryWorkflow.errors.loadWorkflow'));
    } finally {
      setIsLoadingDetail(false);
    }
  }, [t]);

  useEffect(() => {
    setSelectedWorkflow(null);
    setSelectedWorkflowId(null);
    void refreshWorkflows(false);
  }, [refreshWorkflows, selectedProject.name]);

  useEffect(() => {
    void refreshSelectedWorkflow(selectedWorkflowId);
  }, [refreshSelectedWorkflow, selectedWorkflowId]);

  useEffect(() => {
    const message = latestMessage as DeliveryWorkflowMessage | null;
    if (!message || message.type !== 'delivery-workflow-updated' || message.projectName !== selectedProject.name) {
      return;
    }

    void refreshWorkflows(true);
    if (!message.workflowId || message.workflowId === selectedWorkflowId) {
      void refreshSelectedWorkflow(message.workflowId || selectedWorkflowId);
    }
  }, [latestMessage, refreshSelectedWorkflow, refreshWorkflows, selectedProject.name, selectedWorkflowId]);

  const requirementDetails = selectedWorkflow?.data?.requirement?.content;
  const prototypeDetails = selectedWorkflow?.data?.prototype?.content;
  const testResults = selectedWorkflow?.data?.development?.report?.testResults || [];

  const canConfirm = useMemo(() => (
    selectedWorkflow?.status === 'waiting_confirm'
    && (selectedWorkflow.stage === 'requirement' || selectedWorkflow.stage === 'prototype')
  ), [selectedWorkflow]);

  const canSubmitFeedback = selectedWorkflow?.stage === 'uat' && selectedWorkflow.status === 'waiting_feedback';
  const canComplete = canSubmitFeedback;
  const canRetry = selectedWorkflow?.status === 'failed'
    && ['requirement', 'prototype', 'development'].includes(selectedWorkflow.stage);

  const handleCreateWorkflow = useCallback(async () => {
    if (!requirementText.trim()) {
      setError(t('deliveryWorkflow.errors.requirementRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.delivery.create({
        projectName: selectedProject.name,
        projectPath: selectedProjectPath,
        title: title.trim() || undefined,
        requirementText: requirementText.trim(),
      });
      const data = await parseJsonResponse(response);
      const workflow = data.workflow as DeliveryWorkflow;
      setTitle('');
      setRequirementText('');
      setSelectedWorkflowId(workflow.id);
      await refreshWorkflows(true);
      await refreshSelectedWorkflow(workflow.id);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('deliveryWorkflow.errors.createWorkflow'));
    } finally {
      setIsSubmitting(false);
    }
  }, [requirementText, refreshSelectedWorkflow, refreshWorkflows, selectedProject.name, selectedProjectPath, t, title]);

  const handleConfirm = useCallback(async () => {
    if (!selectedWorkflow) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.delivery.confirm(selectedWorkflow.id);
      await parseJsonResponse(response);
      await refreshWorkflows(true);
      await refreshSelectedWorkflow(selectedWorkflow.id);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('deliveryWorkflow.errors.confirmWorkflow'));
    } finally {
      setIsSubmitting(false);
    }
  }, [refreshSelectedWorkflow, refreshWorkflows, selectedWorkflow, t]);

  const handleSubmitFeedback = useCallback(async () => {
    if (!selectedWorkflow || !feedbackText.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.delivery.submitFeedback(selectedWorkflow.id, feedbackText.trim());
      await parseJsonResponse(response);
      setFeedbackText('');
      await refreshWorkflows(true);
      await refreshSelectedWorkflow(selectedWorkflow.id);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('deliveryWorkflow.errors.submitFeedback'));
    } finally {
      setIsSubmitting(false);
    }
  }, [feedbackText, refreshSelectedWorkflow, refreshWorkflows, selectedWorkflow, t]);

  const handleComplete = useCallback(async () => {
    if (!selectedWorkflow) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.delivery.complete(selectedWorkflow.id);
      await parseJsonResponse(response);
      await refreshWorkflows(true);
      await refreshSelectedWorkflow(selectedWorkflow.id);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('deliveryWorkflow.errors.completeWorkflow'));
    } finally {
      setIsSubmitting(false);
    }
  }, [refreshSelectedWorkflow, refreshWorkflows, selectedWorkflow, t]);

  const handleRetry = useCallback(async () => {
    if (!selectedWorkflow) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.delivery.retry(selectedWorkflow.id);
      await parseJsonResponse(response);
      await refreshWorkflows(true);
      await refreshSelectedWorkflow(selectedWorkflow.id);
      setError(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('deliveryWorkflow.errors.retryWorkflow'));
    } finally {
      setIsSubmitting(false);
    }
  }, [refreshSelectedWorkflow, refreshWorkflows, selectedWorkflow, t]);

  return (
    <div className="h-full overflow-auto bg-background px-4 py-4">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('deliveryWorkflow.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('deliveryWorkflow.description')}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
              onClick={() => void refreshWorkflows(true)}
              disabled={isLoadingList}
            >
              {t('buttons.refresh')}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
            <input
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
              placeholder={t('deliveryWorkflow.titlePlaceholder')}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <textarea
              className="min-h-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
              placeholder={t('deliveryWorkflow.requirementPlaceholder')}
              value={requirementText}
              onChange={(event) => setRequirementText(event.target.value)}
            />
            <button
              type="button"
              className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handleCreateWorkflow()}
              disabled={isSubmitting || !requirementText.trim()}
            >
              {isSubmitting ? t('deliveryWorkflow.starting') : t('buttons.create')}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="grid min-h-[560px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-xl border border-border/60 bg-card p-3">
            <div className="mb-3 text-sm font-medium text-foreground">{t('deliveryWorkflow.workflowsTitle')}</div>
            <div className="space-y-2">
              {isLoadingList && workflows.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  {t('deliveryWorkflow.loadingWorkflows')}
                </div>
              )}
              {!isLoadingList && workflows.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  {t('deliveryWorkflow.emptyWorkflows')}
                </div>
              )}
              {workflows.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  className={classNames(
                    'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                    selectedWorkflowId === workflow.id
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border/60 bg-background hover:bg-accent/60',
                  )}
                  onClick={() => setSelectedWorkflowId(workflow.id)}
                >
                  <div className="truncate text-sm font-medium text-foreground">
                    {workflow.title || workflow.latestSummary || t('deliveryWorkflow.untitledWorkflow')}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{getStageLabel(workflow.stage, t)}</span>
                    <span className={classNames('rounded-full px-2 py-0.5', getStatusTone(workflow.status))}>
                      {getStatusLabel(workflow.status, t)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-4">
            {!selectedWorkflow && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {isLoadingDetail ? t('deliveryWorkflow.loadingWorkflow') : t('deliveryWorkflow.selectWorkflow')}
              </div>
            )}

            {selectedWorkflow && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {selectedWorkflow.title || selectedWorkflow.latestSummary || t('deliveryWorkflow.untitledWorkflow')}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{getStageLabel(selectedWorkflow.stage, t)}</span>
                      <span className={classNames('rounded-full px-2 py-0.5', getStatusTone(selectedWorkflow.status))}>
                        {getStatusLabel(selectedWorkflow.status, t)}
                      </span>
                      <span>{t('deliveryWorkflow.updatedAt', { timestamp: formatTimestamp(selectedWorkflow.updatedAt, i18n.language) })}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canConfirm && (
                      <button
                        type="button"
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                        onClick={() => void handleConfirm()}
                        disabled={isSubmitting}
                      >
                        {t('buttons.confirm')}
                      </button>
                    )}
                    {canRetry && (
                      <button
                        type="button"
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                        onClick={() => void handleRetry()}
                        disabled={isSubmitting}
                      >
                        {t('buttons.retry')}
                      </button>
                    )}
                    {canComplete && (
                      <button
                        type="button"
                        className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-60"
                        onClick={() => void handleComplete()}
                        disabled={isSubmitting}
                      >
                        {t('deliveryWorkflow.markDelivered')}
                      </button>
                    )}
                  </div>
                </div>

                {selectedWorkflow.latestSummary && (
                  <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-foreground">
                    {selectedWorkflow.latestSummary}
                  </div>
                )}

                {selectedWorkflow.errorMessage && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {selectedWorkflow.errorMessage}
                  </div>
                )}

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="mb-2 text-sm font-medium text-foreground">{t('deliveryWorkflow.sections.requirement')}</div>
                      {requirementDetails ? (
                        <div className="space-y-2 text-sm text-foreground">
                          <div>{requirementDetails.summary}</div>
                          {Array.isArray(requirementDetails.acceptanceCriteria) && requirementDetails.acceptanceCriteria.length > 0 && (
                            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                              {requirementDetails.acceptanceCriteria.map((item: string) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">{t('deliveryWorkflow.emptyStates.requirement')}</div>
                      )}
                    </div>

                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="mb-2 text-sm font-medium text-foreground">{t('deliveryWorkflow.sections.prototype')}</div>
                      {prototypeDetails ? (
                        <div className="space-y-2 text-sm text-foreground">
                          <div>{prototypeDetails.summary}</div>
                          {Array.isArray(prototypeDetails.highlights) && prototypeDetails.highlights.length > 0 && (
                            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                              {prototypeDetails.highlights.map((item: string) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">{t('deliveryWorkflow.emptyStates.prototype')}</div>
                      )}
                    </div>

                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="mb-2 text-sm font-medium text-foreground">{t('deliveryWorkflow.sections.verification')}</div>
                      {testResults.length > 0 ? (
                        <div className="space-y-2">
                          {testResults.map((result: { name: string; status: string; details?: string }) => (
                            <div key={`${result.name}-${result.status}`} className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                              <div className="font-medium text-foreground">{result.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {result.status} {result.details ? `· ${result.details}` : ''}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">{t('deliveryWorkflow.emptyStates.verification')}</div>
                      )}
                    </div>

                    {canSubmitFeedback && (
                      <div className="rounded-lg border border-border/60 p-4">
                        <div className="mb-2 text-sm font-medium text-foreground">{t('deliveryWorkflow.sections.uatFeedback')}</div>
                        <textarea
                          className="min-h-28 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                          placeholder={t('deliveryWorkflow.uatFeedbackPlaceholder')}
                          value={feedbackText}
                          onChange={(event) => setFeedbackText(event.target.value)}
                        />
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                            onClick={() => void handleSubmitFeedback()}
                            disabled={isSubmitting || !feedbackText.trim()}
                          >
                            {t('buttons.submit')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="mb-2 text-sm font-medium text-foreground">{t('deliveryWorkflow.sections.links')}</div>
                      <WorkflowLinks workflow={selectedWorkflow} />
                    </div>

                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="mb-2 text-sm font-medium text-foreground">{t('deliveryWorkflow.sections.timeline')}</div>
                      <div className="space-y-2">
                        {(selectedWorkflow.events || []).length === 0 && (
                          <div className="text-sm text-muted-foreground">{t('deliveryWorkflow.noEvents')}</div>
                        )}
                        {(selectedWorkflow.events || []).map((event) => (
                          <div key={event.id} className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                            <div className="font-medium text-foreground">{getEventSummary(event, t)}</div>
                            <div className="text-xs text-muted-foreground">
                              {getStageLabel(event.stage, t)} · {formatTimestamp(event.createdAt, i18n.language)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-border/60 p-4">
                      <div className="mb-2 text-sm font-medium text-foreground">{t('deliveryWorkflow.sections.submittedFeedback')}</div>
                      <div className="space-y-2">
                        {(selectedWorkflow.feedback || []).length === 0 && (
                          <div className="text-sm text-muted-foreground">{t('deliveryWorkflow.noFeedback')}</div>
                        )}
                        {(selectedWorkflow.feedback || []).map((item) => (
                          <div key={item.id} className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                            <div className="text-foreground">{item.content}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{formatTimestamp(item.createdAt, i18n.language)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

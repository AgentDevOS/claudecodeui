import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionWorkflow } from '../../hooks/useWorkflowSessionState';

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

const stageTone: Record<string, string> = {
  requirement: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  prototype: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  development: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  uat: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
  delivery: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

type WorkflowStagePanelProps = {
  workflow: SessionWorkflow;
  isSubmitting?: boolean;
  onConfirm?: () => void;
  onComplete?: () => void;
};

type DevelopmentResultItem = {
  name: string;
  status: string;
  details: string;
};

function limitItems(items: unknown, max = 3) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function getRequirementDetails(workflow: SessionWorkflow) {
  const requirement = workflow.data?.requirement?.content;
  if (!requirement) {
    return null;
  }

  return {
    summary: String(requirement.summary || '').trim(),
    scope: limitItems(requirement.scope),
    acceptanceCriteria: limitItems(requirement.acceptanceCriteria),
  };
}

function getPrototypeDetails(workflow: SessionWorkflow) {
  const prototype = workflow.data?.prototype?.content;
  if (!prototype) {
    return null;
  }

  return {
    summary: String(prototype.summary || '').trim(),
    highlights: limitItems(prototype.highlights),
  };
}

function getDevelopmentDetails(workflow: SessionWorkflow) {
  const report = workflow.data?.development?.report;
  if (!report) {
    return null;
  }

  const testResults = Array.isArray(report.testResults) ? report.testResults : [];
  const previewUrl = typeof workflow.data?.uat?.previewUrl === 'string' ? workflow.data.uat.previewUrl.trim() : '';

  return {
    summary: String(report.summary || '').trim(),
    testResults: testResults.slice(0, 3).map((item: Record<string, unknown>): DevelopmentResultItem => ({
      name: String(item?.name || '').trim(),
      status: String(item?.status || '').trim(),
      details: String(item?.details || '').trim(),
    })).filter((item: DevelopmentResultItem) => item.name),
    previewUrl,
  };
}

function SummarySection({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="mt-1 space-y-1 text-sm text-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary/70" />
            <span className="min-w-0 flex-1">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function WorkflowStagePanel({
  workflow,
  isSubmitting = false,
  onConfirm,
  onComplete,
}: WorkflowStagePanelProps) {
  const { t } = useTranslation('chat');

  const stageLabel = useMemo(
    () => t(`workflowSession.stages.${workflow.stage}`, { defaultValue: workflow.stage }),
    [t, workflow.stage],
  );
  const statusLabel = useMemo(
    () => t(`workflowSession.statuses.${workflow.status}`, { defaultValue: workflow.status }),
    [t, workflow.status],
  );

  const isWaitingForConfirm = workflow.status === 'waiting_confirm' && (workflow.stage === 'requirement' || workflow.stage === 'prototype');
  const isWaitingForFeedback = workflow.stage === 'uat' && workflow.status === 'waiting_feedback';

  const summaryText = workflow.latestSummary?.trim() || workflow.errorMessage?.trim() || t('workflowSession.noSummary');
  const requirementDetails = useMemo(() => getRequirementDetails(workflow), [workflow]);
  const prototypeDetails = useMemo(() => getPrototypeDetails(workflow), [workflow]);
  const developmentDetails = useMemo(() => getDevelopmentDetails(workflow), [workflow]);
  const helperText = isWaitingForConfirm
    ? t('workflowSession.helpers.reviseCurrentStage')
    : isWaitingForFeedback
      ? t('workflowSession.helpers.submitUatFeedback')
      : workflow.status === 'running'
        ? t('workflowSession.helpers.running')
        : workflow.status === 'completed'
          ? t('workflowSession.helpers.completed')
          : t('workflowSession.helpers.inspect');

  return (
    <div className="mx-3 mb-3 rounded-2xl border border-border/70 bg-card/90 px-4 py-4 shadow-sm sm:mx-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={classNames('rounded-full px-2.5 py-1 text-xs font-medium', stageTone[workflow.stage] || 'bg-muted text-foreground')}>
              {stageLabel}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {statusLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('workflowSession.attempt', { count: workflow.stageAttempt })}
            </span>
          </div>

          <div className="text-sm font-medium text-foreground">
            {workflow.title || t('workflowSession.defaultTitle')}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {summaryText}
          </div>

          {workflow.stage === 'requirement' && requirementDetails && (
            <div className="mt-4 rounded-xl border border-border/60 bg-background/70 p-3">
              <div className="text-sm font-medium text-foreground">
                {t('workflowSession.cards.requirementTitle', { defaultValue: '需求概要' })}
              </div>
              {requirementDetails.summary && (
                <div className="mt-2 text-sm text-foreground">
                  {requirementDetails.summary}
                </div>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <SummarySection
                  title={t('workflowSession.cards.scope', { defaultValue: '范围' })}
                  items={requirementDetails.scope}
                />
                <SummarySection
                  title={t('workflowSession.cards.acceptanceCriteria', { defaultValue: '验收标准' })}
                  items={requirementDetails.acceptanceCriteria}
                />
              </div>
            </div>
          )}

          {workflow.stage === 'prototype' && prototypeDetails && (
            <div className="mt-4 rounded-xl border border-border/60 bg-background/70 p-3">
              <div className="text-sm font-medium text-foreground">
                {t('workflowSession.cards.prototypeTitle', { defaultValue: '原型概要' })}
              </div>
              {prototypeDetails.summary && (
                <div className="mt-2 text-sm text-foreground">
                  {prototypeDetails.summary}
                </div>
              )}
              <div className="mt-3">
                <SummarySection
                  title={t('workflowSession.cards.highlights', { defaultValue: '亮点' })}
                  items={prototypeDetails.highlights}
                />
              </div>
            </div>
          )}

          {workflow.stage === 'uat' && developmentDetails && (
            <div className="mt-4 rounded-xl border border-border/60 bg-background/70 p-3">
              <div className="text-sm font-medium text-foreground">
                {t('workflowSession.cards.uatTitle', { defaultValue: '交付概要' })}
              </div>
              {developmentDetails.summary && (
                <div className="mt-2 text-sm text-foreground">
                  {developmentDetails.summary}
                </div>
              )}
              {developmentDetails.testResults.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('workflowSession.cards.verification', { defaultValue: '验证结果' })}
                  </div>
                  <div className="mt-1 space-y-1 text-sm text-foreground">
                    {developmentDetails.testResults.map((item: DevelopmentResultItem) => (
                      <div key={`${item.name}-${item.status}`} className="rounded-lg bg-muted/60 px-2.5 py-2">
                        <span className="font-medium">{item.name}</span>
                        <span className="text-muted-foreground">
                          {` · ${item.status}${item.details ? ` · ${item.details}` : ''}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {developmentDetails.previewUrl && (
                <div className="mt-3 text-sm text-foreground">
                  <span className="font-medium">
                    {t('workflowSession.cards.preview', { defaultValue: '预览' })}
                  </span>
                  {`: ${developmentDetails.previewUrl}`}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 text-xs text-muted-foreground">
            {helperText}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isWaitingForConfirm && onConfirm && (
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? t('workflowSession.actions.processing') : t('workflowSession.actions.confirm')}
            </button>
          )}
          {isWaitingForFeedback && onComplete && (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onComplete}
              disabled={isSubmitting}
            >
              {isSubmitting ? t('workflowSession.actions.processing') : t('workflowSession.actions.markDelivered')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

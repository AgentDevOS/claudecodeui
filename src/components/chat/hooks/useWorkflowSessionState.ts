import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import type { Project, ProjectSession } from '../../../types/app';

type DeliveryWorkflowUpdateMessage = {
  type?: string;
  projectName?: string;
  workflowId?: string;
  activeSessionId?: string | null;
  eventType?: string;
};

export interface WorkflowFeedbackItem {
  id: number;
  stage?: string;
  content: string;
  resolvedInAttempt?: number | null;
  createdAt: string;
}

export interface WorkflowEventItem {
  id: number;
  stage?: string;
  eventType?: string;
  summary?: string | null;
  payload?: Record<string, any>;
  createdAt: string;
}

export interface SessionWorkflow {
  id: string;
  title?: string | null;
  requirementText: string;
  stage: string;
  status: string;
  stageAttempt: number;
  activeSessionId?: string | null;
  latestSummary?: string | null;
  errorMessage?: string | null;
  updatedAt?: string;
  createdAt?: string;
  data?: Record<string, any>;
  feedback?: WorkflowFeedbackItem[];
  events?: WorkflowEventItem[];
}

async function parseWorkflowResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Failed to load workflow (${response.status})`;
    throw new Error(message);
  }
  return data.workflow as SessionWorkflow;
}

async function parseWorkflowListResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Failed to load workflows (${response.status})`;
    throw new Error(message);
  }

  return Array.isArray(data?.workflows) ? (data.workflows as SessionWorkflow[]) : [];
}

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getSessionLabel(session: ProjectSession | null) {
  if (!session) {
    return '';
  }

  return normalizeText(session.summary || session.name || session.title || '');
}

function getWorkflowSessionIds(workflow: SessionWorkflow) {
  const sessionIds = Array.isArray(workflow.data?.sessionIds) ? workflow.data.sessionIds : [];
  return sessionIds
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function matchesWorkflowSessionLabel(workflow: SessionWorkflow, sessionLabel: string) {
  if (!sessionLabel) {
    return false;
  }

  const candidates = [
    workflow.title,
    workflow.latestSummary,
    workflow.requirementText,
    workflow.data?.requirement?.content?.title,
  ]
    .map(normalizeText)
    .filter(Boolean);

  return candidates.some((candidate) => (
    sessionLabel.includes(candidate) || candidate.includes(sessionLabel)
  ));
}

function findWorkflowForSession(
  workflows: SessionWorkflow[],
  selectedSession: ProjectSession | null,
  trackedWorkflowId?: string | null,
) {
  if (trackedWorkflowId) {
    const tracked = workflows.find((workflow) => workflow.id === trackedWorkflowId);
    if (tracked) {
      return tracked;
    }
  }

  const sessionId = String(selectedSession?.id || '').trim();
  const sessionLabel = getSessionLabel(selectedSession);

  if (sessionId) {
    const directMatch = workflows.find((workflow) => workflow.activeSessionId === sessionId);
    if (directMatch) {
      return directMatch;
    }

    const historyMatch = workflows.find((workflow) => getWorkflowSessionIds(workflow).includes(sessionId));
    if (historyMatch) {
      return historyMatch;
    }
  }

  if (sessionLabel) {
    const labelMatch = workflows.find((workflow) => matchesWorkflowSessionLabel(workflow, sessionLabel));
    if (labelMatch) {
      return labelMatch;
    }
  }

  if (workflows.length === 1) {
    return workflows[0];
  }

  const activeWorkflows = workflows.filter((workflow) => workflow.status !== 'completed');
  if (activeWorkflows.length === 1) {
    return activeWorkflows[0];
  }

  return null;
}

export function useWorkflowSessionState({
  selectedProject,
  selectedSession,
  latestMessage,
  trackedWorkflowId = null,
}: {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  latestMessage: unknown;
  trackedWorkflowId?: string | null;
}) {
  const [workflow, setWorkflow] = useState<SessionWorkflow | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshWorkflow = useCallback(async () => {
    if (!selectedProject?.name && !selectedSession?.id && !trackedWorkflowId) {
      setWorkflow(null);
      return null;
    }

    setIsLoading(true);
    try {
      if (selectedSession?.id) {
        const response = await api.delivery.getBySession(selectedSession.id);
        if (response.status !== 404) {
          const nextWorkflow = await parseWorkflowResponse(response);
          setWorkflow(nextWorkflow);
          return nextWorkflow;
        }
      }

      if (trackedWorkflowId) {
        const trackedResponse = await api.delivery.get(trackedWorkflowId);
        if (trackedResponse.status !== 404) {
          const trackedWorkflow = await parseWorkflowResponse(trackedResponse);
          setWorkflow(trackedWorkflow);
          return trackedWorkflow;
        }
      }

      if (selectedProject?.name) {
        const listResponse = await api.delivery.list(selectedProject.name);
        const workflows = await parseWorkflowListResponse(listResponse);
        const matchedWorkflow = findWorkflowForSession(workflows, selectedSession, trackedWorkflowId);
        setWorkflow(matchedWorkflow);
        return matchedWorkflow;
      }

      setWorkflow(null);
      return null;
    } catch (error) {
      console.error('Failed to load workflow for session:', error);
      setWorkflow(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject?.name, selectedSession, trackedWorkflowId]);

  useEffect(() => {
    void refreshWorkflow();
  }, [refreshWorkflow]);

  useEffect(() => {
    const message = latestMessage as DeliveryWorkflowUpdateMessage | null;
    if (!message || message.type !== 'delivery-workflow-updated') {
      return;
    }

    if (selectedProject?.name && message.projectName && message.projectName !== selectedProject.name) {
      return;
    }

    if (
      (trackedWorkflowId && message.workflowId === trackedWorkflowId)
      || (workflow?.id && message.workflowId === workflow.id)
      || (selectedSession?.id && message.activeSessionId === selectedSession.id)
    ) {
      void refreshWorkflow();
    }
  }, [latestMessage, refreshWorkflow, selectedProject?.name, selectedSession?.id, trackedWorkflowId, workflow?.id]);

  return {
    workflow,
    isLoading,
    refreshWorkflow,
  };
}

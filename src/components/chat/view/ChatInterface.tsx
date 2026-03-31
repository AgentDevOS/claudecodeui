import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { api } from '../../../utils/api';
import { QuickSettingsPanel } from '../../quick-settings-panel';
import type { ChatInterfaceProps } from '../types/types';
import type { SessionProvider } from '../../../types/app';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useWorkflowSessionState } from '../hooks/useWorkflowSessionState';
import { useSessionStore } from '../../../stores/useSessionStore';
import { buildWorkflowChatMessages } from '../utils/workflowMessages';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import WorkflowStagePanel from './subcomponents/WorkflowStagePanel';


type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  latestMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  onShowAllTasks,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { t, i18n } = useTranslation('chat');
  const [trackedWorkflowId, setTrackedWorkflowId] = useState<string | null>(null);
  const [isWorkflowTrackingPending, setIsWorkflowTrackingPending] = useState(false);
  const [workflowTrackingOriginSessionId, setWorkflowTrackingOriginSessionId] = useState<string | null>(null);
  const [isWorkflowActionSubmitting, setIsWorkflowActionSubmitting] = useState(false);
  const [pendingWorkflowSessionId, setPendingWorkflowSessionId] = useState<string | null>(null);

  const sessionStore = useSessionStore();
  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
    accumulatedStreamRef.current = '';
  }, []);

  const {
    provider,
    cursorModel,
    claudeModel,
    codexModel,
    geminiModel,
    pendingPermissionRequests,
    setPendingPermissionRequests,
  } = useChatProviderState({
    selectedSession,
  });

  const {
    chatMessages,
    addMessage,
    clearMessages,
    rewindMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
    sessionStore,
  });

  const {
    workflow: sessionWorkflow,
    refreshWorkflow,
  } = useWorkflowSessionState({
    selectedProject,
    selectedSession,
    latestMessage,
    trackedWorkflowId,
  });

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    renderInputWithMentions,
    attachedImages,
    setAttachedImages,
    uploadingImages,
    imageErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openImagePicker,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    sessionWorkflow,
    currentSessionId,
    provider,
    cursorModel,
    claudeModel,
    codexModel,
    geminiModel,
    isLoading,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    onTrackWorkflow: setTrackedWorkflowId,
    onSetWorkflowTrackingPending: setIsWorkflowTrackingPending,
    pendingViewSessionRef,
    scrollToBottom,
    addMessage,
    clearMessages,
    rewindMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
  });

  const parseWorkflowMutation = useCallback(async (response: Response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Workflow request failed (${response.status})`);
    }
    return data.workflow;
  }, []);

  const handleWorkflowConfirm = useCallback(async () => {
    if (!sessionWorkflow) {
      return;
    }

    setWorkflowTrackingOriginSessionId(selectedSession?.id || null);
    setTrackedWorkflowId(sessionWorkflow.id);
    setIsWorkflowTrackingPending(true);
    setIsWorkflowActionSubmitting(true);
    try {
      const response = await api.delivery.confirm(sessionWorkflow.id);
      await parseWorkflowMutation(response);
      setTrackedWorkflowId(sessionWorkflow.id);
      await refreshWorkflow();
    } catch (error) {
      console.error('Failed to confirm workflow stage:', error);
      setIsWorkflowTrackingPending(false);
      addMessage({
        type: 'error',
        content: error instanceof Error ? error.message : 'Failed to confirm workflow stage',
        timestamp: new Date(),
      });
    } finally {
      setIsWorkflowActionSubmitting(false);
    }
  }, [addMessage, parseWorkflowMutation, refreshWorkflow, selectedSession?.id, sessionWorkflow]);

  const handleWorkflowComplete = useCallback(async () => {
    if (!sessionWorkflow) {
      return;
    }

    setWorkflowTrackingOriginSessionId(selectedSession?.id || null);
    setTrackedWorkflowId(sessionWorkflow.id);
    setIsWorkflowTrackingPending(true);
    setIsWorkflowActionSubmitting(true);
    try {
      const response = await api.delivery.complete(sessionWorkflow.id);
      await parseWorkflowMutation(response);
      await refreshWorkflow();
    } catch (error) {
      console.error('Failed to complete workflow:', error);
      setIsWorkflowTrackingPending(false);
      addMessage({
        type: 'error',
        content: error instanceof Error ? error.message : 'Failed to complete workflow',
        timestamp: new Date(),
      });
    } finally {
      setIsWorkflowActionSubmitting(false);
    }
  }, [addMessage, parseWorkflowMutation, refreshWorkflow, selectedSession?.id, sessionWorkflow]);

  // On WebSocket reconnect, re-fetch the current session's messages from the server
  // so missed streaming events are shown. Also reset isLoading.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    const providerVal = (localStorage.getItem('selected-provider') as SessionProvider) || 'codex';
    await sessionStore.refreshFromServer(selectedSession.id, {
      provider: (selectedSession.__provider || providerVal) as SessionProvider,
      projectName: selectedProject.name,
      projectPath: selectedProject.fullPath || selectedProject.path || '',
    });
    setIsLoading(false);
    setCanAbortSession(false);
  }, [selectedProject, selectedSession, sessionStore, setIsLoading, setCanAbortSession]);

  const handleNavigateToSession = useCallback((sessionId: string) => {
    if (trackedWorkflowId || isWorkflowTrackingPending) {
      setPendingWorkflowSessionId(sessionId);
      return;
    }

    onNavigateToSession?.(sessionId);
  }, [isWorkflowTrackingPending, onNavigateToSession, trackedWorkflowId]);

  useChatRealtimeHandlers({
    latestMessage,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setPendingPermissionRequests,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    accumulatedStreamRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession: handleNavigateToSession,
    onWebSocketReconnect: handleWebSocketReconnect,
    sessionStore,
  });

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  useEffect(() => {
    const message = latestMessage as {
      type?: string;
      projectName?: string;
      workflowId?: string;
      activeSessionId?: string;
      eventType?: string;
    } | null;

    if (!message || message.type !== 'delivery-workflow-updated') {
      return;
    }

    if (selectedProject?.name && message.projectName && message.projectName !== selectedProject.name) {
      return;
    }

    if (!trackedWorkflowId || message.workflowId !== trackedWorkflowId) {
      return;
    }

    if (message.eventType !== 'session_attached' || !message.activeSessionId) {
      return;
    }

    const navigateToTrackedSession = async () => {
      try {
        await window.refreshProjects?.();
      } finally {
        setPendingWorkflowSessionId(message.activeSessionId as string);
        setTrackedWorkflowId(null);
        setIsWorkflowTrackingPending(false);
      }
    };

    void navigateToTrackedSession();
  }, [latestMessage, selectedProject?.name, trackedWorkflowId]);

  useEffect(() => {
    if (sessionWorkflow && pendingWorkflowSessionId && selectedSession?.id === pendingWorkflowSessionId) {
      setPendingWorkflowSessionId(null);
    }
  }, [pendingWorkflowSessionId, selectedSession?.id, sessionWorkflow]);

  useEffect(() => {
    if (!sessionWorkflow) {
      return;
    }

    if (trackedWorkflowId && sessionWorkflow.id !== trackedWorkflowId) {
      return;
    }

    if (sessionWorkflow.status !== 'running') {
      setIsWorkflowTrackingPending(false);
    }
  }, [sessionWorkflow, trackedWorkflowId]);

  useEffect(() => {
    if (!isWorkflowTrackingPending || workflowTrackingOriginSessionId || !selectedSession?.id) {
      return;
    }

    setWorkflowTrackingOriginSessionId(selectedSession.id);
  }, [isWorkflowTrackingPending, selectedSession?.id, workflowTrackingOriginSessionId]);

  useEffect(() => {
    if (!trackedWorkflowId || isWorkflowTrackingPending || !workflowTrackingOriginSessionId || !selectedSession?.id) {
      return;
    }

    if (selectedSession.id === workflowTrackingOriginSessionId) {
      return;
    }

    setTrackedWorkflowId(null);
    setPendingWorkflowSessionId(null);
    setWorkflowTrackingOriginSessionId(null);
  }, [isWorkflowTrackingPending, selectedSession?.id, trackedWorkflowId, workflowTrackingOriginSessionId]);

  const workflowInputPlaceholder = sessionWorkflow?.status === 'waiting_confirm' && sessionWorkflow.stage === 'requirement'
    ? t('workflowSession.placeholders.requirement')
    : sessionWorkflow?.status === 'waiting_confirm' && sessionWorkflow.stage === 'prototype'
      ? t('workflowSession.placeholders.prototype')
      : sessionWorkflow?.stage === 'uat' && sessionWorkflow.status === 'waiting_feedback'
        ? t('workflowSession.placeholders.uat')
        : '';

  const workflowChatMessages = useMemo(
    () => (sessionWorkflow ? buildWorkflowChatMessages(sessionWorkflow, i18n.language) : []),
    [i18n.language, sessionWorkflow],
  );
  const isHoldingWorkflowSession = Boolean(
    pendingWorkflowSessionId
    && selectedSession?.id
    && selectedSession.id === pendingWorkflowSessionId
    && !sessionWorkflow,
  );
  const holdingWorkflowMessages = useMemo(() => (
    isHoldingWorkflowSession
      ? [{
          type: 'assistant',
          content: t('workflowSession.progress.creating'),
          timestamp: new Date(),
          isTaskNotification: true,
          taskStatus: 'running',
        }]
      : []
  ), [isHoldingWorkflowSession, t]);
  const isWorkflowMessageView = workflowChatMessages.length > 0;
  const displayedChatMessages = isWorkflowMessageView
    ? workflowChatMessages
    : isHoldingWorkflowSession
      ? holdingWorkflowMessages
      : chatMessages;
  const displayedVisibleMessages = isWorkflowMessageView
    ? workflowChatMessages
    : isHoldingWorkflowSession
      ? holdingWorkflowMessages
      : visibleMessages;
  const displayedIsLoadingSessionMessages = isWorkflowMessageView || isHoldingWorkflowSession ? false : isLoadingSessionMessages;
  const displayedIsLoading = isWorkflowMessageView ? false : isLoading;
  const displayedHasMoreMessages = isWorkflowMessageView || isHoldingWorkflowSession ? false : hasMoreMessages;
  const displayedTotalMessages = isWorkflowMessageView
    ? workflowChatMessages.length
    : isHoldingWorkflowSession
      ? holdingWorkflowMessages.length
      : totalMessages;
  const displayedVisibleMessageCount = isWorkflowMessageView
    ? workflowChatMessages.length
    : isHoldingWorkflowSession
      ? holdingWorkflowMessages.length
      : visibleMessageCount;
  const displayedAllMessagesLoaded = isWorkflowMessageView || isHoldingWorkflowSession ? false : allMessagesLoaded;
  const displayedIsLoadingAllMessages = isWorkflowMessageView || isHoldingWorkflowSession ? false : isLoadingAllMessages;
  const displayedLoadAllJustFinished = isWorkflowMessageView || isHoldingWorkflowSession ? false : loadAllJustFinished;
  const displayedShowLoadAllOverlay = isWorkflowMessageView || isHoldingWorkflowSession ? false : showLoadAllOverlay;

  if (!selectedProject) {
    const selectedProviderLabel =
      provider === 'cursor'
        ? t('messageTypes.cursor')
        : provider === 'codex'
          ? t('messageTypes.codex')
          : provider === 'gemini'
            ? t('messageTypes.gemini')
            : t('messageTypes.claude');

    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col">
        {sessionWorkflow && (
          <WorkflowStagePanel
            workflow={sessionWorkflow}
            isSubmitting={isWorkflowActionSubmitting}
            onConfirm={handleWorkflowConfirm}
            onComplete={handleWorkflowComplete}
          />
        )}

        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleScroll}
          onTouchMove={handleScroll}
          isLoadingSessionMessages={displayedIsLoadingSessionMessages}
          chatMessages={displayedChatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          claudeModel={claudeModel}
          cursorModel={cursorModel}
          codexModel={codexModel}
          geminiModel={geminiModel}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
          isLoadingMoreMessages={isWorkflowMessageView ? false : isLoadingMoreMessages}
          hasMoreMessages={displayedHasMoreMessages}
          totalMessages={displayedTotalMessages}
          sessionMessagesCount={displayedChatMessages.length}
          visibleMessageCount={displayedVisibleMessageCount}
          visibleMessages={displayedVisibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={displayedAllMessagesLoaded}
          isLoadingAllMessages={displayedIsLoadingAllMessages}
          loadAllJustFinished={displayedLoadAllJustFinished}
          showLoadAllOverlay={displayedShowLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          onGrantToolPermission={handleGrantToolPermission}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
          isLoading={displayedIsLoading}
        />

        <ChatComposer
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          claudeStatus={claudeStatus}
          isLoading={isLoading}
          onAbortSession={handleAbortSession}
          provider={provider}
          tokenBudget={tokenBudget}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          isUserScrolledUp={isUserScrolledUp}
          hasMessages={displayedChatMessages.length > 0}
          onScrollToBottom={scrollToBottomAndReset}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedImages={attachedImages}
          onRemoveImage={(index) =>
            setAttachedImages((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingImages={uploadingImages}
          imageErrors={imageErrors}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openImagePicker={openImagePicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          isInputFocused={isInputFocused}
          placeholder={workflowInputPlaceholder}
          isTextareaExpanded={isTextareaExpanded}
          onTranscript={handleTranscript}
        />
      </div>

      <QuickSettingsPanel />
    </>
  );
}

export default React.memo(ChatInterface);

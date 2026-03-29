import React from 'react';
import { useTranslation } from 'react-i18next';
import TokenUsagePie from './TokenUsagePie';

interface ChatInputControlsProps {
  tokenBudget: { used?: number; total?: number } | null;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
}

export default function ChatInputControls({
  tokenBudget,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
      <TokenUsagePie used={tokenBudget?.used || 0} total={tokenBudget?.total || parseInt(import.meta.env.VITE_CONTEXT_WINDOW) || 160000} />

      {hasInput && (
        <button
          type="button"
          onClick={onClearInput}
          className="group flex h-7 w-7 items-center justify-center rounded-lg border border-border/50 bg-card shadow-sm transition-all duration-200 hover:bg-accent/60 sm:h-8 sm:w-8"
          title={t('input.clearInput', { defaultValue: 'Clear input' })}
        >
          <svg
            className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground sm:h-4 sm:w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {isUserScrolledUp && hasMessages && (
        <button
          onClick={onScrollToBottom}
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-all duration-200 hover:scale-105 hover:bg-primary/90 sm:h-8 sm:w-8"
          title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
        >
          <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
}

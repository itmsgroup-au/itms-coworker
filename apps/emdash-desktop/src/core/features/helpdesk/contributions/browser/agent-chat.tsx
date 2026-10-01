/**
 * TicketAgentChat — a live, two-way ACP chat with the agent working a ticket,
 * rendered inside the narrow Helpdesk detail pane.
 *
 * It does not use AcpChatPanel: that component reads its store out of the
 * workbench pane context (usePaneContext + an acp-chat tab resource), so it can
 * only render inside a task pane, and it drags in the full task composer
 * (model/effort/mode pickers, mentions, attachments, slash commands) which does
 * not fit 460px. Instead this mounts the same machinery one level down —
 * ChatTranscript over a real AcpChatStore — plus a minimal composer.
 *
 * The store attaches to the ACP session directly (AcpLiveSession.create), so the
 * transcript loads without the user ever having opened the task view. The
 * conversation id is read from the wire (conversations.getConversationsForTask)
 * rather than from the browser-side conversation registry, which is only
 * populated once a task scope exists.
 */

import type { TranscriptItem } from '@emdash/chat-ui';
import { Button } from '@emdash/ui/react/primitives';
import { observer, useObserver } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import {
  getAcpChatResourceManager,
  type AcpChatStore,
} from '@core/features/conversations/api/browser/acp-chat-access';
import { ChatTranscript } from '@core/features/conversations/api/browser/chat/chat-transcript';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';
import { log } from '@core/primitives/logging/browser/logger';
import { cn } from '@core/primitives/styling/browser/cn';

type Resolution =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; conversationId: string };

/**
 * Find the ACP conversation for a task. Prefers the most recently used one and
 * ignores PTY/TUI conversations, which this panel cannot drive.
 */
function useTicketConversationId(projectId: string, taskId: string): Resolution {
  const [resolution, setResolution] = useState<Resolution>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setResolution({ kind: 'loading' });
    void (async () => {
      try {
        const client = await getConversationsClient();
        const conversations = await client.getConversationsForTask({ projectId, taskId });
        if (cancelled) return;
        const acp = conversations
          .filter((conversation) => (conversation.type ?? 'pty') === 'acp')
          .sort((a, b) => (a.lastInteractedAt ?? '').localeCompare(b.lastInteractedAt ?? ''));
        const chosen = acp.at(-1);
        setResolution(chosen ? { kind: 'ready', conversationId: chosen.id } : { kind: 'none' });
      } catch (error) {
        if (cancelled) return;
        log.warn('Failed to resolve the helpdesk agent conversation', { taskId, error });
        setResolution({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId]);

  return resolution;
}

/** Ref-counted acquire of the shared per-conversation chat store. */
function useAcpChatStore(
  projectId: string,
  taskId: string,
  conversationId: string | null
): AcpChatStore | null {
  const [store, setStore] = useState<AcpChatStore | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setStore(null);
      return;
    }
    const manager = getAcpChatResourceManager(taskId, projectId);
    const acquired = manager.acquire(conversationId);
    acquired.bootstrap();
    setStore(acquired);
    return () => {
      manager.release(conversationId);
      setStore(null);
    };
  }, [projectId, taskId, conversationId]);

  return store;
}

/** The agent's most recent assistant message, read from the live transcript. */
export function lastAssistantText(store: AcpChatStore | null): string {
  if (!store) return '';
  const state = store.chatState.transcript.state;
  const turns = [
    ...state.committedTurns,
    ...(state.activeTurnSnapshot ? [state.activeTurnSnapshot] : []),
  ];
  let text = '';
  for (const turn of turns) {
    for (const item of turn.items) {
      if (isAssistantMessage(item) && item.text.trim()) text = item.text;
    }
  }
  return text;
}

type TranscriptMessage = Extract<TranscriptItem, { kind: 'message' }>;

function isAssistantMessage(item: TranscriptItem): item is TranscriptMessage {
  return item.kind === 'message' && item.role === 'assistant';
}

// ── Composer ──────────────────────────────────────────────────────────────────

const TicketChatComposer = observer(function TicketChatComposer({
  store,
}: {
  store: AcpChatStore;
}) {
  const { isWorking, canSubmit, canCancel } = store.affordances;
  const permission = store.permissionQueue[0];
  const queued = store.queuedPrompts;

  const submit = useCallback(() => {
    const text = store.draftText.trim();
    if (!text) return;
    store.submitPrompt(text);
  }, [store]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
      event.preventDefault();
      submit();
    },
    [submit]
  );

  return (
    <div className="shrink-0 border-t border-border bg-background px-3 py-2">
      {permission && (
        <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5">
          <div className="mb-1 text-[11px] text-foreground-muted">
            The agent needs permission
            {store.permissionQueue.length > 1 && ` (${store.permissionQueue.length} waiting)`}
          </div>
          <div className="mb-1.5 text-xs break-words">{permission.title}</div>
          <div className="flex flex-wrap gap-1">
            {permission.options.map((option) => (
              <Button
                key={option.optionId}
                size="sm"
                variant={option.kind.startsWith('allow') ? 'primary' : 'secondary'}
                onClick={() => store.resolvePermission(option.optionId)}
              >
                {option.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {queued.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {queued.map((prompt) => (
            <div
              key={prompt.id}
              className="flex items-center gap-1 rounded-md border border-border bg-background-secondary/40 px-2 py-1 text-[11px]"
            >
              <span className="min-w-0 flex-1 truncate text-foreground-muted" title={prompt.text}>
                Queued: {prompt.text}
              </span>
              <button
                type="button"
                className="shrink-0 text-foreground-muted hover:text-foreground"
                onClick={() => store.deleteQueuedPrompt(prompt.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {store.loadError && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1 text-[11px]">
          <span className="min-w-0 flex-1 break-words text-red-600">{store.loadError.message}</span>
          <Button size="sm" variant="secondary" onClick={() => store.retry()}>
            Retry
          </Button>
        </div>
      )}

      <textarea
        value={store.draftText}
        onChange={(event) => store.setDraftText(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        placeholder={
          isWorking ? 'The agent is working — your message will be queued…' : 'Ask the agent…'
        }
        className="focus-visible:ring-accent w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus-visible:ring-1"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-foreground-muted">
          Enter sends · Shift+Enter for a new line
        </span>
        <div className="flex shrink-0 gap-1">
          {isWorking && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!canCancel}
              onClick={() => store.stop()}
            >
              Stop
            </Button>
          )}
          <Button size="sm" onClick={submit} disabled={!canSubmit || !store.draftText.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
});

// ── Panel ─────────────────────────────────────────────────────────────────────

export const TicketAgentChat = observer(function TicketAgentChat({
  projectId,
  taskId,
  className,
  onStoreChange,
}: {
  projectId: string;
  taskId: string;
  className?: string;
  /** Lets the parent read the live transcript (for the "add a note" prefill). */
  onStoreChange?: (store: AcpChatStore | null) => void;
}) {
  const resolution = useTicketConversationId(projectId, taskId);
  const conversationId = resolution.kind === 'ready' ? resolution.conversationId : null;
  const store = useAcpChatStore(projectId, taskId, conversationId);

  useEffect(() => {
    onStoreChange?.(store);
  }, [store, onStoreChange]);

  const historyLoading = useObserver(() => store?.historyLoading ?? false);
  const hasSession = useObserver(() => store?.session !== null && store?.session !== undefined);
  const loadError = useObserver(() => store?.loadError ?? null);

  if (resolution.kind === 'loading' || (store !== null && historyLoading)) {
    return <Placeholder className={className}>Connecting to the agent…</Placeholder>;
  }
  if (resolution.kind === 'error') {
    return (
      <Placeholder className={className} tone="error">
        <span className="break-words">
          Could not find the agent&apos;s conversation: {resolution.message}
        </span>
      </Placeholder>
    );
  }
  if (resolution.kind === 'none') {
    return (
      <Placeholder className={className}>
        The agent has not started a chat session for this ticket yet.
      </Placeholder>
    );
  }
  if (!store) {
    return <Placeholder className={className}>Connecting to the agent…</Placeholder>;
  }
  if (!hasSession) {
    return (
      <Placeholder className={className} tone={loadError ? 'error' : 'muted'}>
        <span className="break-words">
          {loadError ? loadError.message : 'The agent session is not running.'}
        </span>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => store.retry()}>
          Retry
        </Button>
      </Placeholder>
    );
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="surface-paper relative min-h-0 flex-1 overflow-hidden bg-(--em-surface)">
        <ChatTranscript
          context={store.chatContext}
          state={store.chatState}
          composer="none"
          stickToBottom
          style={{ position: 'absolute', inset: 0 }}
        />
      </div>
      <TicketChatComposer store={store} />
    </div>
  );
});

function Placeholder({
  children,
  className,
  tone = 'muted',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'muted' | 'error';
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-start px-4 py-3 text-xs',
        tone === 'error' ? 'text-red-600' : 'text-foreground-muted',
        className
      )}
    >
      {children}
    </div>
  );
}

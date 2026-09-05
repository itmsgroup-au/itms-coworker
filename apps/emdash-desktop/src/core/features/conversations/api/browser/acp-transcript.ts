import { acpChatRegistry } from '@core/features/conversations/browser/acp/acp-chat-registry';

export type TranscriptStep = { id: string; title: string; status: 'running' | 'done' | 'error' };

export type TaskTranscriptSummary = {
  steps: TranscriptStep[];
  lastAssistantText: string;
  turnStatus: 'generating' | 'cancelled' | 'done' | null;
  /** False until a chat panel for the task has loaded its transcript. */
  available: boolean;
};

export const EMPTY_TRANSCRIPT_SUMMARY: TaskTranscriptSummary = {
  steps: [],
  lastAssistantText: '',
  turnStatus: null,
  available: false,
};

type AnyItem = {
  kind?: string;
  id?: string;
  role?: string;
  text?: string;
  title?: string;
  status?: string;
  children?: AnyItem[];
};

function collectSteps(items: readonly AnyItem[], out: TranscriptStep[]): void {
  for (const item of items) {
    if (!item.kind) continue;
    if (item.kind === 'tool-group') {
      collectSteps(item.children ?? [], out);
      continue;
    }
    if (item.kind.endsWith('-tool-call')) {
      const status = item.status === 'running' || item.status === 'error' ? item.status : 'done';
      out.push({ id: item.id ?? String(out.length), title: item.title ?? item.kind, status });
      if (item.children?.length) collectSteps(item.children, out);
    }
  }
}

/**
 * A flat reading of a task's ACP transcript(s): every tool call as a step,
 * the last assistant message, and whether a turn is still generating. The
 * transcript is signal-backed rather than MobX, so callers poll this.
 */
export function readTaskTranscript(taskId: string): TaskTranscriptSummary {
  const stores = acpChatRegistry.getAll(taskId);
  if (!stores || stores.size === 0) return EMPTY_TRANSCRIPT_SUMMARY;
  const steps: TranscriptStep[] = [];
  let lastAssistantText = '';
  let turnStatus: TaskTranscriptSummary['turnStatus'] = null;
  for (const store of stores.values()) {
    const state = store.chatState.transcript.state as {
      committedTurns: readonly { items: readonly AnyItem[] }[];
      activeTurnSnapshot: { items: readonly AnyItem[] } | null;
      turnStatus: 'generating' | 'cancelled' | 'done';
    };
    const turns = [
      ...state.committedTurns,
      ...(state.activeTurnSnapshot ? [state.activeTurnSnapshot] : []),
    ];
    for (const turn of turns) {
      collectSteps(turn.items, steps);
      for (const item of turn.items) {
        if (item.kind === 'message' && item.role === 'assistant' && item.text?.trim()) {
          lastAssistantText = item.text;
        }
      }
    }
    turnStatus = state.turnStatus;
  }
  return { steps, lastAssistantText, turnStatus, available: true };
}

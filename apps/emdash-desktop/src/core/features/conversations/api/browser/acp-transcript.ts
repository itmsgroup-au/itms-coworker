import { acpChatRegistry } from '@core/features/conversations/browser/acp/acp-chat-registry';

export type TranscriptStep = { id: string; title: string; status: 'running' | 'done' | 'error' };

export type TaskTranscriptSummary = {
  steps: TranscriptStep[];
  lastAssistantText: string;
  turnStatus: 'generating' | 'cancelled' | 'done' | null;
  /** False until a transcript for the task could be read at all. */
  available: boolean;
  /**
   * True when the task's ACP sessions are all suspended, so earlier turns
   * cannot be replayed without waking the agent.
   */
  suspended: boolean;
};

export const EMPTY_TRANSCRIPT_SUMMARY: TaskTranscriptSummary = {
  steps: [],
  lastAssistantText: '',
  turnStatus: null,
  available: false,
  suspended: false,
};

/**
 * The shape both transcript sources share: the renderer chat store's rendered
 * items and the ACP runtime's `transcriptTurnSchema` items use the same
 * `kind` / `id` / `title` / `status` / `role` / `text` fields.
 */
export type TranscriptLikeItem = {
  kind?: string;
  id?: string;
  role?: string;
  text?: string;
  title?: string;
  status?: string;
  children?: TranscriptLikeItem[];
};

export type TranscriptLikeTurn = { items: readonly TranscriptLikeItem[] };

function collectSteps(items: readonly TranscriptLikeItem[], out: TranscriptStep[]): void {
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

/** Every tool call in order, plus the last assistant message across the turns. */
export function summarizeTranscriptTurns(turns: readonly TranscriptLikeTurn[]): {
  steps: TranscriptStep[];
  lastAssistantText: string;
} {
  const steps: TranscriptStep[] = [];
  let lastAssistantText = '';
  for (const turn of turns) {
    collectSteps(turn.items, steps);
    for (const item of turn.items) {
      if (item.kind === 'message' && item.role === 'assistant' && item.text?.trim()) {
        lastAssistantText = item.text;
      }
    }
  }
  return { steps, lastAssistantText };
}

/**
 * A flat reading of a task's ACP transcript(s) from the renderer chat stores.
 * Only populated once a chat panel for the task has mounted; the helpdesk
 * progress view reads the ACP live models instead (see
 * `@core/features/helpdesk/api/browser/agent-progress-source`).
 */
export function readTaskTranscript(taskId: string): TaskTranscriptSummary {
  const stores = acpChatRegistry.getAll(taskId);
  if (!stores || stores.size === 0) return EMPTY_TRANSCRIPT_SUMMARY;
  const steps: TranscriptStep[] = [];
  let lastAssistantText = '';
  let turnStatus: TaskTranscriptSummary['turnStatus'] = null;
  for (const store of stores.values()) {
    const state = store.chatState.transcript.state as {
      committedTurns: readonly TranscriptLikeTurn[];
      activeTurnSnapshot: TranscriptLikeTurn | null;
      turnStatus: 'generating' | 'cancelled' | 'done';
    };
    const turns = [
      ...state.committedTurns,
      ...(state.activeTurnSnapshot ? [state.activeTurnSnapshot] : []),
    ];
    const summary = summarizeTranscriptTurns(turns);
    steps.push(...summary.steps);
    if (summary.lastAssistantText) lastAssistantText = summary.lastAssistantText;
    turnStatus = state.turnStatus;
  }
  return { steps, lastAssistantText, turnStatus, available: true, suspended: false };
}

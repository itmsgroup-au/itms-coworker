import {
  sessionStateSchema,
  transcriptTurnSchema,
  type SessionState,
  type TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire/state';
import { conversationsContract } from '@core/features/conversations/api';
import {
  EMPTY_TRANSCRIPT_SUMMARY,
  summarizeTranscriptTurns,
  type TaskTranscriptSummary,
} from '@core/features/conversations/api/browser/acp-transcript';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';

/**
 * Task progress read straight from the ACP runtime rather than from a mounted
 * chat panel.
 *
 * Both reads are side-effect free: the `conversations.acp.session` live model
 * is served from a per-conversation projection that exists whether or not the
 * session is attached (a closed session simply reports the closed state), and
 * history is only requested while the session already reports itself live, so
 * nothing here wakes a suspended agent.
 */

const HISTORY_PAGE_LIMIT = 50;
/** How long a source survives with no subscribers, so remounts do not reconnect. */
const RELEASE_LINGER_MS = 30_000;
const REMOTE_LINGER_MS = 15_000;

const nullableTurnSchema = transcriptTurnSchema.nullable();

type ConversationProgress = {
  state: SessionState | null;
  activeTurn: TranscriptTurn | null;
  history: readonly TranscriptTurn[];
};

/** A live session is attached and running, so reading its history cannot wake it. */
function isLive(state: SessionState): boolean {
  return state.lifecycle !== 'closed' && state.suspended !== true;
}

function emptyProgress(): ConversationProgress {
  return { state: null, activeTurn: null, history: [] };
}

class TaskAgentProgressSource {
  private readonly listeners = new Set<() => void>();
  private readonly scope = createScope({ label: 'helpdesk-agent-progress' });
  private readonly conversationScopes = new Map<string, Scope>();
  private readonly conversations = new Map<string, ConversationProgress>();
  private readonly historyInFlight = new Set<string>();
  private summary: TaskTranscriptSummary = EMPTY_TRANSCRIPT_SUMMARY;
  private started = false;
  private disposed = false;
  private retainCount = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly taskId: string) {}

  snapshot(): TaskTranscriptSummary {
    return this.summary;
  }

  subscribe(listener: () => void): () => void {
    this.retain();
    this.listeners.add(listener);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.listeners.delete(listener);
      this.release();
    };
  }

  private retain(): void {
    this.retainCount += 1;
    if (this.releaseTimer !== null) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    this.start();
  }

  private release(): void {
    this.retainCount = Math.max(0, this.retainCount - 1);
    if (this.retainCount > 0 || this.releaseTimer !== null) return;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      if (this.retainCount > 0) return;
      dropSource(this.taskId, this);
      this.dispose();
    }, RELEASE_LINGER_MS);
  }

  private start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    void this.discoverConversations();
    void this.watchConversationEvents();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    void this.scope.dispose();
    this.conversationScopes.clear();
    this.conversations.clear();
  }

  /**
   * The conversation rows come from the wire, not the renderer conversation
   * registry, so a task whose view has never been opened still resolves.
   */
  private async discoverConversations(): Promise<void> {
    try {
      const client = await getConversationsClient();
      if (this.disposed) return;
      const rows = await client.getConversations();
      if (this.disposed) return;
      for (const row of rows) {
        if (row.taskId === this.taskId && row.type === 'acp') this.watchConversation(row.id);
      }
      this.recompute();
    } catch {
      // Leave the summary unavailable; a later conversation event retries.
    }
  }

  private async watchConversationEvents(): Promise<void> {
    try {
      const client = await getConversationsClient();
      if (this.disposed) return;
      const unsubscribe = await client.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type !== 'created') return;
          const conversation = event.conversation;
          if (conversation.taskId !== this.taskId || conversation.type !== 'acp') return;
          this.watchConversation(conversation.id);
          this.recompute();
        },
        onGap: () => void this.discoverConversations(),
      });
      if (this.disposed) unsubscribe();
      else this.scope.add(unsubscribe);
    } catch {
      // Without the event stream the initial discovery still applies.
    }
  }

  private watchConversation(conversationId: string): void {
    if (this.disposed || this.conversationScopes.has(conversationId)) return;
    const scope = this.scope.child(`acp-session:${conversationId}`);
    this.conversationScopes.set(conversationId, scope);
    this.conversations.set(conversationId, emptyProgress());
    void this.connect(conversationId, scope);
  }

  private async connect(conversationId: string, scope: Scope): Promise<void> {
    try {
      const client = (await getConversationsClient()).acp;
      if (this.disposed) return;
      const sessionRemote = remote(conversationsContract.acp.session, client.session, {
        scope,
        lingerMs: REMOTE_LINGER_MS,
      });
      const member = sessionRemote({ conversationId });
      observe(
        member.states.state,
        (snapshot) => {
          if (snapshot.value === undefined) return;
          const state = sessionStateSchema.parse(snapshot.value);
          this.progressFor(conversationId).state = state;
          this.recompute();
          if (isLive(state)) void this.loadHistory(conversationId);
        },
        { scope, immediate: true }
      );
      observe(
        member.states.activeTurn,
        (snapshot) => {
          if (snapshot.value === undefined) return;
          const turn = nullableTurnSchema.parse(snapshot.value);
          const progress = this.progressFor(conversationId);
          const settled = progress.activeTurn !== null && turn === null;
          progress.activeTurn = turn;
          this.recompute();
          // The settled turn has just moved into history; pick it up there.
          if (settled) void this.loadHistory(conversationId, true);
        },
        { scope, immediate: true }
      );
    } catch {
      // A conversation that cannot be reached stays absent from the summary.
    }
  }

  /**
   * Only called for a session that already reports itself live, so the
   * runtime's `ensureActivation` is a no-op rather than a spawn.
   */
  private async loadHistory(conversationId: string, force = false): Promise<void> {
    const progress = this.progressFor(conversationId);
    if (!progress.state || !isLive(progress.state)) return;
    if (!force && progress.history.length > 0) return;
    if (this.historyInFlight.has(conversationId)) return;
    this.historyInFlight.add(conversationId);
    try {
      const client = (await getConversationsClient()).acp;
      if (this.disposed) return;
      const result = await client.loadHistory({ conversationId, limit: HISTORY_PAGE_LIMIT });
      if (this.disposed || !result.success || result.data.unavailable) return;
      this.progressFor(conversationId).history = result.data.turns;
      this.recompute();
    } catch {
      // Keep whatever history was already read.
    } finally {
      this.historyInFlight.delete(conversationId);
    }
  }

  private progressFor(conversationId: string): ConversationProgress {
    const existing = this.conversations.get(conversationId);
    if (existing) return existing;
    const created = emptyProgress();
    this.conversations.set(conversationId, created);
    return created;
  }

  private recompute(): void {
    const next = this.buildSummary();
    if (sameSummary(this.summary, next)) return;
    this.summary = next;
    for (const listener of this.listeners) listener();
  }

  private buildSummary(): TaskTranscriptSummary {
    if (this.conversations.size === 0) return EMPTY_TRANSCRIPT_SUMMARY;
    const turns: TranscriptTurn[] = [];
    let available = false;
    let generating = false;
    let live = false;
    for (const progress of this.conversations.values()) {
      if (progress.state) {
        available = true;
        if (progress.state.isGenerating) generating = true;
        if (isLive(progress.state)) live = true;
      }
      const seen = new Set<string>();
      for (const turn of progress.history) {
        seen.add(turn.id);
        turns.push(turn);
      }
      if (progress.activeTurn && !seen.has(progress.activeTurn.id)) turns.push(progress.activeTurn);
    }
    turns.sort((a, b) => a.seq - b.seq);
    const lastOutcome = turns.at(-1)?.outcome;
    const { steps, lastAssistantText } = summarizeTranscriptTurns(turns);
    return {
      steps,
      lastAssistantText,
      turnStatus: turnStatusOf(generating, turns.length > 0, lastOutcome),
      available,
      suspended: available && !live,
    };
  }
}

function turnStatusOf(
  generating: boolean,
  hasTurns: boolean,
  outcome: TranscriptTurn['outcome']
): TaskTranscriptSummary['turnStatus'] {
  if (generating) return 'generating';
  if (!hasTurns) return null;
  return outcome?.kind === 'cancelled' ? 'cancelled' : 'done';
}

function sameSummary(a: TaskTranscriptSummary, b: TaskTranscriptSummary): boolean {
  if (
    a.available !== b.available ||
    a.suspended !== b.suspended ||
    a.turnStatus !== b.turnStatus ||
    a.lastAssistantText !== b.lastAssistantText ||
    a.steps.length !== b.steps.length
  ) {
    return false;
  }
  return a.steps.every((step, index) => {
    const other = b.steps[index];
    return (
      other !== undefined &&
      step.id === other.id &&
      step.title === other.title &&
      step.status === other.status
    );
  });
}

const sources = new Map<string, TaskAgentProgressSource>();

function dropSource(taskId: string, source: TaskAgentProgressSource): void {
  if (sources.get(taskId) === source) sources.delete(taskId);
}

function sourceFor(taskId: string): TaskAgentProgressSource {
  const existing = sources.get(taskId);
  if (existing) return existing;
  const created = new TaskAgentProgressSource(taskId);
  sources.set(taskId, created);
  return created;
}

/**
 * One shared source per task id, however many components render its progress.
 * Returns the unsubscribe; the source is torn down a while after the last one.
 */
export function subscribeTaskProgress(taskId: string, listener: () => void): () => void {
  return sourceFor(taskId).subscribe(listener);
}

/** The current summary without starting a source; safe to call while rendering. */
export function getTaskProgressSnapshot(taskId: string): TaskTranscriptSummary {
  return sources.get(taskId)?.snapshot() ?? EMPTY_TRANSCRIPT_SUMMARY;
}

/** Test seam: drop every source and its subscriptions. */
export function resetTaskProgressSources(): void {
  for (const source of sources.values()) source.dispose();
  sources.clear();
}

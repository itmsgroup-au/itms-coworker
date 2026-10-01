import {
  sessionStateSchema,
  type AcpPermissionRequest,
  type ToolCallItem,
} from '@emdash/core/runtimes/acp/api/client';
import { createScope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire/state';
import { useSyncExternalStore } from 'react';
import { conversationsContract } from '@core/features/conversations/api';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';

/**
 * Every permission an agent is waiting on, across every ACP conversation, in
 * one list. This is the read side of the Approvals inbox.
 *
 * The per-conversation `conversations.acp.session` live model is served from a
 * projection that exists whether or not the session is attached, so watching a
 * closed or suspended conversation reads its state without waking the agent.
 */

const REMOTE_LINGER_MS = 15_000;

export type PendingApproval = {
  conversationId: string;
  projectId: string | null;
  taskId: string | null;
  providerId: string;
  conversationTitle: string;
  request: AcpPermissionRequest;
};

type ConversationRow = {
  id: string;
  projectId?: string | null;
  taskId?: string | null;
  providerId?: string | null;
  title?: string | null;
  type?: string | null;
};

class ApprovalsSource {
  private readonly listeners = new Set<() => void>();
  private readonly scope = createScope({ label: 'approvals-inbox' });
  private readonly watched = new Map<string, ConversationRow>();
  private readonly pending = new Map<string, readonly AcpPermissionRequest[]>();
  private snapshotValue: readonly PendingApproval[] = [];
  private started = false;

  snapshot = (): readonly PendingApproval[] => this.snapshotValue;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Sends the agent's chosen option back; the request leaves the list when the state updates. */
  async resolve(conversationId: string, requestId: string, optionId: string): Promise<void> {
    const client = (await getConversationsClient()).acp;
    const result = await client.resolvePermission({ conversationId, requestId, optionId });
    if (!result.success) {
      throw new Error(describeError(result.error));
    }
  }

  dispose(): void {
    this.listeners.clear();
    void this.scope.dispose();
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    void this.discover();
    void this.watchEvents();
  }

  private async discover(): Promise<void> {
    try {
      const client = await getConversationsClient();
      const rows = (await client.getConversations()) as ConversationRow[];
      for (const row of rows) this.watch(row);
    } catch {
      // A later conversation event retries discovery.
    }
  }

  private async watchEvents(): Promise<void> {
    try {
      const client = await getConversationsClient();
      const unsubscribe = await client.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'created') this.watch(event.conversation as ConversationRow);
        },
        onGap: () => void this.discover(),
      });
      this.scope.add(unsubscribe);
    } catch {
      // Without the event stream the initial discovery still applies.
    }
  }

  private watch(row: ConversationRow): void {
    if (row.type !== 'acp' || this.watched.has(row.id)) return;
    this.watched.set(row.id, row);
    void this.connect(row.id);
  }

  private async connect(conversationId: string): Promise<void> {
    try {
      const client = (await getConversationsClient()).acp;
      const scope = this.scope.child(`approvals:${conversationId}`);
      const sessionRemote = remote(conversationsContract.acp.session, client.session, {
        scope,
        lingerMs: REMOTE_LINGER_MS,
      });
      observe(
        sessionRemote({ conversationId }).states.state,
        (snapshot) => {
          if (snapshot.value === undefined) return;
          const state = sessionStateSchema.parse(snapshot.value);
          const before = this.pending.get(conversationId) ?? [];
          if (before.length === 0 && state.pendingPermissions.length === 0) return;
          this.pending.set(conversationId, state.pendingPermissions);
          this.recompute();
        },
        { scope, immediate: true }
      );
    } catch {
      // A conversation that cannot be reached contributes nothing.
    }
  }

  private recompute(): void {
    const next: PendingApproval[] = [];
    for (const [conversationId, requests] of this.pending) {
      const row = this.watched.get(conversationId);
      for (const request of requests) {
        next.push({
          conversationId,
          projectId: row?.projectId ?? null,
          taskId: row?.taskId ?? null,
          providerId: row?.providerId ?? 'agent',
          conversationTitle: row?.title ?? 'Conversation',
          request,
        });
      }
    }
    this.snapshotValue = next;
    for (const listener of this.listeners) listener();
  }
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; type?: unknown };
    if (typeof value.message === 'string' && value.message) return value.message;
    if (typeof value.type === 'string') return value.type;
  }
  return String(error);
}

let source: ApprovalsSource | null = null;

function getSource(): ApprovalsSource {
  source ??= new ApprovalsSource();
  return source;
}

/** Live list of every pending approval. */
export function usePendingApprovals(): readonly PendingApproval[] {
  const current = getSource();
  return useSyncExternalStore(current.subscribe, current.snapshot);
}

export function subscribePendingApprovals(listener: () => void): () => void {
  return getSource().subscribe(listener);
}

export function getPendingApprovalsSnapshot(): readonly PendingApproval[] {
  return getSource().snapshot();
}

export function resolveApproval(
  conversationId: string,
  requestId: string,
  optionId: string
): Promise<void> {
  return getSource().resolve(conversationId, requestId, optionId);
}

/** One short line saying what the agent wants to do, for the inbox row. */
export function approvalDetail(toolCall: ToolCallItem): string | null {
  switch (toolCall.kind) {
    case 'execute-tool-call':
      return toolCall.command ?? toolCall.inputSummary ?? null;
    case 'read-tool-call':
      return toolCall.locations?.[0]?.path ?? toolCall.inputSummary ?? null;
    case 'create-file-tool-call':
    case 'modify-file-tool-call':
    case 'delete-file-tool-call':
      return toolCall.path;
    case 'web-fetch-tool-call':
      return toolCall.url;
    case 'search-tool-call':
      return toolCall.query;
    case 'mcp-tool-call':
      return toolCall.server
        ? `${toolCall.server}: ${toolCall.title}`
        : (toolCall.inputSummary ?? null);
    default:
      return toolCall.inputSummary ?? null;
  }
}

/** Test seam: forget the singleton between tests. */
export function resetApprovalsSource(): void {
  source?.dispose();
  source = null;
}

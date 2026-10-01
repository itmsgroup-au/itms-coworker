import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Snapshot = { value: unknown };
type FakeCell = { value: unknown; listeners: Array<(snapshot: Snapshot) => void> };

const stateCells = new Map<string, FakeCell>();

function stateCellFor(conversationId: string): FakeCell {
  const existing = stateCells.get(conversationId);
  if (existing) return existing;
  const created: FakeCell = { value: undefined, listeners: [] };
  stateCells.set(conversationId, created);
  return created;
}

function push(target: FakeCell, value: unknown): void {
  target.value = value;
  for (const listener of target.listeners) listener({ value });
}

vi.mock('@emdash/wire/state', () => ({
  remote: () => (key: { conversationId: string }) => ({
    states: { state: stateCellFor(key.conversationId) },
  }),
  observe: (
    node: FakeCell,
    listener: (snapshot: Snapshot) => void,
    options: { immediate?: boolean }
  ) => {
    node.listeners.push(listener);
    if (options.immediate) listener({ value: node.value });
  },
}));

const getConversations = vi.fn();
const resolvePermission = vi.fn();
let onConversationEvent: ((event: unknown) => void) | null = null;

vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => ({
    getConversations,
    events: {
      subscribe: async (_key: unknown, handlers: { onEvent: (event: unknown) => void }) => {
        onConversationEvent = handlers.onEvent;
        return () => {};
      },
    },
    acp: { session: {}, resolvePermission },
  }),
}));

const {
  approvalDetail,
  getPendingApprovalsSnapshot,
  resetApprovalsSource,
  resolveApproval,
  subscribePendingApprovals,
} = await import('./approvals-source');

function sessionState(pendingPermissions: unknown[]): Record<string, unknown> {
  return {
    lifecycle: 'working',
    activeTurnId: 'turn-1',
    transcript: null,
    pendingPermissions,
    lastStopReason: null,
    lastTurnErrored: false,
    queuedPrompts: [],
    agentTurnActive: false,
    backgroundAgentCount: 0,
    isGenerating: true,
    canSubmit: false,
    canCancel: true,
  };
}

function permission(requestId: string, command: string): Record<string, unknown> {
  return {
    requestId,
    toolCall: {
      kind: 'execute-tool-call',
      id: `item-${requestId}`,
      seq: 1,
      toolCallId: `tool-${requestId}`,
      title: 'Run a command',
      status: 'running',
      command,
    },
    options: [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  };
}

function acpRow(id: string, taskId: string): Record<string, unknown> {
  return { id, projectId: 'project-1', taskId, providerId: 'hermes', title: 'Chat', type: 'acp' };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  stateCells.clear();
  getConversations.mockReset();
  resolvePermission.mockReset();
  onConversationEvent = null;
});

afterEach(() => {
  resetApprovalsSource();
});

describe('approvals inbox source', () => {
  it('lists pending permissions from every ACP conversation and ignores terminals', async () => {
    getConversations.mockResolvedValue([
      acpRow('c1', 'task-1'),
      acpRow('c2', 'task-2'),
      { id: 'p1', taskId: 'task-3', type: 'pty' },
    ]);
    const unsubscribe = subscribePendingApprovals(() => {});
    await vi.waitFor(() => expect(stateCells.size).toBe(2));

    push(stateCellFor('c1'), sessionState([permission('r1', 'rm -rf build')]));
    push(stateCellFor('c2'), sessionState([permission('r2', 'atlas mail send')]));
    await settle();

    const approvals = getPendingApprovalsSnapshot();
    expect(approvals.map((a) => [a.conversationId, a.taskId, a.request.requestId])).toEqual([
      ['c1', 'task-1', 'r1'],
      ['c2', 'task-2', 'r2'],
    ]);
    expect(stateCells.has('p1')).toBe(false);
    unsubscribe();
  });

  it('drops a request once the session no longer reports it', async () => {
    getConversations.mockResolvedValue([acpRow('c1', 'task-1')]);
    const changed = vi.fn();
    const unsubscribe = subscribePendingApprovals(changed);
    await vi.waitFor(() => expect(stateCells.size).toBe(1));

    push(stateCellFor('c1'), sessionState([permission('r1', 'ls')]));
    await settle();
    expect(getPendingApprovalsSnapshot()).toHaveLength(1);

    push(stateCellFor('c1'), sessionState([]));
    await settle();
    expect(getPendingApprovalsSnapshot()).toHaveLength(0);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('watches conversations created after it started', async () => {
    getConversations.mockResolvedValue([]);
    const unsubscribe = subscribePendingApprovals(() => {});
    await vi.waitFor(() => expect(onConversationEvent).not.toBeNull());

    onConversationEvent?.({ type: 'created', conversation: acpRow('c9', 'task-9') });
    await vi.waitFor(() => expect(stateCells.has('c9')).toBe(true));
    push(stateCellFor('c9'), sessionState([permission('r9', 'echo hi')]));
    await settle();

    expect(getPendingApprovalsSnapshot()[0]?.taskId).toBe('task-9');
    unsubscribe();
  });

  it('answers through resolvePermission and surfaces a failure', async () => {
    resolvePermission.mockResolvedValueOnce({ success: true, data: undefined });
    await resolveApproval('c1', 'r1', 'allow');
    expect(resolvePermission).toHaveBeenCalledWith({
      conversationId: 'c1',
      requestId: 'r1',
      optionId: 'allow',
    });

    resolvePermission.mockResolvedValueOnce({
      success: false,
      error: { type: 'not-found', message: 'request already answered' },
    });
    await expect(resolveApproval('c1', 'r1', 'allow')).rejects.toThrow('request already answered');
  });

  it('describes what the agent wants to run', () => {
    const toolCall = permission('r1', 'atlas mail send --to x').toolCall;
    expect(approvalDetail(toolCall as never)).toBe('atlas mail send --to x');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Snapshot = { value: unknown };
type FakeCell = { value: unknown; listeners: Array<(snapshot: Snapshot) => void> };

function cell(value: unknown): FakeCell {
  return { value, listeners: [] };
}

function push(target: FakeCell, value: unknown): void {
  target.value = value;
  for (const listener of target.listeners) listener({ value });
}

const sessionCells = new Map<string, { state: FakeCell; activeTurn: FakeCell }>();

function sessionCellsFor(conversationId: string): { state: FakeCell; activeTurn: FakeCell } {
  const existing = sessionCells.get(conversationId);
  if (existing) return existing;
  const created = { state: cell(undefined), activeTurn: cell(undefined) };
  sessionCells.set(conversationId, created);
  return created;
}

vi.mock('@emdash/wire/state', () => ({
  remote: () => (key: { conversationId: string }) => ({
    states: sessionCellsFor(key.conversationId),
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
const loadHistory = vi.fn();
const subscribeEvents = vi.fn(async () => () => {});

vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => ({
    getConversations,
    events: { subscribe: subscribeEvents },
    acp: { session: {}, loadHistory },
  }),
}));

const { getTaskProgressSnapshot, resetTaskProgressSources, subscribeTaskProgress } =
  await import('./agent-progress-source');

const TASK_ID = 'task-1';
const CONVERSATION_ID = 'conversation-1';

const acpConversation = {
  id: CONVERSATION_ID,
  projectId: 'project-1',
  taskId: TASK_ID,
  providerId: 'hermes',
  title: 'Ticket',
  lastInteractedAt: null,
  isInitialConversation: true,
  type: 'acp',
};

function sessionState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lifecycle: 'working',
    activeTurnId: 'turn-1',
    pendingPermissions: [],
    lastStopReason: null,
    lastTurnErrored: false,
    queuedPrompts: [],
    agentTurnActive: false,
    backgroundAgentCount: 0,
    isGenerating: true,
    canSubmit: false,
    canCancel: true,
    ...overrides,
  };
}

const activeTurn = {
  id: 'turn-1',
  seq: 1,
  initiator: 'user',
  items: [
    {
      kind: 'execute-tool-call',
      id: 'item-1',
      seq: 1,
      toolCallId: 'tool-1',
      title: 'Read the ticket in Odoo',
      status: 'running',
    },
    { kind: 'message', id: 'item-2', seq: 2, role: 'assistant', text: 'Reading the ticket.' },
  ],
};

beforeEach(() => {
  sessionCells.clear();
  getConversations.mockReset();
  loadHistory.mockReset();
  subscribeEvents.mockClear();
  getConversations.mockResolvedValue([acpConversation]);
  loadHistory.mockResolvedValue({ success: true, data: { turns: [], nextCursor: null } });
});

afterEach(() => {
  resetTaskProgressSources();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('task agent progress source', () => {
  it('reads steps and the last assistant message without a mounted chat panel', async () => {
    const changed = vi.fn();
    const unsubscribe = subscribeTaskProgress(TASK_ID, changed);
    await vi.waitFor(() => expect(sessionCells.has(CONVERSATION_ID)).toBe(true));

    const cells = sessionCellsFor(CONVERSATION_ID);
    push(cells.state, sessionState());
    push(cells.activeTurn, activeTurn);
    await settle();

    const progress = getTaskProgressSnapshot(TASK_ID);
    expect(progress.available).toBe(true);
    expect(progress.steps).toEqual([
      { id: 'item-1', title: 'Read the ticket in Odoo', status: 'running' },
    ]);
    expect(progress.lastAssistantText).toBe('Reading the ticket.');
    expect(progress.turnStatus).toBe('generating');
    expect(changed).toHaveBeenCalled();
    unsubscribe();
  });

  it('merges committed history with the active turn', async () => {
    loadHistory.mockResolvedValue({
      success: true,
      data: {
        turns: [
          {
            id: 'turn-0',
            seq: 0,
            initiator: 'user',
            items: [
              {
                kind: 'read-tool-call',
                id: 'item-0',
                seq: 1,
                toolCallId: 'tool-0',
                title: 'Open the chatter',
                status: 'done',
              },
            ],
            outcome: { kind: 'done' },
          },
        ],
        nextCursor: null,
      },
    });
    const unsubscribe = subscribeTaskProgress(TASK_ID, () => {});
    await vi.waitFor(() => expect(sessionCells.has(CONVERSATION_ID)).toBe(true));

    const cells = sessionCellsFor(CONVERSATION_ID);
    push(cells.state, sessionState());
    push(cells.activeTurn, activeTurn);
    await vi.waitFor(() => expect(getTaskProgressSnapshot(TASK_ID).steps).toHaveLength(2));

    expect(getTaskProgressSnapshot(TASK_ID).steps.map((step) => step.id)).toEqual([
      'item-0',
      'item-1',
    ]);
    unsubscribe();
  });

  it('never asks for history while the session is suspended, so no agent is woken', async () => {
    const unsubscribe = subscribeTaskProgress(TASK_ID, () => {});
    await vi.waitFor(() => expect(sessionCells.has(CONVERSATION_ID)).toBe(true));

    const cells = sessionCellsFor(CONVERSATION_ID);
    push(cells.state, sessionState({ lifecycle: 'closed', suspended: true, isGenerating: false }));
    push(cells.activeTurn, null);
    await settle();

    expect(loadHistory).not.toHaveBeenCalled();
    const progress = getTaskProgressSnapshot(TASK_ID);
    expect(progress.available).toBe(true);
    expect(progress.suspended).toBe(true);
    unsubscribe();
  });

  it('shares one source and one conversation lookup across subscribers', async () => {
    const first = subscribeTaskProgress(TASK_ID, () => {});
    const second = subscribeTaskProgress(TASK_ID, () => {});
    await vi.waitFor(() => expect(sessionCells.has(CONVERSATION_ID)).toBe(true));
    await settle();

    expect(getConversations).toHaveBeenCalledTimes(1);
    expect(subscribeEvents).toHaveBeenCalledTimes(1);
    first();
    second();
  });
});

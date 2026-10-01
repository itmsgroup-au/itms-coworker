import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { Button, toast } from '@emdash/ui/react/primitives';
import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useAgentAvailability } from '@core/features/agents/api/browser/components/agent-selector/use-agent-availability';
import { AgentSelector } from '@core/features/agents/contributions/browser/agent-selector';
import { getChatClient } from '@core/features/chat/api/browser/client';
import { chatViewDef } from '@core/features/chat/contributions/views';
import {
  describe,
  findProjectIdByPath,
  waitForTaskManager,
} from '@core/features/helpdesk/api/browser/use-ticket-agent';
import { TicketAgentChat } from '@core/features/helpdesk/contributions/browser/agent-chat';
import {
  getProjectManagerStore,
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import {
  getTaskManagerStore,
  taskDisplayName,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import {
  useCurrentViewParams,
  useNavigate,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';

/** The worker a new chat uses unless another is picked. */
const PREFERRED_PROVIDER = 'hermes' as AgentProviderId;

type ProjectState =
  | { kind: 'loading' }
  | { kind: 'ready'; projectId: string }
  | { kind: 'error'; message: string };

/**
 * General chat: a list of past chats on the left, one chat on the right. Every
 * chat is an ordinary ACP task in the ~/ITMS CoWorker/chat project, so the
 * task view, Approvals and the status bar all see it.
 */
export const ChatPage = observer(function ChatPage() {
  const { navigate } = useNavigate();
  const { params } = useCurrentViewParams(chatViewDef);
  const selectedTaskId = params.task ?? null;
  const project = useChatProject();

  if (project.kind === 'loading') return <Centered>Opening the chat folder…</Centered>;
  if (project.kind === 'error') return <Centered>Chat is unavailable: {project.message}</Centered>;

  const chats = listChats(project.projectId);
  const selected = chats.find((chat) => chat.id === selectedTaskId) ?? null;

  return (
    <div className="flex h-full min-h-0 gap-4 bg-background px-6 py-6 text-foreground">
      <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Chats</span>
          <Button size="sm" variant="ghost" onClick={() => navigate(chatViewDef({}))}>
            <Plus className="size-4" />
            New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {chats.length === 0 && (
            <div className="px-3 py-4 text-xs text-foreground-muted">No chats yet.</div>
          )}
          {chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => navigate(chatViewDef({ task: chat.id }))}
              className={cn(
                'block w-full border-b border-border px-3 py-2 text-left hover:bg-background-secondary/60',
                chat.id === selectedTaskId && 'bg-accent/10 hover:bg-accent/10'
              )}
            >
              <div className="truncate text-sm">{chat.name}</div>
              <div className="text-xs text-foreground-muted">{formatWhen(chat.when)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        {selected ? (
          <TicketAgentChat
            key={selected.id}
            projectId={project.projectId}
            taskId={selected.id}
            className="min-h-0 flex-1"
          />
        ) : (
          <NewChat
            projectId={project.projectId}
            onStarted={(taskId) => navigate(chatViewDef({ task: taskId }))}
          />
        )}
      </div>
    </div>
  );
});

const NewChat = observer(function NewChat({
  projectId,
  onStarted,
}: {
  projectId: string;
  onStarted: (taskId: string) => void;
}) {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState<AgentProviderId | null>(null);
  const [busy, setBusy] = useState(false);
  const { groups } = useAgentAvailability({ value: provider });
  const options = groups.flatMap((g) => g.items);
  const fallback =
    options.find((o) => o.agentId === PREFERRED_PROVIDER && !o.disabled) ??
    options.find((o) => !o.disabled) ??
    null;
  const effectiveProvider = provider ?? fallback?.agentId ?? null;
  const option = options.find((o) => o.agentId === effectiveProvider);

  const send = async () => {
    const message = text.trim();
    if (!message || !effectiveProvider || busy) return;
    setBusy(true);
    try {
      const taskManager = await waitForTaskManager(projectId);
      const data = projectData(getProjectStore(projectId));
      if (!data?.repositoryWorkspaceId) throw new Error('The chat folder is not ready yet.');
      const taskId = crypto.randomUUID();
      const supportsAcp = option?.supportsAcp ?? true;
      await taskManager.createTask({
        id: taskId,
        projectId,
        taskConfig: {
          version: '1',
          name: message.replace(/\s+/g, ' ').slice(0, 80),
          initialConversation: {
            id: crypto.randomUUID(),
            provider: effectiveProvider,
            title: 'Chat',
            type: supportsAcp ? 'acp' : 'pty',
            ...(supportsAcp ? { initialQueue: [{ text: message }] } : { initialPrompt: message }),
            autoApprove: false,
          },
        },
        workspaceConfig: {
          version: '2',
          git: { kind: 'none' },
          workspace: { kind: 'repository-instance', workspaceId: data.repositoryWorkspaceId },
        },
      });
      setText('');
      onStarted(taskId);
    } catch (error) {
      toast.error('Could not start the chat', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 px-6">
      <h1 className="text-lg font-semibold">What do you need?</h1>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        rows={4}
        placeholder="Ask anything. Enter sends, Shift+Enter for a new line."
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <AgentSelector value={effectiveProvider} onChange={setProvider} className="w-[240px]" />
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          disabled={busy || !text.trim() || !effectiveProvider}
          onClick={() => void send()}
        >
          {busy ? 'Starting…' : 'Send'}
        </Button>
      </div>
      <p className="text-xs text-foreground-muted">
        The agent asks before anything that writes or sends; those requests also appear in
        Approvals.
      </p>
    </div>
  );
});

/** Finds or creates the chat project. */
function useChatProject(): ProjectState {
  const [state, setState] = useState<ProjectState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const folder = await (await getChatClient()).prepareFolder();
        let projectId = findProjectIdByPath(folder.path);
        if (!projectId) {
          const result = await getProjectManagerStore().startProjectCreation(
            { type: 'local' },
            { mode: 'pick', name: folder.name, path: folder.path, initGitRepository: false }
          );
          if (result.kind === 'existing') projectId = result.projectId;
          else {
            const completion = await result.completion;
            if (!completion.success) throw new Error(describe(completion.error));
            projectId = result.projectId;
          }
        }
        await waitForTaskManager(projectId);
        if (!cancelled) setState({ kind: 'ready', projectId });
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

type ChatEntry = { id: string; name: string; when: string | null };

/** Every live chat in the project, newest activity first. Call inside `observer`. */
function listChats(projectId: string): ChatEntry[] {
  const manager = getTaskManagerStore(projectId);
  if (!manager) return [];
  const out: ChatEntry[] = [];
  for (const [id, store] of manager.tasks.entries()) {
    const data = store.data as {
      archivedAt?: string;
      lastInteractedAt?: string;
      createdAt?: string;
    };
    if (data.archivedAt) continue;
    out.push({
      id,
      name: taskDisplayName(store) ?? 'Chat',
      when: data.lastInteractedAt ?? data.createdAt ?? null,
    });
  }
  return out.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''));
}

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  // Task rows carry SQLite's CURRENT_TIMESTAMP: UTC with no zone marker.
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
      {children}
    </div>
  );
}

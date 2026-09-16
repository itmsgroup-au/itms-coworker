import { Button, toast } from '@emdash/ui/react/primitives';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Mail, MessageSquare, StickyNote, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import type { AcpChatStore } from '@core/features/conversations/api/browser/acp-chat-access';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import {
  HELPDESK_QUERY_KEY,
  postHelpdeskNote,
  useHelpdeskMessages,
  useHelpdeskRelated,
} from '@core/features/helpdesk/api/browser/use-helpdesk';
import type {
  HelpdeskMessage,
  HelpdeskTicket,
  OdooProfileSummary,
} from '@core/features/odoo/api/contract';
import {
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { HelpdeskAssignment } from '@core/primitives/app-settings/api';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { AgentProgressList } from './AgentProgress';
import { lastAssistantText, TicketAgentChat } from './TicketAgentChat';

type Tab = 'thread' | 'customer' | 'agent';

export const TicketDetail = observer(function TicketDetail({
  profile,
  ticket,
  assignment,
  onClose,
  onAssign,
}: {
  profile: OdooProfileSummary;
  ticket: HelpdeskTicket;
  assignment: HelpdeskAssignment | null;
  onClose: () => void;
  onAssign: () => void;
}) {
  const [tab, setTab] = useState<Tab>(assignment ? 'agent' : 'thread');
  useEffect(() => {
    setTab(assignment ? 'agent' : 'thread');
  }, [ticket.id, assignment]);

  const odooUrl = `${profile.url.replace(/\/+$/, '')}/odoo/helpdesk/${ticket.id}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-foreground-muted">
            #{ticket.ref} · {ticket.team} · {ticket.stage}
          </div>
          <div className="truncate text-sm font-semibold" title={ticket.name}>
            {ticket.name}
          </div>
          <div className="truncate text-xs text-foreground-muted">
            {ticket.customer || 'No customer'} · {ticket.assignee || 'Unassigned'} · opened{' '}
            {formatDateTime(ticket.createdAt)}
          </div>
        </div>
        <a
          href={odooUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1 text-foreground-muted hover:bg-background-secondary hover:text-foreground"
          title="Open in Odoo"
        >
          <ExternalLink className="size-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-foreground-muted hover:bg-background-secondary hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex gap-1 border-b border-border px-3 pt-2">
        <TabButton active={tab === 'thread'} onClick={() => setTab('thread')}>
          Thread
        </TabButton>
        <TabButton active={tab === 'customer'} onClick={() => setTab('customer')}>
          Customer
        </TabButton>
        <TabButton active={tab === 'agent'} onClick={() => setTab('agent')}>
          {assignment ? 'Agent' : 'Agent (none)'}
        </TabButton>
      </div>

      <div
        className={cn(
          'min-h-0 flex-1',
          // The agent tab owns its own scrolling: the transcript scrolls, the
          // composer stays pinned. Every other tab scrolls as a whole.
          tab === 'agent' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
        )}
      >
        {tab === 'thread' && <ThreadTab profile={profile} ticket={ticket} />}
        {tab === 'customer' && <CustomerTab profile={profile} ticket={ticket} />}
        {tab === 'agent' && (
          <AgentTab profile={profile} ticket={ticket} assignment={assignment} onAssign={onAssign} />
        )}
      </div>
    </div>
  );
});

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium',
        active
          ? 'border-accent text-foreground'
          : 'border-transparent text-foreground-muted hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Thread: description first, then the chatter oldest to newest
// ---------------------------------------------------------------------------

function ThreadTab({ profile, ticket }: { profile: OdooProfileSummary; ticket: HelpdeskTicket }) {
  const messages = useHelpdeskMessages(profile, ticket.id);
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <Bubble
        kind="description"
        author={ticket.customer || 'Ticket description'}
        date={ticket.createdAt}
        body={ticket.description || '(no description)'}
      />
      {messages.isLoading && <div className="text-xs text-foreground-muted">Loading thread…</div>}
      {messages.error && <div className="text-xs text-red-600">{messages.error.message}</div>}
      {(messages.data ?? []).map((m) => (
        <Bubble
          key={m.id}
          kind={m.kind}
          author={m.author}
          date={m.date}
          body={m.body}
          subject={m.subject}
        />
      ))}
      {messages.data && messages.data.length === 0 && (
        <div className="text-xs text-foreground-muted">No messages on this ticket yet.</div>
      )}
    </div>
  );
}

function Bubble({
  kind,
  author,
  date,
  body,
  subject,
}: {
  kind: HelpdeskMessage['kind'] | 'description';
  author: string;
  date: string;
  body: string;
  subject?: string;
}) {
  const Icon = kind === 'note' ? StickyNote : kind === 'email' ? Mail : MessageSquare;
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        kind === 'note'
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'border-border bg-background-secondary/40'
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-[11px] text-foreground-muted">
        <Icon className="size-3.5" />
        <span className="font-medium text-foreground">{author}</span>
        <span>·</span>
        <span>{formatDateTime(date)}</span>
        {kind === 'note' && (
          <span className="ml-auto rounded bg-amber-500/15 px-1.5 text-amber-700">
            internal note
          </span>
        )}
      </div>
      {subject && kind === 'email' && <div className="mb-1 text-xs font-medium">{subject}</div>}
      <div className="text-xs leading-relaxed whitespace-pre-wrap">{body}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer: the contact and their other tickets
// ---------------------------------------------------------------------------

function CustomerTab({ profile, ticket }: { profile: OdooProfileSummary; ticket: HelpdeskTicket }) {
  const related = useHelpdeskRelated(profile, ticket.id);
  if (related.isLoading)
    return <div className="px-4 py-3 text-xs text-foreground-muted">Loading…</div>;
  if (related.error)
    return <div className="px-4 py-3 text-xs text-red-600">{related.error.message}</div>;
  const r = related.data;
  if (!r) return null;
  return (
    <div className="flex flex-col gap-4 px-4 py-3 text-xs">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold">
          {r.company || r.contact || 'No customer on this ticket'}
        </div>
        {r.contact && r.contact !== r.company && <div>{r.contact}</div>}
        {r.email && <div className="text-foreground-muted">{r.email}</div>}
        {r.phone && <div className="text-foreground-muted">{r.phone}</div>}
        <div className="text-foreground-muted">
          {r.openTickets} other open ticket{r.openTickets === 1 ? '' : 's'}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium tracking-wide text-foreground-muted uppercase">
          Previous tickets
        </div>
        {r.previousTickets.length === 0 && <div className="text-foreground-muted">None.</div>}
        <div className="flex flex-col divide-y divide-border rounded-md border border-border">
          {r.previousTickets.map((t) => (
            <div key={t.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="text-foreground-muted">#{t.ref}</span>
              <span className="min-w-0 flex-1 truncate" title={t.name}>
                {t.name}
              </span>
              <span className="shrink-0 text-foreground-muted">{t.stage}</span>
              <span className="shrink-0 text-foreground-muted">{formatDay(t.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent: who is on it, what they did, what they said, and write it back
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<string, string> = {
  working: 'Working',
  'awaiting-input': 'Needs you',
  error: 'Failed',
  completed: 'Done',
  idle: 'Idle',
};

const AgentTab = observer(function AgentTab({
  profile,
  ticket,
  assignment,
}: {
  profile: OdooProfileSummary;
  ticket: HelpdeskTicket;
  assignment: HelpdeskAssignment | null;
  onAssign: () => void;
}) {
  const { navigate } = useNavigate();
  const [chatStore, setChatStore] = useState<AcpChatStore | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    setShowNote(false);
    setShowSteps(false);
  }, [assignment?.taskId]);

  if (!assignment) {
    return (
      <div className="px-4 py-4 text-xs text-foreground-muted">No agent is on this ticket yet.</div>
    );
  }

  const taskStore = getTaskStore(assignment.projectId, assignment.taskId);
  const status = taskStore ? (taskAgentStatus(taskStore) ?? 'idle') : 'missing';
  const project = projectData(getProjectStore(assignment.projectId));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <AgentIcon id={assignment.provider} size={18} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {assignment.provider === 'hermes' ? 'ITMS CoWorker' : assignment.provider}
          </div>
          <div className="truncate text-foreground-muted">
            {project?.name ?? assignment.projectId} · since {formatDateTime(assignment.assignedAt)}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
            status === 'working' && 'bg-emerald-500/15 text-emerald-600',
            status === 'awaiting-input' && 'bg-amber-500/15 text-amber-600',
            status === 'error' && 'bg-red-500/15 text-red-600',
            status === 'completed' && 'bg-sky-500/15 text-sky-600',
            (status === 'idle' || status === 'missing') && 'bg-foreground/10 text-foreground-muted'
          )}
        >
          {STATUS_TEXT[status] ?? 'Task gone'}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-1.5 text-[11px]">
        <LinkButton active={showSteps} onClick={() => setShowSteps((v) => !v)}>
          Steps
        </LinkButton>
        <LinkButton active={showNote} onClick={() => setShowNote((v) => !v)}>
          Note to ticket
        </LinkButton>
        <button
          type="button"
          className="ml-auto text-foreground-muted hover:text-foreground"
          onClick={() =>
            navigate(taskViewDef({ projectId: assignment.projectId, taskId: assignment.taskId }))
          }
        >
          Open the task
        </button>
      </div>

      {showSteps && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-border px-4 py-2">
          <AgentProgressList taskId={assignment.taskId} />
        </div>
      )}

      {showNote && (
        <TicketNoteBox
          profile={profile}
          ticket={ticket}
          initialBody={lastAssistantText(chatStore)}
          onDone={() => setShowNote(false)}
        />
      )}

      <TicketAgentChat
        key={assignment.taskId}
        projectId={assignment.projectId}
        taskId={assignment.taskId}
        onStoreChange={setChatStore}
        className="flex-1"
      />
    </div>
  );
});

function LinkButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-1.5 py-0.5',
        active ? 'bg-foreground/10 text-foreground' : 'text-foreground-muted hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

/** Post an internal note on the Odoo ticket, pre-filled with the agent's last message. */
function TicketNoteBox({
  profile,
  ticket,
  initialBody,
  onDone,
}: {
  profile: OdooProfileSummary;
  ticket: HelpdeskTicket;
  initialBody: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(initialBody);
  const [posting, setPosting] = useState(false);

  const post = async () => {
    const body = note.trim();
    if (!body) return;
    setPosting(true);
    try {
      await postHelpdeskNote(profile, ticket.id, body);
      await queryClient.invalidateQueries({ queryKey: [...HELPDESK_QUERY_KEY, 'messages'] });
      toast(`Note added to #${ticket.ref}`);
      setNote('');
      onDone();
    } catch (error) {
      toast.error('Could not add the note', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-border px-4 py-2 text-xs">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={5}
        placeholder="What should go on the ticket? Pre-filled with the agent's latest message."
        className="focus-visible:ring-accent w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus-visible:ring-1"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 text-[11px] text-foreground-muted">
          Internal note as {profile.user}. Nothing is sent to the customer.
        </span>
        <Button size="sm" onClick={() => void post()} disabled={posting || !note.trim()}>
          {posting ? 'Adding…' : 'Add note'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function parseOdooDate(iso: string): Date {
  return new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
}

function formatDateTime(iso: string): string {
  const d = parseOdooDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDay(iso: string): string {
  const d = parseOdooDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
}

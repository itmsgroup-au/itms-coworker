import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { Button, Select, toast } from '@emdash/ui/react/primitives';
import { ChevronDown, ChevronRight, Headset, RefreshCw, Star } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgentAvailability } from '@core/features/agents/api/browser/components/agent-selector/use-agent-availability';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import { AgentSelector } from '@core/features/agents/contributions/browser/agent-selector';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import {
  useDefaultOdooProfile,
  useHelpdeskTeams,
  useHelpdeskTickets,
} from '@core/features/helpdesk/api/browser/use-helpdesk';
import { assignmentKey } from '@core/features/helpdesk/contributions/settings';
import { helpdeskViewDef } from '@core/features/helpdesk/contributions/views';
import type { HelpdeskTeam, HelpdeskTicket } from '@core/features/odoo/api/contract';
import {
  getProjectManagerStore,
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import {
  getTaskManagerStore,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { HelpdeskAssignment, OdooProfile } from '@core/primitives/app-settings/api';
import {
  useCurrentViewParams,
  useNavigate,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { TicketDetail } from './TicketDetail';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const HelpdeskPage = observer(function HelpdeskPage() {
  const { profile, isLoading } = useDefaultOdooProfile();
  const { params, setParams } = useCurrentViewParams(helpdeskViewDef);
  const { navigate } = useNavigate();
  const teamId = params.team;
  const showList = params.all === true || teamId !== undefined;
  const selectedTicketId = params.ticket ?? null;
  const select = (id: number | null) => setParams((prev) => ({ ...prev, ticket: id ?? undefined }));

  if (isLoading) return null;
  if (!profile) {
    return (
      <Empty
        title="No Odoo server selected"
        body="Tasks reads Helpdesk from the default Odoo server. Choose one in Settings → Odoo."
        action={
          <Button onClick={() => navigate(settingsViewDef({ tab: 'odoo' }))}>
            Open Odoo settings
          </Button>
        }
      />
    );
  }

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-background text-foreground',
        showList ? 'overflow-hidden' : 'overflow-y-auto'
      )}
    >
      <div
        className={cn(
          'mx-auto flex w-full flex-1 flex-col px-6 py-6',
          showList ? 'min-h-0 max-w-none' : 'max-w-7xl'
        )}
      >
        {showList ? (
          <TicketList
            profile={profile}
            teamId={teamId}
            selectedTicketId={selectedTicketId}
            onSelect={select}
            onBack={() => setParams({})}
            onPickTeam={(id) => setParams(id === null ? { all: true } : { team: id })}
          />
        ) : (
          <TeamOverview
            profile={profile}
            onPickTeam={(id) => setParams(id === null ? { all: true } : { team: id })}
          />
        )}
      </div>
    </div>
  );
});

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Headset className="size-8 text-foreground-muted" />
      <div className="text-base font-medium">{title}</div>
      <div className="max-w-md text-sm text-foreground-muted">{body}</div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team overview: the Odoo Helpdesk landing page
// ---------------------------------------------------------------------------

const TeamOverview = observer(function TeamOverview({
  profile,
  onPickTeam,
}: {
  profile: OdooProfile;
  onPickTeam: (teamId: number | null) => void;
}) {
  const teams = useHelpdeskTeams(profile);
  const { value: helpdesk } = useAppSettingsKey('helpdesk');
  const activeByTeam = useActiveCountsByTeam(profile, helpdesk?.assignments ?? {});
  const totalOpen = (teams.data ?? []).reduce((n, t) => n + t.open, 0);
  const totalActive = Object.values(activeByTeam).reduce((n, c) => n + c, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Helpdesk"
        subtitle={`${profile.name} · ${totalOpen} open ticket${totalOpen === 1 ? '' : 's'} · ${totalActive} with an agent working`}
        onRefresh={() => void teams.refetch()}
        refreshing={teams.isFetching}
      />
      {teams.error && <ErrorLine error={teams.error} />}
      <div className="overflow-hidden rounded-lg border border-border">
        <TeamRow
          name="All tickets"
          description="Every open ticket, grouped by team and assignee"
          open={totalOpen}
          active={totalActive}
          onClick={() => onPickTeam(null)}
          strong
        />
        {(teams.data ?? []).map((team: HelpdeskTeam) => (
          <TeamRow
            key={team.id}
            name={team.name}
            description={team.description}
            open={team.open}
            active={activeByTeam[team.id] ?? 0}
            onClick={() => onPickTeam(team.id)}
          />
        ))}
        {teams.isLoading && (
          <div className="px-4 py-3 text-sm text-foreground-muted">Loading teams…</div>
        )}
      </div>
    </div>
  );
});

function TeamRow({
  name,
  description,
  open,
  active,
  onClick,
  strong,
}: {
  name: string;
  description?: string;
  open: number;
  active: number;
  onClick: () => void;
  strong?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-background-secondary"
    >
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-sm', strong ? 'font-semibold' : 'font-medium')}>
          {name}
        </div>
        {description && <div className="truncate text-xs text-foreground-muted">{description}</div>}
      </div>
      <Stat value={open} label="open" />
      <Stat value={active} label="AI working" accent={active > 0} />
      <ChevronRight className="size-4 shrink-0 text-foreground-muted" />
    </button>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="w-24 text-right">
      <span className={cn('text-sm font-semibold tabular-nums', accent && 'text-accent')}>
        {value}
      </span>
      <span className="ml-1 text-xs text-foreground-muted">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket list: the Odoo "All tickets" list view, plus the Agent column
// ---------------------------------------------------------------------------

const TicketList = observer(function TicketList({
  profile,
  teamId,
  selectedTicketId,
  onSelect,
  onBack,
  onPickTeam,
}: {
  profile: OdooProfile;
  teamId: number | undefined;
  selectedTicketId: number | null;
  onSelect: (ticketId: number | null) => void;
  onBack: () => void;
  onPickTeam: (teamId: number | null) => void;
}) {
  const tickets = useHelpdeskTickets(profile, teamId);
  const teams = useHelpdeskTeams(profile);
  const { value: helpdesk, update } = useAppSettingsKey('helpdesk');
  const assignments = helpdesk?.assignments ?? {};
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [assigning, setAssigning] = useState<number | null>(null);

  const groups = useMemo(() => groupTickets(tickets.data ?? []), [tickets.data]);
  const teamName = teams.data?.find((t) => t.id === teamId)?.name;
  const selectedTicket = tickets.data?.find((t) => t.id === selectedTicketId) ?? null;

  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const saveAssignment = (a: HelpdeskAssignment) => {
    update({ assignments: { ...assignments, [assignmentKey(a.profileId, a.ticketId)]: a } });
  };
  const clearAssignment = (ticketId: number) => {
    const next = { ...assignments };
    delete next[assignmentKey(profile.id, ticketId)];
    update({ assignments: next });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title={teamName ? `${teamName} tickets` : 'All tickets'}
        subtitle={`${profile.name} · ${tickets.data?.length ?? 0} open`}
        onRefresh={() => void tickets.refetch()}
        refreshing={tickets.isFetching}
        left={
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Teams
          </Button>
        }
        right={
          <Select.Root
            value={teamId === undefined ? 'all' : String(teamId)}
            onValueChange={(next) => onPickTeam(next === 'all' ? null : Number(next))}
          >
            <Select.Trigger className="w-[200px] gap-2">
              <Select.Value>{teamName ?? 'All teams'}</Select.Value>
            </Select.Trigger>
            <Select.Content align="end">
              <Select.Item value="all">All teams</Select.Item>
              {(teams.data ?? []).map((t) => (
                <Select.Item key={t.id} value={String(t.id)}>
                  {t.name} ({t.open})
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        }
      />
      {tickets.error && <ErrorLine error={tickets.error} />}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-xs font-medium text-foreground-muted">
                <th className="w-20 px-3 py-2">Priority</th>
                <th className="w-32 px-3 py-2">Stage</th>
                <th className="w-56 px-3 py-2">Customer</th>
                <th className="w-36 px-3 py-2">Assigned to</th>
                <th className="px-3 py-2">Name</th>
                <th className="w-64 px-3 py-2">Agent</th>
                <th className="w-24 px-3 py-2 text-right">SLA</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((team) => {
                const teamKey = `t:${team.key}`;
                const teamOpen = !collapsed[teamKey];
                return (
                  <GroupRows key={teamKey}>
                    <GroupHeader
                      depth={0}
                      label={`${team.label} (${team.count})`}
                      open={teamOpen}
                      onToggle={() => toggle(teamKey)}
                    />
                    {teamOpen &&
                      team.children.map((who) => {
                        const whoKey = `${teamKey}/${who.key}`;
                        const whoOpen = !collapsed[whoKey];
                        return (
                          <GroupRows key={whoKey}>
                            <GroupHeader
                              depth={1}
                              label={`${who.label} (${who.count})`}
                              open={whoOpen}
                              onToggle={() => toggle(whoKey)}
                            />
                            {whoOpen &&
                              who.tickets.map((ticket) => {
                                const assignment =
                                  assignments[assignmentKey(profile.id, ticket.id)] ?? null;
                                return (
                                  <TicketRowGroup key={ticket.id}>
                                    <TicketRow
                                      ticket={ticket}
                                      assignment={assignment}
                                      selected={ticket.id === selectedTicketId}
                                      onSelect={() =>
                                        onSelect(ticket.id === selectedTicketId ? null : ticket.id)
                                      }
                                      onAssign={() => setAssigning(ticket.id)}
                                      onUnassign={() => clearAssignment(ticket.id)}
                                    />
                                    {assigning === ticket.id && (
                                      <AssignRow
                                        profile={profile}
                                        ticket={ticket}
                                        onCancel={() => setAssigning(null)}
                                        onAssigned={(a) => {
                                          saveAssignment(a);
                                          setAssigning(null);
                                        }}
                                      />
                                    )}
                                  </TicketRowGroup>
                                );
                              })}
                          </GroupRows>
                        );
                      })}
                  </GroupRows>
                );
              })}
              {tickets.isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-foreground-muted">
                    Loading tickets…
                  </td>
                </tr>
              )}
              {!tickets.isLoading && groups.length === 0 && !tickets.error && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-foreground-muted">
                    No open tickets.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selectedTicket && (
          <div className="w-[460px] shrink-0 overflow-hidden rounded-lg border border-border bg-background">
            <TicketDetail
              profile={profile}
              ticket={selectedTicket}
              assignment={assignments[assignmentKey(profile.id, selectedTicket.id)] ?? null}
              onClose={() => onSelect(null)}
              onAssign={() => setAssigning(selectedTicket.id)}
            />
          </div>
        )}
      </div>
    </div>
  );
});

function GroupRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
function TicketRowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function GroupHeader({
  depth,
  label,
  open,
  onToggle,
}: {
  depth: number;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <tr
      className="cursor-pointer border-b border-border bg-background-secondary/60 hover:bg-background-secondary"
      onClick={onToggle}
    >
      <td colSpan={7} className="px-3 py-1.5" style={{ paddingLeft: 12 + depth * 20 }}>
        <span className="inline-flex items-center gap-1 text-xs font-medium">
          <Icon className="size-3.5 text-foreground-muted" />
          {label}
        </span>
      </td>
    </tr>
  );
}

const TicketRow = observer(function TicketRow({
  ticket,
  assignment,
  selected,
  onSelect,
  onAssign,
  onUnassign,
}: {
  ticket: HelpdeskTicket;
  assignment: HelpdeskAssignment | null;
  selected: boolean;
  onSelect: () => void;
  onAssign: () => void;
  onUnassign: () => void;
}) {
  const sla = ticket.slaDeadline ? formatDay(ticket.slaDeadline) : '';
  const slaLate = ticket.slaDeadline ? new Date(ticket.slaDeadline) < new Date() : false;
  return (
    <tr
      className={cn(
        'cursor-pointer border-b border-border hover:bg-background-secondary/40',
        selected && 'bg-accent/10 hover:bg-accent/10'
      )}
      onClick={onSelect}
    >
      <td className="px-3 py-2">
        <Stars value={ticket.priority} />
      </td>
      <td className="truncate px-3 py-2">{ticket.stage}</td>
      <td className="text-accent max-w-56 truncate px-3 py-2" title={ticket.customer}>
        {ticket.customer}
      </td>
      <td className="truncate px-3 py-2">
        {ticket.assignee ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-accent/20 text-accent inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold">
              {ticket.assignee.slice(0, 1)}
            </span>
            {ticket.assignee}
          </span>
        ) : (
          <span className="text-foreground-muted">Unassigned</span>
        )}
      </td>
      <td className="px-3 py-2" title={ticket.description}>
        <span className="mr-2 text-xs text-foreground-muted">#{ticket.ref}</span>
        {ticket.name}
      </td>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <AgentCell assignment={assignment} onAssign={onAssign} onUnassign={onUnassign} />
      </td>
      <td className={cn('px-3 py-2 text-right', slaLate && 'text-red-500')}>{sla}</td>
    </tr>
  );
});

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3].map((n) => (
        <Star
          key={n}
          className={cn(
            'size-3.5',
            n <= value ? 'fill-amber-400 text-amber-400' : 'text-foreground-muted/50'
          )}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Agent column
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  working: { text: 'Working', className: 'bg-emerald-500/15 text-emerald-600' },
  'awaiting-input': { text: 'Needs you', className: 'bg-amber-500/15 text-amber-600' },
  error: { text: 'Failed', className: 'bg-red-500/15 text-red-600' },
  completed: { text: 'Done', className: 'bg-sky-500/15 text-sky-600' },
  idle: { text: 'Idle', className: 'bg-foreground/10 text-foreground-muted' },
  missing: { text: 'Task gone', className: 'bg-foreground/10 text-foreground-muted' },
};

const AgentCell = observer(function AgentCell({
  assignment,
  onAssign,
  onUnassign,
}: {
  assignment: HelpdeskAssignment | null;
  onAssign: () => void;
  onUnassign: () => void;
}) {
  const { navigate } = useNavigate();
  if (!assignment) {
    return (
      <Button variant="secondary" size="sm" onClick={onAssign}>
        Assign agent
      </Button>
    );
  }
  const taskStore = getTaskStore(assignment.projectId, assignment.taskId);
  const status = taskStore ? (taskAgentStatus(taskStore) ?? 'idle') : 'missing';
  const label = STATUS_LABEL[status] ?? STATUS_LABEL.idle;
  const project = projectData(getProjectStore(assignment.projectId));
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-background-secondary"
        onClick={() =>
          navigate(taskViewDef({ projectId: assignment.projectId, taskId: assignment.taskId }))
        }
        title={`Open the task (${project?.name ?? 'project'})`}
      >
        <AgentIcon id={assignment.provider} size={16} />
        <span className="min-w-0">
          <span className="block truncate text-sm">
            <ProviderName id={assignment.provider} />
          </span>
          <span className="block truncate text-[11px] text-foreground-muted">
            {project?.name ?? assignment.projectId}
          </span>
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', label.className)}>
          {label.text}
        </span>
      </button>
      <button
        type="button"
        className="text-[11px] text-foreground-muted hover:text-foreground"
        onClick={onUnassign}
        title="Forget this assignment (the task stays)"
      >
        ×
      </button>
    </div>
  );
});

function ProviderName({ id }: { id: string }) {
  const { data } = useAgents(hostRefFromConnectionId(undefined));
  return <>{data?.find((a) => a.id === id)?.name ?? id}</>;
}

// ---------------------------------------------------------------------------
// Assign row: pick the worker and the project, then start the task
// ---------------------------------------------------------------------------

const AssignRow = observer(function AssignRow({
  profile,
  ticket,
  onCancel,
  onAssigned,
}: {
  profile: OdooProfile;
  ticket: HelpdeskTicket;
  onCancel: () => void;
  onAssigned: (assignment: HelpdeskAssignment) => void;
}) {
  const projects = useProjectOptions();
  const paired = projects.find((p) => p.path.endsWith(`odoo-${profile.id}`)) ?? projects[0];
  const [projectId, setProjectId] = useState<string | undefined>(paired?.id);
  const project = projects.find((p) => p.id === projectId);
  const [provider, setProvider] = useState<AgentProviderId | null>(null);
  const [busy, setBusy] = useState(false);
  const { groups } = useAgentAvailability({ connectionId: project?.connectionId, value: provider });
  const options = groups.flatMap((g) => g.items);
  const effectiveProvider =
    provider ??
    options.find((o) => o.agentId === ('hermes' as AgentProviderId) && !o.disabled)?.agentId ??
    options.find((o) => !o.disabled)?.agentId ??
    null;
  const option = options.find((o) => o.agentId === effectiveProvider);

  const start = async () => {
    if (!projectId || !effectiveProvider || !project) return;
    const taskManager = getTaskManagerStore(projectId);
    if (!taskManager) {
      toast.error('That project is not ready yet');
      return;
    }
    setBusy(true);
    try {
      const taskId = crypto.randomUUID();
      const prompt = ticketPrompt(profile, ticket);
      const useAcp = option?.supportsAcp ?? true;
      await taskManager.createTask({
        id: taskId,
        projectId,
        taskConfig: {
          version: '1',
          name: `#${ticket.ref} ${ticket.name}`.slice(0, 120),
          initialConversation: {
            id: crypto.randomUUID(),
            provider: effectiveProvider,
            title: 'Ticket',
            type: useAcp ? 'acp' : 'pty',
            ...(useAcp ? { initialQueue: [{ text: prompt }] } : { initialPrompt: prompt }),
            autoApprove: false,
          },
        },
        workspaceConfig: {
          version: '2',
          git: { kind: 'none' },
          workspace: project.repositoryWorkspaceId
            ? { kind: 'repository-instance', workspaceId: project.repositoryWorkspaceId }
            : { kind: 'new-worktree' },
        },
      });
      onAssigned({
        profileId: profile.id,
        ticketId: ticket.id,
        ticketRef: ticket.ref,
        ticketName: ticket.name,
        projectId,
        taskId,
        provider: effectiveProvider,
        assignedAt: new Date().toISOString(),
      });
      toast(`${option?.label ?? effectiveProvider} is on ticket #${ticket.ref}`);
    } catch (error) {
      toast.error('Could not start the task', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr
      className="border-b border-border bg-background-secondary/40"
      onClick={(e) => e.stopPropagation()}
    >
      <td colSpan={7} className="px-3 py-3">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Worker">
            <AgentSelector
              value={effectiveProvider}
              onChange={setProvider}
              connectionId={project?.connectionId}
              className="w-[240px]"
            />
          </Field>
          <Field label="Project (the worker's computer)">
            <Select.Root
              value={projectId ?? ''}
              onValueChange={(v) => setProjectId(v || undefined)}
            >
              <Select.Trigger className="w-[260px] gap-2">
                <Select.Value>{project?.name ?? 'Choose a project'}</Select.Value>
              </Select.Trigger>
              <Select.Content>
                {projects.map((p) => (
                  <Select.Item key={p.id} value={p.id}>
                    {p.name}
                    {p.connectionId ? ' (remote)' : ''}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void start()}
              disabled={busy || !projectId || !effectiveProvider}
            >
              {busy ? 'Starting…' : 'Start on this ticket'}
            </Button>
          </div>
        </div>
        <div className="mt-2 text-xs text-foreground-muted">
          The worker reads the ticket from Odoo, investigates, and reports back in its task. It does
          not change the ticket or send anything without asking.
        </div>
      </td>
    </tr>
  );
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ProjectOption = {
  id: string;
  name: string;
  path: string;
  connectionId?: string;
  repositoryWorkspaceId: string | null;
};

/** Every project the app knows about. Call inside `observer`. */
function useProjectOptions(): ProjectOption[] {
  const out: ProjectOption[] = [];
  for (const [id, store] of getProjectManagerStore().projects.entries()) {
    const data = projectData(store);
    if (!data) continue;
    out.push({
      id,
      name: data.name,
      path: data.path,
      connectionId: data.type === 'ssh' ? data.connectionId : undefined,
      repositoryWorkspaceId: data.repositoryWorkspaceId ?? null,
    });
  }
  return out;
}

/** Tickets with a working agent, counted per Odoo team. Call inside `observer`. */
function useActiveCountsByTeam(
  profile: OdooProfile,
  assignments: Record<string, HelpdeskAssignment>
): Record<number, number> {
  const tickets = useHelpdeskTickets(profile);
  const byTicket = new Map<number, number | null>();
  for (const t of tickets.data ?? []) byTicket.set(t.id, t.teamId);
  const counts: Record<number, number> = {};
  for (const a of Object.values(assignments)) {
    if (a.profileId !== profile.id) continue;
    const store = getTaskStore(a.projectId, a.taskId);
    if (!store || taskAgentStatus(store) !== 'working') continue;
    const teamId = byTicket.get(a.ticketId);
    if (teamId == null) continue;
    counts[teamId] = (counts[teamId] ?? 0) + 1;
  }
  return counts;
}

type WhoGroup = { key: string; label: string; count: number; tickets: HelpdeskTicket[] };
type TeamGroup = { key: string; label: string; count: number; children: WhoGroup[] };

/** Odoo's default grouping for this list: team, then assignee, unassigned last. */
function groupTickets(tickets: HelpdeskTicket[]): TeamGroup[] {
  const teams = new Map<string, TeamGroup>();
  for (const t of tickets) {
    const teamKey = String(t.teamId ?? 'none');
    let team = teams.get(teamKey);
    if (!team) {
      team = { key: teamKey, label: t.team || 'No team', count: 0, children: [] };
      teams.set(teamKey, team);
    }
    team.count += 1;
    const whoKey = String(t.assigneeId ?? 'none');
    let who = team.children.find((w) => w.key === whoKey);
    if (!who) {
      who = { key: whoKey, label: t.assignee || 'Unassigned', count: 0, tickets: [] };
      team.children.push(who);
    }
    who.count += 1;
    who.tickets.push(t);
  }
  const out = [...teams.values()];
  for (const team of out) {
    team.children.sort((a, b) =>
      a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label)
    );
  }
  return out.sort((a, b) => b.count - a.count);
}

function ticketPrompt(profile: OdooProfile, ticket: HelpdeskTicket): string {
  const lines = [
    `Odoo Helpdesk ticket #${ticket.ref}: ${ticket.name}`,
    `Server: ${profile.name} (profile "${profile.id}", ${profile.url})`,
    `Team: ${ticket.team || 'none'} · Stage: ${ticket.stage} · Assigned to: ${ticket.assignee || 'nobody'} · Priority: ${ticket.priority}/3`,
    `Customer: ${ticket.customer || 'not set'}`,
    ticket.slaDeadline ? `SLA deadline: ${ticket.slaDeadline}` : '',
    `Opened: ${ticket.createdAt} · Last activity: ${ticket.updatedAt}`,
    '',
    'Description:',
    ticket.description || '(empty)',
    '',
    `Read the full ticket in Odoo first: helpdesk.ticket id ${ticket.id}, including its chatter (mail.message with model helpdesk.ticket and res_id ${ticket.id}), using \`atlas odoo --profile ${profile.id}\`.`,
    'Then investigate the problem with the tools you have, and report: what happened, what you found, and the recommended next action.',
    'Do not change the ticket, send email, or run anything destructive without asking first.',
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

function formatDay(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function PageHeader({
  title,
  subtitle,
  onRefresh,
  refreshing,
  left,
  right,
}: {
  title: string;
  subtitle: string;
  onRefresh: () => void;
  refreshing: boolean;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {left}
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="truncate text-xs text-foreground-muted">{subtitle}</div>
      </div>
      {right}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh"
      >
        <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
      </Button>
    </div>
  );
}

function ErrorLine({ error }: { error: Error }) {
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
      {error.message}
    </div>
  );
}

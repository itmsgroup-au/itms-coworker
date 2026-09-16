import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { toast } from '@emdash/ui/react/primitives';
import { when } from 'mobx';
import { useCallback, useState } from 'react';
import { useAgentAvailability } from '@core/features/agents/api/browser/components/agent-selector/use-agent-availability';
import { getOdooClient } from '@core/features/odoo/api/browser/client';
import type { HelpdeskTicket, OdooProfileSummary } from '@core/features/odoo/api/contract';
import {
  getProjectManagerStore,
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { HelpdeskAssignment } from '@core/primitives/app-settings/api';

/** The worker the one-click button uses when nobody chose one. */
const PREFERRED_PROVIDER = 'hermes' as AgentProviderId;

/** How long to wait for a project to finish opening before giving up. */
const PROJECT_READY_TIMEOUT_MS = 60_000;

export type TicketAgentState =
  | { phase: 'starting'; step: string }
  | { phase: 'error'; message: string };

export type StartTicketAgentOptions = {
  /** Worker to use; the default worker when omitted. */
  provider?: AgentProviderId;
  /** Project to run in; the Odoo project for this server when omitted. */
  projectId?: string;
  /** Whether that worker speaks ACP; resolved from the default worker when omitted. */
  supportsAcp?: boolean;
};

export type TicketAgentLauncher = {
  /** The worker a plain click will use, or null while the agent list loads. */
  defaultProvider: AgentProviderId | null;
  /** The name of that worker, for the button title. */
  defaultProviderLabel: string | null;
  stateFor: (ticketId: number) => TicketAgentState | null;
  clearState: (ticketId: number) => void;
  /** Resolves true when the task was created, false when it failed. */
  start: (ticket: HelpdeskTicket, options?: StartTicketAgentOptions) => Promise<boolean>;
};

/**
 * One click from a ticket row to a running agent: resolve the worker, resolve
 * (or create) the project paired with the Odoo server, then create the task.
 * Call inside an `observer` component.
 */
export function useTicketAgentLauncher({
  profile,
  onAssigned,
}: {
  profile: OdooProfileSummary;
  onAssigned: (assignment: HelpdeskAssignment) => void;
}): TicketAgentLauncher {
  const [states, setStates] = useState<Record<number, TicketAgentState>>({});
  const { groups } = useAgentAvailability({ value: null });
  const options = groups.flatMap((g) => g.items);
  const defaultOption =
    options.find((o) => o.agentId === PREFERRED_PROVIDER && !o.disabled) ??
    options.find((o) => !o.disabled) ??
    null;

  const setState = useCallback((ticketId: number, state: TicketAgentState) => {
    setStates((prev) => ({ ...prev, [ticketId]: state }));
  }, []);

  const clearState = useCallback((ticketId: number) => {
    setStates((prev) => {
      if (!(ticketId in prev)) return prev;
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
  }, []);

  const start = useCallback(
    async (ticket: HelpdeskTicket, startOptions?: StartTicketAgentOptions) => {
      const provider = startOptions?.provider ?? defaultOption?.agentId ?? null;
      const supportsAcp = startOptions?.supportsAcp ?? defaultOption?.supportsAcp ?? true;
      if (!provider) {
        setState(ticket.id, {
          phase: 'error',
          message: 'No worker is installed. Install one in Settings → Agents.',
        });
        return false;
      }
      setState(ticket.id, { phase: 'starting', step: 'Preparing the project…' });
      try {
        const projectId =
          startOptions?.projectId ??
          (await resolveOdooProjectId(profile.id, (step) =>
            setState(ticket.id, { phase: 'starting', step })
          ));

        setState(ticket.id, { phase: 'starting', step: 'Opening the project…' });
        const taskManager = await waitForTaskManager(projectId);
        const data = projectData(getProjectStore(projectId));
        if (!data) throw new Error('That project is not available.');

        setState(ticket.id, { phase: 'starting', step: 'Starting the worker…' });
        const taskId = crypto.randomUUID();
        const atlasProfile = await resolveAtlasProfile(profile.id);
        await taskManager.createTask({
          id: taskId,
          projectId,
          taskConfig: {
            version: '1',
            name: `#${ticket.ref} ${ticket.name}`.slice(0, 120),
            initialConversation: {
              id: crypto.randomUUID(),
              provider,
              title: 'Ticket',
              type: supportsAcp ? 'acp' : 'pty',
              ...(supportsAcp
                ? { initialQueue: [{ text: ticketPrompt(profile, ticket, atlasProfile) }] }
                : { initialPrompt: ticketPrompt(profile, ticket, atlasProfile) }),
              autoApprove: false,
            },
          },
          workspaceConfig: {
            version: '2',
            git: { kind: 'none' },
            workspace: data.repositoryWorkspaceId
              ? { kind: 'repository-instance', workspaceId: data.repositoryWorkspaceId }
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
          provider,
          assignedAt: new Date().toISOString(),
        });
        clearState(ticket.id);
        toast(`${labelFor(provider, options)} is on ticket #${ticket.ref}`);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState(ticket.id, { phase: 'error', message });
        toast.error(`Could not start a worker on #${ticket.ref}`, { description: message });
        return false;
      }
    },
    [clearState, defaultOption, onAssigned, options, profile, setState]
  );

  return {
    defaultProvider: defaultOption?.agentId ?? null,
    defaultProviderLabel: defaultOption?.label ?? null,
    stateFor: (ticketId: number) => states[ticketId] ?? null,
    clearState,
    start,
  };
}

/**
 * The project paired with this Odoo server. The durable marker is the folder
 * path the Odoo service itself owns (`prepareProject`), which also scaffolds
 * the folder when it is missing; the old `odoo-<id>` path suffix stays as a
 * fallback for projects added by hand. Creates the project when there is none.
 */
async function resolveOdooProjectId(
  profileId: string,
  onStep: (step: string) => void
): Promise<string> {
  const folder = await (await getOdooClient()).prepareProject({ profileId });
  const byMarker = findProjectIdByPath(folder.path);
  if (byMarker) return byMarker;
  const bySuffix = findProjectIdByPathSuffix(`odoo-${profileId}`);
  if (bySuffix) return bySuffix;

  onStep('Adding the project…');
  const result = await getProjectManagerStore().startProjectCreation(
    { type: 'local' },
    { mode: 'pick', name: folder.name, path: folder.path, initGitRepository: false }
  );
  if (result.kind === 'existing') return result.projectId;
  const completion = await result.completion;
  if (!completion.success) {
    throw new Error(`Could not add the project at ${folder.path}: ${describe(completion.error)}`);
  }
  return result.projectId;
}

function findProjectIdByPath(path: string): string | undefined {
  const wanted = normalizePath(path);
  for (const [id, store] of getProjectManagerStore().projects.entries()) {
    const data = projectData(store);
    if (data && data.type === 'local' && normalizePath(data.path) === wanted) return id;
  }
  return undefined;
}

function findProjectIdByPathSuffix(suffix: string): string | undefined {
  const wanted = suffix.toLowerCase();
  for (const [id, store] of getProjectManagerStore().projects.entries()) {
    const data = projectData(store);
    if (data && normalizePath(data.path).endsWith(wanted)) return id;
  }
  return undefined;
}

function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, '').toLowerCase();
}

/** Hydrates the project context, then waits for its task manager to exist. */
async function waitForTaskManager(projectId: string) {
  await getProjectManagerStore().hydrateProjectContext(projectId);
  try {
    await when(() => getTaskManagerStore(projectId) !== undefined, {
      timeout: PROJECT_READY_TIMEOUT_MS,
    });
  } catch {
    throw new Error('The project did not finish opening. Open it once, then try again.');
  }
  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) throw new Error('That project is not ready yet.');
  return taskManager;
}

function describe(error: { type: string; message?: string }): string {
  return error.message && error.message.length > 0 ? error.message : error.type;
}

function labelFor(
  provider: AgentProviderId,
  options: { agentId: string; label: string }[]
): string {
  return options.find((o) => o.agentId === provider)?.label ?? provider;
}

/**
 * The name `atlas` and the `odoo` CLI know this server by.
 *
 * `~/.odoo-profiles.json` is keyed by that name (for example `ITMS19`), which
 * is neither this app's profile id (`itms-19`) nor its display name
 * (`itms - 19`). Measured 16 Sep 2026: a ticket prompt that passed the id made
 * the agent's first command fail with `unknown Odoo profile "itms-19"`. The
 * main process matches on the server the profile points at and returns null
 * rather than guess, so a failure here means no atlas profile name, not a
 * wrong one.
 */
async function resolveAtlasProfile(profileId: string): Promise<string | null> {
  try {
    return await (await getOdooClient()).atlasProfileName({ profileId });
  } catch {
    return null;
  }
}

/** What the worker is told about the ticket before it starts. */
export function ticketPrompt(
  profile: OdooProfileSummary,
  ticket: HelpdeskTicket,
  atlasProfile?: string | null
): string {
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
    `Read the full ticket in Odoo first: helpdesk.ticket id ${ticket.id}, including its chatter (mail.message with model helpdesk.ticket and res_id ${ticket.id}).`,
    atlasProfile
      ? `Use the odoo MCP tools if you have them, otherwise \`atlas odoo --profile ${atlasProfile}\`.`
      : `Use the odoo MCP tools if you have them. For atlas, run \`atlas odoo profiles\` first and pick the one for ${profile.url} (database ${profile.db}); this app's own id "${profile.id}" is not an atlas profile name.`,
    'Then investigate the problem with the tools you have, and report: what happened, what you found, and the recommended next action.',
    'Do not change the ticket, send email, or run anything destructive without asking first.',
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

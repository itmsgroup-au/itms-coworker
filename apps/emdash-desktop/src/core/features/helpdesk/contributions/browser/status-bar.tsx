import { Ticket } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import { helpdeskViewDef } from '@core/features/helpdesk/contributions/views';
import {
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { HelpdeskAssignment } from '@core/primitives/app-settings/api';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';

type Live = { assignment: HelpdeskAssignment; status: string; project: string };

const STATUS_TEXT: Record<string, string> = {
  working: 'Working',
  'awaiting-input': 'Needs you',
  error: 'Failed',
  completed: 'Done',
};

const DOT: Record<string, string> = {
  working: 'bg-emerald-500 animate-pulse',
  'awaiting-input': 'bg-amber-500',
  error: 'bg-red-500',
  completed: 'bg-sky-500',
};

/**
 * The strip along the bottom of every view: which agents are on which
 * tickets right now. Working first, then anything that needs a person,
 * then failures, then done. Idle assignments stay out of the way.
 */
export const CoWorkerStatusBar = observer(function CoWorkerStatusBar() {
  const { navigate } = useNavigate();
  const { value } = useAppSettingsKey('helpdesk');
  const assignments = Object.values(value?.assignments ?? {});

  const live: Live[] = [];
  for (const assignment of assignments) {
    const store = getTaskStore(assignment.projectId, assignment.taskId);
    if (!store) continue;
    const status = taskAgentStatus(store);
    if (!status || status === 'idle') continue;
    live.push({
      assignment,
      status,
      project: projectData(getProjectStore(assignment.projectId))?.name ?? '',
    });
  }
  const order = ['working', 'awaiting-input', 'error', 'completed'];
  live.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-(--em-surface) px-3 text-xs text-foreground-muted">
      <button
        type="button"
        onClick={() => navigate(helpdeskViewDef({ all: true }))}
        className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-background-secondary hover:text-foreground"
        title="Open Tasks"
      >
        <Ticket className="size-3.5" />
        <span>{live.length === 0 ? 'No agent working' : `${live.length} on tickets`}</span>
      </button>
      {live.map(({ assignment, status, project }) => (
        <button
          key={`${assignment.profileId}:${assignment.ticketId}`}
          type="button"
          onClick={() => navigate(helpdeskViewDef({ all: true, ticket: assignment.ticketId }))}
          onDoubleClick={() =>
            navigate(taskViewDef({ projectId: assignment.projectId, taskId: assignment.taskId }))
          }
          className="flex max-w-xs shrink-0 items-center gap-1.5 rounded border border-border px-2 py-0.5 text-foreground hover:bg-background-secondary"
          title={`${assignment.ticketName}\n${project} · click for the ticket, double-click for the task`}
        >
          <span
            className={cn('inline-block size-2 rounded-full', DOT[status] ?? 'bg-foreground-muted')}
          />
          <AgentIcon id={assignment.provider} size={14} />
          <span className="truncate">
            #{assignment.ticketRef} {assignment.ticketName}
          </span>
          <span className="shrink-0 text-foreground-muted">{STATUS_TEXT[status] ?? status}</span>
        </button>
      ))}
    </div>
  );
});

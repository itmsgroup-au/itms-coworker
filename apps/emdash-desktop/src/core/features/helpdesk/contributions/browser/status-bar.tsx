import { Ticket } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import { useHelpdeskAssignments } from '@core/features/helpdesk/contributions/browser/assignments';
import { helpdeskViewDef } from '@core/features/helpdesk/contributions/views';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { AgentStatus } from '@core/primitives/agents/api';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';

const STATUS_TEXT: Record<Exclude<AgentStatus, 'idle'>, string> = {
  working: 'Working',
  'awaiting-input': 'Needs you',
  error: 'Failed',
  completed: 'Done',
};

const DOT: Record<Exclude<AgentStatus, 'idle'>, string> = {
  working: 'bg-emerald-500 animate-pulse',
  'awaiting-input': 'bg-amber-500',
  error: 'bg-red-500',
  completed: 'bg-sky-500',
};

/**
 * The strip along the bottom of every view: which agents are on which
 * tickets right now. Working first, then anything that needs a person,
 * then failures, then done. Idle assignments stay out of the way.
 *
 * This is the one mount that reconciles assignments, so an entry whose project
 * or task was deleted is dropped from settings rather than shown forever.
 */
export const CoWorkerStatusBar = observer(function CoWorkerStatusBar() {
  const { navigate } = useNavigate();
  const { active } = useHelpdeskAssignments({ reconcile: true });

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-(--em-surface) px-3 text-xs text-foreground-muted">
      <button
        type="button"
        onClick={() => navigate(helpdeskViewDef({ all: true }))}
        className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-background-secondary hover:text-foreground"
        title="Open Tasks"
      >
        <Ticket className="size-3.5" />
        <span>{active.length === 0 ? 'No agent working' : `${active.length} on tickets`}</span>
      </button>
      {active.map(({ key, assignment, status, projectName }) => (
        <button
          key={key}
          type="button"
          onClick={() => navigate(helpdeskViewDef({ all: true, ticket: assignment.ticketId }))}
          onDoubleClick={() =>
            navigate(taskViewDef({ projectId: assignment.projectId, taskId: assignment.taskId }))
          }
          className="flex max-w-xs shrink-0 items-center gap-1.5 rounded border border-border px-2 py-0.5 text-foreground hover:bg-background-secondary"
          title={`${assignment.ticketName}\n${projectName} · click for the ticket, double-click for the task`}
        >
          <span className={cn('inline-block size-2 rounded-full', DOT[status])} />
          <AgentIcon id={assignment.provider} size={14} />
          <span className="truncate">
            #{assignment.ticketRef} {assignment.ticketName}
          </span>
          <span className="shrink-0 text-foreground-muted">{STATUS_TEXT[status]}</span>
        </button>
      ))}
    </div>
  );
});

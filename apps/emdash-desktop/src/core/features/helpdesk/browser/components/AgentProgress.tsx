import { observer } from 'mobx-react-lite';
import { useCallback, useSyncExternalStore } from 'react';
import {
  EMPTY_TRANSCRIPT_SUMMARY,
  type TaskTranscriptSummary,
  type TranscriptStep,
} from '@core/features/conversations/api/browser/acp-transcript';
import {
  getTaskProgressSnapshot,
  subscribeTaskProgress,
} from '@core/features/helpdesk/api/browser/agent-progress-source';
import { cn } from '@core/primitives/styling/browser/cn';

export type ProgressStep = TranscriptStep;
export type TaskProgress = TaskTranscriptSummary;

/**
 * A task's agent progress, read from the ACP live models rather than from a
 * mounted chat panel, so a ticket whose task view was never opened still shows
 * its steps. One shared subscription per task id; there is no polling.
 *
 * The second argument is accepted for callers written against the old polling
 * signature and is ignored.
 */
export function useTaskProgress(taskId: string | null, _intervalMs?: number): TaskProgress {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!taskId) return () => {};
      return subscribeTaskProgress(taskId, listener);
    },
    [taskId]
  );
  const getSnapshot = useCallback(
    () => (taskId ? getTaskProgressSnapshot(taskId) : EMPTY_TRANSCRIPT_SUMMARY),
    [taskId]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const AgentProgressList = observer(function AgentProgressList({
  taskId,
  max = 12,
}: {
  taskId: string;
  max?: number;
}) {
  const progress = useTaskProgress(taskId);
  if (!progress.available) {
    return <div className="text-xs text-foreground-muted">Reading the worker's output…</div>;
  }
  const shown = progress.steps.slice(-max);
  const hidden = progress.steps.length - shown.length;
  if (shown.length === 0 && progress.suspended) {
    return (
      <div className="text-xs text-foreground-muted">
        The worker is paused. Open the task to replay its earlier steps.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {hidden > 0 && (
        <div className="text-[11px] text-foreground-muted">… {hidden} earlier steps</div>
      )}
      {shown.length === 0 && <div className="text-xs text-foreground-muted">No steps yet.</div>}
      {shown.map((step) => (
        <div key={step.id} className="flex items-start gap-2 text-xs">
          <span
            className={cn(
              'mt-1 inline-block size-2 shrink-0 rounded-full',
              step.status === 'running' && 'animate-pulse bg-emerald-500',
              step.status === 'done' && 'bg-foreground-muted/60',
              step.status === 'error' && 'bg-red-500'
            )}
          />
          <span
            className={cn('truncate', step.status === 'error' && 'text-red-600')}
            title={step.title}
          >
            {step.title}
          </span>
        </div>
      ))}
    </div>
  );
});

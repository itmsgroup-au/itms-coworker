import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import {
  EMPTY_TRANSCRIPT_SUMMARY,
  readTaskTranscript,
  type TaskTranscriptSummary,
  type TranscriptStep,
} from '@core/features/conversations/api/browser/acp-transcript';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import { cn } from '@core/primitives/styling/browser/cn';

export type ProgressStep = TranscriptStep;
export type TaskProgress = TaskTranscriptSummary;
const EMPTY = EMPTY_TRANSCRIPT_SUMMARY;
const readTaskProgress = readTaskTranscript;

export function useTaskProgress(taskId: string | null, intervalMs = 2000): TaskProgress {
  const [progress, setProgress] = useState<TaskProgress>(EMPTY);
  useEffect(() => {
    if (!taskId) {
      setProgress(EMPTY);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        setProgress(readTaskProgress(taskId));
      } catch {
        setProgress(EMPTY);
      }
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId, intervalMs]);
  return progress;
}

export const AgentProgressList = observer(function AgentProgressList({
  taskId,
  max = 12,
}: {
  taskId: string;
  max?: number;
}) {
  const progress = useTaskProgress(taskId);
  const conversations = getConversationsForTask(taskId);
  if (!progress.available) {
    return (
      <div className="text-xs text-foreground-muted">
        {conversations ? 'Open the task once to see its steps here.' : 'The task is starting.'}
      </div>
    );
  }
  const shown = progress.steps.slice(-max);
  const hidden = progress.steps.length - shown.length;
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

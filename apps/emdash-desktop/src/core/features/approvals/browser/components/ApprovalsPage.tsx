import { Button } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useAgentAvailability } from '@core/features/agents/api/browser/components/agent-selector/use-agent-availability';
import {
  approvalDetail,
  resolveApproval,
  usePendingApprovals,
  type PendingApproval,
} from '@core/features/approvals/api/browser/approvals-source';
import { useDefaultOdooProfile, useJidoApprovals } from '@core/features/jido/api/browser/use-jido';
import { jidoViewDef } from '@core/features/jido/contributions/views';
import {
  getTaskStore,
  taskDisplayName,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';

/** The inbox: one row per waiting permission, answered in place. */
export const ApprovalsPage = observer(function ApprovalsPage() {
  const approvals = usePendingApprovals();
  const { groups } = useAgentAvailability({ value: null });
  const labels = new Map(groups.flatMap((g) => g.items).map((o) => [o.agentId, o.label]));

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
        <div>
          <h1 className="text-lg font-semibold">Approvals</h1>
          <p className="text-sm text-foreground-secondary">
            Agents stop here before anything that needs your OK. Nothing runs until you answer.
          </p>
        </div>
        <ProcedureApprovalsLink />
        {approvals.length === 0 ? (
          <div className="rounded-lg border border-border px-4 py-8 text-center text-sm text-foreground-secondary">
            Nothing is waiting for you.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {approvals.map((approval) => (
              <ApprovalRow
                key={`${approval.conversationId}:${approval.request.requestId}`}
                approval={approval}
                workerLabel={labels.get(approval.providerId) ?? approval.providerId}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

const ApprovalRow = observer(function ApprovalRow({
  approval,
  workerLabel,
}: {
  approval: PendingApproval;
  workerLabel: string;
}) {
  const { navigate } = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { request, projectId, taskId } = approval;
  const taskName =
    (projectId && taskId ? taskDisplayName(getTaskStore(projectId, taskId)) : undefined) ??
    approval.conversationTitle;
  const detail = approvalDetail(request.toolCall);

  const answer = async (optionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await resolveApproval(approval.conversationId, request.requestId, optionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm font-medium">{taskName}</span>
        <span className="shrink-0 text-xs text-foreground-tertiary">{workerLabel}</span>
      </div>
      <div className="text-sm">{request.toolCall.title}</div>
      {detail && detail !== request.toolCall.title && (
        <code className="block overflow-x-auto rounded bg-background-secondary px-2 py-1 font-mono text-xs whitespace-pre-wrap">
          {detail}
        </code>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {request.options.map((option) => (
          <Button
            key={option.optionId}
            size="sm"
            variant={option.kind.startsWith('allow') ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => void answer(option.optionId)}
          >
            {option.name}
          </Button>
        ))}
        {projectId && taskId && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(taskViewDef({ projectId, taskId }))}
          >
            Open chat
          </Button>
        )}
      </div>
      {error && <div className="text-xs text-red-500">Could not answer: {error}</div>}
    </li>
  );
});

/** Jido procedure approvals live in Odoo; point to them so one inbox reaches everything. */
function ProcedureApprovalsLink() {
  const { navigate } = useNavigate();
  const { profile } = useDefaultOdooProfile();
  const procedures = useJidoApprovals(profile?.id ?? null);
  const count = procedures.data?.length ?? 0;
  if (!profile || count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(jidoViewDef({ tab: 'approvals' }))}
      className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-left text-sm hover:bg-background-secondary"
    >
      <span>
        {count} procedure approval{count === 1 ? '' : 's'} waiting in Odoo ({profile.name})
      </span>
      <span className="text-foreground-secondary">Open Procedures →</span>
    </button>
  );
}

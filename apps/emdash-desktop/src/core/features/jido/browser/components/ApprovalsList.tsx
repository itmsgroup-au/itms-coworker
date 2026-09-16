import { Button, Textarea, toast } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import {
  approveBlockedReason,
  approveJidoAction,
  rejectBlockedReason,
  rejectJidoAction,
  useInvalidateJido,
  useJidoApprovals,
  type JidoApproval,
} from '@core/features/jido/api/browser/use-jido';
import type { OdooProfileSummary } from '@core/features/odoo/api';
import { cn } from '@core/primitives/styling/browser/cn';
import { ErrorLine, formatPayload, formatWhen, PageHeader } from './shared';

export function ApprovalsList({
  profile,
  selectedApprovalId,
  onSelect,
}: {
  profile: OdooProfileSummary;
  selectedApprovalId: number | null;
  onSelect: (approvalId: number | null) => void;
}) {
  const approvals = useJidoApprovals(profile.id, { proceduresOnly: false });
  const rows = approvals.data ?? [];
  const selected = rows.find((row) => row.id === selectedApprovalId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Waiting for approval"
        subtitle={`${profile.name} · ${rows.length} waiting`}
        onRefresh={() => void approvals.refetch()}
        refreshing={approvals.isFetching}
      />
      {approvals.error && <ErrorLine error={approvals.error} />}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-xs font-medium text-foreground-muted">
                <th className="w-40 px-3 py-2">Asked</th>
                <th className="w-32 px-3 py-2">Asked by</th>
                <th className="px-3 py-2">What is waiting</th>
                <th className="w-52 px-3 py-2">On</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((approval) => (
                <tr
                  key={approval.id}
                  className={cn(
                    'cursor-pointer border-b border-border hover:bg-background-secondary/40',
                    approval.id === selectedApprovalId && 'bg-accent/10 hover:bg-accent/10'
                  )}
                  onClick={() => onSelect(approval.id === selectedApprovalId ? null : approval.id)}
                >
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {formatWhen(approval.createdAt)}
                  </td>
                  <td className="truncate px-3 py-2">{approval.requestedBy || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="truncate">{approval.name}</div>
                    <div className="truncate text-xs text-foreground-muted">
                      {describeWrite(approval)}
                    </div>
                  </td>
                  <td className="truncate px-3 py-2" title={approval.taskName}>
                    {approval.targetDisplay || approval.taskName || '—'}
                  </td>
                </tr>
              ))}
              {approvals.isLoading && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-foreground-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!approvals.isLoading && rows.length === 0 && !approvals.error && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-foreground-muted">
                    Nothing is waiting for approval.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selected && (
          <div className="w-[460px] shrink-0 overflow-auto rounded-lg border border-border bg-background p-4">
            <ApprovalDetail profile={profile} approval={selected} onClose={() => onSelect(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

/** One line naming the exact write, in the words of the record itself. */
export function describeWrite(approval: JidoApproval): string {
  if (approval.actionType === 'write') {
    return `Write ${approval.payload} to ${approval.targetModel} ${approval.targetId}`;
  }
  if (approval.actionType === 'create') {
    return `Create a ${approval.targetModel} record`;
  }
  if (approval.actionType === 'connector_call') {
    return `Run ${approval.toolRef || 'a command'}`;
  }
  if (approval.actionType === 'message_post') {
    return `Send a message on ${approval.targetModel} ${approval.targetId}`;
  }
  if (approval.actionType === 'log_note') {
    return `Add an internal note on ${approval.targetModel} ${approval.targetId}`;
  }
  if (approval.actionType === 'ask') {
    return approval.askQuestion.split('\n')[0] ?? 'A question for you';
  }
  return approval.actionType;
}

type Pending = { kind: 'approve' } | { kind: 'reject' } | null;

function ApprovalDetail({
  profile,
  approval,
  onClose,
}: {
  profile: OdooProfileSummary;
  approval: JidoApproval;
  onClose: () => void;
}) {
  const invalidate = useInvalidateJido();
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const approveBlocked = approveBlockedReason(approval);
  const rejectBlocked = rejectBlockedReason(approval);
  const payload = formatPayload(approval.payload);

  const run = async (kind: 'approve' | 'reject') => {
    setBusy(true);
    try {
      if (kind === 'approve') {
        await approveJidoAction(profile.id, approval.id);
        toast(`Approved: ${approval.name}`);
      } else {
        await rejectJidoAction(profile.id, approval.id, reason);
        toast(`Rejected: ${approval.name}`);
      }
      setPending(null);
      setReason('');
      invalidate();
      onClose();
    } catch (error) {
      toast.error(kind === 'approve' ? 'Could not approve it' : 'Could not reject it', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{approval.name}</div>
          <div className="text-xs text-foreground-muted">
            Asked {formatWhen(approval.createdAt)} by {approval.requestedBy || 'a procedure'}
          </div>
        </div>
        <button
          type="button"
          className="text-xs text-foreground-muted hover:text-foreground"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <Row label="Waiting on" value={approval.taskName || approval.targetDisplay || '—'} />
      {approval.stepSeq > 0 && <Row label="Step" value={String(approval.stepSeq)} />}
      <Row label="Kind" value={approval.actionType} />
      <Row label="Record" value={`${approval.targetModel} ${approval.targetId}`} />
      {approval.toolRef && <Row label="Command" value={approval.toolRef} />}
      <Row
        label="Approver"
        value={approval.approverName || 'anyone who can approve on this server'}
      />

      {payload && (
        <div>
          <div className="text-[11px] font-medium text-foreground-muted">The exact write</div>
          <pre className="mt-1 max-h-60 overflow-auto rounded-md border border-border bg-background-secondary p-2 text-xs">
            {payload}
          </pre>
        </div>
      )}
      {approval.askQuestion && (
        <div>
          <div className="text-[11px] font-medium text-foreground-muted">The question</div>
          <div className="mt-1 text-sm whitespace-pre-wrap">{approval.askQuestion}</div>
        </div>
      )}
      {approval.rationale && (
        <div>
          <div className="text-[11px] font-medium text-foreground-muted">Why</div>
          <div className="mt-1 text-sm whitespace-pre-wrap">{approval.rationale}</div>
        </div>
      )}
      {approval.evidence && (
        <div>
          <div className="text-[11px] font-medium text-foreground-muted">Evidence</div>
          <div className="mt-1 text-sm whitespace-pre-wrap">{approval.evidence}</div>
        </div>
      )}

      {(approveBlocked ?? rejectBlocked) && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          {approveBlocked ?? rejectBlocked}
        </div>
      )}

      {pending === null ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => setPending({ kind: 'approve' })}
            disabled={approveBlocked !== null}
            title={approveBlocked ?? undefined}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPending({ kind: 'reject' })}
            disabled={rejectBlocked !== null}
            title={rejectBlocked ?? undefined}
          >
            Reject
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background-secondary p-3">
          <div className="text-sm font-medium">
            {pending.kind === 'approve' ? 'Approve this?' : 'Reject this?'}
          </div>
          <div className="text-xs text-foreground-muted">
            {pending.kind === 'approve'
              ? `Approving lets it go ahead now: ${describeWrite(approval)}. It is recorded in Odoo against proposal ${approval.id} on ${profile.name}.`
              : `Rejecting stops it. Nothing is written. It is recorded in Odoo against proposal ${approval.id} on ${profile.name}.`}
          </div>
          {pending.kind === 'reject' && (
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why (optional). This is saved on the record."
              rows={3}
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void run(pending.kind)} disabled={busy}>
              {busy
                ? 'Sending…'
                : pending.kind === 'approve'
                  ? 'Yes, approve it'
                  : 'Yes, reject it'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="w-28 shrink-0 text-[11px] font-medium text-foreground-muted">{label}</div>
      <div className="min-w-0 flex-1 break-words">{value}</div>
    </div>
  );
}

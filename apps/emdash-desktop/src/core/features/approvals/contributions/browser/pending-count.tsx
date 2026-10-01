import { usePendingApprovals } from '@core/features/approvals/api/browser/approvals-source';

/** Sidebar badge: how many agent permissions are waiting for an answer. */
export function ApprovalsPendingCount() {
  const count = usePendingApprovals().length;
  if (count === 0) return null;
  return (
    <span
      className="rounded-full bg-amber-500/20 px-1.5 text-[11px] font-medium text-amber-600 tabular-nums"
      title={`${count} approval${count === 1 ? '' : 's'} waiting`}
    >
      {count}
    </span>
  );
}

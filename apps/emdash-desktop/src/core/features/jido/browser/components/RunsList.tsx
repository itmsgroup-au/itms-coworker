import { Checkbox } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import { useJidoRuns, type JidoRun } from '@core/features/jido/api/browser/use-jido';
import type { OdooProfile } from '@core/primitives/app-settings/api';
import { cn } from '@core/primitives/styling/browser/cn';
import { ErrorLine, formatWhen, PageHeader } from './shared';

const OUTCOME_LABEL: Record<string, { text: string; className: string }> = {
  success: { text: 'Finished', className: 'bg-emerald-500/15 text-emerald-600' },
  failure: { text: 'Did not finish', className: 'bg-red-500/15 text-red-600' },
  pending_approval: { text: 'Waiting for approval', className: 'bg-amber-500/15 text-amber-600' },
};

export function RunsList({
  profile,
  selectedRunId,
  onSelect,
}: {
  profile: OdooProfile;
  selectedRunId: number | null;
  onSelect: (runId: number | null) => void;
}) {
  const [proceduresOnly, setProceduresOnly] = useState(true);
  const runs = useJidoRuns(profile, { proceduresOnly });
  const rows = runs.data ?? [];
  const selected = rows.find((run) => run.id === selectedRunId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Runs"
        subtitle={`${profile.name} · ${rows.length} recent run${rows.length === 1 ? '' : 's'}`}
        onRefresh={() => void runs.refetch()}
        refreshing={runs.isFetching}
        right={
          <label className="flex items-center gap-2 text-xs text-foreground-muted">
            <Checkbox
              checked={proceduresOnly}
              onCheckedChange={(next) => setProceduresOnly(next === true)}
            />
            Procedures only
          </label>
        }
      />
      {runs.error && <ErrorLine error={runs.error} />}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-background-secondary text-left text-xs font-medium text-foreground-muted">
                <th className="w-40 px-3 py-2">When</th>
                <th className="w-32 px-3 py-2">Client</th>
                <th className="px-3 py-2">What ran</th>
                <th className="w-20 px-3 py-2 text-right">Steps</th>
                <th className="w-44 px-3 py-2">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  selected={run.id === selectedRunId}
                  onSelect={() => onSelect(run.id === selectedRunId ? null : run.id)}
                />
              ))}
              {runs.isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-foreground-muted">
                    Loading runs…
                  </td>
                </tr>
              )}
              {!runs.isLoading && rows.length === 0 && !runs.error && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-foreground-muted">
                    No runs recorded on this server yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selected && (
          <div className="w-[420px] shrink-0 overflow-auto rounded-lg border border-border bg-background p-4">
            <RunDetail run={selected} onClose={() => onSelect(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: JidoRun;
  selected: boolean;
  onSelect: () => void;
}) {
  const outcome = run.outcome ? OUTCOME_LABEL[run.outcome] : undefined;
  return (
    <tr
      className={cn(
        'cursor-pointer border-b border-border hover:bg-background-secondary/40',
        selected && 'bg-accent/10 hover:bg-accent/10'
      )}
      onClick={onSelect}
    >
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatWhen(run.startedAt)}</td>
      <td className="truncate px-3 py-2">{run.tenant || '—'}</td>
      <td className="px-3 py-2" title={run.summary}>
        <div className="truncate">{run.name || run.taskName || run.runRef}</div>
        {run.summary && <div className="truncate text-xs text-foreground-muted">{run.summary}</div>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{run.stepCount}</td>
      <td className="px-3 py-2">
        {outcome ? (
          <span
            className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', outcome.className)}
          >
            {outcome.text}
          </span>
        ) : (
          <span className="text-foreground-muted">—</span>
        )}
      </td>
    </tr>
  );
}

function RunDetail({ run, onClose }: { run: JidoRun; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{run.name || run.runRef}</div>
          <div className="text-xs text-foreground-muted">{formatWhen(run.startedAt)}</div>
        </div>
        <button
          type="button"
          className="text-xs text-foreground-muted hover:text-foreground"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <Row label="Client" value={run.tenant || '—'} />
      <Row label="Procedure" value={run.taskName || '—'} />
      <Row label="Run reference" value={run.runRef || '—'} />
      <Row label="Started by" value={run.workerName || '—'} />
      <Row label="Source" value={run.source || '—'} />
      <Row label="Steps" value={String(run.stepCount)} />
      {run.summary && (
        <div>
          <div className="text-[11px] font-medium text-foreground-muted">What happened</div>
          <div className="mt-1 text-sm whitespace-pre-wrap">{run.summary}</div>
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

import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { getOdooClient } from '@core/features/odoo/api/browser/client';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import type { OdooProfile } from '@core/primitives/app-settings/api';

export const JIDO_QUERY_KEY = ['jido'] as const;

/** The default Odoo server from Settings → Odoo, or null when none is chosen. */
export function useDefaultOdooProfile(): { profile: OdooProfile | null; isLoading: boolean } {
  const { value, isLoading } = useAppSettingsKey('odoo');
  const profile = value?.profiles.find((p) => p.id === value.defaultProfileId) ?? null;
  return { profile, isLoading };
}

// ---------------------------------------------------------------------------
// Row shapes, named after the Odoo fields they come from
// ---------------------------------------------------------------------------

/** Odoo many2one: `[id, display name]` when set, `false` when empty. */
type Many2one = [number, string] | false;
const m2oId = (value: Many2one): number | null => (value ? value[0] : null);
const m2oName = (value: Many2one): string => (value ? value[1] : '');
const text = (value: string | false): string => (value === false ? '' : value);

/** One receipt: `itms.ai.cp.run`. */
export type JidoRun = {
  id: number;
  name: string;
  runRef: string;
  summary: string;
  outcome: 'success' | 'failure' | 'pending_approval' | null;
  startedAt: string;
  tenant: string;
  source: string;
  stepCount: number;
  taskId: number | null;
  taskName: string;
  workerName: string;
};

/** One thing waiting for a person: `itms.ai.action` in state `proposed`. */
export type JidoApproval = {
  id: number;
  name: string;
  actionType: string;
  askKind: string;
  askQuestion: string;
  askOptionKeys: string[];
  toolRef: string;
  payload: string;
  targetModel: string;
  targetId: number;
  targetDisplay: string;
  rationale: string;
  evidence: string;
  stepSeq: number;
  sourceRef: string;
  createdAt: string;
  requestedBy: string;
  approverName: string;
  taskId: number | null;
  taskName: string;
};

type RunRow = {
  id: number;
  name: string | false;
  run_ref: string | false;
  summary: string | false;
  outcome: 'success' | 'failure' | 'pending_approval' | false;
  started_at: string | false;
  create_date: string | false;
  tenant: string | false;
  source: string | false;
  step_count: number;
  task_id: Many2one;
  ai_worker_id: Many2one;
};

type ApprovalRow = {
  id: number;
  name: string | false;
  action_type: string | false;
  ask_kind: string | false;
  ask_question: string | false;
  ask_options: string | false;
  tool_ref: string | false;
  payload: string | false;
  res_model: string | false;
  res_id: number | false;
  target_display: string | false;
  rationale: string | false;
  evidence: string | false;
  step_seq: number;
  source_ref: string | false;
  create_date: string | false;
  worker_id: Many2one;
  approver_id: Many2one;
  task_id: Many2one;
};

const RUN_FIELDS = [
  'id',
  'name',
  'run_ref',
  'summary',
  'outcome',
  'started_at',
  'create_date',
  'tenant',
  'source',
  'step_count',
  'task_id',
  'ai_worker_id',
];

const APPROVAL_FIELDS = [
  'id',
  'name',
  'action_type',
  'ask_kind',
  'ask_question',
  'ask_options',
  'tool_ref',
  'payload',
  'res_model',
  'res_id',
  'target_display',
  'rationale',
  'evidence',
  'step_seq',
  'source_ref',
  'create_date',
  'worker_id',
  'approver_id',
  'task_id',
];

/** Option keys of a decision, from the `ask_options` JSON on the record. */
function optionKeys(raw: string | false): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) =>
        entry !== null && typeof entry === 'object' && 'key' in entry
          ? String((entry as { key: unknown }).key)
          : ''
      )
      .filter((key) => key !== '');
  } catch {
    return [];
  }
}

function toRun(row: RunRow): JidoRun {
  return {
    id: row.id,
    name: text(row.name),
    runRef: text(row.run_ref),
    summary: text(row.summary),
    outcome: row.outcome === false ? null : row.outcome,
    startedAt: text(row.started_at) || text(row.create_date),
    tenant: text(row.tenant),
    source: text(row.source),
    stepCount: row.step_count,
    taskId: m2oId(row.task_id),
    taskName: m2oName(row.task_id),
    workerName: m2oName(row.ai_worker_id),
  };
}

function toApproval(row: ApprovalRow): JidoApproval {
  return {
    id: row.id,
    name: text(row.name),
    actionType: text(row.action_type),
    askKind: text(row.ask_kind),
    askQuestion: text(row.ask_question),
    askOptionKeys: optionKeys(row.ask_options),
    toolRef: text(row.tool_ref),
    payload: text(row.payload),
    targetModel: text(row.res_model),
    targetId: row.res_id === false ? 0 : row.res_id,
    targetDisplay: text(row.target_display),
    rationale: text(row.rationale),
    evidence: text(row.evidence),
    stepSeq: row.step_seq,
    sourceRef: text(row.source_ref),
    createdAt: text(row.create_date),
    requestedBy: m2oName(row.worker_id),
    approverName: m2oName(row.approver_id),
    taskId: m2oId(row.task_id),
    taskName: m2oName(row.task_id),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Recent receipts, newest first. `proceduresOnly` keeps the rows a procedure
 * wrote (`source` starts with `jido:`) and drops every other receipt on the
 * same model.
 */
export function useJidoRuns(
  profile: OdooProfile | null,
  options: { proceduresOnly: boolean; limit?: number }
): UseQueryResult<JidoRun[], Error> {
  const limit = options.limit ?? 100;
  return useQuery<JidoRun[], Error>({
    queryKey: [
      ...JIDO_QUERY_KEY,
      'runs',
      profile?.id ?? 'none',
      options.proceduresOnly ? 'procedures' : 'all',
      limit,
    ],
    enabled: !!profile,
    queryFn: async () => {
      if (!profile) return [];
      const domain = options.proceduresOnly ? [['source', '=like', 'jido:%']] : [];
      const rows = (await (
        await getOdooClient()
      ).executeKw({
        profile,
        model: 'itms.ai.cp.run',
        method: 'search_read',
        args: [domain],
        kwargs: { fields: RUN_FIELDS, limit, order: 'id desc' },
      })) as RunRow[];
      return rows.map(toRun);
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

/** Everything still waiting for a person, newest first. */
export function useJidoApprovals(
  profile: OdooProfile | null,
  options: { proceduresOnly: boolean; limit?: number } = { proceduresOnly: false }
): UseQueryResult<JidoApproval[], Error> {
  const limit = options.limit ?? 100;
  return useQuery<JidoApproval[], Error>({
    queryKey: [
      ...JIDO_QUERY_KEY,
      'approvals',
      profile?.id ?? 'none',
      options.proceduresOnly ? 'procedures' : 'all',
      limit,
    ],
    enabled: !!profile,
    queryFn: async () => {
      if (!profile) return [];
      const domain: unknown[] = [['state', '=', 'proposed']];
      if (options.proceduresOnly) domain.push(['source_ref', '=like', 'jido:%']);
      const rows = (await (
        await getOdooClient()
      ).executeKw({
        profile,
        model: 'itms.ai.action',
        method: 'search_read',
        args: [domain],
        kwargs: { fields: APPROVAL_FIELDS, limit, order: 'id desc' },
      })) as ApprovalRow[];
      return rows.map(toApproval);
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// The one write: decide an approval
// ---------------------------------------------------------------------------

/**
 * Why a proposal cannot be decided from here, or null when it can.
 *
 * Measured from `itms_ai_worker/models/ai_decision.py`: `action_approve` on an
 * `ask` only works for kinds `approve` and `acknowledge`, and only when the
 * record carries options; `action_reject` on an `ask` needs an option keyed
 * `reject` or `stop`. Everything that is not an `ask` takes both.
 */
export function approveBlockedReason(approval: JidoApproval): string | null {
  if (approval.actionType !== 'ask') return null;
  if (!['approve', 'acknowledge'].includes(approval.askKind)) {
    return 'This one asks for a choice between options. Open it in Odoo to decide.';
  }
  if (approval.askOptionKeys.length === 0) {
    return 'This one has no options recorded, so there is nothing to approve here.';
  }
  return null;
}

export function rejectBlockedReason(approval: JidoApproval): string | null {
  if (approval.actionType !== 'ask') return null;
  if (!approval.askOptionKeys.some((key) => key === 'reject' || key === 'stop')) {
    return 'This one has no plain "no" option. Open it in Odoo to decide.';
  }
  return null;
}

/** Approve one proposal. Calls `itms.ai.action.action_approve` on that record. */
export async function approveJidoAction(profile: OdooProfile, actionId: number): Promise<void> {
  await (
    await getOdooClient()
  ).executeKw({
    profile,
    model: 'itms.ai.action',
    method: 'action_approve',
    args: [[actionId]],
  });
}

/**
 * Reject one proposal. The reason is written to `reject_reason` first, so the
 * note Odoo posts carries it, then `action_reject` runs on the record.
 */
export async function rejectJidoAction(
  profile: OdooProfile,
  actionId: number,
  reason: string
): Promise<void> {
  const client = await getOdooClient();
  const trimmed = reason.trim();
  if (trimmed) {
    await client.executeKw({
      profile,
      model: 'itms.ai.action',
      method: 'write',
      args: [[actionId], { reject_reason: trimmed }],
    });
  }
  await client.executeKw({
    profile,
    model: 'itms.ai.action',
    method: 'action_reject',
    args: [[actionId]],
  });
}

/** Drop every Procedures query so the lists re-read after a decision. */
export function useInvalidateJido(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: JIDO_QUERY_KEY });
  };
}

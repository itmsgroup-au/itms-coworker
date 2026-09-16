import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  OdooProfileList,
  OdooProfileSummary,
  OdooRecord,
  OdooResult,
} from '@core/features/odoo/api';
import { getOdooClient } from '@core/features/odoo/api/browser/client';

export const JIDO_QUERY_KEY = ['jido'] as const;

/**
 * The default Odoo server from Settings → Odoo, or null when none is chosen.
 *
 * The list comes from the odoo domain, which resolves credentials from
 * 1Password and the OS keychain in the main process. What arrives here is a
 * summary: id, name, url, db, user. No password is read, stored or passed on.
 * Settings only supplies which id is the default; if that id is not in the
 * list, the first server is used.
 */
export function useDefaultOdooProfile(): {
  profile: OdooProfileSummary | null;
  isLoading: boolean;
} {
  // The node side owns the default now, so it comes back with the list rather
  // than being read from app settings; a renderer read would go stale after a
  // refresh from 1Password.
  const profiles = useQuery<OdooProfileList, Error>({
    queryKey: [...JIDO_QUERY_KEY, 'profiles'],
    queryFn: async () => (await getOdooClient()).listProfiles(),
    staleTime: 5 * 60 * 1000,
  });
  const rows = profiles.data?.profiles ?? [];
  const chosen = rows.find((row) => row.id === profiles.data?.defaultProfileId) ?? rows[0] ?? null;
  return { profile: chosen, isLoading: profiles.isLoading };
}

/** Every generic Odoo procedure answers with this envelope; a failure is thrown. */
function unwrap<T>(result: OdooResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
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

/**
 * Odoo hands back `Record<string, unknown>` per row, because the value shape
 * depends on each field's Odoo type. These two casts name the shape of the
 * fields we asked for, and are the only place the slice asserts it.
 */
const asRunRows = (rows: OdooRecord[]): RunRow[] => rows as unknown as RunRow[];
const asApprovalRows = (rows: OdooRecord[]): ApprovalRow[] => rows as unknown as ApprovalRow[];

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
  profileId: string | null,
  options: { proceduresOnly: boolean; limit?: number }
): UseQueryResult<JidoRun[], Error> {
  const limit = options.limit ?? 100;
  return useQuery<JidoRun[], Error>({
    queryKey: [
      ...JIDO_QUERY_KEY,
      'runs',
      profileId ?? 'none',
      options.proceduresOnly ? 'procedures' : 'all',
      limit,
    ],
    enabled: !!profileId,
    queryFn: async () => {
      if (!profileId) return [];
      const domain = options.proceduresOnly ? [['source', '=like', 'jido:%']] : [];
      const rows = unwrap(
        await (
          await getOdooClient()
        ).searchRead({
          profileId,
          model: 'itms.ai.cp.run',
          domain,
          fields: RUN_FIELDS,
          order: 'id desc',
          limit,
        })
      );
      return asRunRows(rows).map(toRun);
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

/** Everything still waiting for a person, newest first. */
export function useJidoApprovals(
  profileId: string | null,
  options: { proceduresOnly: boolean; limit?: number } = { proceduresOnly: false }
): UseQueryResult<JidoApproval[], Error> {
  const limit = options.limit ?? 100;
  return useQuery<JidoApproval[], Error>({
    queryKey: [
      ...JIDO_QUERY_KEY,
      'approvals',
      profileId ?? 'none',
      options.proceduresOnly ? 'procedures' : 'all',
      limit,
    ],
    enabled: !!profileId,
    queryFn: async () => {
      if (!profileId) return [];
      const domain: unknown[] = [['state', '=', 'proposed']];
      if (options.proceduresOnly) domain.push(['source_ref', '=like', 'jido:%']);
      const rows = unwrap(
        await (
          await getOdooClient()
        ).searchRead({
          profileId,
          model: 'itms.ai.action',
          domain,
          fields: APPROVAL_FIELDS,
          order: 'id desc',
          limit,
        })
      );
      return asApprovalRows(rows).map(toApproval);
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

/**
 * Approve one proposal. Calls `itms.ai.action.action_approve` on that record.
 * This is a write, so it goes through `callMethod` with `confirmWrite: true`;
 * the person has already seen the record and the exact write in the panel.
 */
export async function approveJidoAction(profileId: string, actionId: number): Promise<void> {
  unwrap(
    await (
      await getOdooClient()
    ).callMethod({
      profileId,
      model: 'itms.ai.action',
      method: 'action_approve',
      args: [[actionId]],
      confirmWrite: true,
    })
  );
}

/**
 * Reject one proposal. The reason is written to `reject_reason` first, so the
 * note Odoo posts carries it, then `action_reject` runs on the record. Both are
 * writes and both carry `confirmWrite: true`, after the same confirm step.
 */
export async function rejectJidoAction(
  profileId: string,
  actionId: number,
  reason: string
): Promise<void> {
  const client = await getOdooClient();
  const trimmed = reason.trim();
  if (trimmed) {
    unwrap(
      await client.callMethod({
        profileId,
        model: 'itms.ai.action',
        method: 'write',
        args: [[actionId], { reject_reason: trimmed }],
        confirmWrite: true,
      })
    );
  }
  unwrap(
    await client.callMethod({
      profileId,
      model: 'itms.ai.action',
      method: 'action_reject',
      args: [[actionId]],
      confirmWrite: true,
    })
  );
}

/** Drop every Procedures query so the lists re-read after a decision. */
export function useInvalidateJido(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: JIDO_QUERY_KEY });
  };
}

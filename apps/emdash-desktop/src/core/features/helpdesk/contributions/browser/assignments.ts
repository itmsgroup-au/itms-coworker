import { useEffect, useRef, useState } from 'react';
import { taskAgentStatus } from '@core/features/conversations/api/browser/conversation-selectors';
import {
  getProjectManagerStore,
  getProjectStore,
  projectData,
  projectViewKind,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  getTaskManagerStore,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { AgentStatus } from '@core/primitives/agents/api';
import type { HelpdeskAssignment } from '@core/primitives/app-settings/api';
import { log } from '@core/primitives/logging/browser/logger';

/**
 * What we can prove about the task behind an assignment.
 *
 * - `live`: the project is hydrated and its task list contains the task.
 * - `gone`: the project list has loaded without this project, or the task list
 *   has loaded without this task.
 * - `unknown`: neither has been proven yet. Stores still loading land here, and
 *   nothing is ever deleted on `unknown`.
 */
export type AssignmentPresence = 'live' | 'gone' | 'unknown';

export type ResolvedAssignment = {
  /** The stored key in `helpdesk.assignments`, `${profileId}:${ticketId}`. */
  key: string;
  assignment: HelpdeskAssignment;
  presence: AssignmentPresence;
  /** Agent status while the task exists; null when it does not, or has no conversation yet. */
  status: AgentStatus | null;
  projectName: string;
};

export type ActiveAssignment = ResolvedAssignment & {
  presence: 'live';
  status: Exclude<AgentStatus, 'idle'>;
};

/** Working first, then anything needing a person, then failures, then done. */
export const ACTIVE_STATUS_ORDER: readonly Exclude<AgentStatus, 'idle'>[] = [
  'working',
  'awaiting-input',
  'error',
  'completed',
];

/**
 * How long a `gone` verdict must hold before the entry is dropped. A project
 * being removed and re-added by a live-model resync, or a task list arriving in
 * two snapshots, resolves well inside this window.
 */
const GC_GRACE_MS = 20_000;

/**
 * Presence for one assignment, deliberately biased towards `unknown`.
 *
 * `gone` needs positive evidence: either the project list has loaded (at least
 * one project is present) and this project is not in it, or the project is
 * hydrated, its task list has loaded (at least one task is present) and this
 * task is not in it. Every loading, hydrating, creating or failed state returns
 * `unknown`, so a slow boot never looks like a deletion.
 *
 * Call only inside an `observer` component or another MobX reaction.
 */
export function assignmentPresence(assignment: HelpdeskAssignment): AssignmentPresence {
  const projects = getProjectManagerStore().projects;
  // An empty project map means the project-list snapshot has not arrived (the
  // renderer mounts before it does), not that every project was deleted.
  if (projects.size === 0) return 'unknown';

  const projectStore = getProjectStore(assignment.projectId);
  if (!projectStore) return 'gone';
  if (projectViewKind(projectStore) !== 'ready') return 'unknown';

  const taskManager = getTaskManagerStore(assignment.projectId);
  if (!taskManager) return 'unknown';
  if (taskManager.tasks.has(assignment.taskId)) return 'live';
  // The Project context turns `available` before `loadTasks()` resolves, so an
  // empty task map is "not loaded yet" as often as it is "no tasks".
  if (taskManager.tasks.size === 0) return 'unknown';
  return 'gone';
}

/** Resolve every stored assignment against the live stores. Call inside `observer`. */
export function resolveAssignments(
  assignments: Readonly<Record<string, HelpdeskAssignment>>
): ResolvedAssignment[] {
  const out: ResolvedAssignment[] = [];
  for (const [key, assignment] of Object.entries(assignments)) {
    const presence = assignmentPresence(assignment);
    const store =
      presence === 'live' ? getTaskStore(assignment.projectId, assignment.taskId) : undefined;
    out.push({
      key,
      assignment,
      presence,
      status: store ? taskAgentStatus(store) : null,
      projectName: projectData(getProjectStore(assignment.projectId))?.name ?? '',
    });
  }
  return out;
}

/** The chips worth showing: task present, agent doing something other than idling. */
export function activeAssignments(resolved: readonly ResolvedAssignment[]): ActiveAssignment[] {
  const active: ActiveAssignment[] = [];
  for (const entry of resolved) {
    if (entry.presence !== 'live') continue;
    const status = entry.status;
    if (!status || status === 'idle') continue;
    active.push({ ...entry, presence: 'live', status });
  }
  active.sort(
    (a, b) => ACTIVE_STATUS_ORDER.indexOf(a.status) - ACTIVE_STATUS_ORDER.indexOf(b.status)
  );
  return active;
}

export type HelpdeskAssignmentsView = {
  /** Every stored assignment, with what the stores say about it. */
  all: ResolvedAssignment[];
  /** Present tasks with a non-idle agent, in display order. */
  active: ActiveAssignment[];
};

/**
 * The one derivation of assignment state, shared by the status bar and the
 * sidebar badge so they cannot disagree.
 *
 * Pass `reconcile` in exactly one mount (the status bar) to also garbage-collect
 * entries whose project or task no longer exists. Call inside `observer`.
 */
export function useHelpdeskAssignments(options?: { reconcile?: boolean }): HelpdeskAssignmentsView {
  const reconcile = options?.reconcile ?? false;
  const { value, isLoading, update } = useAppSettingsKey('helpdesk');
  const assignments = value?.assignments;
  const all = resolveAssignments(assignments ?? {});
  const active = activeAssignments(all);

  const goneSinceRef = useRef<Map<string, number>>(new Map());
  const assignmentsRef = useRef(assignments);
  const updateRef = useRef(update);
  assignmentsRef.current = assignments;
  updateRef.current = update;

  const [gcTick, setGcTick] = useState(0);
  const goneSignature = all
    .filter((entry) => entry.presence === 'gone')
    .map((entry) => entry.key)
    .sort()
    .join('|');
  const canReconcile = reconcile && !isLoading && assignments !== undefined;

  useEffect(() => {
    const since = goneSinceRef.current;
    const keys = goneSignature === '' ? [] : goneSignature.split('|');
    const stillGone = new Set(keys);
    for (const key of [...since.keys()]) {
      if (!stillGone.has(key)) since.delete(key);
    }
    if (!canReconcile || keys.length === 0) return;

    const now = Date.now();
    for (const key of keys) {
      if (!since.has(key)) since.set(key, now);
    }

    const ripe = keys.filter((key) => now - (since.get(key) ?? now) >= GC_GRACE_MS);
    if (ripe.length === 0) {
      const oldest = Math.min(...keys.map((key) => since.get(key) ?? now));
      const timer = setTimeout(
        () => setGcTick((tick) => tick + 1),
        Math.max(GC_GRACE_MS - (now - oldest), 0) + 50
      );
      return () => clearTimeout(timer);
    }

    const current = assignmentsRef.current;
    if (!current) return;
    const next = { ...current };
    const removed: string[] = [];
    for (const key of ripe) {
      if (!(key in next)) continue;
      delete next[key];
      since.delete(key);
      removed.push(key);
    }
    if (removed.length === 0) return;
    log.info('Dropping helpdesk assignments whose project or task no longer exists', { removed });
    updateRef.current({ assignments: next });
    return;
  }, [canReconcile, goneSignature, gcTick]);

  return { all, active };
}

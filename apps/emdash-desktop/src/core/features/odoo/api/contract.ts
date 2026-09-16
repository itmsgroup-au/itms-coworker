import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type { OdooProfile } from '@core/primitives/app-settings/api';

export const odooDomain = 'odoo' as const;

export type OdooConnectionTestResult =
  | { ok: true; serverVersion: string; uid: number; userName: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

export type OdooProfilesSource = {
  source: string;
  profiles: OdooProfile[];
  skipped: string[];
};

export type OdooProfilesFile = {
  path: string;
  exists: boolean;
  profiles: OdooProfile[];
};

export type OdooProjectFolder = {
  path: string;
  created: boolean;
  name: string;
  /** Absolute path of the Odoo MCP server wired into the folder, or null if none was found. */
  mcpServer: string | null;
};

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Every Odoo failure is normalised to one of these before it leaves the node
 * side, so the renderer never has to pattern-match on a raw message.
 *
 * - `auth`          the login itself was refused (bad password or API key)
 * - `network`       the server could not be reached, or answered non-2xx
 * - `timeout`       the request was still open when the deadline passed
 * - `odoo`          Odoo answered with a server-side fault (ValidationError, etc.)
 * - `access-denied` the user is authenticated but not allowed on that record
 * - `unknown`       anything we could not classify
 */
export type OdooErrorKind = 'auth' | 'network' | 'timeout' | 'odoo' | 'access-denied' | 'unknown';

export type OdooError = { kind: OdooErrorKind; message: string };

/** Result envelope used by every generic Odoo procedure. */
export type OdooResult<T> = { ok: true; data: T } | { ok: false; error: OdooError };

// ---------------------------------------------------------------------------
// Generic read payloads
// ---------------------------------------------------------------------------

/**
 * A raw Odoo record. The keys are whatever the caller asked for in `fields`
 * and the value shapes depend on each field's Odoo type (many2one comes back
 * as `[id, name]`, one2many as `number[]`, dates as strings). There is no
 * honest static type for that, so values stay `unknown` rather than pretending.
 */
export type OdooRecord = Record<string, unknown>;

/** One entry of `fields_get`. Which keys are present depends on `attributes`. */
export type OdooFieldInfo = Partial<{
  string: string;
  type: string;
  required: boolean;
  readonly: boolean;
  store: boolean;
  relation: string;
  selection: Array<[string, string]>;
  help: string;
}> &
  Record<string, unknown>;

export type OdooModelSummary = { model: string; name: string };

// ---------------------------------------------------------------------------
// Read / write classification
// ---------------------------------------------------------------------------

/** Default page size for `searchRead`. */
export const ODOO_DEFAULT_LIMIT = 200;
/** Hard cap for `searchRead`; a larger request is clamped, not refused. */
export const ODOO_MAX_LIMIT = 500;

const ODOO_READ_METHODS = new Set([
  'fields_get',
  'search_count',
  'default_get',
  'name_search',
  'name_get',
  'get_views',
  'fields_view_get',
  'check_access_rights',
]);

/**
 * The same rule the generated project folder writes into AGENTS.md: reads are
 * free, anything else is a write and has to be confirmed by a human first.
 *
 * Reads are `search*` (search, search_read, search_count, search_fetch),
 * `read*` (read, read_group, read_progress_bar), plus the introspection and
 * defaulting methods listed above. Everything else - create, write, unlink,
 * message_post, button_* and any custom method - is a write.
 */
export function classifyOdooMethod(method: string): 'read' | 'write' {
  const name = method.trim();
  if (ODOO_READ_METHODS.has(name)) return 'read';
  if (/^search(_|$)/.test(name) || name === 'search') return 'read';
  if (/^read(_|$)/.test(name) || name === 'read') return 'read';
  return 'write';
}

/** Convenience wrapper around {@link classifyOdooMethod}. */
export function isOdooReadMethod(method: string): boolean {
  return classifyOdooMethod(method) === 'read';
}

export type HelpdeskTeam = { id: number; name: string; description: string; open: number };

export type HelpdeskTicket = {
  id: number;
  ref: string;
  name: string;
  teamId: number | null;
  team: string;
  stageId: number | null;
  stage: string;
  customer: string;
  assigneeId: number | null;
  assignee: string;
  /** Odoo priority 0-3, shown as stars. */
  priority: number;
  slaDeadline: string | null;
  kanbanState: string;
  createdAt: string;
  updatedAt: string;
  /** Plain text, capped at 4000 characters. */
  description: string;
};

export type HelpdeskMessage = {
  id: number;
  date: string;
  author: string;
  subject: string;
  body: string;
  kind: 'email' | 'message' | 'note';
};

export type HelpdeskRelatedTicket = {
  id: number;
  ref: string;
  name: string;
  stage: string;
  assignee: string;
  createdAt: string;
};

export type HelpdeskRelated = {
  contact: string | null;
  company: string;
  email: string;
  phone: string;
  openTickets: number;
  previousTickets: HelpdeskRelatedTicket[];
};

export const odooContract = defineContract({
  /** Make (or refresh) the local project folder that pairs with a profile. */
  prepareProject: procedure({
    input: z.custom<OdooProfile>(),
    output: z.custom<OdooProjectFolder>(),
  }),
  /** JSON-RPC version_info + authenticate against the server named in the profile. */
  testConnection: procedure({
    input: z.custom<OdooProfile>(),
    output: z.custom<OdooConnectionTestResult>(),
  }),
  /** Read every 1Password item tagged odoo-profile in the vault (default AI_MCP). */
  readProfilesFromOnePassword: procedure({
    input: z.object({ vault: z.string().optional() }),
    output: z.custom<OdooProfilesSource>(),
  }),
  /** Read ~/.odoo-profiles.json (the file atlas and the odoo CLI use). */
  readProfilesFile: procedure({ input: z.void(), output: z.custom<OdooProfilesFile>() }),
  /** Any model method through object.execute_kw. Read-only use from the renderer. */
  executeKw: procedure({
    input: z.object({
      profile: z.custom<OdooProfile>(),
      model: z.string(),
      method: z.string(),
      args: z.array(z.unknown()),
      kwargs: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.unknown(),
  }),
  /** search_read on any model. Limit defaults to 200 and is capped at 500. */
  searchRead: procedure({
    input: z.object({
      profile: z.custom<OdooProfile>(),
      model: z.string().min(1),
      domain: z.array(z.unknown()).optional(),
      fields: z.array(z.string()).optional(),
      order: z.string().optional(),
      limit: z.number().int().positive().max(ODOO_MAX_LIMIT).optional(),
      offset: z.number().int().nonnegative().optional(),
    }),
    output: z.custom<OdooResult<OdooRecord[]>>(),
  }),
  /** read on a known set of ids. */
  readRecords: procedure({
    input: z.object({
      profile: z.custom<OdooProfile>(),
      model: z.string().min(1),
      ids: z.array(z.number().int()),
      fields: z.array(z.string()).optional(),
    }),
    output: z.custom<OdooResult<OdooRecord[]>>(),
  }),
  /** search_count on any model. */
  searchCount: procedure({
    input: z.object({
      profile: z.custom<OdooProfile>(),
      model: z.string().min(1),
      domain: z.array(z.unknown()).optional(),
    }),
    output: z.custom<OdooResult<number>>(),
  }),
  /** fields_get: what fields a model has, and of what type. */
  fieldsGet: procedure({
    input: z.object({
      profile: z.custom<OdooProfile>(),
      model: z.string().min(1),
      attributes: z.array(z.string()).optional(),
    }),
    output: z.custom<OdooResult<Record<string, OdooFieldInfo>>>(),
  }),
  /** ir.model, optionally filtered by a substring of the technical or display name. */
  listModels: procedure({
    input: z.object({ profile: z.custom<OdooProfile>(), filter: z.string().optional() }),
    output: z.custom<OdooResult<OdooModelSummary[]>>(),
  }),
  /**
   * Any model method, behind the write gate. Reads run straight through;
   * anything else is refused with a typed error unless confirmWrite is true.
   */
  callMethod: procedure({
    input: z.object({
      profile: z.custom<OdooProfile>(),
      model: z.string().min(1),
      method: z.string().min(1),
      args: z.array(z.unknown()),
      kwargs: z.record(z.string(), z.unknown()).optional(),
      confirmWrite: z.boolean(),
    }),
    output: z.custom<OdooResult<unknown>>(),
  }),
  /** Helpdesk teams with open-ticket counts. */
  helpdeskTeams: procedure({
    input: z.object({ profile: z.custom<OdooProfile>() }),
    output: z.custom<HelpdeskTeam[]>(),
  }),
  /** Open helpdesk tickets, newest activity first, optionally one team. */
  helpdeskTickets: procedure({
    input: z.object({
      profile: z.custom<OdooProfile>(),
      teamId: z.number().optional(),
      limit: z.number().optional(),
    }),
    output: z.custom<HelpdeskTicket[]>(),
  }),
  /** The chatter of one ticket, oldest first. */
  helpdeskMessages: procedure({
    input: z.object({ profile: z.custom<OdooProfile>(), ticketId: z.number() }),
    output: z.custom<HelpdeskMessage[]>(),
  }),
  /** The customer behind a ticket and their other tickets. */
  helpdeskRelated: procedure({
    input: z.object({ profile: z.custom<OdooProfile>(), ticketId: z.number() }),
    output: z.custom<HelpdeskRelated>(),
  }),
  /** Add an internal note to a ticket (the app's only Odoo write). */
  helpdeskPostNote: procedure({
    input: z.object({ profile: z.custom<OdooProfile>(), ticketId: z.number(), body: z.string() }),
    output: z.custom<{ messageId: number }>(),
  }),
  /** Write the given profiles to ~/.odoo-profiles.json, replacing it. */
  writeProfilesFile: procedure({
    input: z.object({ profiles: z.custom<OdooProfile[]>() }),
    output: z.custom<{ path: string }>(),
  }),
});

import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type { OdooProfileSummary } from '@core/primitives/app-settings/api';

export const odooDomain = 'odoo' as const;

/**
 * One Odoo server as the renderer sees it: metadata, never a credential.
 * Defined with the `odoo` settings type it is stored as, and surfaced here so
 * callers can take it from `@core/features/odoo/api` with the contract.
 */
export type { OdooProfileSummary };

export type OdooConnectionTestResult =
  | { ok: true; serverVersion: string; uid: number; userName: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

/** What the settings page renders: the list plus which one is the default. */
export type OdooProfileList = {
  profiles: OdooProfileSummary[];
  defaultProfileId: string | null;
};

/** The outcome of re-reading the 1Password vault. */
export type OdooProfilesRefresh = OdooProfileList & {
  /** Where they came from, for the toast: "1Password vault AI_MCP, tag odoo-profile". */
  source: string;
  /** Vault item titles that could not be used, with the reason. Never a secret. */
  skipped: string[];
  /**
   * False when the OS keychain is unavailable, so the refreshed credentials are
   * held for this session only and 1Password is read again next launch.
   */
  secretsPersisted: boolean;
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

/** Every procedure names the server by id; the credential never crosses the wire. */
const profileInput = z.object({ profileId: z.string().min(1) });

export const odooContract = defineContract({
  /** Every stored server, and which one is the default. */
  listProfiles: procedure({ input: z.void(), output: z.custom<OdooProfileList>() }),
  /**
   * Re-read the 1Password vault: stored metadata is refreshed and each secret is
   * put in the OS keychain. This is the only way a credential enters the app.
   */
  refreshProfilesFromOnePassword: procedure({
    input: z.object({ vault: z.string().optional() }),
    output: z.custom<OdooProfilesRefresh>(),
  }),
  /** Choose the server an agent works against unless a task says otherwise. */
  setDefaultProfile: procedure({
    input: profileInput,
    output: z.custom<OdooProfileList>(),
  }),
  /** Forget a server: its metadata and its cached credential both go. */
  removeProfile: procedure({
    input: profileInput,
    output: z.custom<OdooProfileList>(),
  }),
  /** Make (or refresh) the local project folder that pairs with a profile. */
  prepareProject: procedure({
    input: profileInput,
    output: z.custom<OdooProjectFolder>(),
  }),
  /** JSON-RPC version_info + authenticate against the server named by the profile. */
  testConnection: procedure({
    input: profileInput,
    output: z.custom<OdooConnectionTestResult>(),
  }),
  /**
   * The name `atlas` and the `odoo` CLI know this server by, from
   * ~/.odoo-profiles.json, matched on url and database. Null when that file has
   * no entry for it. Read-only, and it reads no credential.
   */
  atlasProfileName: procedure({
    input: profileInput,
    output: z.custom<string | null>(),
  }),
  /** Any model method through object.execute_kw. Read-only use from the renderer. */
  executeKw: procedure({
    input: z.object({
      profileId: z.string().min(1),
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
      profileId: z.string().min(1),
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
      profileId: z.string().min(1),
      model: z.string().min(1),
      ids: z.array(z.number().int()),
      fields: z.array(z.string()).optional(),
    }),
    output: z.custom<OdooResult<OdooRecord[]>>(),
  }),
  /** search_count on any model. */
  searchCount: procedure({
    input: z.object({
      profileId: z.string().min(1),
      model: z.string().min(1),
      domain: z.array(z.unknown()).optional(),
    }),
    output: z.custom<OdooResult<number>>(),
  }),
  /** fields_get: what fields a model has, and of what type. */
  fieldsGet: procedure({
    input: z.object({
      profileId: z.string().min(1),
      model: z.string().min(1),
      attributes: z.array(z.string()).optional(),
    }),
    output: z.custom<OdooResult<Record<string, OdooFieldInfo>>>(),
  }),
  /** ir.model, optionally filtered by a substring of the technical or display name. */
  listModels: procedure({
    input: z.object({ profileId: z.string().min(1), filter: z.string().optional() }),
    output: z.custom<OdooResult<OdooModelSummary[]>>(),
  }),
  /**
   * Any model method, behind the write gate. Reads run straight through;
   * anything else is refused with a typed error unless confirmWrite is true.
   */
  callMethod: procedure({
    input: z.object({
      profileId: z.string().min(1),
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
    input: profileInput,
    output: z.custom<HelpdeskTeam[]>(),
  }),
  /** Open helpdesk tickets, newest activity first, optionally one team. */
  helpdeskTickets: procedure({
    input: z.object({
      profileId: z.string().min(1),
      teamId: z.number().optional(),
      limit: z.number().optional(),
    }),
    output: z.custom<HelpdeskTicket[]>(),
  }),
  /** The chatter of one ticket, oldest first. */
  helpdeskMessages: procedure({
    input: z.object({ profileId: z.string().min(1), ticketId: z.number() }),
    output: z.custom<HelpdeskMessage[]>(),
  }),
  /** The customer behind a ticket and their other tickets. */
  helpdeskRelated: procedure({
    input: z.object({ profileId: z.string().min(1), ticketId: z.number() }),
    output: z.custom<HelpdeskRelated>(),
  }),
  /** Add an internal note to a ticket (the app's only Odoo write). */
  helpdeskPostNote: procedure({
    input: z.object({
      profileId: z.string().min(1),
      ticketId: z.number(),
      body: z.string(),
    }),
    output: z.custom<{ messageId: number }>(),
  }),
});

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { OdooProfileSummary } from '@core/primitives/app-settings/api';
import {
  classifyOdooMethod,
  ODOO_DEFAULT_LIMIT,
  ODOO_MAX_LIMIT,
  type HelpdeskMessage,
  type HelpdeskRelated,
  type HelpdeskTeam,
  type HelpdeskTicket,
  type OdooConnectionTestResult,
  type OdooFieldInfo,
  type OdooModelSummary,
  type OdooProfileList,
  type OdooProfilesRefresh,
  type OdooProjectFolder,
  type OdooRecord,
  type OdooResult,
} from '../api/contract';
import {
  classifyOdooFault,
  classifyTransport,
  OdooCallError,
  odooResult,
  toOdooError,
} from './odoo-errors';
import { readOdooProfilesFromOnePassword } from './odoo-onepassword';
import { atlasProfileNameFor } from './odoo-profiles-file';
import {
  findStoredProfile,
  mergeOnePasswordProfiles,
  readOdooSettings,
  writeOdooSettings,
} from './odoo-profiles-store';
import {
  ensureOdooSecretsMigrated,
  forgetOdooSecret,
  getOdooSecret,
  rememberOdooSecrets,
} from './odoo-secrets';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function listProfiles(): Promise<OdooProfileList> {
  await ensureOdooSecretsMigrated();
  const settings = await readOdooSettings();
  return { profiles: settings.profiles, defaultProfileId: settings.defaultProfileId };
}

/**
 * Re-read the vault. Stored metadata is refreshed in place (a server already
 * listed keeps its id) and every secret is put in the OS keychain, which is the
 * only way a credential enters this app.
 */
export async function refreshProfilesFromOnePassword(vault?: string): Promise<OdooProfilesRefresh> {
  await ensureOdooSecretsMigrated();
  const { source, profiles: incoming, skipped } = await readOdooProfilesFromOnePassword(vault);
  const settings = await readOdooSettings();
  const { profiles, idByIncoming } = mergeOnePasswordProfiles(settings.profiles, incoming);
  const secretsPersisted = await rememberOdooSecrets(
    incoming.map((profile) => ({
      profileId: idByIncoming.get(profile.id) ?? profile.id,
      password: profile.password,
    }))
  );
  const defaultProfileId =
    settings.defaultProfileId && profiles.some((p) => p.id === settings.defaultProfileId)
      ? settings.defaultProfileId
      : (profiles[0]?.id ?? null);
  await writeOdooSettings({ defaultProfileId, profiles });
  return { profiles, defaultProfileId, source, skipped, secretsPersisted };
}

export async function setDefaultProfile(profileId: string): Promise<OdooProfileList> {
  const settings = await readOdooSettings();
  if (!settings.profiles.some((profile) => profile.id === profileId)) {
    throw new OdooCallError('unknown', `No Odoo server with id "${profileId}"`);
  }
  await writeOdooSettings({ defaultProfileId: profileId, profiles: settings.profiles });
  return { profiles: settings.profiles, defaultProfileId: profileId };
}

/** Forget a server: its metadata and its cached credential both go. 1Password is untouched. */
export async function removeProfile(profileId: string): Promise<OdooProfileList> {
  const settings = await readOdooSettings();
  const profiles = settings.profiles.filter((profile) => profile.id !== profileId);
  const defaultProfileId =
    settings.defaultProfileId === profileId ? (profiles[0]?.id ?? null) : settings.defaultProfileId;
  await writeOdooSettings({ defaultProfileId, profiles });
  await forgetOdooSecret(profileId);
  return { profiles, defaultProfileId };
}

/** The name `atlas` knows this server by, or null. Reads ~/.odoo-profiles.json, never writes it. */
export async function atlasProfileName(profileId: string): Promise<string | null> {
  const profile = await findStoredProfile(profileId);
  if (!profile) return null;
  return atlasProfileNameFor(profile);
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

/** A profile plus the credential resolved for it, for the length of one call. */
type OdooConnection = {
  profile: OdooProfileSummary;
  base: string;
  password: string;
};

async function connect(profileId: string): Promise<OdooConnection> {
  await ensureOdooSecretsMigrated();
  const profile = await findStoredProfile(profileId);
  if (!profile) {
    throw new OdooCallError(
      'unknown',
      `No Odoo server with id "${profileId}". Refresh the servers from 1Password on the Odoo settings page.`
    );
  }
  const password = await getOdooSecret(profileId);
  return { profile, base: profile.url.replace(/\/+$/, ''), password };
}

/**
 * Odoo's external RPC endpoint (/jsonrpc, services common and object). This is
 * the one that accepts API keys as the password; /web/session/authenticate only
 * takes a real password, which is why "Access Denied" appeared on itms19.
 */
export async function odooRpc(
  base: string,
  service: 'common' | 'object',
  method: string,
  args: unknown[],
  timeoutMs = 15000
): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${base}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          id: Date.now(),
          params: { service, method, args },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new OdooCallError(
          'timeout',
          `Odoo did not answer within ${timeoutMs} ms at ${base}/jsonrpc`
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new OdooCallError(classifyTransport(error), `${base}/jsonrpc: ${message}`);
    }
    if (!response.ok) {
      throw new OdooCallError('network', `HTTP ${response.status} from ${base}/jsonrpc`);
    }
    const body = (await response.json()) as {
      result?: unknown;
      error?: { message?: string; data?: { message?: string } };
    };
    if (body.error) {
      const message = body.error.data?.message ?? body.error.message ?? 'Odoo returned an error';
      throw new OdooCallError(classifyOdooFault(message), message);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(profileId: string): Promise<OdooConnectionTestResult> {
  const started = Date.now();
  try {
    const { profile, base, password } = await connect(profileId);
    const version = (await odooRpc(base, 'common', 'version', [])) as { server_version?: string };
    const uid = (await odooRpc(base, 'common', 'authenticate', [
      profile.db,
      profile.user,
      password,
      {},
    ])) as number | false;
    if (!uid) {
      return {
        ok: false,
        error: `Login refused for ${profile.user} on database ${profile.db} (password or API key)`,
        durationMs: Date.now() - started,
      };
    }
    const users = (await odooRpc(base, 'object', 'execute_kw', [
      profile.db,
      uid,
      password,
      'res.users',
      'read',
      [[uid]],
      { fields: ['name'] },
    ])) as Array<{ name?: string }>;
    return {
      ok: true,
      serverVersion: version.server_version ?? 'unknown',
      uid,
      userName: users[0]?.name ?? profile.user,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}

// ---------------------------------------------------------------------------
// The paired project folder
// ---------------------------------------------------------------------------

const ODOO_MCP_CANDIDATES = [
  process.env.ITMS_ODOO_MCP_SERVER,
  path.join(os.homedir(), '.local', 'bin', 'itms-odoo-dev'),
  '/opt/homebrew/bin/itms-odoo-dev',
  '/usr/local/bin/itms-odoo-dev',
].filter((p): p is string => Boolean(p));

/**
 * The Odoo MCP server this machine already has: the `itms-odoo-dev` launcher,
 * which resolves a profile name to credentials itself (`.proj/config.yaml` ->
 * ~/.odoo-profiles.json) so the password never has to be written into the
 * project folder. Returns null when nothing is installed - we do not invent a
 * server that is not there.
 */
export async function findOdooMcpServer(): Promise<string | null> {
  for (const candidate of ODOO_MCP_CANDIDATES) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * A project folder for one Odoo server, so a task can start the moment a
 * server is chosen. ~/ITMS CoWorker/odoo-<id>/ with an AGENTS.md that tells the
 * agent which server it is on. The credential never goes in the folder: the MCP
 * launcher and atlas read it from their own ~/.odoo-profiles.json.
 *
 * The profile name written into the folder is the name atlas knows, matched on
 * url and database - this app's id ("itms-19") is not an atlas profile name.
 */
export async function prepareProjectFolder(profileId: string): Promise<OdooProjectFolder> {
  await ensureOdooSecretsMigrated();
  const profile = await findStoredProfile(profileId);
  if (!profile) {
    throw new OdooCallError('unknown', `No Odoo server with id "${profileId}"`);
  }
  const atlasName = await atlasProfileNameFor(profile);
  const root = path.join(os.homedir(), 'ITMS CoWorker');
  const dir = path.join(root, `odoo-${profile.id}`);
  let created = false;
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    created = true;
  }
  const mcpServer = await findOdooMcpServer();
  const mcpSection = mcpServer
    ? `## How to reach it: the odoo MCP server (use this first)

This folder registers an \`odoo\` MCP server in .mcp.json. It is already pointed at
this server, so the tools need no URL, database or password:

- \`list_profiles\` / \`switch_profile\` - which server the tools are talking to
- \`search_models\` - find a model by name
- \`execute_method\` - any model method, e.g. search_read, read, fields_get
- \`get_installed_modules\` - what is installed
- \`run_sql\` - read-only SQL where a query is easier than a domain

Credentials come from the profile name in .proj/config.yaml, resolved against
~/.odoo-profiles.json by the launcher. Nothing secret is stored in this folder.

## Fallback: the atlas CLI

If the MCP tools are not available in this session, use atlas, which holds the
credential itself:`
    : `## How to reach it: the atlas CLI

No Odoo MCP server is installed on this machine, so atlas is the way in. It
holds the credential itself:`;

  const atlasSection = atlasName
    ? `    atlas odoo --profile ${atlasName} models --json
    atlas odoo --profile ${atlasName} fields res.partner --json
    atlas odoo --profile ${atlasName} count res.partner --domain '[["is_company","=",true]]'
    atlas odoo --profile ${atlasName} read res.partner 1 2 --fields name,email --json
    atlas odoo --profile ${atlasName} export res.partner --fields name,email --limit 50

\`atlas odoo --help\` lists every verb for this family; \`atlas commands --json\` lists
the whole tree.`
    : `~/.odoo-profiles.json has no entry for this server, so atlas has no profile name
for it. Run \`atlas odoo profiles\` and pick the one for ${profile.url} (database
${profile.db}); "${profile.id}" is this app's own id, not an atlas profile name.`;

  const agents = `# Odoo server: ${profile.name}

This project is paired with one Odoo server. Every question or change is about this
server unless the task says otherwise.

- Name: ${profile.name}
- URL: ${profile.url}
- Database: ${profile.db}
- User: ${profile.user}
${profile.odooVersion ? `- Odoo version: ${profile.odooVersion}\n` : ''}${profile.description ? `- Notes: ${profile.description}\n` : ''}
${mcpSection}

${atlasSection}

## Read before you write

These methods are reads and need no permission: \`search\`, \`search_read\`,
\`search_count\`, \`read\`, \`read_group\`, \`fields_get\`, \`default_get\`, \`name_search\`.

Everything else is a write - \`create\`, \`write\`, \`unlink\`, \`message_post\`, button
methods, module install and upgrade. Show the exact call and the number of affected
records to the person and wait for them to agree before running it.
${atlasName ? `\nThe environment variable ODOO_PROFILE=${atlasName} names this server too.\n` : ''}
Never print or copy the password or API key. It is not in this folder on purpose.
`;
  await fs.writeFile(path.join(dir, 'AGENTS.md'), agents);
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  await fs.writeFile(
    path.join(dir, '.env'),
    `${atlasName ? `ODOO_PROFILE=${atlasName}\n` : ''}ODOO_URL=${profile.url}\nODOO_DB=${profile.db}\n`
  );
  if (mcpServer && atlasName) {
    // The launcher walks up from its working directory looking for this file and
    // resolves the profile name against ~/.odoo-profiles.json, which is where the
    // launcher's own copy of the password stays. Without a name it knows, there
    // is nothing to point it at.
    await fs.mkdir(path.join(dir, '.proj'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.proj', 'config.yaml'),
      `# Read by the itms-odoo-dev MCP launcher.\nodoo:\n  profile: ${atlasName}\n`
    );
    const mcpConfig = {
      mcpServers: {
        odoo: {
          type: 'stdio',
          command: mcpServer,
          args: [] as string[],
          // No password here on purpose: the launcher adds ODOO_PASSWORD from
          // ~/.odoo-profiles.json using the profile named in .proj/config.yaml.
          env: {
            ODOO_PROFILE: atlasName,
            ODOO_URL: profile.url,
            ODOO_DB: profile.db,
            ODOO_USERNAME: profile.user,
          },
        },
      },
    };
    await fs.writeFile(path.join(dir, '.mcp.json'), JSON.stringify(mcpConfig, null, 2) + '\n');
  }
  try {
    await fs.access(path.join(dir, '.git'));
  } catch {
    await execFileAsync('git', ['init', '-q'], { cwd: dir });
    await fs.writeFile(path.join(dir, '.gitignore'), '.env\n');
    await execFileAsync('git', ['add', '-A'], { cwd: dir });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=ITMS CoWorker',
        '-c',
        'user.email=coworker@itmsgroup.com.au',
        'commit',
        '-q',
        '-m',
        `Odoo project for ${profile.name}`,
      ],
      { cwd: dir }
    );
  }
  return {
    path: dir,
    created,
    name: `Odoo · ${profile.name}`,
    mcpServer: mcpServer && atlasName ? mcpServer : null,
  };
}

// ---------------------------------------------------------------------------
// Generic execute_kw and the Helpdesk readers
// ---------------------------------------------------------------------------

const uidCache = new Map<string, number>();

/**
 * The cache key identifies the credential without holding it: the password is
 * replaced by a truncated SHA-256 so a rotated API key still misses the cache
 * but the plaintext is never a map key.
 */
function uidCacheKey(connection: OdooConnection): string {
  const fingerprint = createHash('sha256').update(connection.password).digest('hex').slice(0, 32);
  return `${connection.base}|${connection.profile.db}|${connection.profile.user}|${fingerprint}`;
}

/** Forget the cached uid for one connection, or for every profile when none is given. */
export function clearUidCache(connection?: OdooConnection): void {
  if (!connection) uidCache.clear();
  else uidCache.delete(uidCacheKey(connection));
}

/** Authenticate once per credential (url + db + user + password) and cache the uid. */
async function odooUid(connection: OdooConnection): Promise<number> {
  const key = uidCacheKey(connection);
  const cached = uidCache.get(key);
  if (cached) return cached;
  const uid = (await odooRpc(connection.base, 'common', 'authenticate', [
    connection.profile.db,
    connection.profile.user,
    connection.password,
    {},
  ])) as number | false;
  if (!uid) {
    throw new OdooCallError(
      'auth',
      `Login refused for ${connection.profile.user} on database ${connection.profile.db} (password or API key)`
    );
  }
  uidCache.set(key, uid);
  return uid;
}

async function executeKwOnce(
  connection: OdooConnection,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown>
): Promise<unknown> {
  const uid = await odooUid(connection);
  return odooRpc(connection.base, 'object', 'execute_kw', [
    connection.profile.db,
    uid,
    connection.password,
    model,
    method,
    args,
    kwargs,
  ]);
}

/**
 * object.execute_kw for any model and method, on an already-resolved connection.
 *
 * A cached uid outlives the session it was minted in, so an Odoo restart or a
 * rotated key shows up here as an auth failure on a call that used to work.
 * When that happens the cached uid is dropped and the call is tried once more
 * from a fresh authenticate; a second failure is surfaced as a typed auth error.
 */
async function executeKwOn(
  connection: OdooConnection,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<unknown> {
  try {
    return await executeKwOnce(connection, model, method, args, kwargs);
  } catch (error) {
    if (toOdooError(error).kind !== 'auth') throw error;
    clearUidCache(connection);
    try {
      return await executeKwOnce(connection, model, method, args, kwargs);
    } catch (retryError) {
      const normalised = toOdooError(retryError);
      throw new OdooCallError(normalised.kind, normalised.message);
    }
  }
}

/** object.execute_kw for any model and method, by profile id. */
export async function executeKw(
  profileId: string,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<unknown> {
  return executeKwOn(await connect(profileId), model, method, args, kwargs);
}

// ---------------------------------------------------------------------------
// Convenience reads, on the wire for the renderer and for agent tooling
// ---------------------------------------------------------------------------

export type SearchReadRequest = {
  profileId: string;
  model: string;
  domain?: unknown[];
  fields?: string[];
  order?: string;
  limit?: number;
  offset?: number;
};

/** search_read, with the limit clamped to ODOO_MAX_LIMIT so one call cannot pull a whole table. */
export async function searchRead(req: SearchReadRequest): Promise<OdooResult<OdooRecord[]>> {
  return odooResult(async () => {
    const limit = Math.min(Math.max(1, req.limit ?? ODOO_DEFAULT_LIMIT), ODOO_MAX_LIMIT);
    const kwargs: Record<string, unknown> = { limit };
    if (req.fields?.length) kwargs.fields = req.fields;
    if (req.order) kwargs.order = req.order;
    if (req.offset) kwargs.offset = req.offset;
    const rows = (await executeKw(
      req.profileId,
      req.model,
      'search_read',
      [req.domain ?? []],
      kwargs
    )) as OdooRecord[];
    return rows;
  });
}

export async function readRecords(req: {
  profileId: string;
  model: string;
  ids: number[];
  fields?: string[];
}): Promise<OdooResult<OdooRecord[]>> {
  return odooResult(async () => {
    if (req.ids.length === 0) return [];
    const kwargs: Record<string, unknown> = {};
    if (req.fields?.length) kwargs.fields = req.fields;
    return (await executeKw(req.profileId, req.model, 'read', [req.ids], kwargs)) as OdooRecord[];
  });
}

export async function searchCount(req: {
  profileId: string;
  model: string;
  domain?: unknown[];
}): Promise<OdooResult<number>> {
  return odooResult(
    async () =>
      (await executeKw(req.profileId, req.model, 'search_count', [req.domain ?? []])) as number
  );
}

export async function fieldsGet(req: {
  profileId: string;
  model: string;
  attributes?: string[];
}): Promise<OdooResult<Record<string, OdooFieldInfo>>> {
  return odooResult(async () => {
    const attributes = req.attributes ?? [
      'string',
      'type',
      'required',
      'readonly',
      'store',
      'relation',
      'selection',
      'help',
    ];
    return (await executeKw(req.profileId, req.model, 'fields_get', [[]], {
      attributes,
    })) as Record<string, OdooFieldInfo>;
  });
}

/** Every installed model, or those whose technical or display name contains `filter`. */
export async function listModels(req: {
  profileId: string;
  filter?: string;
}): Promise<OdooResult<OdooModelSummary[]>> {
  return odooResult(async () => {
    const needle = req.filter?.trim();
    const domain = needle ? ['|', ['model', 'ilike', needle], ['name', 'ilike', needle]] : [];
    const rows = (await executeKw(req.profileId, 'ir.model', 'search_read', [domain], {
      fields: ['model', 'name'],
      order: 'model',
      limit: ODOO_MAX_LIMIT,
    })) as Array<{ model?: string; name?: string }>;
    return rows.map((r) => ({ model: r.model ?? '', name: r.name ?? '' }));
  });
}

/**
 * The write gate. Reads run straight through. Anything else - create, write,
 * unlink, message_post, module installs, any custom method - is refused unless
 * the caller has already shown it to a person and passes confirmWrite.
 *
 * This is the same rule the generated Odoo project folder states in AGENTS.md,
 * enforced here rather than only documented.
 */
export async function callMethod(req: {
  profileId: string;
  model: string;
  method: string;
  args: unknown[];
  kwargs?: Record<string, unknown>;
  confirmWrite: boolean;
}): Promise<OdooResult<unknown>> {
  if (classifyOdooMethod(req.method) === 'write' && req.confirmWrite !== true) {
    return {
      ok: false,
      error: {
        kind: 'access-denied',
        message: `${req.model}.${req.method} writes to Odoo. Show it to a person and call again with confirmWrite: true.`,
      },
    };
  }
  return odooResult(() =>
    executeKw(req.profileId, req.model, req.method, req.args, req.kwargs ?? {})
  );
}

type Many2one = [number, string] | false;
const m2oId = (v: Many2one): number | null => (v ? v[0] : null);
const m2oName = (v: Many2one): string => (v ? v[1] : '');

/** Odoo stores descriptions as HTML; the list shows plain text. */
function htmlToText(html: string | false): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const OPEN_DOMAIN = [['stage_id.fold', '=', false]];

/** Every helpdesk team with its open-ticket count (stages not folded). */
export async function helpdeskTeams(profileId: string): Promise<HelpdeskTeam[]> {
  const connection = await connect(profileId);
  const teams = (await executeKwOn(connection, 'helpdesk.team', 'search_read', [[]], {
    fields: ['id', 'name', 'description'],
    order: 'sequence, name',
  })) as Array<{ id: number; name: string; description: string | false }>;
  const groups = (await executeKwOn(connection, 'helpdesk.ticket', 'read_group', [
    OPEN_DOMAIN,
    ['team_id'],
    ['team_id'],
  ])) as Array<{ team_id: Many2one; team_id_count: number }>;
  const open = new Map<number | null, number>();
  for (const g of groups) open.set(m2oId(g.team_id), g.team_id_count);
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: htmlToText(t.description),
    open: open.get(t.id) ?? 0,
  }));
}

/** Open tickets, newest activity first, optionally for one team. */
export async function helpdeskTickets(
  profileId: string,
  opts: { teamId?: number; limit?: number } = {}
): Promise<HelpdeskTicket[]> {
  const domain = opts.teamId ? [...OPEN_DOMAIN, ['team_id', '=', opts.teamId]] : OPEN_DOMAIN;
  const rows = (await executeKw(profileId, 'helpdesk.ticket', 'search_read', [domain], {
    fields: [
      'id',
      'ticket_ref',
      'name',
      'team_id',
      'stage_id',
      'partner_id',
      'user_id',
      'priority',
      'sla_deadline',
      'kanban_state',
      'create_date',
      'write_date',
      'description',
    ],
    order: 'write_date desc',
    limit: opts.limit ?? 500,
  })) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    ref: (r.ticket_ref as string | false) || String(r.id),
    name: (r.name as string) ?? '',
    teamId: m2oId(r.team_id as Many2one),
    team: m2oName(r.team_id as Many2one),
    stageId: m2oId(r.stage_id as Many2one),
    stage: m2oName(r.stage_id as Many2one),
    customer: m2oName(r.partner_id as Many2one),
    assigneeId: m2oId(r.user_id as Many2one),
    assignee: m2oName(r.user_id as Many2one),
    priority: Number(r.priority ?? 0),
    slaDeadline: (r.sla_deadline as string | false) || null,
    kanbanState: (r.kanban_state as string) ?? 'normal',
    createdAt: r.create_date as string,
    updatedAt: r.write_date as string,
    description: htmlToText(r.description as string | false).slice(0, 4000),
  }));
}

/** The chatter of one ticket, oldest first: emails, comments and internal notes, not system tracking. */
export async function helpdeskMessages(
  profileId: string,
  ticketId: number
): Promise<HelpdeskMessage[]> {
  const rows = (await executeKw(
    profileId,
    'mail.message',
    'search_read',
    [
      [
        ['model', '=', 'helpdesk.ticket'],
        ['res_id', '=', ticketId],
        ['message_type', 'in', ['email', 'comment', 'email_outgoing']],
      ],
    ],
    {
      fields: [
        'id',
        'date',
        'author_id',
        'email_from',
        'body',
        'message_type',
        'subtype_id',
        'subject',
      ],
      order: 'date asc',
      limit: 200,
    }
  )) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const subtype = m2oName(r.subtype_id as Many2one);
    return {
      id: r.id as number,
      date: r.date as string,
      author: m2oName(r.author_id as Many2one) || (r.email_from as string | false) || '',
      subject: (r.subject as string | false) || '',
      body: htmlToText(r.body as string | false).slice(0, 6000),
      kind:
        subtype === 'Note'
          ? 'note'
          : (r.message_type as string) === 'comment'
            ? 'message'
            : 'email',
    };
  });
}

/** What else the practice knows about the ticket's customer: the contact and their other tickets. */
export async function helpdeskRelated(
  profileId: string,
  ticketId: number
): Promise<HelpdeskRelated> {
  const connection = await connect(profileId);
  const [ticket] = (await executeKwOn(connection, 'helpdesk.ticket', 'read', [[ticketId]], {
    fields: ['partner_id', 'commercial_partner_id', 'partner_email', 'partner_phone'],
  })) as Array<Record<string, unknown>>;
  const partnerId = m2oId((ticket?.partner_id as Many2one) ?? false);
  const companyId = m2oId((ticket?.commercial_partner_id as Many2one) ?? false) ?? partnerId;
  if (!companyId) {
    return {
      contact: null,
      company: '',
      email: '',
      phone: '',
      previousTickets: [],
      openTickets: 0,
    };
  }
  const tickets = (await executeKwOn(
    connection,
    'helpdesk.ticket',
    'search_read',
    [
      [
        ['id', '!=', ticketId],
        ['partner_id', 'child_of', companyId],
      ],
    ],
    {
      fields: ['id', 'ticket_ref', 'name', 'stage_id', 'create_date', 'user_id'],
      order: 'create_date desc',
      limit: 15,
    }
  )) as Array<Record<string, unknown>>;
  const openCount = (await executeKwOn(connection, 'helpdesk.ticket', 'search_count', [
    [
      ['id', '!=', ticketId],
      ['partner_id', 'child_of', companyId],
      ['stage_id.fold', '=', false],
    ],
  ])) as number;
  return {
    contact: m2oName((ticket?.partner_id as Many2one) ?? false) || null,
    company: m2oName((ticket?.commercial_partner_id as Many2one) ?? false),
    email: (ticket?.partner_email as string | false) || '',
    phone: (ticket?.partner_phone as string | false) || '',
    openTickets: openCount,
    previousTickets: tickets.map((t) => ({
      id: t.id as number,
      ref: (t.ticket_ref as string | false) || String(t.id),
      name: (t.name as string) ?? '',
      stage: m2oName(t.stage_id as Many2one),
      assignee: m2oName(t.user_id as Many2one),
      createdAt: t.create_date as string,
    })),
  };
}

/** Add an internal note to a ticket. The only write the app makes, and it is a note, not a change. */
export async function helpdeskPostNote(
  profileId: string,
  ticketId: number,
  body: string
): Promise<{ messageId: number }> {
  const html = body
    .split('\n')
    .map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .join('<br/>');
  const id = (await executeKw(profileId, 'helpdesk.ticket', 'message_post', [[ticketId]], {
    body: `<p>${html}</p>`,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_note',
  })) as number;
  return { messageId: id };
}

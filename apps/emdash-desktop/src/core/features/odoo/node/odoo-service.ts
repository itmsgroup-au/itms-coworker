import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { OdooProfile } from '@core/primitives/app-settings/api';
import {
  classifyOdooMethod,
  ODOO_DEFAULT_LIMIT,
  ODOO_MAX_LIMIT,
  type HelpdeskMessage,
  type HelpdeskRelated,
  type HelpdeskTeam,
  type HelpdeskTicket,
  type OdooConnectionTestResult,
  type OdooError,
  type OdooErrorKind,
  type OdooFieldInfo,
  type OdooModelSummary,
  type OdooProfilesFile,
  type OdooProfilesSource,
  type OdooProjectFolder,
  type OdooRecord,
  type OdooResult,
} from '../api/contract';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Every failure raised inside this module carries a kind. `message` stays the
 * human-readable text the UI already prints, so `testConnection`'s existing
 * `{ ok: false, error: string }` shape is unchanged.
 */
export class OdooCallError extends Error {
  readonly kind: OdooErrorKind;

  constructor(kind: OdooErrorKind, message: string) {
    super(message);
    this.name = 'OdooCallError';
    this.kind = kind;
  }
}

/** Odoo says "Access Denied" for a bad login and "Access Error" for a bad ACL. */
function classifyOdooFault(message: string): OdooErrorKind {
  if (/access denied|invalid (password|api key|credentials)|login refused/i.test(message)) {
    return 'auth';
  }
  if (/session expired|expired session/i.test(message)) return 'auth';
  if (
    /access error|you are not allowed|not allowed to (access|read|write|create|unlink)/i.test(
      message
    )
  ) {
    return 'access-denied';
  }
  return 'odoo';
}

function classifyTransport(error: unknown): OdooErrorKind {
  const name = (error as { name?: string }).name ?? '';
  const code = String((error as { code?: string }).code ?? '');
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'AbortError' || /abort|timed? ?out/i.test(message) || code === 'ETIMEDOUT') {
    return 'timeout';
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|CERT_/i.test(code) ||
    /fetch failed|network|socket hang up|certificate/i.test(message)
  ) {
    return 'network';
  }
  return 'unknown';
}

/** Normalise anything thrown anywhere in this module into the wire error union. */
export function toOdooError(error: unknown): OdooError {
  if (error instanceof OdooCallError) return { kind: error.kind, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  const transport = classifyTransport(error);
  if (transport !== 'unknown') return { kind: transport, message };
  const fault = classifyOdooFault(message);
  return { kind: fault === 'odoo' ? 'unknown' : fault, message };
}

/** Run a service call and hand back the wire result envelope instead of throwing. */
async function odooResult<T>(run: () => Promise<T>): Promise<OdooResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, error: toOdooError(error) };
  }
}

/**
 * ~/.odoo-profiles.json is a map of profile name to
 * { url, host, port, db, user, password, odoo_version, description }.
 * That is the file atlas and the odoo CLI read, so we keep it as the exchange
 * format and translate to the app's OdooProfile shape here.
 */
type FileProfile = {
  url?: string;
  host?: string;
  port?: number | string;
  db?: string;
  user?: string;
  password?: string;
  odoo_version?: string;
  description?: string;
};

export const ODOO_PROFILES_PATH = path.join(os.homedir(), '.odoo-profiles.json');

const clip = (value: string | undefined, max: number) =>
  value && value.trim() ? value.trim().slice(0, max) : undefined;

export function profileIdFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'profile';
}

function urlFromFileProfile(entry: FileProfile): string {
  if (entry.url) return entry.url.replace(/\/+$/, '');
  if (entry.host) {
    const port = entry.port ? `:${entry.port}` : '';
    const scheme = String(entry.port) === '443' ? 'https' : 'http';
    return `${scheme}://${entry.host}${port}`;
  }
  return '';
}

export async function readProfilesFile(): Promise<OdooProfilesFile> {
  let raw: string;
  try {
    raw = await fs.readFile(ODOO_PROFILES_PATH, 'utf8');
  } catch {
    return { path: ODOO_PROFILES_PATH, exists: false, profiles: [] };
  }
  const parsed = JSON.parse(raw) as Record<string, FileProfile>;
  const taken = new Set<string>();
  const profiles: OdooProfile[] = Object.entries(parsed).map(([name, entry]) => {
    let id = profileIdFromName(name);
    let suffix = 2;
    while (taken.has(id)) id = `${profileIdFromName(name)}-${suffix++}`;
    taken.add(id);
    return {
      id,
      name,
      url: urlFromFileProfile(entry),
      db: entry.db ?? '',
      user: entry.user ?? '',
      password: entry.password ?? '',
      description: entry.description,
      odooVersion: entry.odoo_version ? String(entry.odoo_version) : undefined,
    };
  });
  return { path: ODOO_PROFILES_PATH, exists: true, profiles };
}

export async function writeProfilesFile(profiles: OdooProfile[]): Promise<{ path: string }> {
  const out: Record<string, FileProfile> = {};
  for (const profile of profiles) {
    const url = new URL(profile.url);
    out[profile.name] = {
      url: profile.url,
      host: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      db: profile.db,
      user: profile.user,
      password: profile.password,
      odoo_version: profile.odooVersion,
      description: profile.description,
    };
  }
  await fs.writeFile(ODOO_PROFILES_PATH, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
  return { path: ODOO_PROFILES_PATH };
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

export async function testConnection(profile: OdooProfile): Promise<OdooConnectionTestResult> {
  const started = Date.now();
  try {
    const base = profile.url.replace(/\/+$/, '');
    const version = (await odooRpc(base, 'common', 'version', [])) as { server_version?: string };
    const uid = (await odooRpc(base, 'common', 'authenticate', [
      profile.db,
      profile.user,
      profile.password,
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
      profile.password,
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

/**
 * 1Password is the source of truth for Odoo servers: one item per server in the
 * vault, tagged `odoo-profile`, with the same custom fields as
 * ~/.odoo-profiles.json (url, host, port, db, user, password, odoo_version,
 * description). The title is "odoo - <name>". Read through the `op` CLI, which
 * signs in through the 1Password desktop app.
 */
const OP_CANDIDATES = ['/opt/homebrew/bin/op', '/usr/local/bin/op', 'op'];

async function op(args: string[]): Promise<string> {
  let lastError: unknown;
  for (const bin of OP_CANDIDATES) {
    try {
      const { stdout } = await execFileAsync(bin, args, {
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` },
      });
      return stdout;
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('1Password CLI (op) not found');
}

type OpField = { id?: string; label?: string; value?: string; type?: string };
type OpItem = { id: string; title: string; category?: string; fields?: OpField[] };

function field(item: OpItem, ...labels: string[]): string {
  for (const label of labels) {
    const hit = item.fields?.find((f) => (f.label ?? f.id ?? '').toLowerCase() === label);
    if (hit?.value) return hit.value;
  }
  return '';
}

export async function readProfilesFromOnePassword(vault = 'AI_MCP'): Promise<OdooProfilesSource> {
  const list = JSON.parse(
    await op(['item', 'list', '--vault', vault, '--tags', 'odoo-profile', '--format', 'json'])
  ) as OpItem[];
  // One `op item get` per server, six at a time: 21 sequential calls took longer
  // than the 30 s wire timeout (4 Sep 2026).
  const items: OpItem[] = [];
  const queue = [...list];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        items.push(
          JSON.parse(
            await op(['item', 'get', next.id, '--vault', vault, '--format', 'json', '--reveal'])
          ) as OpItem
        );
      }
    })
  );
  items.sort((a, b) => a.title.localeCompare(b.title));
  const profiles: OdooProfile[] = [];
  const skipped: string[] = [];
  const taken = new Set<string>();
  for (const item of items) {
    const name = item.title.replace(/^odoo\s*-\s*/i, '').trim() || item.title;
    const entry: FileProfile = {
      url: field(item, 'url', 'website'),
      host: field(item, 'host', 'hostname'),
      port: field(item, 'port'),
      db: field(item, 'db', 'database'),
      user: field(item, 'user', 'username'),
      password: field(item, 'password', 'credential'),
      odoo_version: field(item, 'odoo_version'),
      description: field(item, 'description'),
    };
    const url = urlFromFileProfile(entry);
    if (!url || !entry.db || !entry.user) {
      skipped.push(`${item.title} (missing url, db or user)`);
      continue;
    }
    let id = profileIdFromName(name);
    let suffix = 2;
    while (taken.has(id)) id = `${profileIdFromName(name)}-${suffix++}`;
    taken.add(id);
    profiles.push({
      id,
      name,
      url,
      db: entry.db,
      user: entry.user,
      password: entry.password ?? '',
      description: clip(entry.description, 2000),
      odooVersion: clip(entry.odoo_version, 40),
    });
  }
  return { source: `1Password vault ${vault}, tag odoo-profile`, profiles, skipped };
}

/**
 * A project folder for one Odoo server, so a task can start the moment a
 * server is chosen. ~/ITMS CoWorker/odoo-<id>/ with an AGENTS.md that tells
 * the agent which server it is on and to reach it through `atlas odoo
 * --profile <name>`. The password never goes in the folder: atlas reads it
 * from ~/.odoo-profiles.json or 1Password.
 */
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

export async function prepareProjectFolder(profile: OdooProfile): Promise<OdooProjectFolder> {
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

  const agents = `# Odoo server: ${profile.name}

This project is paired with one Odoo server. Every question or change is about this
server unless the task says otherwise.

- Name: ${profile.name}
- URL: ${profile.url}
- Database: ${profile.db}
- User: ${profile.user}
${profile.odooVersion ? `- Odoo version: ${profile.odooVersion}\n` : ''}${profile.description ? `- Notes: ${profile.description}\n` : ''}
${mcpSection}

    atlas odoo --profile ${profile.name} models --json
    atlas odoo --profile ${profile.name} fields res.partner --json
    atlas odoo --profile ${profile.name} count res.partner --domain '[["is_company","=",true]]'
    atlas odoo --profile ${profile.name} read res.partner 1 2 --fields name,email --json
    atlas odoo --profile ${profile.name} export res.partner --fields name,email --limit 50

\`atlas odoo --help\` lists every verb for this family; \`atlas commands --json\` lists
the whole tree.

## Read before you write

These methods are reads and need no permission: \`search\`, \`search_read\`,
\`search_count\`, \`read\`, \`read_group\`, \`fields_get\`, \`default_get\`, \`name_search\`.

Everything else is a write - \`create\`, \`write\`, \`unlink\`, \`message_post\`, button
methods, module install and upgrade. Show the exact call and the number of affected
records to the person and wait for them to agree before running it.

The environment variable ODOO_PROFILE=${profile.name} names this server too.

Never print or copy the password or API key. It is not in this folder on purpose.
`;
  await fs.writeFile(path.join(dir, 'AGENTS.md'), agents);
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  await fs.writeFile(
    path.join(dir, '.env'),
    `ODOO_PROFILE=${profile.name}\nODOO_URL=${profile.url}\nODOO_DB=${profile.db}\n`
  );
  if (mcpServer) {
    // The launcher walks up from its working directory looking for this file and
    // resolves the profile name against ~/.odoo-profiles.json, which is where the
    // password stays.
    await fs.mkdir(path.join(dir, '.proj'), { recursive: true });
    await fs.writeFile(
      path.join(dir, '.proj', 'config.yaml'),
      `# Read by the itms-odoo-dev MCP launcher.\nodoo:\n  profile: ${profile.name}\n`
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
            ODOO_PROFILE: profile.name,
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
  return { path: dir, created, name: `Odoo · ${profile.name}`, mcpServer };
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
function uidCacheKey(profile: OdooProfile): string {
  const base = profile.url.replace(/\/+$/, '');
  const fingerprint = createHash('sha256').update(profile.password).digest('hex').slice(0, 32);
  return `${base}|${profile.db}|${profile.user}|${fingerprint}`;
}

/** Forget the cached uid for one profile, or for every profile when none is given. */
export function clearUidCache(profile?: OdooProfile): void {
  if (!profile) uidCache.clear();
  else uidCache.delete(uidCacheKey(profile));
}

/** Authenticate once per profile (url + db + user + password) and cache the uid. */
async function odooUid(profile: OdooProfile): Promise<number> {
  const base = profile.url.replace(/\/+$/, '');
  const key = uidCacheKey(profile);
  const cached = uidCache.get(key);
  if (cached) return cached;
  const uid = (await odooRpc(base, 'common', 'authenticate', [
    profile.db,
    profile.user,
    profile.password,
    {},
  ])) as number | false;
  if (!uid) {
    throw new OdooCallError(
      'auth',
      `Login refused for ${profile.user} on database ${profile.db} (password or API key)`
    );
  }
  uidCache.set(key, uid);
  return uid;
}

async function executeKwOnce(
  profile: OdooProfile,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown>
): Promise<unknown> {
  const base = profile.url.replace(/\/+$/, '');
  const uid = await odooUid(profile);
  return odooRpc(base, 'object', 'execute_kw', [
    profile.db,
    uid,
    profile.password,
    model,
    method,
    args,
    kwargs,
  ]);
}

/**
 * object.execute_kw for any model and method.
 *
 * A cached uid outlives the session it was minted in, so an Odoo restart or a
 * rotated key shows up here as an auth failure on a call that used to work.
 * When that happens the cached uid is dropped and the call is tried once more
 * from a fresh authenticate; a second failure is surfaced as a typed auth error.
 */
export async function executeKw(
  profile: OdooProfile,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
): Promise<unknown> {
  try {
    return await executeKwOnce(profile, model, method, args, kwargs);
  } catch (error) {
    if (toOdooError(error).kind !== 'auth') throw error;
    clearUidCache(profile);
    try {
      return await executeKwOnce(profile, model, method, args, kwargs);
    } catch (retryError) {
      const normalised = toOdooError(retryError);
      throw new OdooCallError(normalised.kind, normalised.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience reads, on the wire for the renderer and for agent tooling
// ---------------------------------------------------------------------------

export type SearchReadRequest = {
  profile: OdooProfile;
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
      req.profile,
      req.model,
      'search_read',
      [req.domain ?? []],
      kwargs
    )) as OdooRecord[];
    return rows;
  });
}

export async function readRecords(req: {
  profile: OdooProfile;
  model: string;
  ids: number[];
  fields?: string[];
}): Promise<OdooResult<OdooRecord[]>> {
  return odooResult(async () => {
    if (req.ids.length === 0) return [];
    const kwargs: Record<string, unknown> = {};
    if (req.fields?.length) kwargs.fields = req.fields;
    return (await executeKw(req.profile, req.model, 'read', [req.ids], kwargs)) as OdooRecord[];
  });
}

export async function searchCount(req: {
  profile: OdooProfile;
  model: string;
  domain?: unknown[];
}): Promise<OdooResult<number>> {
  return odooResult(
    async () =>
      (await executeKw(req.profile, req.model, 'search_count', [req.domain ?? []])) as number
  );
}

export async function fieldsGet(req: {
  profile: OdooProfile;
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
    return (await executeKw(req.profile, req.model, 'fields_get', [[]], {
      attributes,
    })) as Record<string, OdooFieldInfo>;
  });
}

/** Every installed model, or those whose technical or display name contains `filter`. */
export async function listModels(req: {
  profile: OdooProfile;
  filter?: string;
}): Promise<OdooResult<OdooModelSummary[]>> {
  return odooResult(async () => {
    const needle = req.filter?.trim();
    const domain = needle ? ['|', ['model', 'ilike', needle], ['name', 'ilike', needle]] : [];
    const rows = (await executeKw(req.profile, 'ir.model', 'search_read', [domain], {
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
  profile: OdooProfile;
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
    executeKw(req.profile, req.model, req.method, req.args, req.kwargs ?? {})
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
export async function helpdeskTeams(profile: OdooProfile): Promise<HelpdeskTeam[]> {
  const teams = (await executeKw(profile, 'helpdesk.team', 'search_read', [[]], {
    fields: ['id', 'name', 'description'],
    order: 'sequence, name',
  })) as Array<{ id: number; name: string; description: string | false }>;
  const groups = (await executeKw(profile, 'helpdesk.ticket', 'read_group', [
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
  profile: OdooProfile,
  opts: { teamId?: number; limit?: number } = {}
): Promise<HelpdeskTicket[]> {
  const domain = opts.teamId ? [...OPEN_DOMAIN, ['team_id', '=', opts.teamId]] : OPEN_DOMAIN;
  const rows = (await executeKw(profile, 'helpdesk.ticket', 'search_read', [domain], {
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
  profile: OdooProfile,
  ticketId: number
): Promise<HelpdeskMessage[]> {
  const rows = (await executeKw(
    profile,
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
  profile: OdooProfile,
  ticketId: number
): Promise<HelpdeskRelated> {
  const [ticket] = (await executeKw(profile, 'helpdesk.ticket', 'read', [[ticketId]], {
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
  const tickets = (await executeKw(
    profile,
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
  const openCount = (await executeKw(profile, 'helpdesk.ticket', 'search_count', [
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
  profile: OdooProfile,
  ticketId: number,
  body: string
): Promise<{ messageId: number }> {
  const html = body
    .split('\n')
    .map((line) => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .join('<br/>');
  const id = (await executeKw(profile, 'helpdesk.ticket', 'message_post', [[ticketId]], {
    body: `<p>${html}</p>`,
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_note',
  })) as number;
  return { messageId: id };
}

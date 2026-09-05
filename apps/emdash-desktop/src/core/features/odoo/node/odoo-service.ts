import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { OdooProfile } from '@core/primitives/app-settings/api';
import type {
  HelpdeskMessage,
  HelpdeskRelated,
  HelpdeskTeam,
  HelpdeskTicket,
  OdooConnectionTestResult,
  OdooProfilesFile,
  OdooProfilesSource,
  OdooProjectFolder,
} from '../api/contract';

const execFileAsync = promisify(execFile);

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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/jsonrpc`, {
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
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${base}/jsonrpc`);
    const body = (await response.json()) as {
      result?: unknown;
      error?: { message?: string; data?: { message?: string } };
    };
    if (body.error) {
      throw new Error(body.error.data?.message ?? body.error.message ?? 'Odoo returned an error');
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
  const agents = `# Odoo server: ${profile.name}

This project is paired with one Odoo server. Every question or change is about this
server unless the task says otherwise.

- Name: ${profile.name}
- URL: ${profile.url}
- Database: ${profile.db}
- User: ${profile.user}
${profile.odooVersion ? `- Odoo version: ${profile.odooVersion}\n` : ''}${profile.description ? `- Notes: ${profile.description}\n` : ''}
## How to reach it

Use the atlas CLI, which holds the credential itself:

    atlas odoo --profile ${profile.name} models --json
    atlas odoo --profile ${profile.name} fields res.partner --json
    atlas odoo --profile ${profile.name} count res.partner --domain '[["is_company","=",true]]'
    atlas odoo --profile ${profile.name} export res.partner --fields name,email --limit 50

\`atlas commands --json\` lists every verb. Read before you write. Any create, write,
module install or upgrade is shown to the person and confirmed first.

The environment variable ODOO_PROFILE=${profile.name} names this server too.

Never print or copy the password or API key. It is not in this folder on purpose.
`;
  await fs.writeFile(path.join(dir, 'AGENTS.md'), agents);
  await fs.writeFile(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  await fs.writeFile(
    path.join(dir, '.env'),
    `ODOO_PROFILE=${profile.name}\nODOO_URL=${profile.url}\nODOO_DB=${profile.db}\n`
  );
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
  return { path: dir, created, name: `Odoo · ${profile.name}` };
}

// ---------------------------------------------------------------------------
// Generic execute_kw and the Helpdesk readers
// ---------------------------------------------------------------------------

const uidCache = new Map<string, number>();

/** Authenticate once per profile (url + db + user + password) and cache the uid. */
async function odooUid(profile: OdooProfile): Promise<number> {
  const base = profile.url.replace(/\/+$/, '');
  const key = `${base}|${profile.db}|${profile.user}|${profile.password}`;
  const cached = uidCache.get(key);
  if (cached) return cached;
  const uid = (await odooRpc(base, 'common', 'authenticate', [
    profile.db,
    profile.user,
    profile.password,
    {},
  ])) as number | false;
  if (!uid) {
    throw new Error(
      `Login refused for ${profile.user} on database ${profile.db} (password or API key)`
    );
  }
  uidCache.set(key, uid);
  return uid;
}

/** object.execute_kw for any model and method. Read-only callers only; writes stay with atlas. */
export async function executeKw(
  profile: OdooProfile,
  model: string,
  method: string,
  args: unknown[],
  kwargs: Record<string, unknown> = {}
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

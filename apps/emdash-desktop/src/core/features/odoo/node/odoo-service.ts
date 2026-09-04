import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { OdooProfile } from '@core/primitives/app-settings/api';
import type {
  OdooConnectionTestResult,
  OdooProfilesFile,
  OdooProfilesSource,
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
async function odooRpc(
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

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OdooProfile } from '@core/primitives/app-settings/api';
import type { OdooConnectionTestResult, OdooProfilesFile } from '../api/contract';

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
  const profiles: OdooProfile[] = Object.entries(parsed).map(([name, entry]) => ({
    id: profileIdFromName(name),
    name,
    url: urlFromFileProfile(entry),
    db: entry.db ?? '',
    user: entry.user ?? '',
    password: entry.password ?? '',
    description: entry.description,
    odooVersion: entry.odoo_version ? String(entry.odoo_version) : undefined,
  }));
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

async function jsonRpc(url: string, params: Record<string, unknown>, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: Date.now(), params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
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
    const version = (await jsonRpc(`${base}/web/webclient/version_info`, {})) as {
      server_version?: string;
    };
    const auth = (await jsonRpc(`${base}/web/session/authenticate`, {
      db: profile.db,
      login: profile.user,
      password: profile.password,
    })) as { uid?: number | false; name?: string; username?: string } | null;
    if (!auth || !auth.uid) {
      return {
        ok: false,
        error: `Login refused for ${profile.user} on database ${profile.db}`,
        durationMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      serverVersion: version.server_version ?? 'unknown',
      uid: auth.uid,
      userName: auth.name ?? auth.username ?? profile.user,
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

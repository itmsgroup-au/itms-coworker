import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * `~/.odoo-profiles.json` is a map of profile name to
 * `{ url, host, port, db, user, password, odoo_version, description }`. It is the
 * file the `atlas` CLI and the `itms-odoo-dev` MCP launcher read.
 *
 * This app no longer stores credentials there and never writes it. The only
 * thing read here is the *name* atlas knows a server by, matched on url and
 * database. No password field is ever touched.
 */
export type FileProfile = {
  url?: string;
  host?: string;
  port?: number | string;
  db?: string;
  user?: string;
  odoo_version?: string;
  description?: string;
};

export const ODOO_PROFILES_PATH = path.join(os.homedir(), '.odoo-profiles.json');

export function urlFromFileProfile(entry: FileProfile): string {
  if (entry.url) return entry.url.replace(/\/+$/, '');
  if (entry.host) {
    const port = entry.port ? `:${entry.port}` : '';
    const scheme = String(entry.port) === '443' ? 'https' : 'http';
    return `${scheme}://${entry.host}${port}`;
  }
  return '';
}

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The name `atlas` and the `odoo` CLI know a server by.
 *
 * `~/.odoo-profiles.json` is keyed by that name (for example `ITMS19`), which is
 * neither this app's profile id (`itms-19`) nor its display name (`itms - 19`).
 * Measured 16 Sep 2026: a ticket prompt that passed the id made the agent's
 * first command fail with `unknown Odoo profile "itms-19"`.
 *
 * Read-only, and it returns null rather than guessing.
 */
export async function atlasProfileNameFor(target: {
  url: string;
  db: string;
}): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(ODOO_PROFILES_PATH, 'utf8');
  } catch {
    return null;
  }
  let parsed: Record<string, FileProfile>;
  try {
    parsed = JSON.parse(raw) as Record<string, FileProfile>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const wantedUrl = normalizeUrl(target.url);
  const wantedHost = hostOf(wantedUrl);
  const wantedDb = target.db.trim();
  let byHost: string | null = null;

  for (const [name, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object') continue;
    if ((entry.db ?? '').trim() !== wantedDb) continue;
    const candidate = normalizeUrl(urlFromFileProfile(entry));
    if (candidate === wantedUrl) return name;
    // Same host and database but a different scheme or port: a weaker match,
    // used only when nothing matches exactly.
    if (wantedHost && hostOf(candidate) === wantedHost) byHost ??= name;
  }
  return byHost;
}

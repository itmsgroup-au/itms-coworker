import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { OdooProfileSummary } from '@core/primitives/app-settings/api';
import { urlFromFileProfile, type FileProfile } from './odoo-profiles-file';

const execFileAsync = promisify(execFile);

/**
 * 1Password is the only source of Odoo credentials: one item per server in the
 * vault, tagged `odoo-profile`, with the same custom fields as
 * ~/.odoo-profiles.json (url, host, port, db, user, password, odoo_version,
 * description). The title is "odoo - <name>". Read through the `op` CLI, which
 * signs in through the 1Password desktop app.
 */
const OP_CANDIDATES = ['/opt/homebrew/bin/op', '/usr/local/bin/op', 'op'];

export const ODOO_ONEPASSWORD_VAULT = 'AI_MCP';

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

/** One vault item: the profile metadata the app stores, plus the secret it does not. */
export type OnePasswordOdooProfile = OdooProfileSummary & { password: string };

export type OnePasswordOdooProfiles = {
  /** Human-readable description of where this came from, for toasts and logs. */
  source: string;
  profiles: OnePasswordOdooProfile[];
  /** Item titles that could not be used, with the reason. Never a secret. */
  skipped: string[];
};

export async function readOdooProfilesFromOnePassword(
  vault: string = ODOO_ONEPASSWORD_VAULT
): Promise<OnePasswordOdooProfiles> {
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
  const profiles: OnePasswordOdooProfile[] = [];
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
      password: field(item, 'password', 'credential'),
      description: clip(entry.description, 2000),
      odooVersion: clip(entry.odoo_version, 40),
    });
  }
  return { source: `1Password vault ${vault}, tag odoo-profile`, profiles, skipped };
}

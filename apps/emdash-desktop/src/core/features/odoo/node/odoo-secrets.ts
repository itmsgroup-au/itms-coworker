import { promises as fs } from 'node:fs';
import path from 'node:path';
import { log } from '@emdash/shared/logger';
import { eq } from 'drizzle-orm';
import { app, safeStorage } from 'electron';
import { appSettings } from '@core/services/app-db/node/schema';
import { OdooCallError } from './odoo-errors';
import { odooAppDb } from './odoo-host';
import { readOdooProfilesFromOnePassword } from './odoo-onepassword';
import {
  findStoredProfile,
  readOdooSettings,
  toProfileSummary,
  writeOdooSettings,
} from './odoo-profiles-store';

/**
 * Where an Odoo password or API key lives, in resolution order:
 *
 * 1. an in-memory map, for the life of this process;
 * 2. `<userData>/odoo-secrets.json`, one Electron `safeStorage` ciphertext per
 *    profile id, file mode 0600, so the app still works when 1Password is
 *    locked;
 * 3. 1Password, the source of truth, read through the `op` CLI.
 *
 * Nothing is ever written to disk in plaintext. When `safeStorage` reports no
 * encryption backend, step 2 is skipped entirely and every miss goes to
 * 1Password instead.
 */

const SECRETS_FILE_NAME = 'odoo-secrets.json';
const SECRETS_FILE_VERSION = 1;

type SecretsFile = {
  version: number;
  /** profile id -> base64 of the safeStorage ciphertext. */
  secrets: Record<string, string>;
};

/** Plaintext, process lifetime only. Never logged, never serialised. */
const session = new Map<string, string>();

/** Test hook: start again from an empty in-memory cache. */
export function resetOdooSecretSessionForTests(): void {
  session.clear();
}

let warnedUnavailable = false;

function secretsFilePath(): string {
  return path.join(app.getPath('userData'), SECRETS_FILE_NAME);
}

export function isSecretStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function warnUnavailableOnce(): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  log.warn(
    'Odoo secrets: Electron safeStorage has no encryption backend on this system. ' +
      'Credentials are kept in memory for this session only and re-read from 1Password ' +
      'on every miss; nothing is written to disk.'
  );
}

async function readSecretsFile(): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await fs.readFile(secretsFilePath(), 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as SecretsFile;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.secrets !== 'object') return {};
    return parsed.secrets ?? {};
  } catch {
    log.warn('Odoo secrets: the encrypted store could not be parsed; treating it as empty');
    return {};
  }
}

async function writeSecretsFile(secrets: Record<string, string>): Promise<void> {
  const target = secretsFilePath();
  const temporary = `${target}.tmp`;
  const body = JSON.stringify({ version: SECRETS_FILE_VERSION, secrets } satisfies SecretsFile);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, body, { mode: 0o600 });
  // writeFile only applies the mode when it creates the file; chmod covers the
  // case where the temp file already existed with wider permissions.
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, target);
  await fs.chmod(target, 0o600);
}

/**
 * Remember one or more secrets: always in this session, and on disk encrypted
 * when the OS has a keychain. Returns true when they reached disk.
 */
export async function rememberOdooSecrets(
  entries: ReadonlyArray<{ profileId: string; password: string }>
): Promise<boolean> {
  const usable = entries.filter((entry) => entry.password.length > 0);
  for (const entry of usable) session.set(entry.profileId, entry.password);
  if (usable.length === 0) return true;
  if (!isSecretStorageAvailable()) {
    warnUnavailableOnce();
    return false;
  }
  const secrets = await readSecretsFile();
  for (const entry of usable) {
    secrets[entry.profileId] = safeStorage.encryptString(entry.password).toString('base64');
  }
  await writeSecretsFile(secrets);
  return true;
}

export async function rememberOdooSecret(profileId: string, password: string): Promise<boolean> {
  return rememberOdooSecrets([{ profileId, password }]);
}

/** Drop a profile's secret from this session and from the encrypted store. */
export async function forgetOdooSecret(profileId: string): Promise<void> {
  session.delete(profileId);
  if (!isSecretStorageAvailable()) return;
  const secrets = await readSecretsFile();
  if (!(profileId in secrets)) return;
  delete secrets[profileId];
  await writeSecretsFile(secrets);
}

async function readPersistedSecret(profileId: string): Promise<string | null> {
  if (!isSecretStorageAvailable()) return null;
  const secrets = await readSecretsFile();
  const encrypted = secrets[profileId];
  if (!encrypted) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    // A ciphertext this keychain can no longer open (restored profile, new
    // machine). Treat it as a miss and let 1Password re-supply it.
    log.warn(`Odoo secrets: stored credential for "${profileId}" could not be decrypted`);
    return null;
  }
}

const sameServer = (a: { url: string; db: string }, b: { url: string; db: string }): boolean =>
  a.url.trim().replace(/\/+$/, '').toLowerCase() ===
    b.url.trim().replace(/\/+$/, '').toLowerCase() && a.db.trim() === b.db.trim();

/**
 * Last resort: read the vault. Everything it returns is remembered, so one `op`
 * round trip serves the whole list rather than one server at a time.
 */
async function fetchFromOnePassword(profileId: string): Promise<string | null> {
  const stored = await findStoredProfile(profileId);
  const { profiles } = await readOdooProfilesFromOnePassword();
  await rememberOdooSecrets(
    profiles.map((profile) => ({ profileId: profile.id, password: profile.password }))
  );
  const direct = profiles.find((profile) => profile.id === profileId);
  const matched = direct ?? (stored ? profiles.find((p) => sameServer(p, stored)) : undefined);
  if (!matched?.password) return null;
  if (matched.id !== profileId) await rememberOdooSecret(profileId, matched.password);
  return matched.password;
}

/**
 * The password or API key for one profile. Throws a typed auth error when no
 * source has it, so a caller's `OdooResult` carries `kind: 'auth'` rather than
 * an opaque failure.
 */
export async function getOdooSecret(profileId: string): Promise<string> {
  const cached = session.get(profileId);
  if (cached) return cached;

  const persisted = await readPersistedSecret(profileId);
  if (persisted) {
    session.set(profileId, persisted);
    return persisted;
  }

  let fromVault: string | null = null;
  try {
    fromVault = await fetchFromOnePassword(profileId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OdooCallError(
      'auth',
      `No stored credential for Odoo profile "${profileId}" and 1Password could not be read: ${message}`
    );
  }
  if (!fromVault) {
    throw new OdooCallError(
      'auth',
      `No credential for Odoo profile "${profileId}". Refresh the servers from 1Password on the Odoo settings page.`
    );
  }
  return fromVault;
}

// ---------------------------------------------------------------------------
// One-time migration out of the settings database
// ---------------------------------------------------------------------------

type LegacyProfile = { id?: unknown; password?: unknown };

function legacyPasswords(raw: unknown): Array<{ profileId: string; password: string }> {
  if (!raw || typeof raw !== 'object') return [];
  const profiles = (raw as { profiles?: unknown }).profiles;
  if (!Array.isArray(profiles)) return [];
  const found: Array<{ profileId: string; password: string }> = [];
  for (const entry of profiles as LegacyProfile[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, password } = entry;
    if (typeof id === 'string' && typeof password === 'string' && password.length > 0) {
      found.push({ profileId: id, password });
    }
  }
  return found;
}

export type OdooSecretsMigration = {
  moved: number;
  outcome: 'nothing-to-move' | 'moved' | 'storage-unavailable' | 'aborted';
};

/**
 * Move every password still sitting in the `odoo` settings row into the
 * encrypted store, then rewrite the row without them.
 *
 * Idempotent: a row with no passwords left is a no-op, so this can run on every
 * boot. It never deletes a password it could not re-store - if safeStorage is
 * unavailable, or a secret does not read back after the write, the settings row
 * is left exactly as it was and the reason is logged.
 */
export async function migrateOdooProfilePasswords(): Promise<OdooSecretsMigration> {
  const [row] = await odooAppDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, 'odoo'))
    .execute();
  if (!row?.value) return { moved: 0, outcome: 'nothing-to-move' };

  let raw: unknown;
  try {
    raw = JSON.parse(row.value);
  } catch {
    return { moved: 0, outcome: 'nothing-to-move' };
  }

  const legacy = legacyPasswords(raw);
  if (legacy.length === 0) return { moved: 0, outcome: 'nothing-to-move' };

  if (!isSecretStorageAvailable()) {
    warnUnavailableOnce();
    log.warn(
      `Odoo secrets: ${legacy.length} password(s) stay in the settings database because ` +
        'safeStorage has no encryption backend. Nothing was deleted.'
    );
    return { moved: 0, outcome: 'storage-unavailable' };
  }

  const persisted = await rememberOdooSecrets(legacy);
  if (!persisted) {
    log.warn('Odoo secrets: migration could not write the encrypted store; settings left as-is');
    return { moved: 0, outcome: 'aborted' };
  }

  // Read every one back before anything is removed from settings.
  for (const entry of legacy) {
    const check = await readPersistedSecret(entry.profileId);
    if (check !== entry.password) {
      log.warn(
        `Odoo secrets: credential for "${entry.profileId}" did not read back from the ` +
          'encrypted store; settings left as-is'
      );
      return { moved: 0, outcome: 'aborted' };
    }
  }

  const settings = await readOdooSettings();
  if (settings.profiles.length === 0) {
    // The stored blob did not survive schema validation, so rewriting it would
    // replace real profiles with the empty default. Keep the row.
    log.warn('Odoo secrets: stored Odoo settings did not parse; settings left as-is');
    return { moved: 0, outcome: 'aborted' };
  }

  await writeOdooSettings({
    defaultProfileId: settings.defaultProfileId,
    profiles: settings.profiles.map(toProfileSummary),
  });
  log.info(
    `Odoo secrets: moved ${legacy.length} password(s) from the settings database into the OS keychain`
  );
  return { moved: legacy.length, outcome: 'moved' };
}

let migration: Promise<OdooSecretsMigration> | null = null;

/** Run {@link migrateOdooProfilePasswords} at most once per process. */
export function ensureOdooSecretsMigrated(): Promise<OdooSecretsMigration> {
  migration ??= migrateOdooProfilePasswords().catch((error) => {
    log.warn('Odoo secrets: migration failed; settings left as-is', { error });
    return { moved: 0, outcome: 'aborted' } as OdooSecretsMigration;
  });
  return migration;
}

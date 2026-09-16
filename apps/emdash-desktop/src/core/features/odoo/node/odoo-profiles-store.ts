import type { OdooProfileSummary, OdooSettings } from '@core/primitives/app-settings/api';
import { odooAppSettings } from './odoo-host';
import type { OnePasswordOdooProfile } from './odoo-onepassword';

/**
 * The `odoo` app-settings key, read and written from the node side.
 *
 * It holds profile metadata only - url, database, user, notes. The password for
 * a profile lives in the OS keychain through `odoo-secrets.ts` and is fetched
 * from 1Password when the keychain has not seen it yet.
 *
 * The settings service is handed to the slice when its wire controller is
 * created (see `odoo-host.ts`); core code must not reach into `@main`.
 */
export async function readOdooSettings(): Promise<OdooSettings> {
  return odooAppSettings().get('odoo');
}

export async function writeOdooSettings(next: OdooSettings): Promise<void> {
  await odooAppSettings().update('odoo', next);
}

export async function listStoredProfiles(): Promise<OdooProfileSummary[]> {
  return (await readOdooSettings()).profiles;
}

export async function findStoredProfile(profileId: string): Promise<OdooProfileSummary | null> {
  const profiles = await listStoredProfiles();
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

/** Strip anything that is not part of the stored summary, password included. */
export function toProfileSummary(profile: OdooProfileSummary): OdooProfileSummary {
  return {
    id: profile.id,
    name: profile.name,
    url: profile.url,
    db: profile.db,
    user: profile.user,
    ...(profile.description === undefined ? {} : { description: profile.description }),
    ...(profile.odooVersion === undefined ? {} : { odooVersion: profile.odooVersion }),
  };
}

/**
 * Merge what 1Password holds into what is stored, by name: a server already
 * listed keeps its id and gets fresh metadata, a new one is appended with a
 * unique id. Ids are kept stable because the keychain entry is keyed by id.
 */
export function mergeOnePasswordProfiles(
  stored: readonly OdooProfileSummary[],
  incoming: readonly OnePasswordOdooProfile[]
): { profiles: OdooProfileSummary[]; idByIncoming: Map<string, string> } {
  const byName = new Map(stored.map((profile) => [profile.name.toLowerCase(), profile]));
  const taken = new Set(stored.map((profile) => profile.id));
  const idByIncoming = new Map<string, string>();
  for (const profile of incoming) {
    const key = profile.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      byName.set(key, toProfileSummary({ ...profile, id: existing.id }));
      idByIncoming.set(profile.id, existing.id);
      continue;
    }
    let id = profile.id;
    let suffix = 2;
    while (taken.has(id)) id = `${profile.id}-${suffix++}`;
    taken.add(id);
    byName.set(key, toProfileSummary({ ...profile, id }));
    idByIncoming.set(profile.id, id);
  }
  return { profiles: [...byName.values()], idByIncoming };
}

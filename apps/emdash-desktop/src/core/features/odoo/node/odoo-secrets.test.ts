import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@core/services/app-db/node/db';
import type { AppSettings } from '@core/services/settings/api';
import type { AppSettingsService } from '@core/services/settings/node';

/** Reversible stand-in for Electron safeStorage, which is unavailable under plain Node. */
const electron = vi.hoisted(() => {
  const state = { available: true, userData: '' };
  return {
    state,
    app: { getPath: () => state.userData },
    safeStorage: {
      isEncryptionAvailable: () => state.available,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
      decryptString: (value: Buffer) => value.toString('utf8').replace(/^enc:/, ''),
    },
  };
});

vi.mock('electron', () => ({ app: electron.app, safeStorage: electron.safeStorage }));

import { setOdooHostServices } from './odoo-host';
import {
  forgetOdooSecret,
  getOdooSecret,
  isSecretStorageAvailable,
  migrateOdooProfilePasswords,
  rememberOdooSecrets,
  resetOdooSecretSessionForTests,
} from './odoo-secrets';

const PROFILE = {
  id: 'itms-19',
  name: 'itms - 19',
  url: 'https://odoo.example.com',
  db: 'itms19',
  user: 'agent@example.com',
};

type StoredBlob = { defaultProfileId: string | null; profiles: Array<Record<string, unknown>> };

function hostWith(raw: StoredBlob | null) {
  const updates: Array<AppSettings['odoo']> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          execute: async () => (raw === null ? [] : [{ value: JSON.stringify(raw) }]),
        }),
      }),
    }),
  } as unknown as AppDb;
  const appSettings = {
    // The real store drops `password` when it parses, so this mirrors it.
    get: async () => ({
      defaultProfileId: raw?.defaultProfileId ?? null,
      profiles: (raw?.profiles ?? []).map((profile) => {
        const copy = { ...profile };
        delete copy.password;
        return copy;
      }),
    }),
    update: async (_key: 'odoo', value: AppSettings['odoo']) => {
      updates.push(value);
    },
  } as unknown as AppSettingsService;
  setOdooHostServices({ appSettings, db });
  return updates;
}

beforeEach(async () => {
  electron.state.available = true;
  electron.state.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'odoo-secrets-'));
  resetOdooSecretSessionForTests();
});

describe('the encrypted secret store', () => {
  it('round-trips a secret through the file without writing it in plaintext', async () => {
    expect(isSecretStorageAvailable()).toBe(true);
    expect(await rememberOdooSecrets([{ profileId: PROFILE.id, password: 'api-key-1' }])).toBe(
      true
    );

    const file = path.join(electron.state.userData, 'odoo-secrets.json');
    const body = await fs.readFile(file, 'utf8');
    expect(body).not.toContain('api-key-1');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);

    resetOdooSecretSessionForTests();
    hostWith({ defaultProfileId: PROFILE.id, profiles: [PROFILE] });
    expect(await getOdooSecret(PROFILE.id)).toBe('api-key-1');
  });

  it('forgets a secret without touching the others', async () => {
    hostWith({ defaultProfileId: PROFILE.id, profiles: [PROFILE] });
    await rememberOdooSecrets([
      { profileId: 'a', password: 'one' },
      { profileId: 'b', password: 'two' },
    ]);
    await forgetOdooSecret('a');
    resetOdooSecretSessionForTests();
    expect(await getOdooSecret('b')).toBe('two');
  });

  it('writes nothing to disk when the OS has no encryption backend', async () => {
    electron.state.available = false;
    expect(await rememberOdooSecrets([{ profileId: PROFILE.id, password: 'api-key-1' }])).toBe(
      false
    );
    await expect(fs.readdir(electron.state.userData)).resolves.toEqual([]);
  });
});

describe('the one-time password migration', () => {
  it('moves stored passwords into the keychain and rewrites settings without them', async () => {
    const updates = hostWith({
      defaultProfileId: PROFILE.id,
      profiles: [
        { ...PROFILE, password: 'api-key-1' },
        { ...PROFILE, id: 'other', name: 'other', password: 'api-key-2' },
      ],
    });

    expect(await migrateOdooProfilePasswords()).toEqual({ moved: 2, outcome: 'moved' });
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0])).not.toContain('api-key-');
    expect(updates[0]?.profiles.every((profile) => !('password' in profile))).toBe(true);

    resetOdooSecretSessionForTests();
    expect(await getOdooSecret(PROFILE.id)).toBe('api-key-1');
    expect(await getOdooSecret('other')).toBe('api-key-2');
  });

  it('is a no-op once the passwords are gone', async () => {
    const updates = hostWith({ defaultProfileId: PROFILE.id, profiles: [PROFILE] });
    expect(await migrateOdooProfilePasswords()).toEqual({ moved: 0, outcome: 'nothing-to-move' });
    expect(updates).toHaveLength(0);
  });

  it('leaves the settings untouched when the keychain is unavailable', async () => {
    electron.state.available = false;
    const updates = hostWith({
      defaultProfileId: PROFILE.id,
      profiles: [{ ...PROFILE, password: 'api-key-1' }],
    });

    expect(await migrateOdooProfilePasswords()).toEqual({
      moved: 0,
      outcome: 'storage-unavailable',
    });
    expect(updates).toHaveLength(0);
  });
});

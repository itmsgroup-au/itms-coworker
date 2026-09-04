import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type { OdooProfile } from '@core/primitives/app-settings/api';

export const odooDomain = 'odoo' as const;

export type OdooConnectionTestResult =
  | { ok: true; serverVersion: string; uid: number; userName: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

export type OdooProfilesSource = {
  source: string;
  profiles: OdooProfile[];
  skipped: string[];
};

export type OdooProfilesFile = {
  path: string;
  exists: boolean;
  profiles: OdooProfile[];
};

export type OdooProjectFolder = { path: string; created: boolean; name: string };

export const odooContract = defineContract({
  /** Make (or refresh) the local project folder that pairs with a profile. */
  prepareProject: procedure({
    input: z.custom<OdooProfile>(),
    output: z.custom<OdooProjectFolder>(),
  }),
  /** JSON-RPC version_info + authenticate against the server named in the profile. */
  testConnection: procedure({
    input: z.custom<OdooProfile>(),
    output: z.custom<OdooConnectionTestResult>(),
  }),
  /** Read every 1Password item tagged odoo-profile in the vault (default AI_MCP). */
  readProfilesFromOnePassword: procedure({
    input: z.object({ vault: z.string().optional() }),
    output: z.custom<OdooProfilesSource>(),
  }),
  /** Read ~/.odoo-profiles.json (the file atlas and the odoo CLI use). */
  readProfilesFile: procedure({ input: z.void(), output: z.custom<OdooProfilesFile>() }),
  /** Write the given profiles to ~/.odoo-profiles.json, replacing it. */
  writeProfilesFile: procedure({
    input: z.object({ profiles: z.custom<OdooProfile[]>() }),
    output: z.custom<{ path: string }>(),
  }),
});

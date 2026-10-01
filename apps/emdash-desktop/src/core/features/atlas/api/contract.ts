import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

export const atlasDomain = 'atlas' as const;

/** Where atlas is and what it knows, read without touching 1Password. */
export type AtlasStatus =
  | {
      installed: true;
      path: string;
      version: string;
      clientCount: number | null;
      commands: { runnable: number; reads: number; writes: number; destructive: number } | null;
    }
  | { installed: false; searched: string[] };

export type AtlasDoctorCheck = { name: string; ok: boolean; detail: string; ms: number };

export type AtlasDoctorResult = {
  allOk: boolean;
  checks: AtlasDoctorCheck[];
  durationMs: number;
};

/** The 1Password daemon (`atlas serve`). */
export type AtlasDaemonStatus =
  | {
      running: true;
      pid: number;
      socket: string;
      started: string;
      requests: number;
    }
  | { running: false };

/** Output of `atlas client sync`, dry run or real. */
export type AtlasClientSyncResult = {
  dryRun: boolean;
  output: string;
  clientCount: number | null;
};

/** Every failure leaves the node side as one readable message. */
export type AtlasResult<T> = { ok: true; data: T } | { ok: false; error: string };

export const atlasContract = defineContract({
  status: procedure({ input: z.void(), output: z.custom<AtlasStatus>() }),
  /** `atlas doctor --json`: config, secrets, RMM and MeshCentral. Takes about 30 s. */
  doctor: procedure({ input: z.void(), output: z.custom<AtlasResult<AtlasDoctorResult>>() }),
  /** `atlas client sync`, with `--dry-run` first so the change can be read before it lands. */
  syncClients: procedure({
    /** `profile` is the atlas name of the Odoo server holding rmm.client; atlas's own config is used when absent. */
    input: z.object({ dryRun: z.boolean(), profile: z.string().optional() }),
    output: z.custom<AtlasResult<AtlasClientSyncResult>>(),
  }),
  daemonStatus: procedure({ input: z.void(), output: z.custom<AtlasDaemonStatus>() }),
  startDaemon: procedure({ input: z.void(), output: z.custom<AtlasResult<AtlasDaemonStatus>>() }),
  stopDaemon: procedure({ input: z.void(), output: z.custom<AtlasResult<AtlasDaemonStatus>>() }),
});

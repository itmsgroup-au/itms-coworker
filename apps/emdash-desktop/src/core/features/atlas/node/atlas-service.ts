import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AtlasClientSyncResult,
  AtlasDaemonStatus,
  AtlasDoctorResult,
  AtlasResult,
  AtlasStatus,
} from '../api';

const execFileAsync = promisify(execFile);

/** `doctor` measured 28 s on 1 Oct 2026, 27 s of it the RMM check. */
const DOCTOR_TIMEOUT_MS = 120_000;
const SYNC_TIMEOUT_MS = 120_000;
const QUICK_TIMEOUT_MS = 15_000;
/** The daemon exits on its own after this long unused, so a closed app leaves nothing running for days. */
const DAEMON_IDLE = '12h';

function candidatePaths(): string[] {
  return [
    process.env.ATLAS_BIN,
    path.join(os.homedir(), '.local', 'bin', 'atlas'),
    '/opt/homebrew/bin/atlas',
    '/usr/local/bin/atlas',
  ].filter((p): p is string => Boolean(p));
}

/** The atlas binary on this machine, or null. The app never installs it. */
export async function findAtlas(): Promise<string | null> {
  for (const candidate of candidatePaths()) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

type Envelope<T> = { ok: boolean; data?: T; error?: string };

async function runAtlas(
  args: string[],
  timeout: number
): Promise<{ stdout: string; stderr: string }> {
  const bin = await findAtlas();
  if (!bin) throw new Error('atlas is not installed on this machine.');
  return execFileAsync(bin, args, { timeout, maxBuffer: 32 * 1024 * 1024 });
}

/** Runs an atlas command with `--json` and returns its `data`, or throws with atlas's own message. */
async function runAtlasJson<T>(args: string[], timeout: number): Promise<T> {
  let stdout: string;
  try {
    ({ stdout } = await runAtlas([...args, '--json'], timeout));
  } catch (error) {
    // atlas exits non-zero on a failed check but still prints its JSON.
    const out = (error as { stdout?: string }).stdout;
    if (!out) throw error;
    stdout = out;
  }
  const envelope = JSON.parse(stdout) as Envelope<T>;
  if (envelope.data === undefined) {
    throw new Error(envelope.error ?? `atlas ${args.join(' ')} returned no data`);
  }
  return envelope.data;
}

function message(error: unknown): string {
  const value = error as { stderr?: string; message?: string; killed?: boolean };
  if (value?.killed) return 'atlas did not answer in time.';
  const stderr = value?.stderr?.trim();
  if (stderr) return stderr.split('\n').slice(-3).join('\n');
  return value?.message ?? String(error);
}

type CommandRecord = { runnable: boolean; writes: boolean; destructive: boolean };

export async function atlasStatus(): Promise<AtlasStatus> {
  const bin = await findAtlas();
  if (!bin) return { installed: false, searched: candidatePaths() };

  const [version, clients, commands] = await Promise.all([
    runAtlas(['version'], QUICK_TIMEOUT_MS)
      .then(({ stdout }) => stdout.trim().replace(/^atlas\s+/, ''))
      .catch(() => 'unknown'),
    runAtlasJson<unknown[]>(['client', 'list'], QUICK_TIMEOUT_MS)
      .then((rows) => rows.length)
      .catch(() => null),
    runAtlasJson<CommandRecord[]>(['commands'], QUICK_TIMEOUT_MS)
      .then((rows) => {
        const runnable = rows.filter((row) => row.runnable);
        return {
          runnable: runnable.length,
          reads: runnable.filter((row) => !row.writes).length,
          writes: runnable.filter((row) => row.writes).length,
          destructive: runnable.filter((row) => row.destructive).length,
        };
      })
      .catch(() => null),
  ]);
  return { installed: true, path: bin, version, clientCount: clients, commands };
}

export async function atlasDoctor(): Promise<AtlasResult<AtlasDoctorResult>> {
  const started = Date.now();
  try {
    const data = await runAtlasJson<{
      all_ok: boolean;
      checks: { name: string; ok: boolean; detail: string; ms: number }[];
    }>(['doctor'], DOCTOR_TIMEOUT_MS);
    return {
      ok: true,
      data: { allOk: data.all_ok, checks: data.checks, durationMs: Date.now() - started },
    };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function syncAtlasClients(
  dryRun: boolean,
  profile?: string
): Promise<AtlasResult<AtlasClientSyncResult>> {
  try {
    const args = [
      'client',
      'sync',
      ...(profile ? ['--profile', profile] : []),
      ...(dryRun ? ['--dry-run'] : []),
    ];
    const { stdout, stderr } = await runAtlas(args, SYNC_TIMEOUT_MS);
    const clientCount = await runAtlasJson<unknown[]>(['client', 'list'], QUICK_TIMEOUT_MS)
      .then((rows) => rows.length)
      .catch(() => null);
    return {
      ok: true,
      data: {
        dryRun,
        output: [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
        clientCount,
      },
    };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function atlasDaemonStatus(): Promise<AtlasDaemonStatus> {
  try {
    const data = await runAtlasJson<{
      pid: number;
      socket: string;
      started: string;
      requests: number;
    }>(['serve', 'status'], QUICK_TIMEOUT_MS);
    return {
      running: true,
      pid: data.pid,
      socket: data.socket,
      started: data.started,
      requests: data.requests,
    };
  } catch {
    return { running: false };
  }
}

/**
 * Starts `atlas serve` detached, so agents keep the open 1Password client even
 * if this app quits; it exits on its own after `DAEMON_IDLE` unused.
 */
export async function startAtlasDaemon(): Promise<AtlasResult<AtlasDaemonStatus>> {
  const existing = await atlasDaemonStatus();
  if (existing.running) return { ok: true, data: existing };
  const bin = await findAtlas();
  if (!bin) return { ok: false, error: 'atlas is not installed on this machine.' };
  const child = spawn(bin, ['serve', '--idle', DAEMON_IDLE], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const status = await atlasDaemonStatus();
    if (status.running) return { ok: true, data: status };
  }
  return { ok: false, error: 'atlas serve started but did not answer on its socket within 10 s.' };
}

export async function stopAtlasDaemon(): Promise<AtlasResult<AtlasDaemonStatus>> {
  const status = await atlasDaemonStatus();
  if (!status.running) return { ok: true, data: status };
  try {
    process.kill(status.pid, 'SIGTERM');
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const next = await atlasDaemonStatus();
    if (!next.running) return { ok: true, data: next };
  }
  return { ok: false, error: `atlas serve (pid ${status.pid}) is still answering.` };
}

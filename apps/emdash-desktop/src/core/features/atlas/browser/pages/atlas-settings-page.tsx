import { PageLayout, SettingsCard, SettingsRow, SettingsSection } from '@emdash/ui/react/patterns';
import { Button, toast } from '@emdash/ui/react/primitives';
import { useCallback, useEffect, useState } from 'react';
import type { AtlasDaemonStatus, AtlasDoctorResult, AtlasStatus } from '@core/features/atlas/api';
import { getAtlasClient } from '@core/features/atlas/api/browser/client';
import { getOdooClient } from '@core/features/odoo/api/browser/client';
import { useOpenModal } from '@core/manifests/browser/modal-api';

export function AtlasSettingsPage() {
  const openConfirm = useOpenModal('confirmActionModal');
  const [status, setStatus] = useState<AtlasStatus | null>(null);
  const [daemon, setDaemon] = useState<AtlasDaemonStatus | null>(null);
  const [doctor, setDoctor] = useState<AtlasDoctorResult | null>(null);
  const [busy, setBusy] = useState<null | 'doctor' | 'sync' | 'daemon'>(null);

  const reload = useCallback(async () => {
    const client = await getAtlasClient();
    const [nextStatus, nextDaemon] = await Promise.all([client.status(), client.daemonStatus()]);
    setStatus(nextStatus);
    setDaemon(nextDaemon);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runDoctor = async () => {
    setBusy('doctor');
    try {
      const result = await (await getAtlasClient()).doctor();
      if (result.ok) setDoctor(result.data);
      else toast.error('atlas doctor failed', { description: result.error });
    } finally {
      setBusy(null);
    }
  };

  const syncClients = async () => {
    setBusy('sync');
    try {
      const client = await getAtlasClient();
      const profile = await defaultOdooAtlasProfile();
      const preview = await client.syncClients({ dryRun: true, profile });
      if (!preview.ok) {
        toast.error('Client sync failed', { description: preview.error });
        return;
      }
      const outcome = await openConfirm({
        title: 'Sync the client list from Odoo?',
        description: `atlas rewrites ~/.itms/clients.json from rmm.client in Odoo. Aliases, jumpboxes, subnets and notes you typed are kept. Dry run:\n\n${truncate(preview.data.output, 1200) || 'No changes.'}`,
        confirmLabel: 'Sync',
      });
      if (!outcome.success) return;
      const result = await client.syncClients({ dryRun: false, profile });
      if (!result.ok) {
        toast.error('Client sync failed', { description: result.error });
        return;
      }
      toast(`Client list synced: ${result.data.clientCount ?? 'unknown'} clients`);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const toggleDaemon = async () => {
    setBusy('daemon');
    try {
      const client = await getAtlasClient();
      const result = daemon?.running ? await client.stopDaemon() : await client.startDaemon();
      if (result.ok) setDaemon(result.data);
      else toast.error('atlas serve', { description: result.error });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <PageLayout.Header
        sticky
        title="Atlas"
        description="The atlas CLI on this Mac: every client tenant, machine and service, with credentials from 1Password."
      />

      <SettingsSection title="Installation" bare>
        <SettingsCard>
          {status === null && <Line>Reading atlas…</Line>}
          {status && !status.installed && (
            <Line>
              atlas is not installed. Looked in {status.searched.join(', ')}. Set ATLAS_BIN to its
              path if it lives elsewhere.
            </Line>
          )}
          {status?.installed && (
            <div className="flex flex-col gap-1 text-sm">
              <Fact label="Path" value={status.path} />
              <Fact label="Version" value={status.version} />
              <Fact
                label="Clients"
                value={
                  status.clientCount === null
                    ? 'unknown'
                    : `${status.clientCount} in ~/.itms/clients.json`
                }
              />
              {status.commands && (
                <Fact
                  label="Commands"
                  value={`${status.commands.runnable}: ${status.commands.reads} read, ${status.commands.writes} write (${status.commands.destructive} destructive)`}
                />
              )}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Health" bare>
        <SettingsCard>
          <SettingsRow
            label="Check config, 1Password, RMM and MeshCentral"
            description="Runs atlas doctor. Takes about 30 seconds, most of it the RMM login."
            control={
              <Button
                size="sm"
                variant="secondary"
                disabled={!status?.installed || busy !== null}
                onClick={() => void runDoctor()}
              >
                {busy === 'doctor' ? 'Checking…' : 'Run check'}
              </Button>
            }
          />
          {doctor && (
            <div className="mt-2 flex flex-col gap-1 text-xs">
              {doctor.checks.map((check) => (
                <div key={check.name} className="flex gap-2">
                  <span className={check.ok ? 'text-emerald-600' : 'text-red-500'}>
                    {check.ok ? 'pass' : 'FAIL'}
                  </span>
                  <span className="font-medium">{check.name}</span>
                  <span className="text-foreground-passive">
                    {check.detail} · {Math.round(check.ms)} ms
                  </span>
                </div>
              ))}
              <div className="text-foreground-passive">
                {doctor.allOk ? 'All checks passed' : 'Some checks failed'} in{' '}
                {(doctor.durationMs / 1000).toFixed(1)} s
              </div>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Clients" bare>
        <SettingsCard>
          <SettingsRow
            label="Sync the client list from Odoo"
            description="atlas client sync. Shows a dry run first; nothing is written until you confirm."
            control={
              <Button
                size="sm"
                variant="secondary"
                disabled={!status?.installed || busy !== null}
                onClick={() => void syncClients()}
              >
                {busy === 'sync' ? 'Syncing…' : 'Sync clients'}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="1Password" bare>
        <SettingsCard>
          <SettingsRow
            label="Keep 1Password open for agents"
            description={
              daemon?.running
                ? `atlas serve is running (pid ${daemon.pid}, since ${formatTime(daemon.started)}, ${daemon.requests} requests). Agent calls skip the 1Password start-up.`
                : 'Off. Every atlas call starts 1Password from nothing, about 3.6 s each. On, atlas serve holds it open and exits after 12 hours unused.'
            }
            control={
              <Button
                size="sm"
                variant={daemon?.running ? 'secondary' : 'primary'}
                disabled={!status?.installed || busy !== null}
                onClick={() => void toggleDaemon()}
              >
                {busy === 'daemon' ? 'Working…' : daemon?.running ? 'Stop' : 'Start'}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

/**
 * The atlas name of the default Odoo server, which holds rmm.client. atlas's
 * own `[clients] odoo_profile` is unset on this Mac (measured 1 Oct 2026), so
 * without this the sync fails.
 */
async function defaultOdooAtlasProfile(): Promise<string | undefined> {
  try {
    const odoo = await getOdooClient();
    const { defaultProfileId } = await odoo.listProfiles();
    if (!defaultProfileId) return undefined;
    return (await odoo.atlasProfileName({ profileId: defaultProfileId })) ?? undefined;
  } catch {
    return undefined;
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-foreground-passive">{label}</span>
      <span className="min-w-0 font-mono text-xs leading-5 break-all">{value}</span>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-foreground-passive">{children}</div>;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

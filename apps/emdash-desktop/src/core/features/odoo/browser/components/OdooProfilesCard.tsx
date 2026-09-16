import { SettingsCard, SettingsRow, SettingsSection } from '@emdash/ui/react/patterns';
import { Button, Select, SeparatedList, toast } from '@emdash/ui/react/primitives';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OdooProfileSummary } from '@core/features/odoo/api';
import { getOdooClient } from '@core/features/odoo/api/browser/client';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { type McpState, OdooProfileRow, type TestState } from './OdooProfileRow';

/** What the last "Refresh from 1Password" run found, so the page can say so. */
type RefreshSummary = { kept: number; skipped: string[] };

/** The hint every 1Password failure ends with; the usual cause is a locked app. */
const ONE_PASSWORD_HINT = 'Is the 1Password app unlocked and the CLI integration on?';

export function OdooProfilesCard() {
  const odooSettings = useAppSettingsKey('odoo');
  const openConfirm = useOpenModal('confirmActionModal');
  const { navigate } = useNavigate();
  const [profiles, setProfiles] = useState<OdooProfileSummary[] | null>(null);
  const [refreshSummary, setRefreshSummary] = useState<RefreshSummary | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [mcp, setMcp] = useState<Record<string, McpState>>({});
  const [busy, setBusy] = useState(false);
  /**
   * Which server is the default. The stored value is the source of truth; while
   * a change is in flight (or if the node side keeps it somewhere this page
   * cannot read) the locally chosen one wins for the rest of the session.
   */
  const [chosenDefault, setChosenDefault] = useState<string | null>(null);
  /** One automatic test per page mount, for the default profile only. */
  const autoTested = useRef(false);

  const isLoading = profiles === null;
  const list = profiles ?? [];
  const defaultProfileId = chosenDefault ?? odooSettings.value?.defaultProfileId ?? null;
  const disabled = isLoading || busy;

  // The list is whatever 1Password gave us last time, held by the node side.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await (await getOdooClient()).listProfiles();
        if (cancelled) return;
        setProfiles(loaded.profiles);
        setChosenDefault(loaded.defaultProfileId);
      } catch (error) {
        if (cancelled) return;
        setProfiles([]);
        toast.error('Could not read the Odoo servers', { description: message(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const test = useCallback(async (profile: OdooProfileSummary) => {
    setTests((prev) => ({ ...prev, [profile.id]: { state: 'testing' } }));
    try {
      const result = await (await getOdooClient()).testConnection({ profileId: profile.id });
      const text = result.ok
        ? `Odoo ${result.serverVersion}, logged in as ${result.userName} (uid ${result.uid}), ${result.durationMs} ms`
        : result.error;
      setTests((prev) => ({ ...prev, [profile.id]: { state: 'done', text, ok: result.ok } }));
    } catch (error) {
      setTests((prev) => ({
        ...prev,
        [profile.id]: { state: 'done', text: message(error), ok: false },
      }));
    }
  }, []);

  // Test the default server once, when the page opens, so the status is there
  // without clicking. Never more than once per mount, and never the others.
  useEffect(() => {
    if (autoTested.current || !defaultProfileId) return;
    const profile = profiles?.find((candidate) => candidate.id === defaultProfileId);
    if (!profile) return;
    autoTested.current = true;
    void test(profile);
  }, [defaultProfileId, profiles, test]);

  /** The project paired with a server: made on demand, opened if it already exists. */
  const openProject = async (profile: OdooProfileSummary) => {
    setBusy(true);
    try {
      const folder = await (await getOdooClient()).prepareProject({ profileId: profile.id });
      setMcp((prev) => ({ ...prev, [profile.id]: { server: folder.mcpServer } }));
      const result = await getProjectManagerStore().startProjectCreation(
        { type: 'local' },
        { mode: 'pick', name: folder.name, path: folder.path, initGitRepository: false }
      );
      if (result.kind === 'existing') {
        navigate(projectViewDef({ projectId: result.projectId }));
        return;
      }
      const completion = await result.completion;
      if (!completion.success) {
        toast.error('Could not open the project', { description: String(completion.error) });
        return;
      }
      toast(folder.created ? `Project created at ${folder.path}` : `Project opened`);
      navigate(projectViewDef({ projectId: result.projectId }));
    } catch (error) {
      toast.error('Could not open the project', { description: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const chooseDefault = async (profileId: string) => {
    const previous = defaultProfileId;
    setChosenDefault(profileId);
    try {
      await (await getOdooClient()).setDefaultProfile({ profileId });
    } catch (error) {
      setChosenDefault(previous);
      toast.error('Could not set the default server', { description: message(error) });
      return;
    }
    const chosen = list.find((profile) => profile.id === profileId);
    if (chosen) await openProject(chosen);
  };

  const remove = (profile: OdooProfileSummary) => {
    void openConfirm({
      title: `Remove ${profile.name}?`,
      description:
        'The server is removed from ITMS CoWorker and its cached password is dropped from the keychain. The 1Password item is not touched, so Refresh from 1Password brings it back.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    }).then(async (outcome) => {
      if (!outcome.success) return;
      setBusy(true);
      try {
        await (await getOdooClient()).removeProfile({ profileId: profile.id });
        setProfiles((prev) => (prev ?? []).filter((existing) => existing.id !== profile.id));
        if (defaultProfileId === profile.id) setChosenDefault(null);
      } catch (error) {
        toast.error(`Could not remove ${profile.name}`, { description: message(error) });
      } finally {
        setBusy(false);
      }
    });
  };

  /**
   * Read the vault again. The list on screen is only replaced when the read
   * succeeded and returned something: a locked 1Password leaves it as it was.
   */
  const refresh = async () => {
    setBusy(true);
    try {
      const result = await (await getOdooClient()).refreshProfilesFromOnePassword({});
      setRefreshSummary({ kept: result.profiles.length, skipped: result.skipped });
      if (result.profiles.length === 0) {
        toast.error('No usable items tagged odoo-profile in the vault', {
          description:
            list.length > 0
              ? `The list on screen is unchanged. ${ONE_PASSWORD_HINT}`
              : ONE_PASSWORD_HINT,
        });
        return;
      }
      setProfiles(result.profiles);
      toast(`${result.profiles.length} Odoo server(s) read from 1Password`, {
        description: result.skipped.length
          ? `${result.skipped.length} item(s) skipped: ${result.skipped.join(', ')}`
          : undefined,
      });
    } catch (error) {
      toast.error('Could not read 1Password', {
        description: `${message(error)}. ${ONE_PASSWORD_HINT}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <SettingsCard>
        <SeparatedList gap="1rem" direction="column">
          <SettingsRow
            label="Default Odoo server"
            description="The server an agent works against unless a task says otherwise. Choosing one opens its project in the left-hand list; the folder carries an AGENTS.md naming the server and ODOO_PROFILE."
            control={
              <Select.Root
                value={defaultProfileId ?? ''}
                onValueChange={(next) => {
                  if (next) void chooseDefault(next);
                }}
                disabled={disabled || list.length === 0}
              >
                <Select.Trigger className="w-[220px] shrink-0 gap-2">
                  <Select.Value>
                    {list.find((profile) => profile.id === defaultProfileId)?.name ?? 'None'}
                  </Select.Value>
                </Select.Trigger>
                <Select.Content align="end">
                  {list.map((profile) => (
                    <Select.Item key={profile.id} value={profile.id}>
                      {profile.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            }
          />
        </SeparatedList>
      </SettingsCard>

      <SettingsSection title="Odoo servers" bare>
        <SettingsCard>
          <div className="text-xs text-foreground-passive">
            Passwords are read from the 1Password vault and cached in the Mac keychain; ITMS
            CoWorker never stores the password itself.
          </div>
          <div className="mt-1 text-xs text-foreground-passive">
            One entry per Odoo server, from the items tagged odoo-profile in the AI_MCP vault,
            titled &quot;odoo - name&quot;. Test checks the version and logs in over JSON-RPC; the
            default server is tested once each time this page opens.
          </div>

          <div className="mt-2 flex flex-col divide-y divide-border/40">
            {list.map((profile) => (
              <OdooProfileRow
                key={profile.id}
                profile={profile}
                isDefault={profile.id === defaultProfileId}
                disabled={disabled}
                test={tests[profile.id] ?? { state: 'idle' }}
                mcp={mcp[profile.id]}
                onOpenProject={() => void openProject(profile)}
                onTest={() => void test(profile)}
                onRemove={() => remove(profile)}
              />
            ))}
            {isLoading && (
              <div className="py-2 text-xs text-foreground-passive">Reading the server list…</div>
            )}
            {!isLoading && list.length === 0 && (
              <div className="py-2 text-xs text-foreground-passive">
                No Odoo servers yet. Choose Refresh from 1Password to read the vault.
              </div>
            )}
          </div>

          {refreshSummary && <SkippedLine summary={refreshSummary} />}

          <div className="mt-2 flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-foreground-muted"
              disabled={disabled}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-4" />
              Refresh from 1Password
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

/**
 * What the last vault read left out. A skipped item is a server the person
 * expected to see, so it is named on the page rather than only in a toast.
 */
function SkippedLine({ summary }: { summary: RefreshSummary }) {
  if (summary.skipped.length === 0) {
    return (
      <div className="mt-2 text-xs text-foreground-muted">
        Last read from 1Password: {summary.kept} server(s), nothing skipped.
      </div>
    );
  }
  return (
    <div className="text-destructive mt-2 text-xs">
      Last read from 1Password: {summary.kept} server(s), {summary.skipped.length} skipped for a
      missing URL, database or user: {summary.skipped.join(', ')}
    </div>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

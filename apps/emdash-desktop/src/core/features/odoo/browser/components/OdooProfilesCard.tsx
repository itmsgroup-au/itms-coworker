import { SettingsCard, SettingsRow, SettingsSection } from '@emdash/ui/react/patterns';
import { Badge, Button, Input, Select, SeparatedList, toast } from '@emdash/ui/react/primitives';
import { Check, Download, KeyRound, Pencil, Plug, Plus, Trash2, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { getOdooClient } from '@core/features/odoo/api/browser/client';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import type { OdooProfile } from '@core/primitives/app-settings/api';

type Draft = Omit<OdooProfile, 'id'> & { id?: string };
type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'done'; text: string; ok: boolean };

const EMPTY_DRAFT: Draft = { name: '', url: 'https://', db: '', user: '', password: '' };

export function OdooProfilesCard() {
  const { value, update, updateAsync, isLoading, isSaving } = useAppSettingsKey('odoo');
  const openConfirm = useOpenModal('confirmActionModal');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [busy, setBusy] = useState(false);

  const profiles = value?.profiles ?? [];
  const defaultProfileId = value?.defaultProfileId ?? null;
  const disabled = isLoading || isSaving || busy;

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim();
    const url = draft.url.trim().replace(/\/+$/, '');
    if (!name || !url || !draft.db.trim() || !draft.user.trim()) {
      toast.error('Name, URL, database and user are required');
      return;
    }
    const id = draft.id ?? makeId(name, profiles);
    const profile: OdooProfile = {
      id,
      name,
      url,
      db: draft.db.trim(),
      user: draft.user.trim(),
      password: draft.password,
      description: draft.description?.trim() || undefined,
      odooVersion: draft.odooVersion?.trim() || undefined,
    };
    const next = draft.id
      ? profiles.map((existing) => (existing.id === id ? profile : existing))
      : [...profiles, profile];
    update({ profiles: next, defaultProfileId: defaultProfileId ?? id });
    setDraft(null);
  };

  const remove = (profile: OdooProfile) => {
    void openConfirm({
      title: `Remove ${profile.name}?`,
      description:
        'The profile is removed from ITMS CoWorker. ~/.odoo-profiles.json is not touched until you export.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    }).then((outcome) => {
      if (!outcome.success) return;
      const next = profiles.filter((existing) => existing.id !== profile.id);
      update({
        profiles: next,
        defaultProfileId:
          defaultProfileId === profile.id ? (next[0]?.id ?? null) : defaultProfileId,
      });
    });
  };

  const test = async (profile: OdooProfile) => {
    setTests((prev) => ({ ...prev, [profile.id]: { state: 'testing' } }));
    try {
      const result = await (await getOdooClient()).testConnection(profile);
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
  };

  const mergeProfiles = async (incoming: OdooProfile[], source: string, skipped: string[]) => {
    // Merge by name: a server already listed is refreshed, a new one is appended.
    const byName = new Map(profiles.map((profile) => [profile.name.toLowerCase(), profile]));
    const taken = new Set(profiles.map((profile) => profile.id));
    for (const profile of incoming) {
      const existing = byName.get(profile.name.toLowerCase());
      if (existing) {
        byName.set(profile.name.toLowerCase(), { ...profile, id: existing.id });
        continue;
      }
      let id = profile.id;
      let suffix = 2;
      while (taken.has(id)) id = `${profile.id}-${suffix++}`;
      taken.add(id);
      byName.set(profile.name.toLowerCase(), { ...profile, id });
    }
    const next = [...byName.values()];
    try {
      await updateAsync({
        profiles: next,
        defaultProfileId: defaultProfileId ?? next[0]?.id ?? null,
      });
      toast(`Imported ${incoming.length} server(s) from ${source}`, {
        description: skipped.length ? `Skipped: ${skipped.join(', ')}` : undefined,
      });
    } catch (error) {
      toast.error('Could not save the imported servers', { description: message(error) });
    }
  };

  const importOnePassword = async () => {
    setBusy(true);
    try {
      const result = await (await getOdooClient()).readProfilesFromOnePassword({});
      if (result.profiles.length === 0) {
        toast.error('No items tagged odoo-profile found', { description: result.source });
        return;
      }
      await mergeProfiles(result.profiles, result.source, result.skipped);
    } catch (error) {
      toast.error('1Password import failed', {
        description: `${message(error)}. Is the 1Password app unlocked and the CLI integration on?`,
      });
    } finally {
      setBusy(false);
    }
  };

  const importFile = async () => {
    setBusy(true);
    try {
      const file = await (await getOdooClient()).readProfilesFile();
      if (!file.exists) {
        toast.error(`No file at ${file.path}`);
        return;
      }
      await mergeProfiles(file.profiles, file.path, []);
    } catch (error) {
      toast.error('Import failed', { description: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const exportFile = () => {
    void openConfirm({
      title: 'Replace ~/.odoo-profiles.json?',
      description: `Writes ${profiles.length} profile(s), passwords included, over the file atlas and the odoo CLI read.`,
      confirmLabel: 'Write file',
      variant: 'destructive',
    }).then(async (outcome) => {
      if (!outcome.success) return;
      setBusy(true);
      try {
        const result = await (await getOdooClient()).writeProfilesFile({ profiles });
        toast(`Wrote ${result.path}`);
      } catch (error) {
        toast.error('Export failed', { description: message(error) });
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <SettingsCard>
        <SeparatedList gap="1rem" direction="column">
          <SettingsRow
            label="Default Odoo server"
            description="The server an agent works against unless a task says otherwise. Passed to the agent as ODOO_PROFILE."
            control={
              <Select.Root
                value={defaultProfileId ?? ''}
                onValueChange={(next) => update({ defaultProfileId: next || null })}
                disabled={disabled || profiles.length === 0}
              >
                <Select.Trigger className="w-[220px] shrink-0 gap-2">
                  <Select.Value>
                    {profiles.find((profile) => profile.id === defaultProfileId)?.name ?? 'None'}
                  </Select.Value>
                </Select.Trigger>
                <Select.Content align="end">
                  {profiles.map((profile) => (
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
            One entry per Odoo server. The source of truth is 1Password: items tagged odoo-profile
            in the AI_MCP vault, titled &quot;odoo - name&quot;. Test checks the version and logs in
            over JSON-RPC.
          </div>

          <div className="mt-2 flex flex-col divide-y divide-border/40">
            {profiles.map((profile) => {
              const status = tests[profile.id] ?? { state: 'idle' };
              return (
                <div key={profile.id} className="flex flex-col gap-1 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {profile.name}
                      <span className="ml-2 text-xs text-foreground-passive">
                        {profile.url} · {profile.db} · {profile.user}
                      </span>
                    </span>
                    {profile.id === defaultProfileId && <Badge>default</Badge>}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || status.state === 'testing'}
                      onClick={() => void test(profile)}
                    >
                      <Plug className="size-4" />
                      {status.state === 'testing' ? 'Testing…' : 'Test'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      icon
                      className="size-7 shrink-0 text-foreground-muted"
                      disabled={disabled}
                      aria-label={`Edit ${profile.name}`}
                      onClick={() => setDraft({ ...profile })}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      icon
                      className="size-7 shrink-0 text-foreground-muted"
                      disabled={disabled}
                      aria-label={`Remove ${profile.name}`}
                      onClick={() => remove(profile)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {status.state === 'done' && (
                    <div
                      className={
                        status.ok ? 'text-xs text-foreground-muted' : 'text-destructive text-xs'
                      }
                    >
                      {status.text}
                    </div>
                  )}
                </div>
              );
            })}
            {profiles.length === 0 && (
              <div className="py-2 text-xs text-foreground-passive">No Odoo servers yet.</div>
            )}
          </div>

          {draft ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Input
                autoFocus
                placeholder="Name (itms19)"
                value={draft.name}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              />
              <Input
                placeholder="URL (https://odoo.itmsgroup.com.au)"
                value={draft.url}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, url: event.currentTarget.value })}
              />
              <Input
                placeholder="Database"
                value={draft.db}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, db: event.currentTarget.value })}
              />
              <Input
                placeholder="User (email)"
                value={draft.user}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, user: event.currentTarget.value })}
              />
              <Input
                type="password"
                placeholder="Password or API key"
                value={draft.password}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, password: event.currentTarget.value })}
              />
              <Input
                placeholder="Description (optional)"
                value={draft.description ?? ''}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
              />
              <div className="col-span-2 flex items-center gap-2">
                <Button type="button" size="sm" disabled={disabled} onClick={saveDraft}>
                  <Check className="size-4" />
                  {draft.id ? 'Save' : 'Add'}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  <X className="size-4" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-foreground-muted"
                disabled={disabled}
                onClick={() => setDraft({ ...EMPTY_DRAFT })}
              >
                <Plus className="size-4" />
                Add server
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-foreground-muted"
                disabled={disabled}
                onClick={() => void importOnePassword()}
              >
                <KeyRound className="size-4" />
                Import from 1Password
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-foreground-muted"
                disabled={disabled}
                onClick={() => void importFile()}
              >
                <Download className="size-4" />
                Import ~/.odoo-profiles.json
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-foreground-muted"
                disabled={disabled || profiles.length === 0}
                onClick={exportFile}
              >
                <Upload className="size-4" />
                Export to ~/.odoo-profiles.json
              </Button>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeId(name: string, profiles: readonly OdooProfile[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'profile';
  const taken = new Set(profiles.map((profile) => profile.id));
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base.slice(0, 60)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

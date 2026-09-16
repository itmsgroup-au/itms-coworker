import { Button } from '@emdash/ui/react/primitives';
import { useDefaultOdooProfile, useJidoApprovals } from '@core/features/jido/api/browser/use-jido';
import { jidoViewDef } from '@core/features/jido/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import type { OdooProfile } from '@core/primitives/app-settings/api';
import {
  useCurrentViewParams,
  useNavigate,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { ApprovalsList } from '../components/ApprovalsList';
import { RunsList } from '../components/RunsList';
import { Empty } from '../components/shared';

export function JidoPage() {
  const { profile, isLoading } = useDefaultOdooProfile();
  const { params, setParams } = useCurrentViewParams(jidoViewDef);
  const { navigate } = useNavigate();
  const tab = params.tab ?? 'runs';

  if (isLoading) return null;
  if (!profile) {
    return (
      <Empty
        title="No Odoo server selected"
        body="Procedures reads what your automations did from the default Odoo server. Choose one in Settings → Odoo."
        action={
          <Button onClick={() => navigate(settingsViewDef({ tab: 'odoo' }))}>
            Open Odoo settings
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-4 px-6 py-6">
        <Tabs profile={profile} tab={tab} onPick={(next) => setParams({ tab: next })} />
        {tab === 'runs' ? (
          <RunsList
            profile={profile}
            selectedRunId={params.run ?? null}
            onSelect={(run) => setParams((prev) => ({ ...prev, run: run ?? undefined }))}
          />
        ) : (
          <ApprovalsList
            profile={profile}
            selectedApprovalId={params.approval ?? null}
            onSelect={(approval) =>
              setParams((prev) => ({ ...prev, approval: approval ?? undefined }))
            }
          />
        )}
      </div>
    </div>
  );
}

function Tabs({
  profile,
  tab,
  onPick,
}: {
  profile: OdooProfile;
  tab: 'runs' | 'approvals';
  onPick: (tab: 'runs' | 'approvals') => void;
}) {
  const approvals = useJidoApprovals(profile, { proceduresOnly: false });
  const waiting = approvals.data?.length ?? 0;
  return (
    <div className="flex gap-1 border-b border-border">
      <Tab label="Runs" active={tab === 'runs'} onClick={() => onPick('runs')} />
      <Tab
        label={waiting > 0 ? `Waiting for approval (${waiting})` : 'Waiting for approval'}
        active={tab === 'approvals'}
        onClick={() => onPick('approvals')}
      />
    </div>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm',
        active
          ? 'border-accent font-medium text-foreground'
          : 'border-transparent text-foreground-muted hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}

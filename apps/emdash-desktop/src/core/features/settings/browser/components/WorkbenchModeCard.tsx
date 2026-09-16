import { SettingsCard, SettingsRow } from '@emdash/ui/react/patterns';
import { Switch } from '@emdash/ui/react/primitives';
import { useNonDeveloperMode } from '@core/features/workbench/api/browser/mode-developer-surfaces';

/**
 * The one switch between the Odoo companion app and the developer workspace.
 *
 * On (the default) the git surfaces are hidden. Nothing is deleted: turning it
 * off brings back pull requests, worktrees and the diff and changes panels.
 */
export function WorkbenchModeCard() {
  const { enabled, setEnabled } = useNonDeveloperMode();

  return (
    <SettingsCard>
      <SettingsRow
        label="Hide developer tools"
        description="Hides pull requests, worktrees, and the diff and changes panels, for people who run Odoo rather than review code. Turn it off to get them all back."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Hide developer tools"
          />
        }
      />
    </SettingsCard>
  );
}

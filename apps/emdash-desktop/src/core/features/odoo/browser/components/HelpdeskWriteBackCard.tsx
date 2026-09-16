import { SettingsCard, SettingsRow } from '@emdash/ui/react/patterns';
import { Switch } from '@emdash/ui/react/primitives';
import { useHelpdeskWriteBack } from '@core/features/helpdesk/contributions/browser/assign-note';

/**
 * The one place the app is allowed to write back to Odoo, off by default.
 *
 * The flag itself lives on the `helpdesk` app-settings key and is owned by the
 * helpdesk slice; this card only binds a switch to it.
 */
export function HelpdeskWriteBackCard() {
  const { enabled, setEnabled } = useHelpdeskWriteBack();

  return (
    <SettingsCard>
      <SettingsRow
        label="Post a note to the ticket when an agent starts"
        description="Adds a short internal note to the Odoo helpdesk ticket saying ITMS CoWorker has started on it. Off by default: nothing is written to Odoo unless you turn this on."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Post a note to the ticket when an agent starts"
          />
        }
      />
    </SettingsCard>
  );
}

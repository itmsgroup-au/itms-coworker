import { PageLayout, SettingsSection } from '@emdash/ui/react/patterns';
import { HelpdeskWriteBackCard } from '../components/HelpdeskWriteBackCard';
import { OdooProfilesCard } from '../components/OdooProfilesCard';

export function OdooSettingsPage() {
  return (
    <div className="space-y-8">
      <PageLayout.Header
        sticky
        title="Odoo"
        description="The Odoo servers ITMS CoWorker agents work against. They come from 1Password."
      />
      <OdooProfilesCard />
      <SettingsSection title="Helpdesk write-back" bare>
        <HelpdeskWriteBackCard />
      </SettingsSection>
    </div>
  );
}

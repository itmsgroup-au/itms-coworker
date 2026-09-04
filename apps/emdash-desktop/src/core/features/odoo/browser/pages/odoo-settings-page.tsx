import { PageLayout } from '@emdash/ui/react/patterns';
import { OdooProfilesCard } from '../components/OdooProfilesCard';

export function OdooSettingsPage() {
  return (
    <div className="space-y-8">
      <PageLayout.Header
        sticky
        title="Odoo"
        description="The Odoo servers ITMS CoWorker agents work against, as profiles."
      />
      <OdooProfilesCard />
    </div>
  );
}

import { OdooSettingsPage } from '@core/features/odoo/browser/pages/odoo-settings-page';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';

export const odooSettingsPage = defineSettingsPageContribution({
  id: 'odoo',
  label: 'Odoo',
  icon: 'database',
  component: OdooSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

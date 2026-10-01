import { AtlasSettingsPage } from '@core/features/atlas/browser/pages/atlas-settings-page';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';

export const atlasSettingsPage = defineSettingsPageContribution({
  id: 'atlas',
  label: 'Atlas',
  icon: 'terminal',
  component: AtlasSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

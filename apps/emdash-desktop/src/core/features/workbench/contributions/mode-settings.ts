import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';

/**
 * The one switch that decides whether this app looks like a developer's git
 * workspace or an Odoo companion app.
 *
 * On (the default for this fork) the git surfaces are hidden: no Pull Requests
 * or Workspaces tab on a project, no Diff tab and no Changes panel on a task,
 * and the per-project git polling never starts. Nothing is deleted; turning it
 * off restores every surface exactly as it was.
 */
export type WorkbenchModeSettingsValue = {
  /** Hide the developer-only (git) surfaces. Default true. */
  nonDeveloperMode: boolean;
};

export const WORKBENCH_MODE_SETTINGS_KEY = 'workbenchMode' as const;

export const workbenchModeSettingsSchema = z.object({
  nonDeveloperMode: z.boolean().default(true),
});

/**
 * Non-developer mode is ON by default in this fork: the people who use it run
 * Odoo, they do not review pull requests.
 */
export const workbenchModeSettingsDefaults: WorkbenchModeSettingsValue = {
  nonDeveloperMode: true,
};

export const workbenchModeSettingsContribution = defineSettingsContribution<
  typeof WORKBENCH_MODE_SETTINGS_KEY,
  WorkbenchModeSettingsValue
>({
  key: WORKBENCH_MODE_SETTINGS_KEY,
  schema: workbenchModeSettingsSchema,
  defaults: workbenchModeSettingsDefaults,
});

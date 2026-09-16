import {
  getAppSettingValueSnapshot,
  useAppSettingsKey,
} from '@core/features/settings/api/browser/use-app-settings-key';
import {
  WORKBENCH_MODE_SETTINGS_KEY,
  workbenchModeSettingsDefaults,
  workbenchModeSettingsSchema,
  type WorkbenchModeSettingsValue,
} from '@core/features/workbench/contributions/mode-settings';

/** Which developer-only surfaces the current mode allows. */
export type DeveloperSurfaces = {
  /** The task Changes panel and the Diff tab. */
  showSourceControl: boolean;
  /** The project Pull Requests tab and the PR sync coordinator. */
  showPullRequests: boolean;
  /** The project Workspaces (worktrees) tab. */
  showWorktrees: boolean;
};

function parseMode(value: unknown): WorkbenchModeSettingsValue {
  const parsed = workbenchModeSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : workbenchModeSettingsDefaults;
}

function toSurfaces(mode: WorkbenchModeSettingsValue): DeveloperSurfaces {
  const show = !mode.nonDeveloperMode;
  return { showSourceControl: show, showPullRequests: show, showWorktrees: show };
}

/** React read of the mode. Re-renders when the setting changes. */
export function useDeveloperSurfaces(): DeveloperSurfaces {
  const { value } = useAppSettingsKey(WORKBENCH_MODE_SETTINGS_KEY);
  return toSurfaces(parseMode(value));
}

/**
 * Synchronous read for code that is not a React component (scoped-store
 * contributions, tab providers).
 *
 * Reads the settings cache; an unread cache yields the defaults, which is the
 * safe direction — the fork's default is non-developer mode, so an unread cache
 * hides the git surfaces rather than starting work nobody asked for.
 */
export function developerSurfacesSnapshot(): DeveloperSurfaces {
  return toSurfaces(parseMode(getAppSettingValueSnapshot(WORKBENCH_MODE_SETTINGS_KEY)));
}

/** Read and set the mode for a settings UI. */
export function useNonDeveloperMode(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const { value, update } = useAppSettingsKey(WORKBENCH_MODE_SETTINGS_KEY);
  return {
    enabled: parseMode(value).nonDeveloperMode,
    setEnabled: (next: boolean) => update({ nonDeveloperMode: next }),
  };
}

import type { TerminalShellId } from '@emdash/core/primitives/terminal-shell/api';
import type { BrowserProfile, BrowserProfileSelection } from '@core/primitives/browser/api';
import type { OpenInAppId } from '@core/primitives/open-in-apps/api/open-in-apps';

export type LocalProjectSettings = {
  defaultProjectsDirectory: string;
  defaultWorktreeDirectory: string;
};

export type ProjectSettings = {
  pushOnCreate: boolean;
  branchPrefix: string;
  appendRandomBranchSuffix: boolean;
  tmuxByDefault: boolean;
};

export type NotificationSettings = {
  enabled: boolean;
  sound: boolean;
  customSoundPath: string;
  osNotifications: boolean;
  soundFocusMode: 'always' | 'unfocused';
};

export type TaskSettings = {
  autoGenerateName: boolean;
  autoApproveByDefault: boolean;
  autoTrustWorktrees: boolean;
  createBranchAndWorktree: boolean;
  deleteBranchByDefault: boolean;
  preserveNameCapitalization: boolean;
  includeIssueContextByDefault: boolean;
};

export type FilesSettings = {
  treeExclude: string[];
  searchExclude: string[];
  watcherExclude: string[];
};

export type TerminalSettings = {
  fontFamily?: string;
  fontSize?: number;
  autoCopyOnSelection: boolean;
  macOptionIsMeta: boolean;
  defaultShell: TerminalShellId;
};

export type Theme = 'emlight' | 'emdark' | null;

export type InterfaceSettings = {
  taskHoverAction: 'delete' | 'archive';
  autoRightSidebarBehavior: boolean;
  showLeftSidebarLineChanges: boolean;
  showLeftSidebarPrStatus: boolean;
  showLeftSidebarTimestamps: boolean;
  hideContextBar: boolean;
};

export type ProviderCustomConfig = {
  extraArgs?: string;
  env?: Record<string, string>;
};
export type ProviderCustomConfigs = Record<string, ProviderCustomConfig>;

export type ChangesViewMode = {
  unstaged: 'flat' | 'tree';
  staged: 'flat' | 'tree';
  pr: 'flat' | 'tree';
};

export type BrowserSettings = {
  defaultProfileId: BrowserProfileSelection;
  relaxCorsForLocalhost: boolean;
  profiles: BrowserProfile[];
};

export type KeyboardSettings = Record<string, string | null | undefined>;

/**
 * One Odoo server an agent can work against. Same shape as ~/.odoo-profiles.json
 * (the file atlas and the odoo CLI read), so a profile round-trips between
 * ITMS CoWorker and the command line unchanged. The password is stored in the
 * local settings database; move it to the keychain before any shared build.
 */
export type OdooProfile = {
  id: string;
  name: string;
  url: string;
  db: string;
  user: string;
  password: string;
  description?: string;
  odooVersion?: string;
};

export type OdooSettings = {
  defaultProfileId: string | null;
  profiles: OdooProfile[];
};

export type OpenInSettings = {
  default: OpenInAppId;
  hidden: OpenInAppId[];
};

export type ChangesSection = keyof ChangesViewMode;
export type ChangesListViewMode = ChangesViewMode[ChangesSection];

export type HostSettings = {
  installBaseUrl: string;
};

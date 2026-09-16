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
 * One Odoo server an agent can work against, without its credential.
 *
 * 1Password is the only source of Odoo passwords and API keys. What a secret is
 * cached in - Electron `safeStorage`, so the app still works while 1Password is
 * locked - is the node side's business; nothing in the settings database, on the
 * wire, or in the renderer carries a password.
 */
export type OdooProfileSummary = {
  id: string;
  name: string;
  url: string;
  db: string;
  user: string;
  description?: string;
  odooVersion?: string;
};

/** @deprecated Name kept for in-flight imports. Use {@link OdooProfileSummary}. */
export type OdooProfile = OdooProfileSummary;

export type OdooSettings = {
  defaultProfileId: string | null;
  profiles: OdooProfileSummary[];
};

/** One helpdesk ticket handed to an agent: the ITMS CoWorker task that is working it. */
export type HelpdeskAssignment = {
  profileId: string;
  ticketId: number;
  ticketRef: string;
  ticketName: string;
  projectId: string;
  taskId: string;
  provider: string;
  assignedAt: string;
};

export type HelpdeskSettings = {
  /** Keyed by `${profileId}:${ticketId}`. */
  assignments: Record<string, HelpdeskAssignment>;
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

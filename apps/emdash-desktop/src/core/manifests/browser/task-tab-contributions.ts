import { browserTaskTabContributions } from '@core/features/browser/contributions/tabs';
import { conversationTaskTabContributions } from '@core/features/conversations/contributions/tabs';
import { editorTaskTabContributions } from '@core/features/editor/contributions/tabs';
import { sourceControlTaskTabContributions } from '@core/features/source-control/contributions/tabs';
import { terminalTaskTabContributions } from '@core/features/terminals/contributions/tabs';
import { developerOnlyTabProviders } from '@core/features/workbench/api/browser/mode-developer-tabs';

export const taskTabContributions = [
  ...conversationTaskTabContributions,
  ...editorTaskTabContributions,
  // The Diff tab stays registered so saved layouts still resolve; it refuses to
  // open while non-developer mode is on.
  ...developerOnlyTabProviders(sourceControlTaskTabContributions),
  ...terminalTaskTabContributions,
  ...browserTaskTabContributions,
] as const;

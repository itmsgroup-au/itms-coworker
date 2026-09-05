import { Toaster } from '@emdash/ui/react/primitives';
import { CoWorkerStatusBar } from '@core/features/helpdesk/contributions/browser/status-bar';
import { LeftSidebar } from '@core/features/workbench/browser/sidebar/left-sidebar';
import { WindowScope } from '@core/features/workbench/browser/window-scope';
import {
  useWorkspaceSlots,
  useWorkspaceViewParams,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { useTheme } from '@core/primitives/theme/browser';
import { BrowserShortcutForwarding, KeybindingDispatcherMount } from '@renderer/lib/keybindings';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';

export function Workspace() {
  useTheme();
  const { WrapView, TitlebarSlot, MainPanel } = useWorkspaceSlots();
  const { params } = useWorkspaceViewParams();

  return (
    <WindowScope>
      <BrowserShortcutForwarding />
      <KeybindingDispatcherMount />
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          <WorkspaceLayout
            leftSidebar={<LeftSidebar />}
            mainContent={
              <WrapView {...params}>
                <WorkspaceContentLayout titlebarSlot={<TitlebarSlot />} mainPanel={<MainPanel />} />
              </WrapView>
            }
          />
        </div>
        <CoWorkerStatusBar />
      </div>
      <Toaster />
    </WindowScope>
  );
}

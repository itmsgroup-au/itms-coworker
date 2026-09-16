import { MicroLabel } from '@emdash/ui/react/primitives';
import {
  ChevronRight,
  Clock,
  FolderInput,
  MessageSquareShare,
  Settings,
  Ticket,
  Workflow,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { automationsViewDef } from '@core/features/automations/contributions/views';
import { HelpdeskOpenCount } from '@core/features/helpdesk/contributions/browser/open-count';
import { helpdeskViewDef } from '@core/features/helpdesk/contributions/views';
import { jidoViewDef } from '@core/features/jido/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { SidebarPinnedTaskList } from './pinned-task-list';
import { ProjectsGroupLabel } from './projects-group-label';
import {
  SidebarContainer,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
} from './sidebar-primitives';
import { SidebarSearchTrigger } from './sidebar-search-trigger';
import { SidebarSpace } from './sidebar-space';
import { SidebarVirtualList } from './sidebar-virtual-list';
import { UpdateSection } from './update-section';
import { useSidebarDrop } from './use-sidebar-drop';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  const openFeedbackModal = useOpenModal('feedbackModal');
  // Projects are the folders the work happens in, not the work itself, so the
  // group starts closed and the ticket queue and procedures sit above it.
  const [showProjects, setShowProjects] = React.useState(false);
  const { isDragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useSidebarDrop();

  return (
    <div
      className={cn(
        // Closed = unmounted (store-driven conditional rendering), so the
        // border applies unconditionally.
        'surface-sunken relative flex h-full flex-col border-r border-border bg-(--em-surface) text-foreground-tertiary-muted transition-colors',
        isDragOver && 'bg-accent/10 ring-2 ring-inset ring-accent/50'
      )}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background-tertiary/80 backdrop-blur-sm">
          <FolderInput className="size-8 text-foreground" />
          <span className="text-xs font-medium text-foreground">Drop to add project</span>
        </div>
      )}
      <SidebarSpace />
      <SidebarContainer className="min-h-0 w-full flex-1 border-r-0">
        <SidebarContent className="flex flex-col">
          <SidebarGroup className="mb-0">
            <div className="flex h-[40px] items-center pl-5">
              <MicroLabel className="font-medium text-foreground-tertiary-passive">Work</MicroLabel>
            </div>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuButton
                  isActive={isCurrentView(currentView, 'helpdesk')}
                  onClick={() => navigate(helpdeskViewDef({}))}
                  aria-label="Tickets"
                  className="w-full justify-between"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Ticket className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
                    <span className="truncate">Tickets</span>
                  </span>
                  <HelpdeskOpenCount />
                </SidebarMenuButton>
                <SidebarMenuButton
                  isActive={isCurrentView(currentView, 'jido')}
                  onClick={() => navigate(jidoViewDef({}))}
                  aria-label="Procedures"
                  className="w-full justify-between"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Workflow className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
                    <span className="truncate">Procedures</span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarPinnedTaskList />
          <SidebarGroup className={cn('mb-0 flex min-h-0 flex-col', showProjects && 'flex-1')}>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowProjects((open) => !open)}
                aria-expanded={showProjects}
                aria-label={showProjects ? 'Hide projects' : 'Show projects'}
                className="absolute top-0 left-1 z-10 flex h-[40px] w-4 cursor-pointer items-center justify-center text-foreground-tertiary-passive focus:outline-none focus-visible:outline-none"
              >
                <ChevronRight
                  className={cn('size-3.5 transition-transform', showProjects && 'rotate-90')}
                />
              </button>
              <ProjectsGroupLabel />
            </div>
            {showProjects && (
              <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
                <SidebarMenu className="flex min-h-0 flex-1 flex-col">
                  <SidebarVirtualList />
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarSearchTrigger />
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'automations')}
              onClick={() => navigate(automationsViewDef())}
              aria-label="Automations"
              className="w-full justify-between"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Clock className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
                <span className="truncate">Automations</span>
              </span>
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'settings')}
              onClick={() => navigate(settingsViewDef())}
              aria-label="Settings"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-5 w-5 sm:h-4 sm:w-4" />
                Settings
              </span>
              <BoundShortcut command="app.settings" variant="keycaps" />
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarFooter>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <button
            type="button"
            className="flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-foreground-muted focus:outline-none focus-visible:outline-none"
            onClick={() => void openFeedbackModal({})}
          >
            <MessageSquareShare className="size-4 shrink-0" />
            <span className="truncate">Give feedback</span>
          </button>
          <UpdateSection />
        </div>
      </SidebarContainer>
    </div>
  );
});

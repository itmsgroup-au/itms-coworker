import { type ReactNode } from 'react';
import { helpdeskViewDef } from '@core/features/helpdesk/contributions/views';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';
import { HelpdeskPage } from './components/HelpdeskPage';

export function HelpdeskViewWrapper({ children }: { children: ReactNode; team?: number }) {
  return <>{children}</>;
}

export function HelpdeskTitlebar() {
  return (
    <Titlebar
      leftSlot={<span className="text-sm font-medium text-foreground">Tasks · Helpdesk</span>}
    />
  );
}

export function HelpdeskMainPanel() {
  return <HelpdeskPage />;
}

export const helpdeskViewRuntime = defineViewRuntime(helpdeskViewDef, {
  slots: {
    wrap: HelpdeskViewWrapper,
    titlebar: HelpdeskTitlebar,
    main: HelpdeskMainPanel,
  },
});

import { type ReactNode } from 'react';
import { approvalsViewDef } from '@core/features/approvals/contributions/views';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';
import { ApprovalsPage } from './components/ApprovalsPage';

export function ApprovalsViewWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function ApprovalsTitlebar() {
  return (
    <Titlebar leftSlot={<span className="text-sm font-medium text-foreground">Approvals</span>} />
  );
}

export function ApprovalsMainPanel() {
  return <ApprovalsPage />;
}

export const approvalsViewRuntime = defineViewRuntime(approvalsViewDef, {
  slots: {
    wrap: ApprovalsViewWrapper,
    titlebar: ApprovalsTitlebar,
    main: ApprovalsMainPanel,
  },
});

import { type ReactNode } from 'react';
import { jidoViewDef } from '@core/features/jido/contributions/views';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';
import { JidoPage } from './pages/JidoPage';

export function JidoViewWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function JidoTitlebar() {
  return (
    <Titlebar leftSlot={<span className="text-sm font-medium text-foreground">Procedures</span>} />
  );
}

export function JidoMainPanel() {
  return <JidoPage />;
}

export const jidoViewRuntime = defineViewRuntime(jidoViewDef, {
  slots: {
    wrap: JidoViewWrapper,
    titlebar: JidoTitlebar,
    main: JidoMainPanel,
  },
});

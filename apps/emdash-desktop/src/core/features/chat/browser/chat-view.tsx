import { type ReactNode } from 'react';
import { chatViewDef } from '@core/features/chat/contributions/views';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';
import { ChatPage } from './components/ChatPage';

export function ChatViewWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function ChatTitlebar() {
  return <Titlebar leftSlot={<span className="text-sm font-medium text-foreground">Chat</span>} />;
}

export function ChatMainPanel() {
  return <ChatPage />;
}

export const chatViewRuntime = defineViewRuntime(chatViewDef, {
  slots: {
    wrap: ChatViewWrapper,
    titlebar: ChatTitlebar,
    main: ChatMainPanel,
  },
});

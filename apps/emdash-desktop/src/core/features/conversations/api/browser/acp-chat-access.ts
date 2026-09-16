/**
 * Slice-api surface for mounting an ACP chat outside a task pane.
 *
 * Other features (the Helpdesk ticket pane) need a live AcpChatStore for a
 * task's conversation, but Core module boundaries only let them import
 * `features/conversations/api/**`. This is the same arrangement as
 * `acp-transcript.ts`: the api layer reaches into its own slice's browser
 * implementation and exposes a narrow surface.
 */

export {
  getAcpChatResourceManager,
  type AcpChatResourceManager,
} from '@core/features/conversations/browser/acp/acp-chat-resource-manager';
export type { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';

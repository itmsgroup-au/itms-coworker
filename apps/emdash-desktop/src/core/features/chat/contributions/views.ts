import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

/**
 * Chat: talk to an agent about anything, with no ticket or project to choose
 * first. `task` selects one past chat.
 */
export const chatViewDef = defineView({
  id: 'chat',
  params: z.object({ task: z.string().optional() }),
  layout: workbenchLayout,
  telemetryEvent: 'chat_viewed',
});

import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

/**
 * Approvals: every permission an agent is waiting on, across every task, in
 * one inbox. Answering here is the same as answering in the task's chat.
 */
export const approvalsViewDef = defineView({
  id: 'approvals',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'approvals_viewed',
});

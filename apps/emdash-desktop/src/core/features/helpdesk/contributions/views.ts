import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

/**
 * The Tasks page: Odoo Helpdesk teams and tickets, with an agent assigned per
 * ticket. `team` narrows the list to one helpdesk team; absent means the
 * team overview.
 */
export const helpdeskViewDef = defineView({
  id: 'helpdesk',
  params: z.object({
    team: z.number().optional(),
    all: z.boolean().optional(),
  }),
  layout: workbenchLayout,
  telemetryEvent: 'helpdesk_viewed',
});

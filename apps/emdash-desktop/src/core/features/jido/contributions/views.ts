import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

/**
 * Procedures: a read-only window onto what the automations did, and the
 * things waiting for someone to approve. `tab` picks the list; `run` and
 * `approval` select one row in it.
 */
export const jidoViewDef = defineView({
  id: 'jido',
  params: z.object({
    tab: z.enum(['runs', 'approvals']).optional(),
    run: z.number().optional(),
    approval: z.number().optional(),
  }),
  layout: workbenchLayout,
  telemetryEvent: 'jido_viewed',
});

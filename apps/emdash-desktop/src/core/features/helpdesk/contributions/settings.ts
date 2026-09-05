import { z } from 'zod';
import type { HelpdeskSettings } from '@core/primitives/app-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';

const assignmentSchema = z.object({
  profileId: z.string(),
  ticketId: z.number(),
  ticketRef: z.string(),
  ticketName: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  provider: z.string(),
  assignedAt: z.string(),
});

const helpdeskSettingsSchema = z.object({
  assignments: z.record(z.string(), assignmentSchema),
});

/** Which ITMS CoWorker task is working which Odoo helpdesk ticket. */
export const helpdeskSettingsContribution = defineSettingsContribution<
  'helpdesk',
  HelpdeskSettings
>({
  key: 'helpdesk',
  schema: helpdeskSettingsSchema,
  defaults: { assignments: {} },
});

export function assignmentKey(profileId: string, ticketId: number): string {
  return `${profileId}:${ticketId}`;
}

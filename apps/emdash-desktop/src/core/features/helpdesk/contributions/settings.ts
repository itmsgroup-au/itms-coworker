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

/**
 * The stored `helpdesk` settings value.
 *
 * `HelpdeskSettings` stays the shared shape; the write-back flag is added here
 * so the contribution owns it. Every field added must default, so a settings
 * blob written before the field existed still parses.
 */
export type HelpdeskSettingsValue = HelpdeskSettings & {
  /**
   * Post a short internal note to the Odoo ticket when an agent starts on it.
   * Off by default: the app makes no Odoo write unless asked to.
   */
  postNoteOnAssign: boolean;
};

const helpdeskSettingsSchema = z.object({
  assignments: z.record(z.string(), assignmentSchema).default({}),
  postNoteOnAssign: z.boolean().default(false),
});

/** Which ITMS CoWorker task is working which Odoo helpdesk ticket. */
export const helpdeskSettingsContribution = defineSettingsContribution<
  'helpdesk',
  HelpdeskSettingsValue
>({
  key: 'helpdesk',
  schema: helpdeskSettingsSchema,
  defaults: { assignments: {}, postNoteOnAssign: false },
});

export function assignmentKey(profileId: string, ticketId: number): string {
  return `${profileId}:${ticketId}`;
}

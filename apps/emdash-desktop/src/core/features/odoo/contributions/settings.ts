import { z } from 'zod';
import type { OdooSettings } from '@core/primitives/app-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';

export const odooProfileIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const odooProfileSchema = z.object({
  id: odooProfileIdSchema,
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
  db: z.string().trim().min(1).max(200),
  user: z.string().trim().min(1).max(200),
  password: z.string().max(2000),
  description: z.string().max(2000).optional(),
  odooVersion: z.string().max(40).optional(),
});

const odooSettingsSchema = z
  .object({
    defaultProfileId: z.union([odooProfileIdSchema, z.null()]),
    profiles: z.array(odooProfileSchema),
  })
  .refine(
    (settings) =>
      new Set(settings.profiles.map((profile) => profile.id)).size === settings.profiles.length
  )
  .refine(
    (settings) =>
      settings.defaultProfileId === null ||
      settings.profiles.some((profile) => profile.id === settings.defaultProfileId)
  );

export const odooSettingsContribution = defineSettingsContribution<'odoo', OdooSettings>({
  key: 'odoo',
  schema: odooSettingsSchema,
  defaults: { defaultProfileId: null, profiles: [] },
});

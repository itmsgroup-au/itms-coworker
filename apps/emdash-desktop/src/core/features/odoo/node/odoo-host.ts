import type { AppDb } from '@core/services/app-db/node/db';
import type { AppSettingsService } from '@core/services/settings/node';

/**
 * The host services this slice needs, handed in when its wire controller is
 * created rather than reached for: core code must not import `@main/*`.
 *
 * - `appSettings` owns the `odoo` key: which servers exist and which is default.
 * - `db` is only used by the one-time password migration, which has to read the
 *   raw settings row before the schema drops the legacy `password` field.
 */
export type OdooHostServices = {
  appSettings: AppSettingsService;
  db: AppDb;
};

let services: OdooHostServices | null = null;

export function setOdooHostServices(next: OdooHostServices): void {
  services = next;
}

function requireServices(): OdooHostServices {
  if (!services) throw new Error('Odoo host services have not been initialized');
  return services;
}

export function odooAppSettings(): AppSettingsService {
  return requireServices().appSettings;
}

export function odooAppDb(): AppDb {
  return requireServices().db;
}

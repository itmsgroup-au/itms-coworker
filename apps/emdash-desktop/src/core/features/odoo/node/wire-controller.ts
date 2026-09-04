import { createController, type Controller } from '@emdash/wire/rpc';
import { odooContract } from '../api';
import { readProfilesFile, testConnection, writeProfilesFile } from './odoo-service';

export function createOdooWireController(): Controller {
  return createController(odooContract, {
    testConnection: (profile) => testConnection(profile),
    readProfilesFile: () => readProfilesFile(),
    writeProfilesFile: ({ profiles }) => writeProfilesFile(profiles),
  });
}

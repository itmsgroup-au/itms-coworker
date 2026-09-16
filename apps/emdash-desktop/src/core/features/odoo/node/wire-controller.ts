import { createController, type Controller } from '@emdash/wire/rpc';
import { odooContract } from '../api';
import { setOdooHostServices, type OdooHostServices } from './odoo-host';
import {
  atlasProfileName,
  callMethod,
  executeKw,
  fieldsGet,
  helpdeskMessages,
  helpdeskPostNote,
  helpdeskRelated,
  helpdeskTeams,
  helpdeskTickets,
  listModels,
  listProfiles,
  prepareProjectFolder,
  readRecords,
  refreshProfilesFromOnePassword,
  removeProfile,
  searchCount,
  searchRead,
  setDefaultProfile,
  testConnection,
} from './odoo-service';

export function createOdooWireController(services: OdooHostServices): Controller {
  setOdooHostServices(services);
  return createController(odooContract, {
    listProfiles: () => listProfiles(),
    refreshProfilesFromOnePassword: ({ vault }) => refreshProfilesFromOnePassword(vault),
    setDefaultProfile: ({ profileId }) => setDefaultProfile(profileId),
    removeProfile: ({ profileId }) => removeProfile(profileId),
    testConnection: ({ profileId }) => testConnection(profileId),
    prepareProject: ({ profileId }) => prepareProjectFolder(profileId),
    atlasProfileName: ({ profileId }) => atlasProfileName(profileId),
    executeKw: ({ profileId, model, method, args, kwargs }) =>
      executeKw(profileId, model, method, args, kwargs ?? {}),
    searchRead: (input) => searchRead(input),
    readRecords: (input) => readRecords(input),
    searchCount: (input) => searchCount(input),
    fieldsGet: (input) => fieldsGet(input),
    listModels: (input) => listModels(input),
    callMethod: (input) => callMethod(input),
    helpdeskTeams: ({ profileId }) => helpdeskTeams(profileId),
    helpdeskMessages: ({ profileId, ticketId }) => helpdeskMessages(profileId, ticketId),
    helpdeskRelated: ({ profileId, ticketId }) => helpdeskRelated(profileId, ticketId),
    helpdeskPostNote: ({ profileId, ticketId, body }) =>
      helpdeskPostNote(profileId, ticketId, body),
    helpdeskTickets: ({ profileId, teamId, limit }) =>
      helpdeskTickets(profileId, { teamId, limit }),
  });
}

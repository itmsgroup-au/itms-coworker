import { createController, type Controller } from '@emdash/wire/rpc';
import { odooContract } from '../api';
import {
  callMethod,
  executeKw,
  fieldsGet,
  helpdeskMessages,
  helpdeskPostNote,
  helpdeskRelated,
  helpdeskTeams,
  helpdeskTickets,
  listModels,
  prepareProjectFolder,
  readProfilesFile,
  readProfilesFromOnePassword,
  readRecords,
  searchCount,
  searchRead,
  testConnection,
  writeProfilesFile,
} from './odoo-service';

export function createOdooWireController(): Controller {
  return createController(odooContract, {
    testConnection: (profile) => testConnection(profile),
    prepareProject: (profile) => prepareProjectFolder(profile),
    readProfilesFromOnePassword: ({ vault }) => readProfilesFromOnePassword(vault),
    readProfilesFile: () => readProfilesFile(),
    writeProfilesFile: ({ profiles }) => writeProfilesFile(profiles),
    executeKw: ({ profile, model, method, args, kwargs }) =>
      executeKw(profile, model, method, args, kwargs ?? {}),
    searchRead: (input) => searchRead(input),
    readRecords: (input) => readRecords(input),
    searchCount: (input) => searchCount(input),
    fieldsGet: (input) => fieldsGet(input),
    listModels: (input) => listModels(input),
    callMethod: (input) => callMethod(input),
    helpdeskTeams: ({ profile }) => helpdeskTeams(profile),
    helpdeskMessages: ({ profile, ticketId }) => helpdeskMessages(profile, ticketId),
    helpdeskRelated: ({ profile, ticketId }) => helpdeskRelated(profile, ticketId),
    helpdeskPostNote: ({ profile, ticketId, body }) => helpdeskPostNote(profile, ticketId, body),
    helpdeskTickets: ({ profile, teamId, limit }) => helpdeskTickets(profile, { teamId, limit }),
  });
}

import { createController, type Controller } from '@emdash/wire/rpc';
import { odooContract } from '../api';
import {
  executeKw,
  helpdeskMessages,
  helpdeskPostNote,
  helpdeskRelated,
  helpdeskTeams,
  helpdeskTickets,
  prepareProjectFolder,
  readProfilesFile,
  readProfilesFromOnePassword,
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
    helpdeskTeams: ({ profile }) => helpdeskTeams(profile),
    helpdeskMessages: ({ profile, ticketId }) => helpdeskMessages(profile, ticketId),
    helpdeskRelated: ({ profile, ticketId }) => helpdeskRelated(profile, ticketId),
    helpdeskPostNote: ({ profile, ticketId, body }) => helpdeskPostNote(profile, ticketId, body),
    helpdeskTickets: ({ profile, teamId, limit }) => helpdeskTickets(profile, { teamId, limit }),
  });
}

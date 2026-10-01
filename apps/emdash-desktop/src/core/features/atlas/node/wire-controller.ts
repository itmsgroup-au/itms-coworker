import { createController, type Controller } from '@emdash/wire/rpc';
import { atlasContract } from '../api';
import {
  atlasDaemonStatus,
  atlasDoctor,
  atlasStatus,
  startAtlasDaemon,
  stopAtlasDaemon,
  syncAtlasClients,
} from './atlas-service';

export function createAtlasWireController(): Controller {
  return createController(atlasContract, {
    status: () => atlasStatus(),
    doctor: () => atlasDoctor(),
    syncClients: ({ dryRun, profile }) => syncAtlasClients(dryRun, profile),
    daemonStatus: () => atlasDaemonStatus(),
    startDaemon: () => startAtlasDaemon(),
    stopDaemon: () => stopAtlasDaemon(),
  });
}

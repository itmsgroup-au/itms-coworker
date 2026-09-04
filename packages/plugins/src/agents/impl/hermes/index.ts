import {
  definePlugin,
  registerPluginBehavior,
} from '@emdash/core/services/agent-plugins/api/plugins';
import { buildStandardCommand } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { createNativeAcpBehavior } from '../../helpers/acp-stdio';
import { icon } from './icon';

export const plugin = definePlugin(
  {
    id: 'hermes',
    name: 'ITMS CoWorker',
    description:
      'ITMS CoWorker: the ITMS Hermes agent (Bruce, Ric, Worker) on its own machine, with the atlas estate tools, the data lake skills and Odoo.',
    websiteUrl: 'https://github.com/itmsgroup-au/itms-coworker',
  },
  {
    acp: {
      kind: 'supported',
    },
    autoApprove: {
      kind: 'supported',
    },
    hostDependency: {
      id: 'hermes',
      binaryNames: ['hermes'],
      installCommands: {
        macos: [
          {
            method: 'curl',
            command: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          },
        ],
        linux: [
          {
            method: 'curl',
            command: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash',
          },
        ],
      },
      updates: {
        kind: 'supported',
        releaseSource: {
          kind: 'none',
        },
        update: {
          kind: 'package-manager',
        },
      },
    },
    prompt: {
      kind: 'pty-only',
    },
    sessions: {
      kind: 'resumable',
    },
  },
  { icon }
);

export const provider = registerPluginBehavior(plugin, {
  acp: createNativeAcpBehavior(() => ({
    args: ['acp'],
  })),
  prompt: {
    buildCommand: (ctx) =>
      buildStandardCommand(ctx, {
        autoApproveFlag: '--yolo',
        resumeFlag: '--continue',
      }),
  },
});

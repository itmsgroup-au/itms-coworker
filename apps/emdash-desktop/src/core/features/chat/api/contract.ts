import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

export const chatDomain = 'chat' as const;

/** The folder general chats run in. */
export type ChatFolder = { path: string; name: string; created: boolean };

export const chatContract = defineContract({
  /** Creates ~/ITMS CoWorker/chat (git-initialised, with an AGENTS.md) if it is missing. */
  prepareFolder: procedure({ input: z.void(), output: z.custom<ChatFolder>() }),
});

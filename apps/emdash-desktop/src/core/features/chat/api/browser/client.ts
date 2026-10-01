import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { chatContract, chatDomain } from '../contract';

export type ChatClient = ContractClient<typeof chatContract>;

export function getChatClient(): Promise<ChatClient> {
  return domainClient<ChatClient>(chatDomain, chatContract);
}

import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { odooContract, odooDomain } from '../contract';

export type OdooClient = ContractClient<typeof odooContract>;

export function getOdooClient(): Promise<OdooClient> {
  return domainClient<OdooClient>(odooDomain, odooContract);
}

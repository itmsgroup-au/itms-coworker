import { useQuery } from '@tanstack/react-query';
import { getOdooClient } from '@core/features/odoo/api/browser/client';
import type {
  HelpdeskMessage,
  HelpdeskRelated,
  HelpdeskTeam,
  HelpdeskTicket,
  OdooProfileSummary,
} from '@core/features/odoo/api/contract';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';

export const HELPDESK_QUERY_KEY = ['helpdesk'] as const;

/**
 * The default Odoo server from Settings → Odoo, or null when none is chosen.
 *
 * A summary only: the credential never reaches the renderer. Every call below
 * passes `profileId`, and the main process resolves the password itself from
 * 1Password by way of the OS keychain.
 */
export function useDefaultOdooProfile(): {
  profile: OdooProfileSummary | null;
  isLoading: boolean;
} {
  const { value, isLoading } = useAppSettingsKey('odoo');
  const profile = value?.profiles.find((p) => p.id === value.defaultProfileId) ?? null;
  return { profile, isLoading };
}

export function useHelpdeskTeams(profile: OdooProfileSummary | null) {
  return useQuery<HelpdeskTeam[], Error>({
    queryKey: [...HELPDESK_QUERY_KEY, 'teams', profile?.id ?? 'none'],
    enabled: !!profile,
    queryFn: async () => {
      if (!profile) return [];
      return (await getOdooClient()).helpdeskTeams({ profileId: profile.id });
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useHelpdeskTickets(profile: OdooProfileSummary | null, teamId?: number) {
  return useQuery<HelpdeskTicket[], Error>({
    queryKey: [...HELPDESK_QUERY_KEY, 'tickets', profile?.id ?? 'none', teamId ?? 'all'],
    enabled: !!profile,
    queryFn: async () => {
      if (!profile) return [];
      return (await getOdooClient()).helpdeskTickets({ profileId: profile.id, teamId });
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useHelpdeskMessages(profile: OdooProfileSummary | null, ticketId: number | null) {
  return useQuery<HelpdeskMessage[], Error>({
    queryKey: [...HELPDESK_QUERY_KEY, 'messages', profile?.id ?? 'none', ticketId ?? 0],
    enabled: !!profile && ticketId !== null,
    queryFn: async () => {
      if (!profile || ticketId === null) return [];
      return (await getOdooClient()).helpdeskMessages({ profileId: profile.id, ticketId });
    },
    staleTime: 30 * 1000,
  });
}

export function useHelpdeskRelated(profile: OdooProfileSummary | null, ticketId: number | null) {
  return useQuery<HelpdeskRelated, Error>({
    queryKey: [...HELPDESK_QUERY_KEY, 'related', profile?.id ?? 'none', ticketId ?? 0],
    enabled: !!profile && ticketId !== null,
    queryFn: async () => {
      if (!profile || ticketId === null) throw new Error('No ticket');
      return (await getOdooClient()).helpdeskRelated({ profileId: profile.id, ticketId });
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Add an internal note to the ticket; the caller invalidates the messages query. */
export async function postHelpdeskNote(
  profile: OdooProfileSummary,
  ticketId: number,
  body: string
) {
  return (await getOdooClient()).helpdeskPostNote({ profileId: profile.id, ticketId, body });
}

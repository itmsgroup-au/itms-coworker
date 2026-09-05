import { useQuery } from '@tanstack/react-query';
import { getOdooClient } from '@core/features/odoo/api/browser/client';
import type { HelpdeskTeam, HelpdeskTicket } from '@core/features/odoo/api/contract';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import type { OdooProfile } from '@core/primitives/app-settings/api';

export const HELPDESK_QUERY_KEY = ['helpdesk'] as const;

/** The default Odoo server from Settings → Odoo, or null when none is chosen. */
export function useDefaultOdooProfile(): { profile: OdooProfile | null; isLoading: boolean } {
  const { value, isLoading } = useAppSettingsKey('odoo');
  const profile = value?.profiles.find((p) => p.id === value.defaultProfileId) ?? null;
  return { profile, isLoading };
}

export function useHelpdeskTeams(profile: OdooProfile | null) {
  return useQuery<HelpdeskTeam[], Error>({
    queryKey: [...HELPDESK_QUERY_KEY, 'teams', profile?.id ?? 'none'],
    enabled: !!profile,
    queryFn: async () => {
      if (!profile) return [];
      return (await getOdooClient()).helpdeskTeams({ profile });
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

export function useHelpdeskTickets(profile: OdooProfile | null, teamId?: number) {
  return useQuery<HelpdeskTicket[], Error>({
    queryKey: [...HELPDESK_QUERY_KEY, 'tickets', profile?.id ?? 'none', teamId ?? 'all'],
    enabled: !!profile,
    queryFn: async () => {
      if (!profile) return [];
      return (await getOdooClient()).helpdeskTickets({ profile, teamId });
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

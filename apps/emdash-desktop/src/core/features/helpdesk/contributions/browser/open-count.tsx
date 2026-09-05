import {
  useDefaultOdooProfile,
  useHelpdeskTeams,
} from '@core/features/helpdesk/api/browser/use-helpdesk';

/** The open-ticket total for the sidebar badge; empty when no server is set or the count is 0. */
export function HelpdeskOpenCount() {
  const { profile } = useDefaultOdooProfile();
  const teams = useHelpdeskTeams(profile);
  const open = (teams.data ?? []).reduce((n, t) => n + t.open, 0);
  if (!profile || open === 0) return null;
  return (
    <span className="bg-accent/15 text-accent rounded-full px-1.5 text-[11px] font-medium tabular-nums">
      {open}
    </span>
  );
}

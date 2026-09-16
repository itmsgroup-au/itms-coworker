import { observer } from 'mobx-react-lite';
import {
  useDefaultOdooProfile,
  useHelpdeskTeams,
} from '@core/features/helpdesk/api/browser/use-helpdesk';
import { useHelpdeskAssignments } from '@core/features/helpdesk/contributions/browser/assignments';

/**
 * The sidebar badge: open tickets on the default server, plus how many have an
 * agent on them right now. The agent count comes from the same derivation the
 * status bar renders, so the two can never disagree.
 */
export const HelpdeskOpenCount = observer(function HelpdeskOpenCount() {
  const { profile } = useDefaultOdooProfile();
  const teams = useHelpdeskTeams(profile);
  const { active } = useHelpdeskAssignments();
  const open = (teams.data ?? []).reduce((n, t) => n + t.open, 0);
  const working = active.filter((entry) => entry.assignment.profileId === profile?.id).length;
  if (!profile || (open === 0 && working === 0)) return null;
  return (
    <span className="flex items-center gap-1">
      {working > 0 && (
        <span
          className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 text-[11px] font-medium text-emerald-600 tabular-nums"
          title={`${working} ticket${working === 1 ? '' : 's'} with an agent on them`}
        >
          <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
          {working}
        </span>
      )}
      {open > 0 && (
        <span
          className="bg-accent/15 text-accent rounded-full px-1.5 text-[11px] font-medium tabular-nums"
          title={`${open} open ticket${open === 1 ? '' : 's'}`}
        >
          {open}
        </span>
      )}
    </span>
  );
});

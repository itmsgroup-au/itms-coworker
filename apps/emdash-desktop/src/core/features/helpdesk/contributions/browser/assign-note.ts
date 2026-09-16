import { postHelpdeskNote } from '@core/features/helpdesk/api/browser/use-helpdesk';
import type { OdooProfileSummary } from '@core/features/odoo/api/contract';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import type { HelpdeskAssignment } from '@core/primitives/app-settings/api';
import { log } from '@core/primitives/logging/browser/logger';
import type { HelpdeskSettingsValue } from '../settings';

/** The internal note posted to Odoo when an agent picks a ticket up. */
export function assignNoteBody(assignment: HelpdeskAssignment): string {
  return `ITMS CoWorker started on this ticket (agent: ${assignment.provider}).`;
}

/**
 * Post the start-of-work note, if the user turned that on.
 *
 * Does nothing when `postNoteOnAssign` is off, when the settings value has not
 * loaded, or when the profile does not match the assignment. Never throws: a
 * failed Odoo write must not fail the assignment that already succeeded.
 */
export async function postAssignNote(
  profile: OdooProfileSummary,
  settings: HelpdeskSettingsValue | undefined,
  assignment: HelpdeskAssignment
): Promise<void> {
  if (!settings?.postNoteOnAssign) return;
  if (profile.id !== assignment.profileId) return;
  try {
    await postHelpdeskNote(profile, assignment.ticketId, assignNoteBody(assignment));
  } catch (error) {
    log.warn('Could not post the assignment note to the Odoo ticket', {
      ticketId: assignment.ticketId,
      error,
    });
  }
}

/** Read and set the write-back toggle for a settings UI. */
export function useHelpdeskWriteBack(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const { value, update } = useAppSettingsKey('helpdesk');
  return {
    enabled: value?.postNoteOnAssign ?? false,
    setEnabled: (next: boolean) => update({ postNoteOnAssign: next }),
  };
}

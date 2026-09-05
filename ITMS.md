# ITMS CoWorker: how to work on this fork

This is ITMS Group's fork of Emdash (generalaction/emdash, Apache 2.0, forked at
v1.2.3 on 4 September 2026). Upstream stays as the `upstream` git remote; `origin`
is github.com/itmsgroup-au/itms-coworker. Everything ITMS adds is small and named,
so upstream can be merged in for as long as the diff stays small.

## Run it

```bash
cd ~/Desktop/git/itms-coworker
pnpm install                       # once; provisions the pinned Node and pnpm itself
cd apps/emdash-desktop && pnpm run dev   # opens the app; renderer hot-reloads
```

Main-process changes (anything under `src/main/` or a `node/` folder) need the
app restarted. The dev build keeps its own database under the `emdash-dev` user
data directory, so it never touches the Homebrew Emdash install.

Before a commit:

```bash
pnpm run format && pnpm exec nx run @emdash/emdash-desktop:typecheck && pnpm exec nx run @emdash/emdash-desktop:lint
```

Packaged, unsigned macOS build (arm64, output in `apps/emdash-desktop/release/`):

```bash
cd apps/emdash-desktop && pnpm run package:mac
```

## What ITMS changed, and where

- **Provider name.** `packages/plugins/src/agents/impl/hermes/index.ts`: the Hermes
  provider shows as "ITMS CoWorker". The id stays `hermes` and the binary it looks for
  stays `hermes`, so detection, ACP and resume are untouched.
- **App name.** `apps/emdash-desktop/src/core/primitives/app-identity/api/app-identity.ts`
  (`PRODUCT_NAME`) and `src/renderer/index.html`. `USER_DATA_DIR_NAME` is deliberately
  unchanged so existing data stays where it is.
- **No upstream updates.** `apps/emdash-desktop/electron-builder.config.ts` has
  `publish: []`, so a packaged build never pulls upstream's releases over itself.
- **Odoo settings section.** All under `apps/emdash-desktop/src/core/features/odoo/`:
  - `contributions/settings.ts`: the `odoo` settings key (profiles + default), zod schema.
  - `contributions/settings-page.ts`: the Settings nav entry (section "ITMS", icon `database`).
  - `browser/pages/odoo-settings-page.tsx` and `browser/components/OdooProfilesCard.tsx`: the UI.
  - `api/contract.ts`, `api/browser/client.ts`: the wire calls (`testConnection`,
    `readProfilesFile`, `writeProfilesFile`).
  - `node/odoo-service.ts`, `node/wire-controller.ts`: main-process side. Test is JSON-RPC
    `version_info` then `session/authenticate`. Import and export use `~/.odoo-profiles.json`,
    the same file atlas and the odoo CLI read.
  - Registered in `src/core/features/settings/contributions/views.ts` (tab enum),
    `src/core/manifests/browser/settings-page-contributions.ts`,
    `src/core/manifests/shared/settings-contributions.ts`,
    `src/core/manifests/shared/domain-contracts.ts`, `src/core/manifests/node/controllers.ts`,
    the nav in `src/core/features/settings/browser/components/SettingsPage.tsx`, and the
    Cmd+F index in `src/core/features/settings/browser/search/settings-search.ts`.

- **No GitHub sign-in.** `src/renderer/App.tsx` no longer adds the `sign-in` onboarding step.
  The legacy-import step still runs when there is something to import.
- **Tasks (Odoo Helpdesk).** Sidebar item "Tasks" above Search, view id `helpdesk`, all under
  `apps/emdash-desktop/src/core/features/helpdesk/`:
  - `contributions/views.ts`: the view (`team` narrows to one team, `all` lists every ticket).
  - `browser/helpdesk-view.tsx`, `browser/components/HelpdeskPage.tsx`: the team overview
    (open tickets, agents working) and the All tickets list grouped by team then assignee.
    The Agent column assigns a worker plus a project and creates the task with the ticket
    as its first prompt; the pill shows the live task status (Working, Needs you, Done).
  - `contributions/settings.ts`: settings key `helpdesk` holding the assignments
    (`${profileId}:${ticketId}` → project, task, provider).
  - `browser/components/TicketDetail.tsx`: the right pane when a ticket is selected (Thread,
    Customer, Agent tabs). The Agent tab reads the task transcript through
    `features/conversations/api/browser/acp-transcript.ts` (`readTaskTranscript`, polled every
    2 s because the transcript is signal-backed) and posts an internal note back to the ticket.
  - `contributions/browser/status-bar.tsx`: the bottom strip on every view, mounted in
    `src/renderer/app/workspace.tsx`. `contributions/browser/open-count.tsx`: the sidebar badge.
  - `api/browser/use-helpdesk.ts`: react-query hooks over the Odoo wire domain.
  - The Odoo wire domain (`features/odoo`) gained `executeKw`, `helpdeskTeams`,
    `helpdeskTickets`, `helpdeskMessages`, `helpdeskRelated` and `helpdeskPostNote` (the one
    write: an internal note via `message_post` with `mail.mt_note`); the `uid` is cached per
    profile in `node/odoo-service.ts`.
  - Renderer console errors, crashes and load failures are written to
    `.emdash-logs/emdash.log` by `src/main/host/window.ts`, so a white screen leaves a trace.
  - Registered in `manifests/browser/view-catalog.ts`, `manifests/browser/browser-contributions.ts`,
    `manifests/shared/settings-contributions.ts`, and the telemetry unions in
    `primitives/telemetry/api/telemetry.ts` (a new view id must be added there too).

## Adding another Settings section (the recipe)

1. Add the id to `settingsPageTabSchema` in `features/settings/contributions/views.ts`.
2. Create `features/<name>/contributions/settings-page.ts` with `defineSettingsPageContribution`.
3. Add it to `manifests/browser/settings-page-contributions.ts` and to `SIDEBAR_ITEMS` in
   `SettingsPage.tsx` (the nav throws at startup if the id is missing from the registry).
4. Plain settings: a `defineSettingsContribution` in `features/<name>/contributions/settings.ts`,
   added to `manifests/shared/settings-contributions.ts`; read and write with
   `useAppSettingsKey('<key>')`.
5. Anything that needs the main process (network, files, secrets): a wire domain, three files
   (`api/contract.ts`, `api/browser/client.ts`, `node/wire-controller.ts`), registered in
   `manifests/shared/domain-contracts.ts` and `manifests/node/controllers.ts`.

The Odoo feature is the smallest complete example of all five steps.

## Machines and agents

- The worker machine is `agent-worker-itms`, an LXC container on the OVH host, reached as
  ssh host `agent-worker` (see the datasets repo, tenants/itmsgroup/profiles/worker-itms).
  Settings → Machines → Add machine → SSH Config → `agent-worker`. Remote project:
  `/srv/repos/odoo_itms_apps`.
- Bruce (ITMS chat agent) is reached through the local `hermes` shim (`~/.local/bin/hermes`),
  which the ITMS CoWorker provider detects on PATH.

## Open items

- Passwords for Odoo profiles sit in the local settings database. Move them to the keychain
  before any build leaves this Mac.
- Pass the default Odoo profile to the agent as `ODOO_PROFILE` when a task starts.
- Machines: pre-fill from the datasets tenants manifests.
- Named agents (Bruce, Ric, Worker) instead of provider CLIs; project becomes client, task
  becomes job, for non-developers.
- Tasks page: related mail, files and RMM endpoints for the customer (needs the lake or
  atlas from the renderer); Today and Home pages; named workers with skill sets instead of
  provider CLIs.

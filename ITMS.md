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

electron-builder finds no Developer ID certificate on this Mac, so it leaves the
bundle with only a linker-signed executable. Launching that from Finder or `open`
fails silently: Gatekeeper kills it, `spctl -a` reports "code has no resources but
signature indicates they must be present". Ad-hoc sign the bundle before installing
it, then copy it to `/Applications`:

```bash
cd apps/emdash-desktop
codesign --force --deep --sign - --options runtime \
  --entitlements build/entitlements.mac.plist "release/mac-arm64/ITMS CoWorker.app"
cp -R "release/mac-arm64/ITMS CoWorker.app" /Applications/
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
    Customer, Agent tabs). The Agent tab is a live chat, see below.
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

- **Talking to the agent on a ticket (16 September 2026).** The Agent tab in
  `TicketDetail.tsx` is a real ACP chat, not a progress summary.
  - `browser/components/TicketAgentChat.tsx` mounts an `AcpChatStore` plus `ChatTranscript`
    with a small composer. It resolves the conversation from the wire
    (`client.getConversationsForTask`), not from `conversationRegistry`, so the transcript
    loads without the user opening the task view first. `AcpChatPanel` itself could not be
    reused: it reads its store out of a workbench pane context.
  - `features/conversations/api/browser/acp-chat-access.ts` re-exports
    `getAcpChatResourceManager` so helpdesk can reach it without breaking the oxlint rule
    `emdash(core-module-boundaries)`, which forbids importing another slice's `browser/**`.
  - `api/browser/agent-progress-source.ts` replaced the 2 s poll with the ACP live models
    (`conversations.acp.session`). It deliberately does not call `loadHistory` for a suspended
    session, because that wakes the agent; a paused worker is reported as paused.
  - The old `acpChatRegistry` had no writer anywhere in `src`, so `readTaskTranscript` always
    returned `available: false` and "Open the task once to read its output here" could never
    resolve. That path is gone.

- **One-click start.** `api/browser/use-ticket-agent.ts` owns the whole sequence: pick the
  worker (hermes if installed), `prepareProject` the Odoo folder, register it as a project if
  it is not one yet, wait for the task manager, create the task with `git: { kind: 'none' }`
  and `repository-instance`. Worker and project pickers stay behind an Options chevron.

- **Assignment hygiene.** `contributions/browser/assignments.ts` is the single derivation for
  the status bar and the sidebar badge, and garbage-collects an assignment only on positive
  evidence (project list loaded and missing it, or task map loaded and missing it) held for
  20 s. `contributions/browser/assign-note.ts` posts the optional start-of-work note; the
  switch is `postNoteOnAssign` on the `helpdesk` key, default off.

- **Odoo as a capability, not just a helpdesk reader.** `features/odoo/api/contract.ts` gained
  `searchRead`, `readRecords`, `searchCount`, `fieldsGet`, `listModels` and `callMethod`.
  Everything returns `OdooResult<T>` — `{ ok: true, data }` or `{ ok: false, error: { kind,
  message } }` with `kind` in `auth | network | timeout | odoo | access-denied | unknown`.
  `classifyOdooMethod` splits reads from writes and `callMethod` refuses a write unless
  `confirmWrite` is true. The uid cache is keyed on a password hash and retries once after
  clearing on an auth failure. `prepareProjectFolder` also writes `.mcp.json` and
  `.proj/config.yaml` when `~/.local/bin/itms-odoo-dev` exists, so an agent in that folder
  gets Odoo tools; atlas stays the documented fallback.

- **Procedures (Jido).** View id `jido`, label "Procedures", under
  `apps/emdash-desktop/src/core/features/jido/`. Read-only over the Odoo ledger that
  `jido_lab` writes: `itms.ai.cp.run` for what ran, `itms.ai.action` for what is waiting.
  Approve and reject call the module's own `action_approve` / `action_reject`
  (`odoo_itms_apps_19/itms_ai_worker/models/ai_action.py`), behind a confirm step that names
  the record and the exact write. They are disabled for an `ask` whose `ask_kind` is not
  `approve`/`acknowledge`, because Odoo raises `UserError` in that case. Jido itself lives in
  `~/Desktop/git/jido` and `~/Desktop/git/jido_lab`; `~/Desktop/git/datasets/docs/JIDO.md` is
  the account of it.

- **Non-developer mode.** `features/workbench/contributions/mode-settings.ts`, settings key
  `workbenchMode`, field `nonDeveloperMode`, **default true**. Consumed through
  `features/workbench/api/browser/mode-developer-surfaces.ts` in five places: the project tab
  array, the task tab manifest, the source-control project stores, the task sidebar and the
  task titlebar. On, it hides pull requests, worktrees, the diff tab and the changes panel and
  never starts `GitRepositoryStore` or `TaskPrSyncCoordinator`. Off restores every one of
  them. The switch is Settings → Interface → Mode.

- **Sidebar.** The "Work" group leads with Tickets and Procedures; Projects is collapsed by
  default below them.

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

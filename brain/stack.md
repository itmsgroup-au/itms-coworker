---
slug: stack
title: Tech stack
role: tech-stack choices
updated: "2026-09-04T19:33:04"
---

# Tech stack

- Electron + React 19 + TypeScript, pnpm workspace with Nx (node 24.14.0, pnpm 10.28.2 pinned in package.json; pnpm provisions both).
- `apps/emdash-desktop`: the app. `src/main` is the Electron main process, `src/renderer` the React shell, `src/core` the vertical feature slices (api / browser / node / contributions per feature).
- `packages/plugins`: agent provider definitions (the Hermes provider we brand as ITMS CoWorker). `packages/core`: ACP session runtime. `packages/wire`: the typed RPC between renderer and main. `packages/ui`: the UI kit (SettingsCard, SettingsSection, PageLayout, Input, Select, Button, toast).
- Storage: SQLite via Drizzle. Settings are a key/value table of JSON overrides merged over contribution defaults.
- Tooling: oxfmt for format, oxlint for lint (includes an ITMS-relevant rule: a feature may not import another feature's browser components, only api/contributions surfaces and primitives), `nx run @emdash/emdash-desktop:typecheck`.
- Packaging: electron-builder, arm64 dmg + zip, unsigned by default; publish disabled in this fork.

---
slug: architecture
title: System architecture
role: system architecture
updated: "2026-09-04T19:33:04"
---

# System architecture

A vertical-slice Electron app. Each feature under `apps/emdash-desktop/src/core/features/<name>/` has up to four surfaces: `api` (contract and browser client), `browser` (React), `node` (main-process implementation), `contributions` (registrations: settings keys, settings pages, views). Manifests under `src/core/manifests/` aggregate the registrations for the browser and node programs.

Renderer and main talk over the wire protocol (`@emdash/wire`): a feature defines a contract, the renderer gets a typed client with `domainClient`, the main process registers a controller. Settings that need no main-process work are plain settings contributions read and written with `useAppSettingsKey`.

Agents are provider plugins (`packages/plugins`). A provider is detected by a binary on PATH and driven either in a PTY or over ACP (JSON-RPC on stdio). ITMS CoWorker is the Hermes provider renamed; on Mark's Mac the `hermes` binary is a shim that reaches Bruce over ssh, and on a Machine (remote SSH host) it is the worker's own Hermes profile.

ITMS additions live in `features/odoo` (settings key `odoo`, wire domain `odoo`, Settings nav section "ITMS"). See ITMS.md at the repo root for the recipe and the file list.

---
slug: background
title: Project background
role: project background
updated: "2026-09-04T19:24:40"
---

# Project background

ITMS CoWorker is ITMS Group's fork of Emdash (generalaction/emdash, Apache 2.0, forked at v1.2.3 on 4 September 2026). Emdash is a desktop app for running many AI coding agents in parallel, each in its own git worktree, locally or over SSH on a remote machine.

## Why the fork exists

Mark Shaw tested Emdash against Bruce, the ITMS Hermes agent, on 4 September 2026 and it did what a year of tooling had been aiming at: one window, many agents, one task per question, each agent living on its own machine with its own tools. The working thesis (datasets brain, page thesis-agent-product-for-non-developers) is that Emdash is the operator console for ITMS, and that a renamed fork becomes the per-client console later.

## What this fork changes, in order

1. Branding: the Hermes provider shows as "ITMS CoWorker" (provider id stays `hermes` so the binary detection keeps working); the app is named ITMS CoWorker.
2. Odoo: a Settings section that holds Odoo server profiles (name, url, db, user, password) in the same shape as `~/.odoo-profiles.json`, with a test-connection button. Odoo is sold with every ITMS package, and the agent must know which Odoo it is working against.
3. Later: project becomes client, task becomes job, named agents (Bruce, Ric, Worker) instead of provider CLIs, git and pull requests hidden for non-developers.

## Related systems

- Hermes agents: Bruce (ITMS, Google Chat), Ric (4Front, Teams), Worker (agent-worker-itms, driven only from this app). All defined in the datasets repo under tenants/.
- atlas: the ITMS estate CLI; `atlas odoo` is how an agent reads and writes Odoo.
- The worker machine: LXC container agent-worker-itms on the OVH host, reached as ssh host `agent-worker`.

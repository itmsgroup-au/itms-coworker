---
slug: roadmap
title: Roadmap
role: milestones
updated: "2026-09-04T19:24:40"
---

# Roadmap

## Now (September 2026)

- Rename the Hermes provider to ITMS CoWorker; rename the app.
- Settings: Odoo profiles section, same shape as ~/.odoo-profiles.json, with test connection.
- Run in dev from the fork; keep upstream as a remote and rebase regularly while the diff is small.

## Next

- Machines: one entry per ITMS agent box (agent-worker-itms first), pre-filled from the datasets tenants manifests.
- Named agents instead of provider CLIs: Bruce, Ric, Worker, each pinned to a machine and a Hermes profile.
- Pass the selected Odoo profile to the agent (environment or MCP) so `atlas odoo --profile` is implied.

## Later

- Non-developer mode: project is a client, task is a job, git and pull requests hidden.
- Odoo panel in the ITMS Odoo instance showing the agent's runs against the client record.
- Per-client console builds.

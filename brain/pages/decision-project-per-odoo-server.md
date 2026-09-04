---
id: decision-project-per-odoo-server
title: Choosing an Odoo server opens a project paired with it
category: decision
status: active
tags: [odoo, projects]
created: "2026-09-04T20:02:34"
updated: "2026-09-04T20:02:34"
---

<!-- compiled_truth -->
Mark, 4 Sep 2026: 'I'm expecting that we could have a default left hand project automatically created and paired to the selected server so you can start working immediately.' Decision: the Odoo settings page makes a local project folder per server at ~/ITMS CoWorker/odoo-<id>/ (AGENTS.md with url, db, user and the atlas odoo --profile recipe; CLAUDE.md importing it; .env with ODOO_PROFILE, ODOO_URL, ODOO_DB, gitignored; git init with one commit) and registers it through the projects store, then navigates to it. Picking the default server opens its project; every row also has a Project button. The password never enters the folder: atlas holds it. Emdash's project model needs a folder, so a per-server folder is the honest pairing; later this becomes 'client' in non-developer mode. Related bug fixed the same hour: the Hermes ACP adapter advertised custom models as custom:<model>, the app handed that back, and Hermes sent the request to DeepSeek (HTTP 400); patched on both boxes (datasets repo, tenants/shared/patches/hermes-acp-custom-model-id.py).


## Timeline

- time: 2026-09-04T20:02:34
  kind: decision
  summary: "Created this page: Choosing an Odoo server opens a project paired with it"
  source: "Mark, session 2026-09-04"
  affects: [decision-project-per-odoo-server]

- time: 2026-09-04T20:02:34
  kind: decision
  summary: "per-server project folder with AGENTS.md; opened on default selection"
  source: brain update-truth
  affects: [decision-project-per-odoo-server]

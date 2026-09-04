---
id: decision-odoo-profiles-in-settings
title: "Odoo servers are profiles in Settings, same shape as ~/.odoo-profiles.json"
category: decision
status: active
tags: [odoo, settings]
created: "2026-09-04T19:33:04"
updated: "2026-09-04T19:52:26"
---

<!-- compiled_truth -->
Mark asked (4 Sep 2026) for a Settings section to hold the Odoo server an agent works against, with profiles like ~/.odoo-profiles.json. Decision: settings key 'odoo' = { defaultProfileId, profiles[] } where a profile is { id, name, url, db, user, password, description?, odooVersion? }, stored in the app's SQLite settings like every other key; wire domain 'odoo' with testConnection (JSON-RPC version_info then session/authenticate), readProfilesFile and writeProfilesFile against ~/.odoo-profiles.json so atlas and the odoo CLI share the same profiles. Import merges by id; export replaces the file after a confirm. Known gap: passwords sit in the local settings database; move to keychain before any shared build. Next: pass the default profile to the agent as ODOO_PROFILE at task start.


## Timeline

- time: 2026-09-04T19:33:04
  kind: decision
  summary: "Created this page: Odoo servers are profiles in Settings, same shape as ~/.odoo-profiles.json"
  source: session 2026-09-04
  affects: [decision-odoo-profiles-in-settings]

- time: 2026-09-04T19:33:04
  kind: decision
  summary: "Settings key odoo + wire domain odoo; profiles round-trip with ~/.odoo-profiles.json"
  source: brain update-truth
  affects: [decision-odoo-profiles-in-settings]

- time: 2026-09-04T19:49:53
  kind: evidence
  summary: "First real use, 4 Sep 2026: (1) description limit 200 rejected profile 17 (229 chars) and the failed save was silent; limits raised, imports trim, errors toasted. (2) 21 sequential op item get calls overran the 30 s wire timeout; now six at a time. (3) 'Access Denied' on itms19: /web/session/authenticate takes only a real password, the vault holds an API key; the test now uses /jsonrpc common.version + common.authenticate + res.users read, verified against odoo.itmsgroup.com.au (19.0+e, uid 10)."
  source: session 2026-09-04
  affects: [decision-odoo-profiles-in-settings]

- time: 2026-09-04T19:52:26
  kind: evidence
  summary: "Mark confirmed 4 Sep 2026: 1Password import (21 servers, six fetches at a time) and Test on itms19 over /jsonrpc both work in the app."
  source: "Mark, session 2026-09-04"
  affects: [decision-odoo-profiles-in-settings]

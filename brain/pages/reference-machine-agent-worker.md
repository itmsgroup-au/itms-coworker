---
id: reference-machine-agent-worker
title: "Machine agent-worker: pick the SSH Config host and SSH Key auth, not Agent"
category: reference
status: active
tags: [machines, ssh, worker]
created: "2026-09-04T19:52:26"
updated: "2026-09-04T19:52:26"
---

<!-- compiled_truth -->
Settings > Machines > Add machine > SSH Config > agent-worker. The app then locks Host (10.106.254.200), Port, Username (root), the key path (~/.ssh/agent_worker_deploy) and ProxyJump (ovh-itms) to the values in ~/.ssh/config and greys them out; that is inherited, not broken. Authentication must be SSH Key: the form defaults to Agent because ~/.ssh/config has a global IdentityAgent line for 1Password, and that agent does not hold the worker's deploy key, so Agent fails with SSH Connection Error. The jump hop uses the system ssh and its own key. Verified working 4 Sep 2026 after switching to SSH Key. Remote project on this machine: /srv/repos/odoo_itms_apps.


## Timeline

- time: 2026-09-04T19:52:26
  kind: decision
  summary: "Created this page: Machine agent-worker: pick the SSH Config host and SSH Key auth, not Agent"
  source: session 2026-09-04
  affects: [reference-machine-agent-worker]

- time: 2026-09-04T19:52:26
  kind: decision
  summary: "agent-worker machine works with SSH Config host + SSH Key auth; Agent auth fails"
  source: brain update-truth
  affects: [reference-machine-agent-worker]

---
id: decision-provider-rename-keeps-id
title: "The Hermes provider is shown as ITMS CoWorker; its id and binary name stay hermes"
category: decision
status: active
tags: [branding, providers]
created: "2026-09-04T19:33:04"
updated: "2026-09-04T19:33:04"
---

<!-- compiled_truth -->
Renaming only metadata.name (and description, website, icon alt) in packages/plugins/src/agents/impl/hermes/index.ts changes every picker, tooltip and status card, because the renderer reads agent.name generically. The id 'hermes', hostDependency.id and binaryNames stay, so detection on PATH, ACP mode ('hermes acp') and session resume are untouched. App PRODUCT_NAME is 'ITMS CoWorker'; USER_DATA_DIR_NAME is deliberately unchanged so the dev database stays put.


## Timeline

- time: 2026-09-04T19:33:04
  kind: decision
  summary: "Created this page: The Hermes provider is shown as ITMS CoWorker; its id and binary name stay hermes"
  source: session 2026-09-04
  affects: [decision-provider-rename-keeps-id]

- time: 2026-09-04T19:33:04
  kind: decision
  summary: "rename display only; id/binary unchanged"
  source: brain update-truth
  affects: [decision-provider-rename-keeps-id]

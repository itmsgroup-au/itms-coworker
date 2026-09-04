---
id: decision-collapsed-tool-calls
title: Tool calls fold into one collapsed line above the answer
category: decision
status: active
tags: [chat-ui, transcript]
created: "2026-09-04T20:12:22"
updated: "2026-09-04T20:12:22"
---

<!-- compiled_truth -->
Mark, 4 Sep 2026: hide code and thinking by default behind an arrow, then one larger collapse above all the commands. Where it lives: packages/chat-ui execute.def.tsx collapsedMaxLines 0 (a collapsed command card is its header only; body gated on bodyH > 0 so no sliver leaks), and packages/core item-fold.ts wrapReadGroups now folds consecutive read-tool-call and execute-tool-call items into one tool-group labelled '<n> file reads, <m> commands' (groupKind tool-batch; reads-only runs keep read-batch). A search or other tool between them breaks the run. Thinking rows were already collapsed upstream. The upstream test 'does not group non-contiguous read tool calls' encoded the old rule and was replaced.


## Timeline

- time: 2026-09-04T20:12:22
  kind: decision
  summary: "Created this page: Tool calls fold into one collapsed line above the answer"
  source: "Mark, session 2026-09-04"
  affects: [decision-collapsed-tool-calls]

- time: 2026-09-04T20:12:22
  kind: decision
  summary: "commands collapse to a header; reads+commands fold into one group line"
  source: brain update-truth
  affects: [decision-collapsed-tool-calls]

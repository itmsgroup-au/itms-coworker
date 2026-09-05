---
id: decision-tasks-helpdesk-first
title: "Tasks: Odoo Helpdesk is the first business workspace, a ticket is the unit of work"
category: decision
status: active
tags: [helpdesk, odoo, tasks, ux]
created: "2026-09-05T07:28:26"
updated: "2026-09-05T07:28:26"
---

<!-- compiled_truth -->
Mark (5 Sep 2026): ITMS CoWorker is not a developer workspace with Odoo bolted on. Odoo Helpdesk is the primary business workspace. Emdash stays the execution engine, Odoo is the business context, the agents (ITMS CoWorker, Claude Code, ...) are assignable workers, a ticket is the unit of work, a project is the worker's computer, skills decide what the worker may do. First cut shipped 5 Sep: sidebar item Tasks (above Search) opens the Helpdesk page for the default Odoo server, a team overview like Odoo's landing page, and the All tickets list grouped by team then assignee with an Agent column. Assigning creates an Emdash task in the chosen project with the ticket as the first prompt and shows the live status on the row. Assignments live in the helpdesk settings key. Read-only against Odoo on purpose: the worker uses atlas odoo for anything further and asks before writing. Also: no GitHub sign-in on first launch; GitHub stays an optional integration. Next: ticket detail pane, related information, status bar, write-back of the result to the ticket, and the sidebar layout Mark sketched (Home, Today, Tasks, Work, AI, then Search, Automations, Settings).


## Timeline

- time: 2026-09-05T07:28:26
  kind: decision
  summary: "Created this page: Tasks: Odoo Helpdesk is the first business workspace, a ticket is the unit of work"
  source: "Mark, 5 Sep 2026"
  affects: [decision-tasks-helpdesk-first]

- time: 2026-09-05T07:28:26
  kind: decision
  summary: "Helpdesk page under Tasks; ticket -> agent -> Emdash task; read-only Odoo"
  source: brain update-truth
  affects: [decision-tasks-helpdesk-first]

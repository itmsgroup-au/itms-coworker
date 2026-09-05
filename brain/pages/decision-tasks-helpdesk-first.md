---
id: decision-tasks-helpdesk-first
title: "Tasks: Odoo Helpdesk is the first business workspace, a ticket is the unit of work"
category: decision
status: active
tags: [helpdesk, odoo, tasks, ux]
created: "2026-09-05T07:28:26"
updated: "2026-09-05T07:44:10"
---

<!-- compiled_truth -->
Mark (5 Sep 2026): ITMS CoWorker is not a developer workspace with Odoo bolted on. Odoo Helpdesk is the primary business workspace. Emdash stays the execution engine, Odoo is the business context, the agents (ITMS CoWorker, Claude Code, ...) are assignable workers, a ticket is the unit of work, a project is the worker's computer, skills decide what the worker may do. Shipped 5 Sep: sidebar group Tasks with Helpdesk and the open count; team overview like Odoo's landing page; All tickets list grouped by team then assignee with an Agent column that creates an Emdash task in the chosen project with the ticket as the first prompt and shows the live status on the row. Later the same day, after Mark said he needs to read the thread before deciding: click a ticket and the right pane shows Thread (description and chatter, internal notes marked), Customer (contact, other open tickets, previous tickets) and Agent (status, live steps read from the task transcript, latest agent message, and Add note, which writes an internal note to the ticket pre-filled with that message). That note is the app's only Odoo write; everything else is read-only and the worker uses atlas odoo with a confirmation. A bottom status bar on every view lists agents on tickets. No GitHub sign-in on first launch. Renderer errors now land in emdash.log because a white screen had left no trace. Next: related mail, files and RMM for the customer; Today and Home; named workers with skill sets.


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

- time: 2026-09-05T07:44:10
  kind: decision
  summary: "Helpdesk under Tasks; split pane with thread, customer, agent output and note write-back; status bar"
  source: brain update-truth
  affects: [decision-tasks-helpdesk-first]

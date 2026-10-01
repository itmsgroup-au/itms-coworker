import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ChatFolder } from '../api';

const execFileAsync = promisify(execFile);

const AGENTS_MD = `# ITMS CoWorker: general chat

This folder is where general chats run: questions and jobs that are not tied to a
ticket or a code project. Keep anything you create here small and say where it is.

## Reaching ITMS systems: the atlas CLI

atlas is installed on this machine and holds every credential through 1Password.

    atlas find "<the job>" --json     the few commands that do a job, with an example
    atlas commands --json             the whole command tree, with read/write labels
    atlas <family> --help             what one family can do

Read freely. Ask before any command whose label says it writes, and always before
anything destructive, sending email, or changing a customer system.
`;

/**
 * The folder general chats run in. A git repository because a task needs a
 * repository workspace; the one commit holds only AGENTS.md.
 */
export async function prepareChatFolder(): Promise<ChatFolder> {
  const dir = path.join(os.homedir(), 'ITMS CoWorker', 'chat');
  let created = false;
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    created = true;
  }
  const agentsPath = path.join(dir, 'AGENTS.md');
  try {
    await fs.access(agentsPath);
  } catch {
    await fs.writeFile(agentsPath, AGENTS_MD);
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  }
  try {
    await fs.access(path.join(dir, '.git'));
  } catch {
    await execFileAsync('git', ['init', '-q'], { cwd: dir });
    await execFileAsync('git', ['add', '-A'], { cwd: dir });
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=ITMS CoWorker',
        '-c',
        'user.email=coworker@itmsgroup.com.au',
        'commit',
        '-q',
        '-m',
        'General chat folder',
      ],
      { cwd: dir }
    );
  }
  return { path: dir, name: 'Chat', created };
}

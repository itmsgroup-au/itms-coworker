import { Badge, Button } from '@emdash/ui/react/primitives';
import { FolderOpen, Plug, Trash2 } from 'lucide-react';
import type { OdooProfileSummary } from '@core/features/odoo/api';

/** How the last connection test for one profile ended. */
export type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'done'; text: string; ok: boolean };

/**
 * What the last "Project" run put in the generated folder's `.mcp.json`.
 *
 * `undefined` means the folder has not been prepared in this session, so we say
 * nothing. `server: null` means the folder was prepared but no Odoo MCP server
 * was found, and agents there fall back to the atlas command line.
 */
export type McpState = { server: string | null };

type Props = {
  profile: OdooProfileSummary;
  isDefault: boolean;
  disabled: boolean;
  test: TestState;
  mcp: McpState | undefined;
  onOpenProject: () => void;
  onTest: () => void;
  onRemove: () => void;
};

/**
 * One Odoo server in the list, with its connection and agent-tooling status.
 *
 * The row is read-only on purpose: everything shown here came from the
 * 1Password item, so there is nothing here for a person to hand-edit.
 */
export function OdooProfileRow({
  profile,
  isDefault,
  disabled,
  test,
  mcp,
  onOpenProject,
  onTest,
  onRemove,
}: Props) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {profile.name}
          <span className="ml-2 text-xs text-foreground-passive">
            {profile.url} · {profile.db} · {profile.user}
            {profile.odooVersion ? ` · Odoo ${profile.odooVersion}` : ''}
          </span>
        </span>
        {isDefault && <Badge>default</Badge>}
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onOpenProject}>
          <FolderOpen className="size-4" />
          Project
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || test.state === 'testing'}
          onClick={onTest}
        >
          <Plug className="size-4" />
          {test.state === 'testing' ? 'Testing…' : 'Test'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          icon
          className="size-7 shrink-0 text-foreground-muted"
          disabled={disabled}
          aria-label={`Remove ${profile.name}`}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {profile.description && (
        <div className="text-xs text-foreground-passive">{profile.description}</div>
      )}
      {test.state === 'testing' && (
        <div className="text-xs text-foreground-passive">Checking the connection…</div>
      )}
      {test.state === 'done' && (
        <div className={test.ok ? 'text-xs text-foreground-muted' : 'text-destructive text-xs'}>
          {test.text}
        </div>
      )}
      {mcp && <McpLine server={mcp.server} />}
    </div>
  );
}

/** One plain line saying what an agent in the prepared folder can reach. */
function McpLine({ server }: { server: string | null }) {
  if (!server) {
    return (
      <div className="text-xs text-foreground-muted">
        Agents in this folder use the atlas command line.
      </div>
    );
  }
  return (
    <div className="text-xs text-foreground-muted">
      Agents in this folder can query Odoo directly.
      <span className="ml-2 text-[10px] text-foreground-passive">{server}</span>
    </div>
  );
}

import { Button } from '@emdash/ui/react/primitives';
import { RefreshCw, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';

export function PageHeader({
  title,
  subtitle,
  onRefresh,
  refreshing,
  right,
}: {
  title: string;
  subtitle: string;
  onRefresh: () => void;
  refreshing: boolean;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="truncate text-xs text-foreground-muted">{subtitle}</div>
      </div>
      {right}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh"
      >
        <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
      </Button>
    </div>
  );
}

export function ErrorLine({ error }: { error: Error }) {
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
      {error.message}
    </div>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Workflow className="size-8 text-foreground-muted" />
      <div className="text-base font-medium">{title}</div>
      <div className="max-w-md text-sm text-foreground-muted">{body}</div>
      {action}
    </div>
  );
}

/** Odoo hands back `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker. */
export function formatWhen(value: string): string {
  if (!value) return '';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Pretty-print a JSON payload; leave anything that is not JSON alone. An empty
 * object or list comes back as an empty string so the panel drops the box.
 */
export function formatPayload(raw: string): string {
  if (!raw.trim()) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null) return '';
    if (Array.isArray(parsed) && parsed.length === 0) return '';
    if (typeof parsed === 'object' && Object.keys(parsed).length === 0) return '';
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

import type { OdooError, OdooErrorKind, OdooResult } from '../api/contract';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Every failure raised inside the Odoo slice carries a kind. `message` stays the
 * human-readable text the UI already prints, so `testConnection`'s existing
 * `{ ok: false, error: string }` shape is unchanged.
 */
export class OdooCallError extends Error {
  readonly kind: OdooErrorKind;

  constructor(kind: OdooErrorKind, message: string) {
    super(message);
    this.name = 'OdooCallError';
    this.kind = kind;
  }
}

/** Odoo says "Access Denied" for a bad login and "Access Error" for a bad ACL. */
export function classifyOdooFault(message: string): OdooErrorKind {
  if (/access denied|invalid (password|api key|credentials)|login refused/i.test(message)) {
    return 'auth';
  }
  if (/session expired|expired session/i.test(message)) return 'auth';
  if (
    /access error|you are not allowed|not allowed to (access|read|write|create|unlink)/i.test(
      message
    )
  ) {
    return 'access-denied';
  }
  return 'odoo';
}

export function classifyTransport(error: unknown): OdooErrorKind {
  const name = (error as { name?: string }).name ?? '';
  const code = String((error as { code?: string }).code ?? '');
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'AbortError' || /abort|timed? ?out/i.test(message) || code === 'ETIMEDOUT') {
    return 'timeout';
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|CERT_/i.test(code) ||
    /fetch failed|network|socket hang up|certificate/i.test(message)
  ) {
    return 'network';
  }
  return 'unknown';
}

/** Normalise anything thrown anywhere in this slice into the wire error union. */
export function toOdooError(error: unknown): OdooError {
  if (error instanceof OdooCallError) return { kind: error.kind, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  const transport = classifyTransport(error);
  if (transport !== 'unknown') return { kind: transport, message };
  const fault = classifyOdooFault(message);
  return { kind: fault === 'odoo' ? 'unknown' : fault, message };
}

/** Run a service call and hand back the wire result envelope instead of throwing. */
export async function odooResult<T>(run: () => Promise<T>): Promise<OdooResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, error: toOdooError(error) };
  }
}

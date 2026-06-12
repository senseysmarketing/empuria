// Client-side helper to report runtime errors to the server and trigger a
// one-time reload when a stale browser tab fails to load a freshly-published
// chunk.

import { reportClientError } from "./client-errors.functions";

const RELOAD_KEY = "__empuria_chunk_reload_at";
const RELOAD_WINDOW_MS = 60_000;

function isChunkLoadError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch dynamically imported module") ||
    m.includes("importing a module script failed") ||
    m.includes("loading chunk") ||
    m.includes("loading css chunk") ||
    m.includes("dynamically imported module") ||
    m.includes("error loading dynamically imported")
  );
}

function tryReloadOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? "0");
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function reportError(
  scope: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message || "unknown error";

  if (isChunkLoadError(message) && tryReloadOnce()) return;

  const payload = {
    scope,
    message: message.slice(0, 2000),
    stack: err.stack ? err.stack.slice(0, 8000) : null,
    url: window.location.href.slice(0, 2000),
    user_agent: navigator.userAgent.slice(0, 1000),
    app_version: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? null,
    extra: extra ?? null,
  };

  // Fire-and-forget; never throw from the reporter itself.
  reportClientError({ data: payload }).catch((e) => {
    console.warn("[client-error-reporter] failed to report", e);
  });
}

let installed = false;
export function installGlobalErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const err = (event as ErrorEvent).error ?? new Error(event.message);
    reportError("window.error", err, {
      filename: (event as ErrorEvent).filename,
      lineno: (event as ErrorEvent).lineno,
      colno: (event as ErrorEvent).colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportError("window.unhandledrejection", (event as PromiseRejectionEvent).reason);
  });
}

export type ImpersonationState = {
  targetUserId: string;
  targetName: string | null;
  startedAt: string;
};

const STORAGE_KEY = "empuria.impersonation";

export function getImpersonationState(): ImpersonationState | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ImpersonationState>;
    if (!parsed.targetUserId || !parsed.startedAt) return null;
    return {
      targetUserId: parsed.targetUserId,
      targetName: parsed.targetName ?? null,
      startedAt: parsed.startedAt,
    };
  } catch {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function startImpersonation(targetUserId: string, targetName: string | null) {
  if (typeof window === "undefined") return;
  const state: ImpersonationState = {
    targetUserId,
    targetName,
    startedAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event("empuria:impersonation-change"));
}

export function stopImpersonation() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("empuria:impersonation-change"));
}

export function getImpersonatedUserIdHeader() {
  return getImpersonationState()?.targetUserId ?? null;
}

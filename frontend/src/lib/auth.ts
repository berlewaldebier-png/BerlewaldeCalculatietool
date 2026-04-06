export type AuthSession = {
  username: string;
  display_name: string;
  role: string;
};

export function readAuthSession(): AuthSession | null {
  // Auth is cookie-based; the server is the source of truth.
  return null;
}

export function writeAuthSession(_: AuthSession) {
  // no-op (cookie-based auth)
}

export function clearAuthSession() {
  // Consumers should call /auth/logout; kept for compatibility in UI components.
  window.dispatchEvent(new Event("calculatietool-auth-changed"));
}

export async function fetchMe(): Promise<AuthSession | null> {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as any;
  if (!payload?.authenticated) {
    return null;
  }
  return {
    username: String(payload.username ?? ""),
    display_name: String(payload.display_name ?? ""),
    role: String(payload.role ?? "")
  };
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.dispatchEvent(new Event("calculatietool-auth-changed"));
  }
}

import type { ReactNode } from "react";

import { apiGetServer } from "@/lib/apiServer";
import type { MeResponse } from "@/lib/apiShared";

type AuthGateProps = {
  children: ReactNode;
};

export async function AuthGate({ children }: AuthGateProps) {
  await apiGetServer<MeResponse>("/auth/me", "/");
  return <>{children}</>;
}

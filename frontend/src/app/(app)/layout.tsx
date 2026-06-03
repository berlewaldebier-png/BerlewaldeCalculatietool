import { AuthGate } from "@/components/AuthGate";
import { DashboardHeader } from "@/components/DashboardHeader";

export default function AppLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="app-shell">
      <AuthGate>
        <div className="app-main app-main-header">
          <DashboardHeader />
        </div>
        <main className="app-main">{children}</main>
      </AuthGate>
    </div>
  );
}

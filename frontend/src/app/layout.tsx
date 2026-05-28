import type { Metadata } from "next";
import "./globals.css";
import { DashboardHeader } from "@/components/DashboardHeader";
import { AuthGate } from "@/components/AuthGate";


export const metadata: Metadata = {
  title: "Brouwerij Calculatie",
  description: "Interne calculatie- en offerteomgeving"
};


export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body>
        <div className="app-shell">
          <div className="app-main">
            <DashboardHeader />
          </div>
          <AuthGate>
            <main className="app-main">{children}</main>
          </AuthGate>
        </div>
      </body>
    </html>
  );
}

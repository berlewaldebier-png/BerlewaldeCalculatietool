import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/AppHeader";
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
          <AppHeader />
          <AuthGate>
            <main className="app-main">{children}</main>
          </AuthGate>
        </div>
      </body>
    </html>
  );
}

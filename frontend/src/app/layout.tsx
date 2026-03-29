import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "CalculatieTool",
  description: "Nieuwe webinterface voor kostprijzen, verkoopstrategie en prijsvoorstellen."
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
          <header className="app-header">
            <div>
              <div className="app-brand">Berlewalde CalculatieTool</div>
              <div className="app-tagline">
                Nieuwe webinterface met behoud van bestaande Python-berekeningen
              </div>
            </div>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";


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
        {children}
      </body>
    </html>
  );
}

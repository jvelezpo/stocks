import type { Metadata } from "next";
import { MarketTimeZoneProvider } from "../components/MarketTimeZoneContext";
import { SiteFooter } from "../components/SiteFooter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stocks Dashboard",
  description: "A dashboard for stock quote history, documents, and analysis stored in Turso.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <MarketTimeZoneProvider>
          {children}
          <SiteFooter />
        </MarketTimeZoneProvider>
      </body>
    </html>
  );
}

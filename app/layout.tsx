import type { Metadata } from "next";
import Link from "next/link";
import { AuthNav } from "../components/AuthNav";
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
          <header className="bg-[#161615] text-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 sm:px-8 lg:px-10">
              <Link className="text-sm font-semibold tracking-wide" href="/">
                Signal Desk
              </Link>
              <AuthNav />
            </div>
          </header>
          {children}
          <SiteFooter />
        </MarketTimeZoneProvider>
      </body>
    </html>
  );
}

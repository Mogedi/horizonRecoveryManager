import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BulkVerifyProvider } from "@/lib/context/bulk-verify-context";
import { BulkHubspotCheckProvider } from "@/lib/context/bulk-hubspot-check-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Horizon Manager",
  description: "Horizon Recovery Operations Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* CSS Custom Highlight API styling for search results (see search-highlight.ts). Injected as a
            raw <style> so the browser parses ::highlight() natively — Turbopack's CSS parser rejects it
            in globals.css and logs a parse warning. React 19 hoists this to <head>. */}
        <style dangerouslySetInnerHTML={{ __html: '::highlight(search-hl){background-color:#fef08a;color:#78350f}' }} />
        <BulkVerifyProvider>
          <BulkHubspotCheckProvider>{children}</BulkHubspotCheckProvider>
        </BulkVerifyProvider>
      </body>
    </html>
  );
}

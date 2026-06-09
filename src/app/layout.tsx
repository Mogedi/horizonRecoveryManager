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
        <BulkVerifyProvider>
          <BulkHubspotCheckProvider>{children}</BulkHubspotCheckProvider>
        </BulkVerifyProvider>
      </body>
    </html>
  );
}

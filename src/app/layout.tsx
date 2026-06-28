import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ПЛ — Упаковка",
  description: "Парфюм Логистик — система упаковки товаров для маркетплейсов (Wildberries, Ozon)",
  keywords: ["Парфюм Логистик", "упаковка", "маркетплейс", "Wildberries", "Ozon", "склад"],
  authors: [{ name: "Парфюм Логистик" }],
  icons: {
    icon: "/pwa/assets/icon-512.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

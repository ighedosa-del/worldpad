import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/error-boundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Worldpad — Trading Research Lab",
  description: "Advanced Deriv digit trading AI platform with bot builder, analysis tools, and live market data.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased wp-noise`}
        style={{
          background: 'radial-gradient(ellipse at 50% 0%, rgba(10, 36, 99, 0.15) 0%, transparent 60%), #0d1117',
          backgroundAttachment: 'fixed',
        }}
      >
        {/* FIX #4: Error boundary wraps the entire app to prevent white-screen crashes */}
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OrganizerHub Admin",
  description: "OrganizerHub organizer dashboard",
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
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <nav className="flex items-center gap-6">
              <Link
                href="/events"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition"
              >
                Events
              </Link>
              <Link
                href="/labels"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition"
              >
                Labels
              </Link>
              <Link
                href="/requests"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition"
              >
                Waitlist
              </Link>
              <Link
                href="/transactions"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition"
              >
                Transactions
              </Link>
            </nav>
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              Admin
            </span>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}

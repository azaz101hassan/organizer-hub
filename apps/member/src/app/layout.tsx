import type { Metadata } from "next";
import {
  Cormorant_Garamond,
  Hanken_Grotesk,
  Spectral,
  Space_Grotesk,
  Spline_Sans_Mono,
} from "next/font/google";
import { readThemeCookie } from "@organizer-hub/web-shared/ui/theme";
import { ToastProvider } from "@organizer-hub/web-shared/ui";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cormorant",
  display: "swap",
});
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});
const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-spectral",
  display: "swap",
});
const spaceGrot = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-spline-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "OrganizerHub", template: "%s · OrganizerHub" },
  description:
    "One pane of glass for event organizers — and a membership that opens the door.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await readThemeCookie("oh_member_theme", "atrium");
  const fontVars = [cormorant, hanken, spectral, spaceGrot, splineMono]
    .map((f) => f.variable)
    .join(" ");
  return (
    <html lang="en" data-theme={theme} className={`${fontVars} h-full`}>
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}

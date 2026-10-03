import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const plex = localFont({
  src: [
    {
      path: "./fonts/ibm-plex-sans-regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans-medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/ibm-plex-sans-semibold.ttf",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-ibm-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kargo · Media planner",
  description:
    "An evidence-led media recommendation workspace for strategists.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={plex.variable}>{children}</body>
    </html>
  );
}

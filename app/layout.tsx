import "./globals.css";
import type { Metadata, Viewport } from "next";
import { DatasetProvider } from "./context/DatasetContext";

export const metadata: Metadata = {
  title: "ODE — Ofiles Data Engine",
  description: "Instant insight. Zero setup.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#ef4444",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DatasetProvider>{children}</DatasetProvider>
      </body>
    </html>
  );
}

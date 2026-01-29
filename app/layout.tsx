import "./globals.css";
import { DatasetProvider } from "./context/DatasetContext";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <DatasetProvider>
          {children}
        </DatasetProvider>
      </body>
    </html>
  );
}

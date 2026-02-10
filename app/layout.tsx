import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "discorg",
  description: "Discord documentation gap analyzer",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "Context Closure",
  description: "Optimal closure driven documentation context builder",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

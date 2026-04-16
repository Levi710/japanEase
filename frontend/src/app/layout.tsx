import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "japanEase AI - Learn Japanese From Any Video",
  description: "AI-powered subtitle generator with furigana, Hindi translation, and interactive dictionary for Japanese language learning.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import SearchPanelWrapper from "@/components/SearchPanelWrapper";

export const metadata: Metadata = {
  title: "BlinkCore — Knowledge Base",
  description: "Technical knowledge base with semantic search",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <SearchPanelWrapper />
      </body>
    </html>
  );
}
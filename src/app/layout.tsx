import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Viz",
  description: "Codex sessions 可视化（本地）"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-zinc-50 text-zinc-900">
        <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
      </body>
    </html>
  );
}


import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "织梦AI小说",
    template: "%s · 织梦AI小说"
  },
  description: "在纸间宇宙，写出你的理想世界。"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}

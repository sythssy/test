import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "登录",
  description: "使用通行证密钥登录织梦AI小说。"
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

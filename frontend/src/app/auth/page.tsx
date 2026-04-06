"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AuthPage() {
  const router = useRouter();
  const [licenseKey, setLicenseKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: licenseKey })
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) {
        setMessage({ text: json.message || "验证失败" });
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setMessage({ text: "网络异常，请重试。" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#050508] px-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.35), transparent),
            radial-gradient(ellipse 60% 40% at 100% 100%, rgba(139, 92, 246, 0.2), transparent)
          `
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-10 text-center">
          <p className="text-[10px] tracking-[0.3em] text-indigo-300/80">通行证入口</p>
          <h1 className="mt-3 bg-gradient-to-br from-white via-indigo-100 to-violet-300/90 bg-clip-text font-semibold tracking-tight text-transparent">
            系统通行证
          </h1>
          <p className="mt-2 text-xs text-slate-500">认码不认人 · 无邮箱 · 无手机</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-indigo-500/20 bg-slate-950/80 p-8 shadow-[0_0_40px_-10px_rgba(99,102,241,0.5)] backdrop-blur-md"
        >
          <label htmlFor="license" className="sr-only">
            通行证
          </label>
          <Input
            id="license"
            name="license"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="请输入系统通行证"
            className="h-12 border-indigo-500/30 bg-black/40 font-mono text-sm text-indigo-100 placeholder:text-slate-600 focus-visible:ring-indigo-400/60"
          />

          {message ? (
            <p
              className={`mt-4 rounded-lg px-3 py-2 text-center text-xs ${
                message.ok
                  ? "bg-emerald-950/80 text-emerald-300"
                  : "bg-rose-950/60 text-rose-300"
              }`}
            >
              {message.text}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={loading || !licenseKey.trim()}
            size="lg"
            className="mt-6 w-full bg-gradient-to-r from-indigo-600 to-violet-600 font-medium text-white shadow-lg shadow-indigo-900/40 hover:from-indigo-500 hover:to-violet-500"
          >
            {loading ? (
              <span className="font-mono text-xs">校验中…</span>
            ) : (
              "验证并进入"
            )}
          </Button>
        </form>

        <p className="mt-8 text-center text-[10px] leading-relaxed text-slate-600">
          会话加密 · 无密码登录 · 认码不认人
        </p>
      </div>
    </main>
  );
}

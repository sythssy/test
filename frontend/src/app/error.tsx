"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center">
        <p className="text-5xl font-bold text-rose-200">500</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-800">服务出现了问题</h1>
        <p className="mt-2 text-sm text-slate-500">
          {error.message || "发生了未知错误，请稍后重试。"}
        </p>
        {error.digest ? (
          <p className="mt-1 font-mono text-xs text-slate-400">错误码：{error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white"
        >
          重试
        </button>
      </section>
    </main>
  );
}

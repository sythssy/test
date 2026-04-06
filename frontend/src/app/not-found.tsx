import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-5xl font-bold text-slate-300">404</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-800">页面不存在</h1>
        <p className="mt-2 text-sm text-slate-500">你访问的页面已不存在或地址有误。</p>
        <Link
          href="/dashboard"
          className="mt-5 inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white"
        >
          回到作品库
        </Link>
      </section>
    </main>
  );
}

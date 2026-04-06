import Link from "next/link";
import { AppealForm } from "@/components/appeal-form";
import { getCurrentUserProfile } from "@/lib/auth";

export default async function ForbiddenPage() {
  const profile = await getCurrentUserProfile();
  const isBanned = profile?.status === "banned";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-xl font-semibold">
          {isBanned ? "账号已被封禁" : "无权限访问"}
        </h1>
        <p className="text-sm text-slate-600">
          {isBanned
            ? "你的账号因违规操作已被系统封禁，如有异议可提交申诉。"
            : "当前账号没有访问该页面的权限。"}
        </p>
        {isBanned ? (
          <AppealForm />
        ) : (
          <Link
            href="/dashboard"
            className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
          >
            返回作品库
          </Link>
        )}
      </section>
    </main>
  );
}

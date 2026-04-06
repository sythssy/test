import { cache } from "react";
import { redirect } from "next/navigation";
import { internalRequest } from "@/lib/server/internal-api";
import type { DbUserProfile } from "@/lib/types";

type MeApiResponse =
  | { ok: true; profile: DbUserProfile }
  | { ok: false; error_code?: string; message?: string };

/**
 * 通过 `/api/me` 获取资料（RSC / Server Action 不直连数据库）。
 * 使用 React cache 同请求内去重。
 */
export const getCurrentUserProfile = cache(async (): Promise<DbUserProfile | null> => {
  const res = await internalRequest("/api/me");
  if (res.status === 401) return null;
  const json = (await res.json()) as MeApiResponse;
  if (!json.ok || !("profile" in json) || !json.profile) return null;
  return json.profile;
});

export async function requireAuth() {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    redirect("/auth");
  }
  if (profile.status === "banned") {
    redirect("/forbidden");
  }
  return profile;
}

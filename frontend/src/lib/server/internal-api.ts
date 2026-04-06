import { cookies, headers } from "next/headers";

/**
 * RSC / Server Action 调用同源 API 时转发 Cookie（页面与 Server Action 禁止直连 Supabase）。
 */
export async function getInternalOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  const fallback = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fallback) return fallback;
  return "http://localhost:3000";
}

export async function internalRequest(path: string, init?: RequestInit): Promise<Response> {
  const origin = await getInternalOrigin();
  const url = path.startsWith("/") ? `${origin}${path}` : `${origin}/${path}`;
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");
  const merged = new Headers(init?.headers);
  if (cookieHeader) merged.set("Cookie", cookieHeader);
  return fetch(url, {
    ...init,
    headers: merged,
    cache: "no-store"
  });
}

export async function internalJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await internalRequest(path, init);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

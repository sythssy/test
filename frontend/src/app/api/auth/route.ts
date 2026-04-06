import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import {
  licenseToShadowEmail,
  shadowPasswordFromLicense,
  validateLicenseKeyForAuth
} from "@/lib/shadow-auth";

/**
 * Shadow Auth：POST { "license_key": "..." }
 * 仅通行证登录：新用户必须用 SUPABASE_SERVICE_ROLE_KEY 静默建号（无邮箱/手机注册）。
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { license_key?: string } | null;
  const licenseRaw = typeof body?.license_key === "string" ? body.license_key : "";
  const validation = validateLicenseKeyForAuth(licenseRaw);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, message: validation.message }, { status: 400 });
  }

  const license = licenseRaw.trim();
  const email = licenseToShadowEmail(license);
  const password = shadowPasswordFromLicense(license);

  let response = NextResponse.json({ ok: true, message: "已进入系统" });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, { ...options, path: options.path ?? "/" });
          }
        }
      }
    }
  );

  const first = await supabase.auth.signInWithPassword({ email, password });
  if (!first.error) {
    return response;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "服务端未配置 SUPABASE_SERVICE_ROLE_KEY，无法开通新通行证。请在环境变量中配置 Supabase 服务角色密钥后重启。"
      },
      { status: 503 }
    );
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { error: adminErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { shadow_license: true }
  });
  const adminMsg = adminErr?.message?.toLowerCase?.() ?? "";
  if (adminErr && !adminMsg.includes("already") && !adminMsg.includes("registered")) {
    return NextResponse.json(
      { ok: false, message: adminErr.message || "开通通行证失败" },
      { status: 400 }
    );
  }

  const second = await supabase.auth.signInWithPassword({ email, password });
  if (second.error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          second.error.message.includes("Invalid login credentials") ||
          second.error.message.includes("invalid")
            ? "通行证不存在或错误。"
            : second.error.message
      },
      { status: 401 }
    );
  }

  return response;
}

export async function GET() {
  return NextResponse.json({ ok: false, message: "Method Not Allowed" }, { status: 405 });
}

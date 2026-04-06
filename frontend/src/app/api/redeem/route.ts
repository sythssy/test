import { NextResponse } from "next/server";
import { readSessionProfile } from "@/lib/server/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RedeemRpcResult = {
  ok?: boolean;
  error_code?: string;
  added_flash_words?: number;
  added_pro_words?: number;
  added_workflow?: number;
};

export async function POST(request: Request) {
  const profile = await readSessionProfile();
  if (!profile) {
    return NextResponse.json(
      { ok: false, error_code: "UNAUTHORIZED", message: "请先登录后再兑换激活码。" },
      { status: 401 }
    );
  }
  if (profile.status === "banned") {
    return NextResponse.json(
      { ok: false, error_code: "FORBIDDEN", message: "账号已封禁，无法兑换。" },
      { status: 403 }
    );
  }

  let body: { code?: string };
  try {
    body = (await request.json()) as { code?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error_code: "BAD_REQUEST", message: "请求格式错误。" },
      { status: 400 }
    );
  }

  const code = String(body.code ?? "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json(
      { ok: false, error_code: "BAD_REQUEST", message: "请填写激活码。" },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient();

  // 优先用新表 redeem_codes（use_redeem_code）；若码不存在则回退旧表 cdk_codes（redeem_cdk）兼容历史码
  const { data: newData, error: newErr } = await supabase.rpc("use_redeem_code", {
    p_code: code,
    p_user_id: profile.id
  });

  // RPC 函数不存在（尚未执行 day32 脚本）时 newErr 会是非空；也会在 CODE_NOT_FOUND 时 ok=false
  const newResult = newData as RedeemRpcResult | null;

  if (!newErr && newResult?.ok) {
    return NextResponse.json({
      ok: true,
      added_flash_words: newResult.added_flash_words ?? 0,
      added_pro_words: newResult.added_pro_words ?? 0,
      added_workflow: newResult.added_workflow ?? 0
    });
  }

  if (!newErr && newResult && !newResult.ok && newResult.error_code !== "CODE_NOT_FOUND") {
    // 码存在但已使用或无效
    const ec = newResult.error_code;
    if (ec === "CODE_ALREADY_USED") {
      return NextResponse.json({ ok: false, error_code: ec, message: "激活码已被使用，每码限用一次。" }, { status: 400 });
    }
    if (ec === "CODE_INVALID") {
      return NextResponse.json({ ok: false, error_code: ec, message: "激活码数据异常，请联系管理员。" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error_code: ec ?? "UNKNOWN", message: "兑换失败，请稍后重试。" }, { status: 400 });
  }

  // 新表未找到 → 回退 cdk_codes（兼容历史码）
  const { data: legData, error: legErr } = await supabase.rpc("redeem_cdk", {
    p_code: code,
    p_user_id: profile.id
  });

  if (legErr) {
    return NextResponse.json(
      { ok: false, error_code: "INTERNAL_ERROR", message: "兑换失败，请稍后重试。" },
      { status: 500 }
    );
  }

  const legResult = legData as RedeemRpcResult;
  if (!legResult?.ok) {
    const ec = legResult?.error_code;
    if (ec === "CDK_NOT_FOUND" || ec === "CODE_NOT_FOUND") {
      return NextResponse.json({ ok: false, error_code: ec, message: "激活码无效，请确认后重新输入。" }, { status: 400 });
    }
    if (ec === "CDK_ALREADY_USED" || ec === "CODE_ALREADY_USED") {
      return NextResponse.json({ ok: false, error_code: ec, message: "激活码已被使用，每码限用一次。" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error_code: ec ?? "UNKNOWN", message: "兑换失败。" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    added_flash_words: legResult.added_flash_words ?? 0,
    added_pro_words: legResult.added_pro_words ?? 0,
    added_workflow: legResult.added_workflow ?? 0
  });
}

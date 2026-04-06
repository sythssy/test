export type WritingToolResponseJson = {
  ok?: boolean;
  answer?: string;
  error_code?: string;
  message?: string;
  billing?: { detail?: string };
};

export type WritingToolResult =
  | { ok: true; answer: string; billingDetail?: string }
  | { ok: false; error_code?: string; message: string };

export async function fetchWritingTool(body: {
  tool: string;
  bookId: string;
  model_key: string;
  fields: Record<string, string>;
}): Promise<WritingToolResult> {
  try {
    const res = await fetch("/api/ai/writing-tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = (await res.json()) as WritingToolResponseJson;
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error_code: json.error_code,
        message: json.message || "生成失败，请重试。"
      };
    }
    return {
      ok: true,
      answer: json.answer || "",
      billingDetail: json.billing?.detail
    };
  } catch {
    return { ok: false, message: "网络异常，请重试。" };
  }
}

export function messageForWritingToolFailure(result: Extract<WritingToolResult, { ok: false }>) {
  const code = result.error_code;
  if (code === "INSUFFICIENT_BALANCE") return result.message || "字数额度不足。";
  if (code === "DAILY_OUTPUT_CAP") return result.message || "本日生成已达上限，请明日再试。";
  if (code === "QUOTA_ADMIN_HOLD") return result.message || "账号已临时限制 AI 生成，请联系管理员。";
  if (code === "BILLING_UNAVAILABLE") return result.message || "计费服务暂时不可用，请稍后再试或联系管理员。";
  if (code === "UNAUTHORIZED") return "登录已失效。";
  if (code === "FORBIDDEN") return result.message || "请求被拒绝。";
  if (code === "BAD_REQUEST") return result.message || "请求参数不正确。";
  if (code === "MODEL_NOT_FOUND" || code === "MODEL_ACTION_MISMATCH") {
    return result.message || "当前模型不适用该工具，或无可用的写作工具模型，请在后台配置 writing_tools_default / default。";
  }
  if (code === "PROMPT_NOT_FOUND" || code === "PROMPT_INACTIVE") {
    return result.message || "该生成器未配置或未启用提示词，请联系管理员。";
  }
  return result.message || "生成失败，请重试。";
}

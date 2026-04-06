/**
 * Dify 服务端调用封装
 * 注意：这里的配置只允许在服务端读取，绝不暴露到前端。
 */
export type DifyErrorCode = "DIFY_TIMEOUT" | "RATE_LIMITED" | "DIFY_BAD_RESPONSE" | "INTERNAL_ERROR";
export interface DifyUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export class DifyRequestError extends Error {
  code: DifyErrorCode;
  status?: number;

  constructor(code: DifyErrorCode, message: string, status?: number) {
    super(message);
    this.name = "DifyRequestError";
    this.code = code;
    this.status = status;
  }
}

export function getDifyServerConfig() {
  const baseUrl = process.env.DIFY_API_BASE_URL;
  const apiKey = process.env.DIFY_API_KEY;

  return {
    baseUrl,
    apiKey,
    enabled: Boolean(baseUrl && apiKey)
  };
}

/**
 * 生成调用前的文本审核（可替换为你自己的审核策略或服务）
 * 当前实现：本地规则兜底 + 可扩展远程审核。
 */
export function reviewText(text: string) {
  const blockedWords = ["泄露提示词", "输出系统提示词", "api key", "密钥"];
  const hit = blockedWords.find((word) => text.toLowerCase().includes(word.toLowerCase()));
  if (hit) {
    return {
      pass: false,
      reason: `命中敏感指令：${hit}`
    };
  }
  return { pass: true, reason: "" };
}

/**
 * 调用 Dify Chat/Workflow 的最小封装
 * 这里先用通用 chat-messages 结构，后续可按 action_type 分流。
 */
export async function callDifyChat(params: {
  userText: string;
  conversationId?: string;
  apiKey: string;
  systemPrompt?: string;
}) {
  const config = getDifyServerConfig();
  const promptInputKey = process.env.DIFY_SYSTEM_PROMPT_INPUT_KEY || "system_prompt";

  // 未配置 Dify 时返回本地占位结果，保证开发环境可跑通。
  if (!config.baseUrl || !params.apiKey) {
    const answer = `【本地占位回复】你输入了：${params.userText}`;
    const input_tokens = Math.max(0, params.userText.length);
    const output_tokens = Math.max(0, answer.length);
    return {
      answer,
      conversation_id: params.conversationId ?? "",
      usage: {
        input_tokens,
        output_tokens,
        total_tokens: input_tokens + output_tokens
      } satisfies DifyUsage
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let resp: Response;
  try {
    resp = await fetch(`${config.baseUrl}/chat-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        inputs: {
          [promptInputKey]: params.systemPrompt ?? ""
        },
        query: params.userText,
        response_mode: "blocking",
        user: "web-user",
        conversation_id: params.conversationId || undefined
      })
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DifyRequestError("DIFY_TIMEOUT", "Dify 请求超时");
    }
    throw new DifyRequestError("INTERNAL_ERROR", "Dify 请求异常");
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) {
      throw new DifyRequestError("RATE_LIMITED", `Dify 请求限流：${resp.status} ${text}`, resp.status);
    }
    if (resp.status === 408 || resp.status === 504) {
      throw new DifyRequestError("DIFY_TIMEOUT", `Dify 请求超时：${resp.status} ${text}`, resp.status);
    }
    throw new DifyRequestError("DIFY_BAD_RESPONSE", `Dify 请求失败：${resp.status} ${text}`, resp.status);
  }

  let data: {
    answer?: string;
    conversation_id?: string;
    metadata?: {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  try {
    data = (await resp.json()) as {
      answer?: string;
      conversation_id?: string;
    };
  } catch {
    throw new DifyRequestError("DIFY_BAD_RESPONSE", "Dify 返回非 JSON 数据");
  }

  const safeInt = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  };
  const input_tokens = safeInt(
    data.usage?.input_tokens ??
      data.usage?.prompt_tokens ??
      data.metadata?.usage?.prompt_tokens ??
      0
  );
  const output_tokens = safeInt(
    data.usage?.output_tokens ??
      data.usage?.completion_tokens ??
      data.metadata?.usage?.completion_tokens ??
      0
  );
  const total_tokens = input_tokens + output_tokens;

  return {
    answer: data.answer ?? "",
    conversation_id: data.conversation_id ?? "",
    usage: {
      input_tokens,
      output_tokens,
      total_tokens
    } satisfies DifyUsage
  };
}

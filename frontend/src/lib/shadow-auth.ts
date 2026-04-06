/**
 * Shadow Auth：通行证即账号。伪邮箱 + 口令均为通行证衍生，不采集真实邮箱/手机。
 * 伪邮箱 local-part：在可为 RFC 兼容时直接使用 license；否则用 base64url 保证唯一可登录。
 */

const SHADOW_DOMAIN = "shadow.local";
const MIN_LICENSE_LENGTH = 6;

export function normalizeLicenseKey(raw: string): string {
  return raw.trim();
}

function isSafeEmailLocalPart(s: string): boolean {
  if (s.length < 1 || s.length > 64) return false;
  return /^[a-zA-Z0-9._+-]+$/.test(s);
}

export function licenseToShadowEmail(license: string): string {
  const key = normalizeLicenseKey(license);
  const local = isSafeEmailLocalPart(key) ? key : Buffer.from(key, "utf8").toString("base64url");
  return `${local}@${SHADOW_DOMAIN}`;
}

export function shadowPasswordFromLicense(license: string): string {
  return normalizeLicenseKey(license);
}

export function validateLicenseKeyForAuth(license: string): { ok: true } | { ok: false; message: string } {
  const key = normalizeLicenseKey(license);
  if (!key) return { ok: false, message: "请输入通行证。" };
  if (key.length < MIN_LICENSE_LENGTH) {
    return { ok: false, message: `通行证至少 ${MIN_LICENSE_LENGTH} 个字符（Supabase 密码策略）。` };
  }
  return { ok: true };
}

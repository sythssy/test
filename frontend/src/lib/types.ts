export type UserRole = "user" | "admin";
export type UserStatus = "active" | "banned";

export interface DbUserProfile {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  flash_word_balance: number;
  pro_word_balance: number;
  workflow_credits: number;
}

export interface Book {
  id: string;
  user_id: string;
  title: string;
  cover_url: string | null;
  description?: string | null;
  genre?: string | null;
  current_conversation_id?: string | null;
  current_model_key?: string | null;
  created_at: string;
  /** 从 chapters 子查询聚合，仅仪表盘页传入 */
  chapters?: { word_count: number }[];
}

export interface AiModelOption {
  model_key: string;
  name: string;
  action_type: string | null;
  /** 扣费池；缺省时前台按 flash 展示 */
  word_pool?: "flash" | "pro" | null;
}

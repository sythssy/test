/** 公告条目，时间倒序（最新在前）。只放功能更新与提示词优化通知。 */
export interface Announcement {
  id: string;
  date: string;          // YYYY-MM-DD
  tag: "功能更新" | "提示词优化" | "体验改进";
  title: string;
  body?: string;         // 可选补充说明（支持 \n 换行）
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "2026-04-04-autosave",
    date: "2026-04-04",
    tag: "功能更新",
    title: "章节切换自动保存",
    body: "切换章节时系统自动保存当前内容，不再弹确认框，写作更顺畅。"
  },
  {
    id: "2026-04-04-drag-sort",
    date: "2026-04-04",
    tag: "功能更新",
    title: "章节拖拽排序",
    body: "左侧目录支持直接拖拽章节调整顺序，自动同步到数据库。"
  },
  {
    id: "2026-04-04-kb-search",
    date: "2026-04-04",
    tag: "功能更新",
    title: "知识库搜索与类型过滤",
    body: "知识库页面新增文本搜索框与类型筛选下拉，快速定位素材条目。"
  },
  {
    id: "2026-04-03-export",
    date: "2026-04-03",
    tag: "功能更新",
    title: "导出全书支持 .txt / .md / .docx",
    body: "全书导出三种格式均已上线，导出时自动读取数据库最新保存内容。"
  },
  {
    id: "2026-04-02-brainstorm-kb",
    date: "2026-04-02",
    tag: "功能更新",
    title: "脑洞结果可加入知识库",
    body: "编辑器与写作工具台的脑洞生成结果，点击「加入知识库」即可保存为素材条目。"
  },
  {
    id: "2026-04-01-prompts-v2",
    date: "2026-04-01",
    tag: "提示词优化",
    title: "润色 / 扩写 / 去 AI 痕迹提示词全面升级",
    body: "针对网文场景重新调校润色、扩写、去痕三组提示词，输出更贴合章节语境，减少重复句式。"
  },
  {
    id: "2026-03-28-paragraph-verify",
    date: "2026-03-28",
    tag: "功能更新",
    title: "段落查证上线",
    body: "选中段落后可触发「段落查证」，自动核对逻辑连贯性与设定一致性，结果在侧栏展示。"
  }
];

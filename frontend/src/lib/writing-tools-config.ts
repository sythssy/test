import {
  AI_ACTION_BOOK_BLURB,
  AI_ACTION_BOOK_OUTLINE,
  AI_ACTION_BOOK_TITLE,
  AI_ACTION_CHARACTER_SETTING,
  AI_ACTION_COVER_COPY,
  AI_ACTION_FINE_OUTLINE,
  AI_ACTION_GLOSSARY_ENTRY,
  AI_ACTION_GOLDEN_FINGER,
  AI_ACTION_GOLDEN_OPENING,
  AI_ACTION_NAME_GEN,
  AI_ACTION_WORLDVIEW
} from "@/lib/ai-action-types";

/** 与前台卡片 id 一致（除 brainstorm 走独立接口） */
export type WritingToolCardId =
  | "title"
  | "blurb"
  | "outline"
  | "fine-outline"
  | "opening"
  | "cheat"
  | "names"
  | "character"
  | "world"
  | "glossary"
  | "cover";

export type WritingToolFieldSpec = {
  key: string;
  label: string;
  placeholder: string;
  optional?: boolean;
  /** 多行输入（简介、大纲粘贴等） */
  multiline?: boolean;
  /** multiline 时行数，默认 3 */
  rows?: number;
};

export type WritingToolDefinition = {
  id: WritingToolCardId;
  actionType: string;
  cardTitle: string;
  /** 卡片上一行说明文案 */
  cardSubtitle: string;
  dialogTitle: string;
  dialogDescription: string;
  fields: WritingToolFieldSpec[];
  buildUserText: (bookTitle: string, values: Record<string, string>) => string;
};

function bookTail(bookTitle: string) {
  return `\n\n当前作品书名（供关联，不要求写进输出）：《${bookTitle}》`;
}

export const WRITING_TOOL_DEFINITIONS: WritingToolDefinition[] = [
  {
    id: "title",
    actionType: AI_ACTION_BOOK_TITLE,
    cardTitle: "书名生成器",
    cardSubtitle: "吸睛书名，更具吸引力",
    dialogTitle: "书名生成",
    dialogDescription: "根据题材与梗概给出多组书名建议（及简短理由）。按所选模型字数池扣费。",
    fields: [
      { key: "genre", label: "题材 / 类型", placeholder: "例如：赛博朋克、古言、无限流" },
      { key: "hook", label: "核心梗 / 卖点", placeholder: "一句话故事或最强设定" },
      { key: "tone", label: "风格倾向", placeholder: "例如：轻松沙雕、正剧、悬疑压抑" }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请根据以下信息输出多组「书名 + 简短理由」，书名尽量好记、好搜、有辨识度：",
        `题材/类型：${f.genre}`,
        `核心梗/卖点：${f.hook}`,
        `风格倾向：${f.tone}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "blurb",
    actionType: AI_ACTION_BOOK_BLURB,
    cardTitle: "简介生成器",
    cardSubtitle: "充满期待，利于传播",
    dialogTitle: "简介生成",
    dialogDescription: "生成适合平台展示的文案简介（可含标签链建议）。",
    fields: [
      { key: "working_title", label: "书名或暂定名", placeholder: "可提供暂用名" },
      {
        key: "premise",
        label: "剧情梗概",
        placeholder: "主角与主线矛盾，可写多句",
        multiline: true,
        rows: 4
      },
      {
        key: "appeal",
        label: "卖点 / 人设亮点",
        placeholder: "读者可能最买账的点",
        multiline: true,
        rows: 3
      }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请写一段小说简介/文案（中文网文平台风格，适度分段，可列 2～4 个标签建议）：",
        `书名或暂定名：${f.working_title}`,
        `剧情梗概：${f.premise}`,
        `卖点/人设亮点：${f.appeal}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "outline",
    actionType: AI_ACTION_BOOK_OUTLINE,
    cardTitle: "大纲生成器",
    cardSubtitle: "创意蓝图，尽在掌握",
    dialogTitle: "大纲生成",
    dialogDescription: "输出可执行的卷/篇级剧情大纲（可按「起承转合」或你更熟的结构）。",
    fields: [
      { key: "genre", label: "题材", placeholder: "类型与读者群" },
      {
        key: "protagonist",
        label: "主角设定",
        placeholder: "身份、目标、缺陷",
        multiline: true,
        rows: 3
      },
      {
        key: "arc",
        label: "故事走向",
        placeholder: "开端—中盘高潮—预期结局方向",
        multiline: true,
        rows: 4
      }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请输出小说剧情大纲（分卷或分大阶段均可，条理清晰，有冲突升级）：",
        `题材：${f.genre}`,
        `主角：${f.protagonist}`,
        `故事走向：${f.arc}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "fine-outline",
    actionType: AI_ACTION_FINE_OUTLINE,
    cardTitle: "细纲生成器",
    cardSubtitle: "层次清晰，好写好用",
    dialogTitle: "细纲生成",
    dialogDescription: "在粗纲基础上拆章节级节拍；若尚无粗纲可仅填前三项。",
    fields: [
      { key: "genre", label: "题材", placeholder: "类型" },
      {
        key: "protagonist",
        label: "主角",
        placeholder: "核心人物",
        multiline: true,
        rows: 3
      },
      {
        key: "arc",
        label: "故事走向",
        placeholder: "当前规划到何处",
        multiline: true,
        rows: 4
      },
      {
        key: "existing",
        label: "已有大纲（可选）",
        placeholder: "可粘贴现有卷纲/章纲；没有则留空",
        optional: true,
        multiline: true,
        rows: 6
      }
    ],
    buildUserText: (bookTitle, f) => {
      const extra = (f.existing ?? "").trim() ? `已有大纲/材料：\n${f.existing.trim()}` : "已有大纲/材料：暂无，请根据前三项自行拆分细纲。";
      return (
        ["请输出「章节级细纲」或「场景节拍表」，便于开写：", `题材：${f.genre}`, `主角：${f.protagonist}`, `故事走向：${f.arc}`, extra].join(
          "\n\n"
        ) + bookTail(bookTitle)
      );
    }
  },
  {
    id: "opening",
    actionType: AI_ACTION_GOLDEN_OPENING,
    cardTitle: "黄金开篇生成器",
    cardSubtitle: "故事启程，点燃期待",
    dialogTitle: "黄金开篇",
    dialogDescription: "生成开篇若干段（或开篇结构建议+示范正文）。",
    fields: [
      { key: "genre", label: "题材", placeholder: "类型与基调" },
      {
        key: "protagonist",
        label: "主角与切入点",
        placeholder: "开篇从谁、在什么处境写起",
        multiline: true,
        rows: 3
      },
      {
        key: "angle",
        label: "期望钩子",
        placeholder: "悬念、反差、危机、谜题等",
        multiline: true,
        rows: 3
      }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请写小说开篇（可包含 1 段结构说明 + 示范正文），注重钩子与代入感：",
        `题材：${f.genre}`,
        `主角与切入点：${f.protagonist}`,
        `期望钩子：${f.angle}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "cheat",
    actionType: AI_ACTION_GOLDEN_FINGER,
    cardTitle: "金手指生成器",
    cardSubtitle: "反转与爽点，信手拈来",
    dialogTitle: "金手指 / 爽点设定",
    dialogDescription: "设计能力、系统或信息差等设定，并提示可能的情节用法。",
    fields: [
      { key: "genre", label: "题材", placeholder: "背景世界" },
      {
        key: "protagonist",
        label: "主角处境",
        placeholder: "当前短板与愿望",
        multiline: true,
        rows: 3
      },
      {
        key: "vibe",
        label: "爽点偏好",
        placeholder: "碾压、苟道、种田、反转、群像等",
        multiline: true,
        rows: 3
      }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请设计「金手指/外挂式设定」：能力边界、代价、成长线，并给 2～3 个可用的情节桥段提示：",
        `题材：${f.genre}`,
        `主角处境：${f.protagonist}`,
        `爽点偏好：${f.vibe}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "names",
    actionType: AI_ACTION_NAME_GEN,
    cardTitle: "名字生成器",
    cardSubtitle: "人名、物件、地名、势力…",
    dialogTitle: "名字生成",
    dialogDescription: "人名、地名、势力、道具等均可；说明风格与数量感即可。",
    fields: [
      { key: "kind", label: "类型", placeholder: "人名 / 地名 / 组织 / 功法 / 道具…" },
      { key: "style", label: "风格", placeholder: "古风、现代、克系、日式轻小说等" },
      { key: "hint", label: "参考或限制", placeholder: "音韵、字数、禁忌字、已有范例" }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请按下列要求生成一批候选名称（带极短释义或语感说明），条数适中、可直接挑选：",
        `类型：${f.kind}`,
        `风格：${f.style}`,
        `参考或限制：${f.hint}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "character",
    actionType: AI_ACTION_CHARACTER_SETTING,
    cardTitle: "人设生成器",
    cardSubtitle: "立体角色，轻松生成",
    dialogTitle: "人设生成",
    dialogDescription: "主角/配角小传式设定表（外貌、动机、秘密、关系线可列）。",
    fields: [
      { key: "role", label: "角色类型", placeholder: "主角 / 反派 / 挚友 / 导师…" },
      {
        key: "position",
        label: "在故事中的位置",
        placeholder: "与主线、主角的关系",
        multiline: true,
        rows: 3
      },
      {
        key: "keywords",
        label: "关键词",
        placeholder: "性格、职业、口头禅、记忆点",
        multiline: true,
        rows: 3
      }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请输出一份可直接粘进设定文档的「角色卡」：",
        `角色类型：${f.role}`,
        `在故事中的位置：${f.position}`,
        `关键词：${f.keywords}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "world",
    actionType: AI_ACTION_WORLDVIEW,
    cardTitle: "世界观生成器",
    cardSubtitle: "虚构世界，落地成文",
    dialogTitle: "世界观生成",
    dialogDescription: "规则、势力、日常与例外；可偏硬设定或偏氛围向。",
    fields: [
      { key: "genre", label: "题材 / 时代", placeholder: "古代/现代/未来/架空" },
      {
        key: "rules",
        label: "核心规则",
        placeholder: "魔法、科技、阶级、禁忌",
        multiline: true,
        rows: 4
      },
      {
        key: "refs",
        label: "参考方向",
        placeholder: "希望贴近的现实或作品气质",
        multiline: true,
        rows: 3
      }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请输出结构化世界观概要（地理/势力/规则/冲突源，可列表+小段说明）：",
        `题材/时代：${f.genre}`,
        `核心规则：${f.rules}`,
        `参考方向：${f.refs}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "glossary",
    actionType: AI_ACTION_GLOSSARY_ENTRY,
    cardTitle: "词条生成器",
    cardSubtitle: "设定词条，便于查阅",
    dialogTitle: "词条生成",
    dialogDescription: "设定词条列表（名释+两三句扩展，便于后文统一称呼）。",
    fields: [
      { key: "topic", label: "词条主题", placeholder: "例如：异能体系、年号、组织职称" },
      { key: "count", label: "数量/粒度", placeholder: "如：8 条、每条 50 字内" },
      { key: "style", label: "文风", placeholder: "百科体 / 游戏图鉴 / 小说旁白" }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请生成一组设定词条（名称 + 释义 + 可扩展暗示）：",
        `主题：${f.topic}`,
        `数量/粒度：${f.count}`,
        `文风：${f.style}`
      ].join("\n") + bookTail(bookTitle)
  },
  {
    id: "cover",
    actionType: AI_ACTION_COVER_COPY,
    cardTitle: "封面生成器",
    cardSubtitle: "封面 brief 与画面描述（文案）",
    dialogTitle: "封面文案 / 画面描述",
    dialogDescription: "生成可用于约稿 brief 的文案与画面元素清单（非直接出图）。",
    fields: [
      { key: "title_hint", label: "书名展示", placeholder: "封面需突出的标题字样" },
      {
        key: "visual",
        label: "画面关键词",
        placeholder: "人物构图、道具、色调、氛围",
        multiline: true,
        rows: 4
      },
      { key: "mood", label: "整体情绪", placeholder: "热血/唯美/恐怖/治愈…" }
    ],
    buildUserText: (bookTitle, f) =>
      [
        "请输出封面约稿 brief：主视觉描述 + 配色与字体气质建议 + 需规避元素；可附一句 slogan。",
        `书名展示：${f.title_hint}`,
        `画面关键词：${f.visual}`,
        `整体情绪：${f.mood}`
      ].join("\n") + bookTail(bookTitle)
  }
];

/** 编辑器侧栏等：不含 brainstorm（主入口已单独链到脑洞/工具台） */
export const WRITING_TOOL_QUICK_NAV_EDITOR = [
  { label: "书名", tool: "title" },
  { label: "简介", tool: "blurb" },
  { label: "大纲", tool: "outline" },
  { label: "细纲", tool: "fine-outline" },
  { label: "开篇", tool: "opening" }
] as const;

const byId = new Map<string, WritingToolDefinition>();
for (const d of WRITING_TOOL_DEFINITIONS) {
  byId.set(d.id, d);
}

export function getWritingToolDefinition(id: string): WritingToolDefinition | undefined {
  return byId.get(id);
}

export const WRITING_TOOL_CARD_IDS = new Set<string>(WRITING_TOOL_DEFINITIONS.map((d) => d.id));

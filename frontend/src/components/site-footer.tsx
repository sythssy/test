export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto border-t border-slate-200/60 bg-white/50 py-5 text-center text-[11px] leading-relaxed text-slate-400 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-slate-500">
      <p>
        AI 生成内容仅为辅助创作工具输出，不代表本平台立场。
        用户对利用生成内容实施的一切行为承担全部法律责任。
      </p>
      <p className="mt-0.5">
        禁止使用本工具生成违法、有害、侵权或其他违反法律法规的内容。
        平台保留用户操作日志及章节历史快照 30 天用于风控审计与内容恢复，不对外披露。
      </p>
      <p className="mt-1 text-slate-300 dark:text-slate-600">
        © {year} 织梦AI写作 · 内测版
      </p>
    </footer>
  );
}

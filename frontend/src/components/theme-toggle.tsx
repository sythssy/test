"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved ? saved === "dark" : prefersDark;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "切换浅色模式" : "切换深色模式"}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}

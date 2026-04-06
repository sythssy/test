"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";

interface Match {
  from: number;
  to: number;
}

function findAllMatches(editor: Editor, search: string, caseSensitive: boolean): Match[] {
  if (!search) return [];
  const needle = caseSensitive ? search : search.toLowerCase();
  const matches: Match[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const haystack = caseSensitive ? node.text : node.text.toLowerCase();
    let idx = 0;
    while (idx <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, idx);
      if (found === -1) break;
      matches.push({ from: pos + found, to: pos + found + needle.length });
      idx = found + 1;
    }
  });

  return matches;
}

export function FindReplaceBar({
  editor,
  open,
  onClose
}: {
  editor: Editor;
  open: boolean;
  onClose: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [currentIdx, setCurrentIdx] = useState(-1);

  const refreshMatches = useCallback(() => {
    if (!search) {
      setMatches([]);
      setCurrentIdx(-1);
      return;
    }
    const found = findAllMatches(editor, search, caseSensitive);
    setMatches(found);
    setCurrentIdx(found.length > 0 ? 0 : -1);
    if (found.length > 0) {
      editor.commands.setTextSelection(found[0]);
      scrollToSelection(editor);
    }
  }, [editor, search, caseSensitive]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(refreshMatches, 150);
    return () => clearTimeout(timer);
  }, [open, search, caseSensitive, refreshMatches]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const goTo = (idx: number) => {
    if (matches.length === 0) return;
    const wrapped = ((idx % matches.length) + matches.length) % matches.length;
    setCurrentIdx(wrapped);
    editor.commands.setTextSelection(matches[wrapped]);
    scrollToSelection(editor);
  };

  const replaceCurrent = () => {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    const m = matches[currentIdx];
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, replace).run();
    const updated = findAllMatches(editor, search, caseSensitive);
    setMatches(updated);
    const nextIdx = updated.length > 0 ? Math.min(currentIdx, updated.length - 1) : -1;
    setCurrentIdx(nextIdx);
    if (nextIdx >= 0) {
      editor.commands.setTextSelection(updated[nextIdx]);
      scrollToSelection(editor);
    }
  };

  const replaceAll = () => {
    if (matches.length === 0) return;
    const tr = editor.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      tr.insertText(replace, matches[i].from, matches[i].to);
    }
    editor.view.dispatch(tr);
    setMatches([]);
    setCurrentIdx(-1);
  };

  if (!open) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-b-lg border-b border-x border-slate-200 bg-slate-50 px-3 py-2 text-xs shadow-sm">
      <input
        ref={searchRef}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            goTo(e.shiftKey ? currentIdx - 1 : currentIdx + 1);
          }
        }}
        placeholder="查找..."
        className="w-36 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-400"
      />
      <input
        value={replace}
        onChange={(e) => setReplace(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            replaceCurrent();
          }
        }}
        placeholder="替换为..."
        className="w-36 rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-400"
      />
      <label className="flex cursor-pointer items-center gap-1 select-none">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => setCaseSensitive(e.target.checked)}
          className="accent-indigo-600"
        />
        <span>区分大小写</span>
      </label>
      <span className="text-slate-500">
        {matches.length > 0 ? `${currentIdx + 1} / ${matches.length}` : search ? "无匹配" : ""}
      </span>
      <button
        type="button"
        onClick={() => goTo(currentIdx - 1)}
        disabled={matches.length === 0}
        className="rounded border border-slate-300 px-2 py-0.5 hover:bg-white disabled:opacity-40"
      >
        上一个
      </button>
      <button
        type="button"
        onClick={() => goTo(currentIdx + 1)}
        disabled={matches.length === 0}
        className="rounded border border-slate-300 px-2 py-0.5 hover:bg-white disabled:opacity-40"
      >
        下一个
      </button>
      <button
        type="button"
        onClick={replaceCurrent}
        disabled={matches.length === 0}
        className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
      >
        替换
      </button>
      <button
        type="button"
        onClick={replaceAll}
        disabled={matches.length === 0}
        className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
      >
        全部替换
      </button>
      <button
        type="button"
        onClick={onClose}
        className="ml-auto rounded border border-slate-300 px-2 py-0.5 hover:bg-white"
      >
        关闭
      </button>
    </div>
  );
}

function scrollToSelection(editor: Editor) {
  requestAnimationFrame(() => {
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const el = node instanceof HTMLElement ? node : node.parentElement;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

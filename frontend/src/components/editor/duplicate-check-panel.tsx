"use client";

import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/core";

interface DuplicateItem {
  text: string;
  count: number;
  positions: number[];
}

function extractDuplicates(fullText: string, minLen: number, maxLen: number, minCount: number): DuplicateItem[] {
  const freq = new Map<string, number[]>();

  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i <= fullText.length - len; i++) {
      const chunk = fullText.slice(i, i + len).trim();
      if (!chunk || /^[\s\p{P}]+$/u.test(chunk)) continue;
      const arr = freq.get(chunk);
      if (arr) {
        if (arr[arr.length - 1] + len <= i) arr.push(i);
      } else {
        freq.set(chunk, [i]);
      }
    }
  }

  const results: DuplicateItem[] = [];
  const seen = new Set<string>();

  const sorted = [...freq.entries()]
    .filter(([, positions]) => positions.length >= minCount)
    .sort((a, b) => {
      const scoreA = a[0].length * a[1].length;
      const scoreB = b[0].length * b[1].length;
      return scoreB - scoreA;
    });

  for (const [text, positions] of sorted) {
    if (seen.has(text)) continue;
    let subsumed = false;
    for (const existing of seen) {
      if (existing.includes(text)) {
        subsumed = true;
        break;
      }
    }
    if (subsumed) continue;
    seen.add(text);
    results.push({ text, count: positions.length, positions });
  }

  return results.slice(0, 80);
}

function extractDuplicateSentences(fullText: string): DuplicateItem[] {
  const sentences = fullText.split(/[。！？\n]+/).map((s) => s.trim()).filter((s) => s.length >= 6);
  const freq = new Map<string, number[]>();

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const arr = freq.get(s);
    if (arr) {
      arr.push(fullText.indexOf(s, (arr[arr.length - 1] || 0) + 1));
    } else {
      freq.set(s, [fullText.indexOf(s)]);
    }
  }

  return [...freq.entries()]
    .filter(([, positions]) => positions.length >= 2)
    .map(([text, positions]) => ({ text, count: positions.length, positions }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

export function DuplicateCheckPanel({
  editor,
  open,
  onClose
}: {
  editor: Editor;
  open: boolean;
  onClose: () => void;
}) {
  const [results, setResults] = useState<DuplicateItem[]>([]);
  const [sentenceResults, setSentenceResults] = useState<DuplicateItem[]>([]);
  const [tab, setTab] = useState<"words" | "sentences">("words");
  const [scanned, setScanned] = useState(false);

  const runCheck = useCallback(() => {
    const fullText = editor.getText();
    setResults(extractDuplicates(fullText, 2, 6, 5));
    setSentenceResults(extractDuplicateSentences(fullText));
    setScanned(true);
  }, [editor]);

  const scrollToPos = (pos: number) => {
    const docPos = pos + 1;
    if (docPos >= editor.state.doc.content.size) return;
    editor.commands.setTextSelection({ from: docPos, to: docPos });
    requestAnimationFrame(() => {
      const { node } = editor.view.domAtPos(docPos);
      const el = node instanceof HTMLElement ? node : node.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  if (!open) return null;

  const list = tab === "words" ? results : sentenceResults;

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-amber-900">查找重复文字</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runCheck}
            className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 hover:bg-amber-200"
          >
            {scanned ? "重新扫描" : "开始扫描"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] hover:bg-white"
          >
            关闭
          </button>
        </div>
      </div>

      {scanned && (
        <>
          <div className="mb-2 flex gap-1">
            <button
              type="button"
              onClick={() => setTab("words")}
              className={`rounded px-2 py-0.5 text-[11px] ${tab === "words" ? "bg-amber-200 text-amber-900 font-medium" : "text-amber-700 hover:bg-amber-100"}`}
            >
              重复词 ({results.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("sentences")}
              className={`rounded px-2 py-0.5 text-[11px] ${tab === "sentences" ? "bg-amber-200 text-amber-900 font-medium" : "text-amber-700 hover:bg-amber-100"}`}
            >
              重复句 ({sentenceResults.length})
            </button>
          </div>

          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {list.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-amber-600">未发现重复内容</p>
            ) : (
              list.map((item, i) => (
                <div
                  key={`${tab}-${i}`}
                  className="flex items-center justify-between rounded-md bg-white px-2 py-1 text-[11px]"
                >
                  <span className="mr-2 max-w-[180px] truncate font-mono text-slate-800">
                    &ldquo;{item.text}&rdquo;
                  </span>
                  <span className="shrink-0 text-amber-700">{item.count} 次</span>
                  <button
                    type="button"
                    onClick={() => scrollToPos(item.positions[0])}
                    className="ml-2 shrink-0 rounded border border-amber-200 px-1.5 py-0.5 text-amber-700 hover:bg-amber-50"
                  >
                    定位
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

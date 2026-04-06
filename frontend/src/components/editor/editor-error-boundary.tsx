"use client";

import React from "react";

interface State {
  hasError: boolean;
  message: string;
}

export class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "编辑器遇到未知错误"
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-8">
          <p className="text-sm font-semibold text-rose-700">编辑器加载出现问题</p>
          <p className="text-xs text-rose-600">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="rounded-lg border border-rose-300 px-4 py-2 text-sm text-rose-700 hover:bg-rose-100"
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

"use client";

import useSWR from "swr";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { SessionTimelineResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function badgeClass(kind: string) {
  switch (kind) {
    case "user":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "assistant":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "tool_call":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "tool_output":
      return "bg-zinc-100 text-zinc-700 border-zinc-200";
    case "error":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-white text-zinc-700 border-zinc-200";
  }
}

function bubbleAlign(kind: string) {
  if (kind === "user") return "justify-end";
  if (kind === "assistant") return "justify-start";
  return "justify-center";
}

function bubbleClass(kind: string) {
  switch (kind) {
    case "user":
      return "bg-blue-50 border-blue-200 text-slate-800";
    case "assistant":
      return "bg-emerald-50 border-emerald-200 text-slate-800";
    case "tool_call":
      return "bg-amber-50 border-amber-200 text-slate-800";
    case "tool_output":
      return "bg-slate-50 border-slate-200 text-slate-700";
    case "error":
      return "bg-rose-50 border-rose-200 text-rose-700";
    default:
      return "bg-white border-slate-200 text-slate-700";
  }
}

function bubbleWidth(kind: string) {
  if (kind === "user" || kind === "assistant") return "max-w-[72%]";
  return "max-w-[88%]";
}

function kindLabel(kind: string) {
  switch (kind) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "tool_call":
      return "tool call";
    case "tool_output":
      return "tool output";
    case "error":
      return "error";
    default:
      return "other";
  }
}

function previewText(text: string, maxChars = 600, maxLines = 10) {
  const lines = text.split("\n");
  const limitedLines = lines.slice(0, maxLines);
  const joined = limitedLines.join("\n");
  if (lines.length > maxLines || joined.length > maxChars) {
    return `${joined.slice(0, maxChars)}\n…`;
  }
  return joined;
}

export default function SessionTimeline({ sessionId }: { sessionId: string }) {
  const { data, error, isLoading } = useSWR<SessionTimelineResponse>(
    `/api/session/${encodeURIComponent(sessionId)}`,
    fetcher
  );

  const parentRef = useRef<HTMLDivElement | null>(null);
  const [filters, setFilters] = useState({
    user: true,
    assistant: true,
    tool_call: true,
    tool_output: true,
    error: true,
    other: false
  });

  const items = useMemo(() => data?.events ?? [], [data?.events]);
  const filteredItems = useMemo(() => {
    return items.filter((it) => filters[it.kind as keyof typeof filters]);
  }, [items, filters]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { user: 0, assistant: 0, tool_call: 0, tool_output: 0, error: 0, other: 0 };
    for (const it of items) c[it.kind] = (c[it.kind] ?? 0) + 1;
    return c;
  }, [items]);


  if (error) {
    return (
      <section className="panel rounded-2xl p-4 text-sm text-rose-600">
        载入失败：{String(error)}
      </section>
    );
  }

  if (isLoading || !data) {
    return (
      <section className="panel rounded-2xl p-4 text-sm text-slate-500">
        正在加载时间线…
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="panel rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            <span className="text-slate-500">开始：</span>
            <span className="tabular-nums">{data.summary.startedAt ?? "—"}</span>
            <span className="mx-2 text-slate-300">|</span>
            <span className="text-slate-500">结束：</span>
            <span className="tabular-nums">{data.summary.endedAt ?? "—"}</span>
          </div>
          <Link href="/sessions" className="text-sm text-slate-500 hover:text-slate-700">
            返回列表
          </Link>
        </div>
        <div className="mt-2 text-xs text-slate-500">cwd：{data.summary.cwd ?? "—"}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            { key: "user", label: "user" },
            { key: "assistant", label: "assistant" },
            { key: "tool_call", label: "tool call" },
            { key: "tool_output", label: "tool output" },
            { key: "error", label: "error" },
            { key: "other", label: "other" }
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
            className={`rounded-full border px-2.5 py-1 ${
              filters[f.key] ? "border-cyan-200 bg-cyan-50 text-cyan-700" : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            {f.label} · {counts[f.key] ?? 0}
          </button>
        ))}
      </div>

      {data.truncated ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          事件过多，已截断显示（仅展示前 {items.length} 条）。
        </div>
      ) : null}

      <div ref={parentRef} className="panel h-[70dvh] overflow-auto rounded-2xl">
        <div className="space-y-4 px-3 py-4">
          {filteredItems.map((item, index) => {
            const text = item.text ?? "";
            const preview = previewText(text);
            const isLong = text.length > preview.length || text.split("\n").length > 10;
            return (
              <div key={`${item.ts}-${index}`} className="flex flex-col gap-2">
                <div className={`flex ${bubbleAlign(item.kind)}`}>
                  <div className={`${bubbleWidth(item.kind)} space-y-2`}>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${badgeClass(
                          item.kind
                        )}`}
                      >
                        {kindLabel(item.kind)}
                        {item.name ? `: ${item.name}` : ""}
                      </span>
                      <span className="text-[11px] tabular-nums text-slate-400">{item.ts}</span>
                    </div>
                    {item.text ? (
                      isLong ? (
                        <div className="space-y-2">
                          <div className={`rounded-2xl border px-3 py-2 text-xs ${bubbleClass(item.kind)}`}>
                            <pre className="whitespace-pre-wrap break-words">{preview}</pre>
                          </div>
                          <details className="text-[11px] text-slate-500">
                            <summary className="cursor-pointer">展开全文</summary>
                            <div className={`mt-2 rounded-2xl border px-3 py-2 text-xs ${bubbleClass(item.kind)}`}>
                              <pre className="whitespace-pre-wrap break-words">{text}</pre>
                            </div>
                          </details>
                        </div>
                      ) : (
                        <div className={`rounded-2xl border px-3 py-2 text-xs ${bubbleClass(item.kind)}`}>
                          <pre className="whitespace-pre-wrap break-words">{text}</pre>
                        </div>
                      )
                    ) : (
                      <div className="text-xs text-slate-500">（无文本内容）</div>
                    )}
                  </div>
                </div>
                <div className="h-px bg-slate-100/70" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

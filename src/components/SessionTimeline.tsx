"use client";

import useSWR from "swr";
import Link from "next/link";
import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

export default function SessionTimeline({ sessionId }: { sessionId: string }) {
  const { data, error, isLoading } = useSWR<SessionTimelineResponse>(
    `/api/session/${encodeURIComponent(sessionId)}`,
    fetcher
  );

  const parentRef = useRef<HTMLDivElement | null>(null);
  const items = useMemo(() => data?.events ?? [], [data?.events]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 90,
    overscan: 10
  });

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        载入失败：{String(error)}
      </section>
    );
  }

  if (isLoading || !data) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        正在加载时间线…
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="text-sm text-zinc-700">
          <span className="text-zinc-500">开始：</span>
          <span className="tabular-nums">{data.summary.startedAt ?? "—"}</span>
          <span className="mx-2 text-zinc-300">|</span>
          <span className="text-zinc-500">结束：</span>
          <span className="tabular-nums">{data.summary.endedAt ?? "—"}</span>
          <span className="mx-2 text-zinc-300">|</span>
          <span className="text-zinc-500">cwd：</span>
          <span className="truncate">{data.summary.cwd ?? "—"}</span>
        </div>
        <Link href="/sessions" className="text-sm text-zinc-600 hover:underline">
          返回列表
        </Link>
      </div>

      {data.truncated ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          事件过多，已截断显示（仅展示前 {items.length} 条）。
        </div>
      ) : null}

      <div
        ref={parentRef}
        className="h-[70dvh] overflow-auto rounded-xl border border-zinc-200 bg-white"
      >
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const item = items[vi.index]!;
            return (
              <div
                key={vi.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`
                }}
                className="border-b border-zinc-100 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${badgeClass(
                      item.kind
                    )}`}
                  >
                    {item.kind}
                    {item.name ? `: ${item.name}` : ""}
                  </span>
                  <span className="text-xs tabular-nums text-zinc-500">{item.ts}</span>
                </div>
                {item.text ? (
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-2 text-xs text-zinc-800">
                    {item.text}
                  </pre>
                ) : (
                  <div className="mt-2 text-xs text-zinc-500">（无文本内容）</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}


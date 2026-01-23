import SessionsTable from "@/components/SessionsTable";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">会话列表</h1>
        <p className="text-sm text-zinc-600">支持按日期、错误、工具调用过滤；点击进入详情。</p>
      </header>

      <SessionsTable />
    </main>
  );
}


import SessionTimeline from "@/components/SessionTimeline";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">会话详情</h1>
        <p className="text-sm text-zinc-600">ID：{id}</p>
      </header>
      <SessionTimeline sessionId={id} />
    </main>
  );
}

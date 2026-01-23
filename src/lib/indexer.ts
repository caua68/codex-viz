import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { getCacheDir, getSessionsDir } from "@/lib/paths";
import type { DailyAgg, IndexSnapshot, SessionSummary, SessionTimelineResponse, TimelineEvent } from "@/lib/types";

const INDEX_VERSION = 1;
const INDEX_FILE = "index.json";
const MANIFEST_FILE = "manifest.json";
const SESSION_DIR = "session";

type Manifest = {
  version: number;
  sessionsDir: string;
  files: Record<
    string,
    {
      mtimeMs: number;
      size: number;
      sessionId: string;
      summary: SessionSummary;
      tools: Record<string, number>;
      dailyKey: string;
    }
  >;
};

let inMemoryIndex: IndexSnapshot | null = null;
let inFlight: Promise<IndexSnapshot> | null = null;

function safeJsonParse(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function toIso(ts: unknown): string | null {
  if (typeof ts !== "string") return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function dayKeyFromIso(iso: string | null) {
  if (!iso) return "unknown";
  return iso.slice(0, 10);
}

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function readJsonFile<T>(p: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(p: string, obj: unknown) {
  const tmp = `${p}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await fsp.rename(tmp, p);
}

async function listJsonlFiles(root: string) {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile() && ent.name.endsWith(".jsonl")) out.push(full);
    }
  }
  await walk(root);
  return out;
}

function summarizeFromMeta(sessionId: string, file: string, meta: any): SessionSummary {
  const payload = meta?.payload ?? {};
  return {
    id: payload?.id ?? sessionId,
    file,
    startedAt: toIso(meta?.timestamp) ?? toIso(payload?.timestamp),
    endedAt: null,
    durationSec: null,
    cwd: typeof payload?.cwd === "string" ? payload.cwd : null,
    originator: typeof payload?.originator === "string" ? payload.originator : null,
    cliVersion: typeof payload?.cli_version === "string" ? payload.cli_version : null,
    messages: 0,
    toolCalls: 0,
    errors: 0
  };
}

function extractMessageText(payload: any): string | null {
  const content = payload?.content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const c of content) {
    if (c?.type === "input_text" && typeof c?.text === "string") parts.push(c.text);
    else if (c?.type === "output_text" && typeof c?.text === "string") parts.push(c.text);
    else if (typeof c?.text === "string") parts.push(c.text);
  }
  const txt = parts.join("\n").trim();
  return txt ? txt : null;
}

async function buildFileIndex(file: string) {
  const sessionId = path.basename(file, ".jsonl");
  const tools: Record<string, number> = {};
  const callIdToToolName = new Map<string, string>();

  let summary: SessionSummary = {
    id: sessionId,
    file,
    startedAt: null,
    endedAt: null,
    durationSec: null,
    cwd: null,
    originator: null,
    cliVersion: null,
    messages: 0,
    toolCalls: 0,
    errors: 0
  };

  let firstTs: string | null = null;
  let lastTs: string | null = null;

  const stream = fs.createReadStream(file, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const obj: any = safeJsonParse(line);
    if (!obj) continue;
    const ts = toIso(obj.timestamp);
    if (ts) {
      if (!firstTs) firstTs = ts;
      lastTs = ts;
    }

    if (obj.type === "session_meta") {
      summary = summarizeFromMeta(sessionId, file, obj);
      if (!firstTs && summary.startedAt) firstTs = summary.startedAt;
    }

    if (obj.type === "event_msg") {
      const pt = obj.payload?.type;
      if (pt === "turn_aborted") summary.errors += 1;
    }

    if (obj.type === "response_item") {
      const payload = obj.payload ?? {};
      const pt = payload.type;
      if (pt === "message") {
        const role = payload.role;
        if (role === "user" || role === "assistant") summary.messages += 1;
      } else if (pt === "function_call" || pt === "custom_tool_call") {
        summary.toolCalls += 1;
        const name = typeof payload.name === "string" ? payload.name : "unknown";
        tools[name] = (tools[name] ?? 0) + 1;
        const callId = typeof payload.call_id === "string" ? payload.call_id : null;
        if (callId) callIdToToolName.set(callId, name);
      } else if (pt === "function_call_output" || pt === "custom_tool_call_output") {
        const out = typeof payload.output === "string" ? payload.output : null;
        const callId = typeof payload.call_id === "string" ? payload.call_id : null;
        const toolName = callId ? callIdToToolName.get(callId) : undefined;
        if (out) {
          // 常见：输出里直接带 error 文本
          if (/error|exception|traceback/i.test(out)) summary.errors += 1;
          // 常见：custom_tool_call_output 里包了一层 JSON，包含 exit_code
          if (out.startsWith("{")) {
            try {
              const parsed: any = JSON.parse(out);
              const exitCode = parsed?.metadata?.exit_code;
              if (typeof exitCode === "number" && exitCode !== 0) summary.errors += 1;
            } catch {
              // ignore
            }
          }
        }
        // 兜底：如果某些工具输出为空但工具名可识别，仍保留统计（summary 已在 call 时统计）
        void toolName;
      }
    }
  }

  summary.startedAt = summary.startedAt ?? firstTs;
  summary.endedAt = lastTs;
  if (summary.startedAt && summary.endedAt) {
    const a = new Date(summary.startedAt).getTime();
    const b = new Date(summary.endedAt).getTime();
    if (!Number.isNaN(a) && !Number.isNaN(b) && b >= a) summary.durationSec = Math.floor((b - a) / 1000);
  }

  const dailyKey = dayKeyFromIso(summary.startedAt ?? firstTs);
  return { sessionId, summary, tools, dailyKey };
}

function mergeDaily(target: Record<string, DailyAgg>, key: string, delta: Partial<DailyAgg>) {
  const cur = target[key] ?? { sessions: 0, messages: 0, toolCalls: 0, errors: 0 };
  target[key] = {
    sessions: cur.sessions + (delta.sessions ?? 0),
    messages: cur.messages + (delta.messages ?? 0),
    toolCalls: cur.toolCalls + (delta.toolCalls ?? 0),
    errors: cur.errors + (delta.errors ?? 0)
  };
}

function mergeTools(target: Record<string, number>, add: Record<string, number>) {
  for (const [k, v] of Object.entries(add)) target[k] = (target[k] ?? 0) + v;
}

async function buildOrUpdateIndex(): Promise<IndexSnapshot> {
  const sessionsDir = getSessionsDir();
  const cacheDir = getCacheDir();
  await ensureDir(cacheDir);
  await ensureDir(path.join(cacheDir, SESSION_DIR));

  const indexPath = path.join(cacheDir, INDEX_FILE);
  const manifestPath = path.join(cacheDir, MANIFEST_FILE);

  const prevManifest = await readJsonFile<Manifest>(manifestPath);
  const manifest: Manifest = {
    version: INDEX_VERSION,
    sessionsDir,
    files: prevManifest?.version === INDEX_VERSION && prevManifest.sessionsDir === sessionsDir ? prevManifest.files : {}
  };

  const files = await listJsonlFiles(sessionsDir);
  const daily: Record<string, DailyAgg> = {};
  const tools: Record<string, number> = {};
  const sessions: SessionSummary[] = [];

  for (const file of files) {
    let st: fs.Stats;
    try {
      st = await fsp.stat(file);
    } catch {
      continue;
    }

    const prev = manifest.files[file];
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) {
      sessions.push(prev.summary);
      mergeTools(tools, prev.tools);
      mergeDaily(daily, prev.dailyKey, {
        sessions: 1,
        messages: prev.summary.messages,
        toolCalls: prev.summary.toolCalls,
        errors: prev.summary.errors
      });
      continue;
    }

    const built = await buildFileIndex(file);
    sessions.push(built.summary);
    mergeTools(tools, built.tools);
    mergeDaily(daily, built.dailyKey, {
      sessions: 1,
      messages: built.summary.messages,
      toolCalls: built.summary.toolCalls,
      errors: built.summary.errors
    });

    manifest.files[file] = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      sessionId: built.sessionId,
      summary: built.summary,
      tools: built.tools,
      dailyKey: built.dailyKey
    };
  }

  // 清理 manifest 中已不存在的文件
  for (const file of Object.keys(manifest.files)) {
    if (!files.includes(file)) delete manifest.files[file];
  }

  const totals = {
    files: files.length,
    sessions: sessions.length,
    messages: sessions.reduce((a, s) => a + (s.messages ?? 0), 0),
    toolCalls: sessions.reduce((a, s) => a + (s.toolCalls ?? 0), 0),
    errors: sessions.reduce((a, s) => a + (s.errors ?? 0), 0)
  };

  const snapshot: IndexSnapshot = {
    version: INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    sessionsDir,
    cacheDir,
    totals,
    tools,
    daily,
    sessions
  };

  await writeJsonFile(manifestPath, manifest);
  await writeJsonFile(indexPath, snapshot);
  return snapshot;
}

export async function getIndex(): Promise<IndexSnapshot> {
  if (inMemoryIndex) return inMemoryIndex;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const cacheDir = getCacheDir();
    const indexPath = path.join(cacheDir, INDEX_FILE);
    const cached = await readJsonFile<IndexSnapshot>(indexPath);
    // 如果缓存存在先返回（更快），同时异步刷新由前端的轮询自然拿到
    if (cached?.version === INDEX_VERSION) {
      inMemoryIndex = cached;
      // 触发后台刷新（不阻塞）
      buildOrUpdateIndex()
        .then((fresh) => {
          inMemoryIndex = fresh;
        })
        .catch(() => {});
      return cached;
    }
    const fresh = await buildOrUpdateIndex();
    inMemoryIndex = fresh;
    return fresh;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function timelineCachePath(cacheDir: string, id: string) {
  return path.join(cacheDir, SESSION_DIR, `${encodeURIComponent(id)}.json`);
}

async function findFileForSession(sessionId: string) {
  const sessionsDir = getSessionsDir();
  const files = await listJsonlFiles(sessionsDir);
  const exact = files.find((f) => path.basename(f, ".jsonl") === sessionId);
  if (exact) return exact;
  // 兼容：如果用户传的是 meta id（uuid），尝试在文件内找（慢路径）
  for (const f of files) {
    const stream = fs.createReadStream(f, "utf8");
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const obj: any = safeJsonParse(line);
      if (obj?.type === "session_meta" && obj?.payload?.id === sessionId) return f;
      break; // 只看第一行即可（大概率就是 session_meta）
    }
  }
  return null;
}

async function buildTimeline(file: string, summary: SessionSummary): Promise<SessionTimelineResponse> {
  const events: TimelineEvent[] = [];
  let truncated = false;
  const maxEvents = 5000;
  const callIdToName = new Map<string, string>();

  const stream = fs.createReadStream(file, "utf8");
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const obj: any = safeJsonParse(line);
    if (!obj) continue;

    const ts = toIso(obj.timestamp) ?? "";

    if (obj.type === "event_msg" && obj.payload?.type === "turn_aborted") {
      events.push({ ts, kind: "error", text: "turn_aborted" });
    }

    if (obj.type === "response_item") {
      const payload = obj.payload ?? {};
      const pt = payload.type;
      if (pt === "message") {
        const role = payload.role;
        const text = extractMessageText(payload) ?? "";
        if (role === "user") events.push({ ts, kind: "user", text });
        else if (role === "assistant") events.push({ ts, kind: "assistant", text });
        else events.push({ ts, kind: "other", text });
      } else if (pt === "function_call" || pt === "custom_tool_call") {
        const name = typeof payload.name === "string" ? payload.name : "unknown";
        const callId = typeof payload.call_id === "string" ? payload.call_id : null;
        if (callId) callIdToName.set(callId, name);
        const args = typeof payload.arguments === "string" ? payload.arguments : null;
        const input = typeof payload.input === "string" ? payload.input : null;
        events.push({ ts, kind: "tool_call", name, text: args ?? "" });
        if (!args && input) {
          events[events.length - 1] = { ts, kind: "tool_call", name, text: input };
        }
      } else if (pt === "function_call_output" || pt === "custom_tool_call_output") {
        const callId = typeof payload.call_id === "string" ? payload.call_id : null;
        const name =
          typeof payload.name === "string" ? payload.name : callId ? callIdToName.get(callId) : undefined;
        const out = typeof payload.output === "string" ? payload.output : "";
        events.push({ ts, kind: "tool_output", name, text: out });
      }
    }

    if (events.length >= maxEvents) {
      truncated = true;
      break;
    }
  }

  return { summary, truncated, events };
}

export async function getSessionTimeline(sessionId: string): Promise<SessionTimelineResponse> {
  const index = await getIndex();
  const cacheDir = index.cacheDir;
  const session = index.sessions.find((s) => s.id === sessionId) ?? null;
  const file = session?.file ?? (await findFileForSession(sessionId));

  if (!file) {
    return {
      summary: {
        id: sessionId,
        file: "",
        startedAt: null,
        endedAt: null,
        durationSec: null,
        cwd: null,
        originator: null,
        cliVersion: null,
        messages: 0,
        toolCalls: 0,
        errors: 1
      },
      truncated: false,
      events: [{ ts: new Date().toISOString(), kind: "error", text: "未找到对应 session 文件" }]
    };
  }

  const st = await fsp.stat(file);
  const cachePath = timelineCachePath(cacheDir, sessionId);
  const cached = await readJsonFile<SessionTimelineResponse & { fileMtimeMs?: number; fileSize?: number }>(cachePath);

  if (cached && cached.fileMtimeMs === st.mtimeMs && cached.fileSize === st.size) {
    return { summary: cached.summary, truncated: cached.truncated, events: cached.events };
  }

  const summary = session ?? (await buildFileIndex(file)).summary;
  const built = await buildTimeline(file, summary);

  await writeJsonFile(cachePath, { ...built, fileMtimeMs: st.mtimeMs, fileSize: st.size });
  return built;
}

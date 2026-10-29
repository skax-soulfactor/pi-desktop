import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 기억 저장소 (설계 DESIGN-AGENT.md §4 "지식베이스"). 기억 하나 = Markdown 파일 하나.
 *
 * desktop-agent는 SQLite·FTS·벡터를 썼지만, Pi의 "파일이 곧 인터페이스" 원칙에 맞춰 사람이 직접 읽고
 * 고치고 지울 수 있는 파일로 둔다. 잊은 기억은 지우지 않고 forgotten/으로 옮겨 되돌릴 수 있게 한다.
 */

export type MemoryKind = "preference" | "fact" | "lesson";
export const MEMORY_KINDS: MemoryKind[] = ["preference", "fact", "lesson"];

export interface Memory {
  id: string;
  kind: MemoryKind;
  created: string;
  text: string;
  /** 턴이 끝난 뒤 자동으로 뽑은 기억이면 "auto" */
  source?: "auto";
  /** 마지막으로 고친 때 */
  updated?: string;
}

export function memoryDir(dataDir: string): string {
  return join(dataDir, "memory");
}

export async function loadMemories(dir: string): Promise<Memory[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const memories: Memory[] = [];
  for (const name of names.filter((n) => n.endsWith(".md"))) {
    try {
      const parsed = parseMemory(name.slice(0, -3), await readFile(join(dir, name), "utf8"));
      if (parsed) memories.push(parsed);
    } catch {
      // 읽지 못하는 파일은 건너뛴다 (사람이 고치다 만 파일 하나 때문에 기억 전체가 사라지면 안 된다)
    }
  }
  // 저장한 순서대로 (같은 초에 여럿이면 id 순)
  return memories.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

export async function saveMemory(dir: string, kind: MemoryKind, text: string, now = new Date(), source?: "auto"): Promise<Memory> {
  const memory: Memory = { id: newId(now), kind, created: now.toISOString(), text: text.trim(), ...(source ? { source } : {}) };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${memory.id}.md`), formatMemory(memory), "utf8");
  return memory;
}

/** 기억을 고친다 (만든 때와 출처는 그대로). 없으면 undefined */
export async function updateMemory(
  dir: string,
  id: string,
  patch: { kind?: MemoryKind; text: string },
  now = new Date(),
): Promise<Memory | undefined> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
  const file = join(dir, `${id}.md`);
  let current: Memory | undefined;
  try {
    current = parseMemory(id, await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
  if (!current) return undefined;
  const next: Memory = { ...current, kind: patch.kind ?? current.kind, text: patch.text.trim(), updated: now.toISOString() };
  await writeFile(file, formatMemory(next), "utf8");
  return next;
}

/** 기억을 잊는다. 파일은 forgotten/으로 옮겨 되돌릴 수 있게 한다. 없으면 false */
export async function forgetMemory(dir: string, id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return false;
  try {
    await mkdir(join(dir, "forgotten"), { recursive: true });
    await rename(join(dir, `${id}.md`), join(dir, "forgotten", `${id}.md`));
    return true;
  } catch {
    return false;
  }
}

export function formatMemory(memory: Memory): string {
  const extra = `${memory.source ? `source: ${memory.source}\n` : ""}${memory.updated ? `updated: ${memory.updated}\n` : ""}`;
  return `---\nkind: ${memory.kind}\ncreated: ${memory.created}\n${extra}---\n${memory.text}\n`;
}

export function parseMemory(id: string, content: string): Memory | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return undefined;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const kind = MEMORY_KINDS.includes(fields.kind as MemoryKind) ? (fields.kind as MemoryKind) : "fact";
  const text = match[2]!.trim();
  if (!text) return undefined;
  return {
    id,
    kind,
    created: fields.created ?? "",
    text,
    ...(fields.source === "auto" ? { source: "auto" as const } : {}),
    ...(fields.updated ? { updated: fields.updated } : {}),
  };
}

/** 시간이 드러나는 짧은 id (예: 20261029-134210-a1b2) */
function newId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 기억 설정 파일 (사람이 고칠 수 있는 JSON). 지금은 자동 기억 켜기·끄기만 있다 */
export function memorySettingsFile(dir: string): string {
  return join(dir, "settings.json");
}

/** 턴이 끝난 뒤 자동으로 기억을 뽑는가. 파일이 없거나 읽지 못하면 켠 것으로 본다 */
export async function loadAutoLearn(dir: string): Promise<boolean> {
  try {
    const settings = JSON.parse(await readFile(memorySettingsFile(dir), "utf8")) as { autoLearn?: unknown };
    return settings.autoLearn !== false;
  } catch {
    return true;
  }
}

export async function saveAutoLearn(dir: string, on: boolean): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(memorySettingsFile(dir), `${JSON.stringify({ autoLearn: on }, null, 2)}\n`, "utf8");
}

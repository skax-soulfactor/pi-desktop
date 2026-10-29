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

export async function saveMemory(dir: string, kind: MemoryKind, text: string, now = new Date()): Promise<Memory> {
  const memory: Memory = { id: newId(now), kind, created: now.toISOString(), text: text.trim() };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${memory.id}.md`), formatMemory(memory), "utf8");
  return memory;
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
  return `---\nkind: ${memory.kind}\ncreated: ${memory.created}\n---\n${memory.text}\n`;
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
  return text ? { id, kind, created: fields.created ?? "", text } : undefined;
}

/** 시간이 드러나는 짧은 id (예: 20261029-134210-a1b2) */
function newId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

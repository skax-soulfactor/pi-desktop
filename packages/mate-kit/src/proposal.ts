import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { InboxItem, Severity } from "./shared";

export interface ProposalInput {
  title: string;
  summary: string;
  detail?: string;
  severity?: Severity;
  /** 관찰자 실행이 붙이는 주제 */
  topic?: string;
  /** "Mate에게 맡기기"로 실행할 지시와 폴더 */
  followUp?: { prompt: string; cwd: string };
}

/** 같은 임무에서 제목과 요약이 같으면 같은 제안으로 본다 (공백 차이는 무시) */
export function proposalHash(dutyId: string, title: string, summary: string): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(`${dutyId}\n${norm(title)}\n${norm(summary)}`).digest("hex").slice(0, 16);
}

export function makeProposal(input: ProposalInput, ids: { dutyId: string; runId: string }, now = Date.now()): InboxItem {
  return {
    id: randomUUID(),
    hash: proposalHash(ids.dutyId, input.title, input.summary),
    dutyId: ids.dutyId,
    runId: ids.runId,
    title: input.title.trim(),
    summary: input.summary.trim(),
    ...(input.detail?.trim() ? { detail: input.detail.trim() } : {}),
    severity: input.severity ?? "info",
    ...(input.topic ? { topic: input.topic } : {}),
    ...(input.followUp?.prompt.trim() ? { followUp: { prompt: input.followUp.prompt.trim(), cwd: input.followUp.cwd } } : {}),
    createdAt: now,
  };
}

/** inbox.jsonl을 읽는다. 깨진 줄(쓰는 도중 끊긴 줄 등)은 건너뛴다 */
export async function readInbox(path: string): Promise<InboxItem[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const items: InboxItem[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line) as InboxItem;
      if (item && typeof item.id === "string" && typeof item.hash === "string") items.push(item);
    } catch {
      // 건너뜀
    }
  }
  return items;
}

/**
 * 제안을 인박스에 더한다. 같은 해시가 이미 있으면(이미 알렸거나 사용자가 버린 제안) 더하지 않고 false.
 * 한 줄을 한 번의 append로 쓰므로 앱이 읽는 도중에도 줄이 섞이지 않는다.
 */
export async function appendProposal(path: string, item: InboxItem): Promise<boolean> {
  const existing = await readInbox(path);
  if (existing.some((e) => e.hash === item.hash)) return false;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(item)}\n`, "utf8");
  return true;
}

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendProposal, makeProposal, proposalHash, readInbox } from "../src/proposal";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("proposal", () => {
  it("같은 임무의 같은 제목·요약은 같은 해시 (공백 차이 무시)", () => {
    expect(proposalHash("d", "CI 실패", "unit  테스트")).toBe(proposalHash("d", " CI 실패", "unit 테스트\n"));
    expect(proposalHash("d", "CI 실패", "x")).not.toBe(proposalHash("other", "CI 실패", "x"));
  });

  it("인박스에 쌓고, 이미 있는 제안은 다시 쌓지 않는다", async () => {
    dir = await mkdtemp(join(tmpdir(), "mate-inbox-"));
    const path = join(dir, "nested", "inbox.jsonl");
    const ids = { dutyId: "brief", runId: "r1" };
    expect(await appendProposal(path, makeProposal({ title: "A", summary: "s", severity: "warn" }, ids, 1))).toBe(true);
    expect(await appendProposal(path, makeProposal({ title: "A", summary: "s" }, { ...ids, runId: "r2" }, 2))).toBe(false);
    expect(await appendProposal(path, makeProposal({ title: "B", summary: "s", detail: "  " }, ids, 3))).toBe(true);
    const items = await readInbox(path);
    expect(items.map((i) => [i.title, i.severity, i.detail])).toEqual([["A", "warn", undefined], ["B", "info", undefined]]);
  });
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareCopy, CopyStore, exportKindOf, fileShas, sameFiles } from "../../src/main/copies";
import type { CopyRecordInput } from "../../src/shared/api";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

const input: CopyRecordInput = {
  kind: "skill",
  name: "pdf",
  fromHostId: "local",
  fromPath: "C:\\Users\\me\\.pi\\agent\\skills\\pdf\\SKILL.md",
  toHostId: "wsl:Ubuntu",
  toPath: "/home/me/.pi/agent/skills/pdf/SKILL.md",
  files: [
    { path: "SKILL.md", contentBase64: b64("hi\n") },
    { path: "scripts/a.py", contentBase64: b64("print(1)\n") },
  ],
};

describe("fileShas·sameFiles", () => {
  it("git blob SHA로 기록하고, 파일 하나짜리는 이름이 달라도 내용으로 견준다", () => {
    // git hash-object로 확인한 값: printf 'hi\n' | git hash-object --stdin
    expect(fileShas([{ path: "a", contentBase64: b64("hi\n") }])).toEqual({ a: "45b983be36b73c0788dc9cbcb76cbb80fc7bb057" });
    expect(sameFiles({ "review.md": "x" }, { "SKILL.md": "x" })).toBe(true);
    expect(sameFiles({ a: "1", b: "2" }, { a: "1", b: "2" })).toBe(true);
    expect(sameFiles({ a: "1", b: "2" }, { a: "1", b: "3" })).toBe(false);
    expect(sameFiles({ a: "1", b: "2" }, { a: "1", b: "2", c: "4" })).toBe(false);
    expect(exportKindOf("context")).toBe("prompt");
  });
});

describe("CopyStore", () => {
  it("대상 위치마다 하나만 두고 파일에 남긴다", () => {
    const file = join(mkdtempSync(join(tmpdir(), "pi-copies-")), "copies.json");
    const store = new CopyStore(file);
    store.add(input, 1);
    store.add({ ...input, fromHostId: "ssh:phone" }, 2);
    expect(store.listTo("wsl:Ubuntu")).toHaveLength(1);
    expect(store.listTo("wsl:Ubuntu")[0]).toMatchObject({ fromHostId: "ssh:phone", copiedAt: 2 });
    expect(store.listTo("local")).toEqual([]);
    expect(new CopyStore(file).listTo("wsl:Ubuntu")[0]!.files["scripts/a.py"]).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.parse(readFileSync(file, "utf8")).copies).toHaveLength(1);
  });
});

describe("compareCopy", () => {
  const record = { ...input, files: fileShas(input.files), copiedAt: 1 };

  it("사본과 원본을 각각 견준다", async () => {
    const changed = { ...record.files, "SKILL.md": "0" };
    expect(await compareCopy(record, async (side) => (side === "local" ? record.files : changed))).toEqual({
      toPath: record.toPath,
      local: "same",
      source: "changed",
    });
  });

  it("없어진 것과 확인 못한 것을 나눈다", async () => {
    const status = await compareCopy(record, async (side) => {
      throw new Error(side === "local" ? "파일이 없습니다: /x" : "연결되지 않았습니다");
    });
    expect(status).toMatchObject({ local: "missing", source: "unknown", error: "연결되지 않았습니다" });
  });
});

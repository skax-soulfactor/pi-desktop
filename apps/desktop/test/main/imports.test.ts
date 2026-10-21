import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ImportRecord } from "../../src/shared/api";
import { ImportStore } from "../../src/main/imports";

const record = (target: string, name = "pdf"): ImportRecord => ({
  hostId: "local",
  kind: "skill",
  name,
  scope: "user",
  target,
  source: { owner: "anthropics", repo: "skills", sha: "a".repeat(40), path: "skills/pdf" },
  files: { "SKILL.md": "s1" },
  importedAt: 1,
});

describe("ImportStore", () => {
  it("기록을 저장하고, 같은 호스트·같은 위치는 바꾸며, 호스트별로 돌려준다", () => {
    const file = join(mkdtempSync(join(tmpdir(), "pi-imports-")), "imports.json");
    const store = new ImportStore(file);
    store.add(record("/a/skills/pdf"));
    store.add({ ...record("/a/skills/pdf"), importedAt: 2 });
    store.add({ ...record("/b"), hostId: "wsl:Ubuntu" });
    const reread = new ImportStore(file);
    expect(reread.list("local")).toEqual([{ ...record("/a/skills/pdf"), importedAt: 2 }]);
    expect(reread.list()).toHaveLength(2);
  });

  it("깨진 파일은 빈 목록", () => {
    const file = join(mkdtempSync(join(tmpdir(), "pi-imports-")), "imports.json");
    writeFileSync(file, "{");
    expect(new ImportStore(file).list()).toEqual([]);
  });
});

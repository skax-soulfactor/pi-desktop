import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileIndex, listGitFiles, rankPaths, walkFiles, withDirectories } from "../src/file-search";

describe("rankPaths", () => {
  const paths = ["src/app.ts", "src/App.test.ts", "docs/app-guide.md", "src/main/application.ts", "README.md", "src/"];

  it("이름이 같음 → 이름 시작 → 이름 포함 → 경로 포함 → 순서대로 포함", () => {
    expect(rankPaths(["x/app", "app-x", "my-app", "app/x", "a_p_p"], "app", 10)).toEqual(["x/app", "app-x", "my-app", "app/x", "a_p_p"]);
  });

  it("같은 등급이면 짧은 경로가 먼저, 대소문자는 가리지 않는다", () => {
    expect(rankPaths(paths, "app", 3)).toEqual(["src/app.ts", "src/App.test.ts", "docs/app-guide.md"]);
  });

  it("경로를 넣어 찾을 수 있고, ./ 와 \\ 는 정리한다", () => {
    expect(rankPaths(paths, "./src\\main", 5)).toEqual(["src/main/application.ts"]);
  });

  it("검색어가 비면 얕은 경로부터", () => {
    expect(rankPaths(paths, "", 2)).toEqual(["src/", "README.md"]);
  });
});

describe("withDirectories", () => {
  it("상위 폴더를 끝에 / 를 붙여 함께 넣는다", () => {
    expect(withDirectories(["a/b/c.ts", "a/d.ts"])).toEqual(["a/", "a/b/", "a/b/c.ts", "a/d.ts"]);
  });
});

describe("파일 목록", () => {
  function project(): string {
    const dir = mkdtempSync(join(tmpdir(), "file-search-"));
    mkdirSync(join(dir, "src", "deep"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "src", "deep", "a.ts"), "");
    writeFileSync(join(dir, "README.md"), "");
    writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "");
    writeFileSync(join(dir, "ignored.log"), "");
    writeFileSync(join(dir, ".gitignore"), "*.log\n");
    return dir;
  }

  it("git이 아니면 생성물 폴더를 빼고 훑으며, 개수 제한을 넘으면 truncated", async () => {
    const dir = project();
    expect(await listGitFiles(dir, 100)).toBeUndefined();
    const list = await walkFiles(dir, 100);
    expect(list.paths.sort()).toEqual([".gitignore", "README.md", "ignored.log", "src/deep/a.ts"]);
    expect((await walkFiles(dir, 2)).truncated).toBe(true);
  });

  it("git 저장소면 .gitignore를 따른다 (추적하지 않은 새 파일도 포함)", async () => {
    const dir = project();
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
    } catch {
      return; // git이 없는 환경
    }
    const list = await listGitFiles(dir, 100);
    expect(list?.paths.sort()).toEqual([".gitignore", "README.md", "node_modules/pkg/index.js", "src/deep/a.ts"]);
  });
});

describe("FileIndex", () => {
  it("목록을 작업 폴더별로 캐시하고, 시간이 지나면 다시 만든다", async () => {
    let calls = 0;
    const index = new FileIndex({
      ttlMs: 50,
      list: async () => {
        calls++;
        return { paths: ["src/a.ts", "b.md"], truncated: false };
      },
    });
    expect((await index.search("/p", "a.ts")).files).toEqual(["src/a.ts"]);
    await index.search("/p", "b");
    expect(calls).toBe(1);
    await new Promise((r) => setTimeout(r, 60));
    await index.search("/p", "b");
    expect(calls).toBe(2);
  });

  it("목록 만들기에 실패하면 다음 요청에서 다시 시도한다", async () => {
    let calls = 0;
    const index = new FileIndex({
      list: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return { paths: ["x.ts"], truncated: false };
      },
    });
    await expect(index.search("/p", "x")).rejects.toThrow("boom");
    expect((await index.search("/p", "x")).files).toEqual(["x.ts"]);
  });
});

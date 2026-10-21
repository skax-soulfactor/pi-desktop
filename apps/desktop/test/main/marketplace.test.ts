import { describe, expect, it } from "vitest";
import { isNpmName, parseDetail, parseSearch, searchUrl } from "../../src/main/marketplace";

describe("isNpmName", () => {
  it("npm 이름(scope 포함)만 통과시킨다", () => {
    expect(isNpmName("pi-mcp-adapter")).toBe(true);
    expect(isNpmName("@earendil-works/pi-tools")).toBe(true);
    expect(isNpmName("Bad Name")).toBe(false);
    expect(isNpmName("x; rm -rf /")).toBe(false);
    expect(isNpmName("--global")).toBe(false);
  });
});

describe("searchUrl", () => {
  it("pi-package 키워드로 거르고 검색어를 붙인다", () => {
    const url = new URL(searchUrl("mcp server", 20, 10));
    expect(url.searchParams.get("text")).toBe("keywords:pi-package mcp server");
    expect(url.searchParams.get("from")).toBe("20");
    expect(new URL(searchUrl("", 0, 10)).searchParams.get("text")).toBe("keywords:pi-package");
  });
});

describe("parseSearch", () => {
  it("npm 검색 결과에서 필요한 값만 꺼낸다", () => {
    const result = parseSearch({
      total: 2,
      objects: [
        {
          package: {
            name: "pi-mcp-adapter",
            version: "5.4.0",
            description: "MCP adapter",
            date: "2026-10-20T06:23:57.736Z",
            publisher: { username: "nico" },
            links: { repository: "git+https://github.com/x/y.git" },
          },
          downloads: { monthly: 1565803, weekly: 1 },
        },
        { package: { name: "bare", version: "1.0.0" } },
      ],
    });
    expect(result.total).toBe(2);
    expect(result.packages[0]).toEqual({
      name: "pi-mcp-adapter",
      version: "5.4.0",
      description: "MCP adapter",
      updated: Date.parse("2026-10-20T06:23:57.736Z"),
      publisher: "nico",
      monthlyDownloads: 1565803,
      repository: "git+https://github.com/x/y.git",
    });
    expect(result.packages[1]).toEqual({ name: "bare", version: "1.0.0" });
  });
});

describe("parseDetail", () => {
  const doc = {
    name: "pi-tools",
    readme: "# pi-tools",
    "dist-tags": { latest: "2.0.0" },
    time: { "1.0.0": "2026-01-01T00:00:00Z", "2.0.0": "2026-06-01T00:00:00Z", "2.1.0-beta.1": "2026-07-01T00:00:00Z" },
    repository: { url: "git+https://github.com/x/pi-tools.git" },
    versions: {
      "1.0.0": {},
      "2.1.0-beta.1": {},
      "2.0.0": {
        description: "도구 모음",
        license: "MIT",
        pi: { extensions: ["./index.ts"], skills: ["./skills"], prompts: [], image: "x.png" },
        dependencies: { zod: "^4" },
        scripts: { test: "vitest", postinstall: "node setup.js" },
      },
    },
  };

  it("최신 버전의 매니페스트로 종류·코드 실행 여부·의존성·설치 스크립트를 정리한다", () => {
    expect(parseDetail(doc)).toEqual({
      name: "pi-tools",
      latest: "2.0.0",
      description: "도구 모음",
      license: "MIT",
      repository: "https://github.com/x/pi-tools.git",
      readme: "# pi-tools",
      versions: ["2.0.0", "1.0.0"],
      updated: Date.parse("2026-06-01T00:00:00Z"),
      manifest: "declared",
      kinds: ["extensions", "skills"],
      mayRunCode: true,
      dependencies: ["zod"],
      installScripts: ["postinstall"],
    });
  });

  it("pi 매니페스트가 없으면 관례 폴더로 찾으므로 코드 실행 가능성이 있다고 본다", () => {
    const detail = parseDetail({ ...doc, versions: { "2.0.0": {} } });
    expect(detail).toMatchObject({ manifest: "conventional", kinds: [], mayRunCode: true });
  });

  it("스킬·프롬프트만 선언한 패키지는 코드를 실행하지 않는다", () => {
    const detail = parseDetail({ ...doc, versions: { "2.0.0": { pi: { skills: ["./skills"] } } } });
    expect(detail).toMatchObject({ kinds: ["skills"], mayRunCode: false });
  });
});

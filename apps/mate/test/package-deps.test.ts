import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 워크스페이스 패키지(@pi-desktop/*)는 TypeScript 원본 그대로라 빌드할 때 번들에 넣어야 한다.
 * electron-vite의 externalizeDepsPlugin은 package.json의 dependencies에 적힌 것을 번들 밖으로 빼고,
 * electron-builder가 설치본의 node_modules에 원본(.ts)을 담는다. 그러면 설치본이 시작하자마자
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING으로 멈춘다 (agent-v0.1.28·mate-v0.5.9). 개발 실행과 CI 테스트는
 * 원본을 그대로 읽으므로 이 실수를 잡지 못한다.
 */
describe("package.json", () => {
  it("워크스페이스 패키지는 dependencies가 아니라 devDependencies에 둔다", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).filter((name) => name.startsWith("@pi-desktop/"))).toEqual([]);
  });
});

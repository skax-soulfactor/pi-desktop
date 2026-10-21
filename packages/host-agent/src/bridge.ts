import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * pi-desktop-bridge 확장 (설계 §5.3).
 *
 * Pi RPC에는 리소스를 다시 불러오는 명령이 없고, 확장 명령 안의 ctx.reload()로만 할 수 있다.
 * 그래서 데몬이 Pi를 띄울 때 이 작은 확장을 `-e`로 넣는다. 사용자 설정에는 기록하지 않는다.
 * 앱은 리소스를 저장한 뒤 `/desktop:reload`를 prompt로 보내 실행 중인 세션에 반영한다.
 *
 * 확장은 그 호스트의 Pi가 jiti로 불러오므로, 다른 모듈을 import하지 않는 TypeScript 한 파일로 둔다.
 */

/** 앱이 보내는 명령 이름 (/desktop:reload) */
export const RELOAD_COMMAND = "desktop:reload";

export const BRIDGE_SOURCE = `// Pi Desktop이 Pi를 띄울 때 -e로 넣는 확장입니다. 직접 고치지 마세요 (앱이 다시 씁니다).
export default function (pi: any) {
  pi.registerCommand("${RELOAD_COMMAND}", {
    description: "Pi Desktop: AGENTS.md·프롬프트·스킬·확장을 다시 불러옵니다",
    handler: async (_args: string, ctx: any) => {
      // 응답 중에 바꾸면 그 턴의 지침이 섞이므로, 끝난 뒤에만 다시 불러온다.
      if (!ctx.isIdle()) {
        ctx.ui.notify("작업 중에는 리소스를 다시 불러올 수 없습니다. 끝난 뒤 다시 시도하세요", "warning");
        return;
      }
      // reload 뒤에는 예전 확장 런타임의 ctx를 쓰면 안 되므로 여기서 끝낸다.
      await ctx.reload();
    },
  });
}
`;

/** 내용 해시를 이름에 넣은 bridge 파일을 dir에 두고 그 경로를 돌려준다. 같은 내용이면 다시 쓰지 않는다 */
export async function ensureBridge(dir: string): Promise<string> {
  const hash = createHash("sha256").update(BRIDGE_SOURCE).digest("hex").slice(0, 12);
  const path = join(dir, `pi-desktop-bridge-${hash}.ts`);
  if (existsSync(path)) return path;
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, BRIDGE_SOURCE, "utf8");
  await rename(tmp, path);
  return path;
}

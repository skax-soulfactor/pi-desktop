import { execFile } from "node:child_process";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { DataBackupResult } from "@pi-desktop/host-protocol";

const execFileAsync = promisify(execFile);

/**
 * Pi 데이터 폴더(~/.pi/agent) 백업과 삭제 (설계 §4.9 "제거"의 데이터 처리).
 *
 * - 백업: <앱 홈>/backups/pi-agent-<날짜시각>.tar.gz. auth.json(자격 증명)이 들어 있으므로 POSIX에서는 600.
 *   Windows는 System32의 tar(bsdtar)를 쓴다. Git for Windows의 GNU tar는 "C:\..."를 원격 호스트로 해석하기 때문이다.
 * - 삭제: 되돌릴 수 없으므로 데몬도 따로 막는다. 홈·루트·너무 얕은 경로는 거부하고,
 *   앱이 보낸 확인 값(앱이 데몬에게 받은 데이터 폴더 경로)이 실제 경로와 같아야 한다. 두 쪽이 같은 폴더를 가리키는지
 *   맞추기 위해서다 (사람의 확인은 화면에서 따로 받는다). 실행 중인 세션이 있거나 Pi가 그 안에 설치되어 있으면
 *   호출하는 쪽(데몬)이 거부한다.
 */

export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pi-agent-${stamp}.tar.gz`;
}

export function tarCommand(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  return platform === "win32" ? join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
}

/**
 * 지워도 되는 데이터 폴더인지. 이유가 있으면 돌려준다 (없으면 통과).
 * 홈 자체, 파일 시스템 루트, 깊이가 너무 얕은 경로(예: /home)는 거부한다.
 */
export function deleteGuard(agentDir: string, home: string = homedir()): string | undefined {
  const target = resolve(agentDir);
  const root = parse(target).root;
  if (target === root) return "파일 시스템 루트는 지울 수 없습니다";
  if (target === resolve(home)) return "홈 폴더는 지울 수 없습니다";
  if (resolve(home).startsWith(target + sep)) return "홈 폴더를 포함하는 폴더는 지울 수 없습니다";
  const depth = target.slice(root.length).split(/[\\/]/).filter(Boolean).length;
  if (depth < 3) return "너무 얕은 경로는 지울 수 없습니다";
  return undefined;
}

/** 데이터 폴더를 tar.gz로 백업한다 */
export async function backupAgentDir(agentDir: string, backupDir: string, now = new Date()): Promise<DataBackupResult> {
  const source = resolve(agentDir);
  if (!(await stat(source).catch(() => undefined))?.isDirectory()) throw new Error(`데이터 폴더가 없습니다: ${source}`);
  await mkdir(backupDir, { recursive: true });
  const path = join(backupDir, backupFileName(now));
  await execFileAsync(tarCommand(), ["-czf", path, "-C", dirname(source), basename(source)], {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (process.platform !== "win32") await chmod(path, 0o600);
  return { path, bytes: (await stat(path)).size };
}

/** 데이터 폴더를 지운다. confirm은 데이터 폴더의 경로와 같아야 한다 */
export async function deleteAgentDir(agentDir: string, confirm: string, home: string = homedir()): Promise<void> {
  const reason = deleteGuard(agentDir, home);
  if (reason) throw new Error(reason);
  if (resolve(confirm) !== resolve(agentDir)) throw new Error("확인 문자열이 데이터 폴더 경로와 다릅니다");
  await rm(resolve(agentDir), { recursive: true, force: true });
}

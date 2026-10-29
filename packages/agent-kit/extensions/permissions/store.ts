import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Rule } from "./rules";

/**
 * agent-kit 상태 폴더 (설계 DESIGN-AGENT.md §3).
 * Pi 설정 폴더를 따라간다: PI_CODING_AGENT_DIR이 있으면 그 아래, 없으면 ~/.pi/agent 아래 pi-desktop-agent.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PI_DESKTOP_AGENT_DATA) return env.PI_DESKTOP_AGENT_DATA;
  return join(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "pi-desktop-agent");
}

interface PermissionsFile {
  rules: Rule[];
}

/** 항상 허용·거부 규칙. 사람이 읽고 고칠 수 있는 JSON이다 */
export async function loadRules(dir: string): Promise<Rule[]> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, "permissions.json"), "utf8")) as Partial<PermissionsFile>;
    return Array.isArray(parsed.rules) ? parsed.rules.filter(isRule) : [];
  } catch {
    // 없거나 깨진 파일은 규칙 없음으로 본다 (깨진 파일 때문에 아무것도 못 하게 되면 안 되고, 없으면 묻게 된다)
    return [];
  }
}

export async function addRule(dir: string, rule: Rule): Promise<void> {
  const rules = await loadRules(dir);
  if (rules.some((r) => r.toolName === rule.toolName && r.pattern === rule.pattern && r.action === rule.action)) return;
  await mkdir(dir, { recursive: true });
  const path = join(dir, "permissions.json");
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ rules: [...rules, rule] }, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export interface AuditRecord {
  at: string;
  toolName: string;
  target: string;
  /**
   * allow-rule·deny-rule: 저장된 규칙, once·session·always·deny: 사람이 고름,
   * repeat-deny: 이번 실행에서 거부한 것과 같은 호출, blocked: 위험 명령, unattended: 사람이 없음
   */
  decision:
    | "allow-rule"
    | "deny-rule"
    | "session-rule"
    | "once"
    | "session"
    | "always"
    | "deny"
    | "repeat-deny"
    | "blocked"
    | "unattended";
  cwd: string;
}

/** 승인 판단을 한 줄씩 남긴다. 기록 실패가 도구 실행을 막지는 않는다 */
export async function appendAudit(dir: string, record: AuditRecord): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "audit.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // 감사 로그를 못 쓰는 환경(읽기 전용 홈 등)에서도 승인 자체는 동작해야 한다
  }
}

function isRule(value: unknown): value is Rule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.toolName === "string" && typeof r.pattern === "string" && (r.action === "allow" || r.action === "deny");
}

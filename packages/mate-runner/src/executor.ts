import { spawn, execFile } from "node:child_process";
import { resolve } from "node:path";
import { ASK_TOOL, MATE_ENV, PROPOSE_TOOL, profileTools, type MateProfile } from "@pi-desktop/mate-kit";
import { isolationArgs, isolationEnv, mcpToolPattern } from "@pi-desktop/pi-isolation";
import type { Duty } from "./types";
import { mateTunables } from "./tunables";

/**
 * 임무 한 번을 `pi --mode json`으로 실행한다 (설계 DESIGN-MATE.md §2.1, §4).
 * Pi는 실행이 끝나면 스스로 종료한다. 시간 제한을 넘으면 프로세스 트리를 끝낸다.
 */

export interface PiLaunch {
  /** Pi를 실행할 node (없으면 실행기 자신의 node) */
  nodePath?: string;
  cliPath: string;
  env?: Record<string, string>;
}

export interface RunInput {
  duty: Duty;
  /** 변화 감지로 돌 때 무엇이 바뀌었는지 (모델에 알린다) */
  cause?: string;
  /** 관찰자 실행: 제안에 붙일 주제 (mate_propose가 환경 변수로 받음) */
  topic?: string;
  runId: string;
  model: string;
  /** mate-kit 확장 진입 파일들 */
  extensions: string[];
  /** Mate 홈에 설치한 Pi 패키지 폴더들 (DESIGN-APPS.md §3.5) */
  packages?: string[];
  /** 그 패키지들이 더하는 도구 이름. --tools에 선언하고, mate-guard가 처음 쓸 때 허용을 묻는다 */
  packageTools?: string[];
  /** Mate 홈. 스킬·프롬프트는 여기서만 올린다 (DESIGN-APPS.md §3.1) */
  home: string;
  /** pi-isolation 폴더 (isolationDirOf) */
  isolationDir: string;
  inboxPath: string;
  sessionsDir: string;
  timeoutSec: number;
  /** 실행당 비용 상한(USD). 0이면 없음. 넘으면 프로세스를 끝낸다 (메시지 단위로 확인하므로 한 메시지만큼 넘을 수 있음) */
  maxCostUsd: number;
  /** act: Pi를 띄울 폴더(작업 공간 안)와 write·edit를 허용할 작업 공간 루트 */
  workspace?: { cwd: string; root: string };
  /** Mate 대화 기록 경로 (mate_ask가 질문을 남김) */
  chatPath?: string;
  /** 허용 목록에 없어 막힌 명령을 mate-guard가 남길 파일. 실행이 끝나면 실행기가 읽어 허용을 묻는다 */
  blockedPath?: string;
  /** 설치 제안 안내 (넣을 수 있는 MCP 서버, 다른 앱에만 있는 스킬). 제안할 수 있는 단계에서만 붙인다 */
  installHints?: string[];
  /** 대화(chat): 권한 단계·시스템 안내·이어 쓸 세션을 바꾼다 (임무 실행에는 쓰지 않음) */
  chat?: { sessionId: string; systemPrompt: string; actionsPath: string };
  /** 지시와 함께 넘길 이미지 파일 (Pi의 `@파일`. 대화에서 붙인 이미지) */
  images?: string[];
}

export interface RunOutcome {
  status: "done" | "failed" | "timeout" | "budget";
  summary?: string;
  error?: string;
  costUsd: number;
  tokens: number;
  proposals: number;
  sessionId?: string;
  /** act: 인박스에 올린 변경의 파일 수 */
  changeFiles?: number;
}

/** pi-isolation 폴더. 개발 중(packages/)에도 설치본(resources/)에도 mate-kit 옆에 있다 */
export function isolationDirOf(kitDir: string): string {
  return resolve(kitDir, "..", "pi-isolation");
}

/** 모든 실행의 시스템 프롬프트 뒤에 붙이는 안내. 줄마다 설정으로 꺼냈다 (tunables.ts의 duty.*) */
export function mateSystemPrompt(duty: Duty, cause?: string, installHints: string[] = []): string {
  const t = mateTunables();
  const tools = { proposeTool: PROPOSE_TOOL, askTool: ASK_TOOL };
  const lines = [
    t.text("duty.head", { dutyName: duty.name }),
    duty.profile === "act" ? t.text("duty.actWorkspace") : t.text("duty.readOnly"),
    t.text("duty.dataNotInstructions"),
  ];
  if (duty.profile === "act") lines.push(t.text("duty.actMinimal"));
  if (duty.profile !== "observe") lines.push(t.text("duty.propose", tools));
  if (duty.profile !== "observe") lines.push(t.text("duty.ask", tools));
  if (duty.grants?.length) lines.push(t.text("duty.grants", { grants: duty.grants.join(", ") }));
  lines.push(t.text("duty.blocked"));
  if (duty.profile !== "observe") {
    lines.push(t.text("duty.install", tools));
    lines.push(...installHints);
  }
  if (cause) lines.push(t.text("duty.cause", { cause }));
  // 일찍 손을 놓지 않게 한다: 막히지 않았는데 "충분하다"며 범위의 일부만 하고 끝낸 일이 있었다 (HN 임무, Haiku)
  lines.push(t.text("duty.finishScope"));
  lines.push(duty.profile === "observe" ? t.text("duty.observeReport") : t.text("duty.summary"));
  return lines.join("\n");
}

export function piArgs(input: RunInput): string[] {
  const { duty } = input;
  const servers = duty.mcpServers ?? [];
  return [
    "--mode", "json",
    "--session-dir", input.sessionsDir,
    // 대화는 같은 세션을 이어 써서 앞의 말을 기억한다
    ...(input.chat ? ["--session-id", input.chat.sessionId] : []),
    // Pi Desktop의 스킬·프롬프트·확장·사용자 지침이 끼어들지 않게 Mate 홈의 것만 올린다.
    // 스킬은 임무가 고른 것만(없으면 전부), MCP는 임무가 고른 서버가 있을 때만 올린다 (DESIGN-APPS.md §3.4)
    ...isolationArgs({
      home: input.home,
      isolationDir: input.isolationDir,
      extensions: [...input.extensions, ...(input.packages ?? [])],
      mcp: servers.length > 0,
      ...(duty.skills ? { skills: duty.skills } : {}),
    }),
    // 고른 서버의 도구는 이름 패턴으로 선언한다. 처음 쓰는 도구는 mate-guard가 막고 허용을 묻는다
    "--tools", [...profileTools(input.chat ? "chat" : duty.profile), ...servers.map(mcpToolPattern), ...(input.packageTools ?? [])].join(","),
    // 모델을 정하지 않았으면 Pi 기본 모델(settings.json)을 따른다
    ...(input.model ? ["--model", input.model] : []),
    "--append-system-prompt", input.chat?.systemPrompt ?? mateSystemPrompt(duty, input.cause, input.installHints),
    ...(input.images ?? []).map((file) => `@${file}`),
    duty.prompt,
  ];
}

export function piEnv(input: RunInput, profile: MateProfile): Record<string, string> {
  const servers = input.duty.mcpServers ?? [];
  return {
    // MCP 도구를 codemode가 아니라 도구 목록에 바로 선언해야 mate-guard가 도구마다 허용을 따진다
    ...isolationEnv(input.home, servers.length > 0 ? { mcpServers: servers, mcpExposure: "direct" } : {}),
    [MATE_ENV.profile]: input.chat ? "chat" : profile,
    ...(input.chatPath ? { [MATE_ENV.chat]: input.chatPath } : {}),
    ...(input.chat ? { [MATE_ENV.actions]: input.chat.actionsPath } : {}),
    [MATE_ENV.inbox]: input.inboxPath,
    [MATE_ENV.dutyId]: input.duty.id,
    [MATE_ENV.runId]: input.runId,
    ...(input.workspace ? { [MATE_ENV.writeRoot]: input.workspace.root } : {}),
    ...(input.topic ? { [MATE_ENV.topic]: input.topic } : {}),
    // 대화(chat)는 대화용 임무에 허용한 MCP 도구만 들어 있다 (chat-agent가 설정의 chatGrants로 채움)
    ...(input.duty.grants?.length ? { [MATE_ENV.grants]: input.duty.grants.join(",") } : {}),
    ...(input.blockedPath ? { [MATE_ENV.blocked]: input.blockedPath } : {}),
    ...(input.packageTools?.length ? { [MATE_ENV.packages]: input.packageTools.join(",") } : {}),
  };
}

/** JSON 이벤트 줄들을 모아 실행 결과를 만든다 (Pi docs/json.md) */
export class EventSummary {
  sessionId: string | undefined;
  lastText = "";
  costUsd = 0;
  tokens = 0;
  proposals = 0;
  errorMessage: string | undefined;
  settled = false;

  push(line: string): void {
    let event: Record<string, any>;
    try {
      event = JSON.parse(line) as Record<string, any>;
    } catch {
      return;
    }
    switch (event.type) {
      case "session":
        if (typeof event.id === "string") this.sessionId = event.id;
        break;
      case "message_end": {
        const message = event.message as Record<string, any> | undefined;
        if (message?.role !== "assistant") break;
        const usage = message.usage as { totalTokens?: number; cost?: { total?: number } } | undefined;
        this.costUsd += usage?.cost?.total ?? 0;
        this.tokens += usage?.totalTokens ?? 0;
        const text = Array.isArray(message.content)
          ? message.content.filter((c: any) => c?.type === "text").map((c: any) => String(c.text ?? "")).join("")
          : "";
        if (text.trim()) this.lastText = text.trim();
        if (message.stopReason === "error") this.errorMessage = String(message.errorMessage ?? "모델 오류");
        else if (message.stopReason === "stop" || message.stopReason === "toolUse") this.errorMessage = undefined;
        break;
      }
      case "tool_execution_end":
        if (event.toolName === PROPOSE_TOOL && !event.isError && event.result?.details?.added) this.proposals++;
        break;
      case "agent_settled":
        this.settled = true;
        break;
    }
  }
}

// 마지막 답의 상한은 설정으로 꺼냈다 (duty.summaryChars). observe 임무는 이 답이 보고서 전체라 넉넉히 둔다 (4000자에서 뒷부분이 잘렸다)

export function runPi(launch: PiLaunch, input: RunInput, signal?: AbortSignal): Promise<RunOutcome> {
  return new Promise((resolve) => {
    const summary = new EventSummary();
    let stderr = "";
    let buffer = "";
    let timedOut = false;
    let overBudget = false;
    const child = spawn(launch.nodePath ?? process.execPath, [launch.cliPath, ...piArgs(input)], {
      cwd: input.workspace?.cwd ?? input.duty.cwd,
      env: { ...withoutSecrets(process.env), ...launch.env, ...piEnv(input, input.duty.profile) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, input.timeoutSec * 1000);
    const onAbort = () => killTree(child.pid);
    signal?.addEventListener("abort", onAbort, { once: true });

    // JSON 모드는 LF로만 줄을 나눈다 (유니코드 줄 구분자는 문자열 안에 올 수 있음)
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        summary.push(buffer.slice(0, at).replace(/\r$/, ""));
        if (input.maxCostUsd > 0 && summary.costUsd > input.maxCostUsd && !overBudget) {
          overBudget = true;
          killTree(child.pid);
        }
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    const finish = (code: number | null, spawnError?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (buffer.trim()) summary.push(buffer);
      const base = {
        costUsd: summary.costUsd,
        tokens: summary.tokens,
        proposals: summary.proposals,
        ...(summary.sessionId ? { sessionId: summary.sessionId } : {}),
        ...(summary.lastText ? { summary: summary.lastText.slice(0, mateTunables().num("duty.summaryChars")) } : {}),
      };
      if (overBudget) {
        resolve({ ...base, status: "budget", error: `비용 상한 $${input.maxCostUsd}를 넘어 멈췄습니다 ($${summary.costUsd.toFixed(4)})` });
      } else if (timedOut) resolve({ ...base, status: "timeout", error: `${input.timeoutSec}초 안에 끝나지 않아 멈췄습니다` });
      else if (spawnError) resolve({ ...base, status: "failed", error: `Pi를 실행하지 못했습니다: ${spawnError.message}` });
      else if (summary.errorMessage) resolve({ ...base, status: "failed", error: summary.errorMessage });
      else if (code !== 0 || !summary.settled) {
        resolve({ ...base, status: "failed", error: lastLines(stderr) || `Pi가 코드 ${code}로 끝났습니다` });
      } else resolve({ ...base, status: "done" });
    };
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

function lastLines(text: string): string {
  return text.trim().split(/\r?\n/).slice(-5).join("\n");
}

/** Windows는 bash 등 손자 프로세스까지 끝내야 해서 taskkill /T를 쓴다 */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // 이미 끝남
  }
}

/** Pi(=모델이 bash로 볼 수 있는 환경)에는 Mate의 비밀값(휴대폰 봇 토큰)을 넘기지 않는다 */
export function withoutSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { PI_DESKTOP_MATE_TELEGRAM_TOKEN: _token, ...rest } = env;
  return rest;
}

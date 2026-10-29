import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { approvalOptions, decisionOf, formatApprovalTitle } from "../../src/approval";
import { classify, evaluate, hardBlockReason, type Rule } from "./rules";
import { addRule, appendAudit, dataDir, loadRules, type AuditRecord } from "./store";

/**
 * 승인 게이트 (설계 DESIGN-AGENT.md §4).
 *
 * 쓰기·실행 도구는 `tool_call`에서 멈추고 사람에게 묻는다. 순서:
 * 위험 명령 차단 → 저장된 거부·허용 규칙 → 이 세션 허용 → 사람이 없으면 거부 → `ctx.ui.select`로 묻기.
 * 거부·취소·시간 초과는 모두 거부다. 판단은 감사 로그에 남긴다.
 *
 * Pi 기본 동작(묻지 않음)과 다른 이 앱만의 선택이다. 확장 hook은 보안 경계가 아니므로, 이것은 동의 절차다.
 */
export default function permissions(pi: ExtensionAPI): void {
  const dir = dataDir();
  /** 이 세션에서 계속 허용한 것. 세션이 바뀌면 비운다 */
  let sessionRules: Rule[] = [];

  pi.on("session_start", async () => {
    sessionRules = [];
  });

  pi.on("tool_call", async (event, ctx) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    const { request } = classify(event.toolName, input);
    if (!request) return undefined;

    const audit = (decision: AuditRecord["decision"]) =>
      appendAudit(dir, { at: new Date().toISOString(), toolName: request.toolName, target: request.target, decision, cwd: ctx.cwd });
    const deny = async (decision: AuditRecord["decision"], reason: string) => {
      await audit(decision);
      return { block: true, reason };
    };

    if (request.risk === "exec") {
      const blocked = hardBlockReason(request.target);
      if (blocked) return deny("blocked", `${blocked}. 같은 명령을 다시 시도하지 말라.`);
    }

    const saved = evaluate(await loadRules(dir), request.toolName, request.target);
    if (saved === "deny") return deny("deny-rule", "사용자가 저장한 거부 규칙에 걸렸다. 다른 방법을 찾거나 사용자에게 물어라.");
    if (saved === "allow") {
      await audit("allow-rule");
      return undefined;
    }
    if (evaluate(sessionRules, request.toolName, request.target) === "allow") {
      await audit("session-rule");
      return undefined;
    }

    // 예약 실행·피어 요청처럼 사람이 지켜보지 않는 실행에서는 묻지 못하므로 거부한다 (설계 §1).
    if (!ctx.hasUI) return deny("unattended", "사람이 확인할 수 없는 실행이라 쓰기·실행 도구를 쓸 수 없다.");

    const decision = decisionOf(await ctx.ui.select(formatApprovalTitle(request), approvalOptions(request)));
    if (decision === "deny") {
      return deny("deny", "사용자가 거부했다. 같은 작업을 다시 시도하지 말고, 다른 방법을 찾거나 사용자에게 이유를 물어라.");
    }
    if (decision === "session") sessionRules.push({ toolName: request.toolName, pattern: request.pattern, action: "allow" });
    if (decision === "always") await addRule(dir, { toolName: request.toolName, pattern: request.pattern, action: "allow" });
    await audit(decision);
    return undefined;
  });
}

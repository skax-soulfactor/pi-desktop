import { useEffect, useRef, type KeyboardEvent } from "react";
import { ApprovalChoice, type ParsedApproval } from "@pi-desktop/agent-kit/approval";
import type { DialogRequest } from "../vendor/renderer/extension-ui-state";

type Answer = { value?: string; cancelled?: boolean };

/**
 * permissions 확장의 승인 요청 화면 (설계 DESIGN-AGENT.md §4).
 *
 * 확장이 보낸 것은 일반 select 다이얼로그다. 제목을 agent-kit의 같은 함수로 읽어
 * 위험도·도구·대상을 따로 보여준다. 고른 버튼의 글자를 그대로 돌려주므로 확장 쪽 판단은 바뀌지 않는다.
 */
export function ApprovalDialog({
  dialog,
  approval,
  onAnswer,
}: {
  dialog: DialogRequest;
  approval: ParsedApproval;
  onAnswer: (answer: Answer) => void;
}) {
  const denyButton = useRef<HTMLButtonElement>(null);
  const options = dialog.options ?? [];
  const deny = options.find((o) => o === ApprovalChoice.deny);
  const allows = options.filter((o) => o !== ApprovalChoice.deny);
  const tone = approval.riskLabel === "실행" ? "exec" : "write";

  // Enter를 습관적으로 눌러 허용하는 일을 막기 위해 기본 초점은 "거부"에 둔다.
  useEffect(() => denyButton.current?.focus(), [dialog.id]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onAnswer({ cancelled: true });
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown}>
      <div className="modal approval" role="dialog" aria-modal="true" aria-labelledby={`approval-${dialog.id}`}>
        <div className="modal-head">
          <span className={`approval-risk ${tone}`}>{approval.riskLabel}</span>
          <span className="modal-badge">승인 요청</span>
        </div>
        <h2 id={`approval-${dialog.id}`} className="modal-title">
          <code>{approval.toolName}</code> {approval.summary}
        </h2>
        <pre className="approval-target">{approval.target || "(대상 없음)"}</pre>
        <div className="approval-actions">
          {allows.map((option, i) => (
            <button key={option} type="button" className={i === 0 ? "primary" : undefined} onClick={() => onAnswer({ value: option })}>
              {option}
            </button>
          ))}
          {deny && (
            <button ref={denyButton} type="button" className="danger" onClick={() => onAnswer({ value: deny })}>
              {deny}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

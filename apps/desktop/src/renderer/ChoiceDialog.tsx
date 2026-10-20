import { useEffect, useRef, type ReactNode } from "react";

export interface Choice {
  label: string;
  kind?: "primary" | "danger";
  onSelect: () => void;
}

/**
 * 앱이 직접 묻는 선택 다이얼로그 (확장 다이얼로그와 같은 모양).
 * 첫 번째 선택지를 가장 안전한 것으로 두고 기본 초점을 준다. Esc는 취소.
 */
export function ChoiceDialog({
  title,
  children,
  choices,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  choices: Choice[];
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    first.current?.focus();
  }, [title]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="choice-title">
        <h2 id="choice-title" className="modal-title">
          {title}
        </h2>
        {children && <div className="modal-message">{children}</div>}
        <div className="modal-options">
          {choices.map((choice, i) => (
            <button
              key={choice.label}
              type="button"
              className={choice.kind ?? ""}
              ref={i === 0 ? first : undefined}
              onClick={choice.onSelect}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

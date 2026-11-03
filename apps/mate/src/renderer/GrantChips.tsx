import { grantParts } from "./mate-view";

/**
 * 허용한 명령·도구 칩 목록 (설정의 대화 허용, 임무의 허용).
 * 칩마다 종류(명령·확장·MCP)와 이름을 보이고, ×로 허용을 뺀다.
 */
export function GrantChips({ label, grants, onRemove }: { label: string; grants: string[]; onRemove: (grant: string) => void }) {
  return (
    <div className="grant-row">
      <span className="muted">{label}</span>
      <ul className="grant-chips">
        {grants.map((g) => {
          const { kind, tool } = grantParts(g);
          return (
            <li key={g} className="grant-chip" title={g}>
              <span className="grant-kind">{kind}</span>
              <span className="grant-name">{tool}</span>
              <button type="button" className="grant-remove" aria-label={`${tool} 허용 빼기`} title="허용 빼기" onClick={() => onRemove(g)}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

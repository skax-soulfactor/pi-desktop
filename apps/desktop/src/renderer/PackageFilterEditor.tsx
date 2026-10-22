import { useEffect, useState } from "react";
import type { ConfiguredPackageInfo, PackageResourceItem } from "@pi-desktop/host-protocol/messages";
import { errorText } from "./folder-browser";
import { PACKAGE_TYPE_LABEL, packageFilterChanges, packageResourceKey } from "./resources-view";

interface Props {
  hostId: string;
  /** 리소스 창의 작업 폴더 (프로젝트 범위 패키지는 이 폴더의 .pi/settings.json) */
  cwd: string;
  pkg: ConfiguredPackageInfo;
  /** 저장한 뒤 리소스 목록을 다시 읽는다 */
  onSaved: () => void;
  onClose: () => void;
}

/**
 * 패키지에 든 리소스를 골라 켜고 끄기 (설계 §4.5 "패키지 필터 편집").
 * 설정의 패키지 항목에 +경로·-경로로 적는다 (pi config와 같은 규칙). 패키지 파일은 건드리지 않는다.
 */
export function PackageFilterEditor({ hostId, cwd, pkg, onSaved, onClose }: Props) {
  const [items, setItems] = useState<PackageResourceItem[] | undefined>();
  const [checked, setChecked] = useState<Map<string, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  async function load() {
    try {
      const next = await window.piDesktop.packageResources(hostId, cwd, pkg.source, pkg.scope);
      setItems(next);
      setChecked(new Map(next.map((i) => [packageResourceKey(i), i.enabled])));
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    void load();
  }, [hostId, cwd, pkg.source, pkg.scope]);

  const changes = items ? packageFilterChanges(items, checked) : [];

  async function save(reset: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await window.piDesktop.setPackageFilter(hostId, cwd, pkg.source, pkg.scope, reset ? [] : changes, reset);
      setNotice(
        `${reset ? "필터를 지우고 모두 켰습니다" : "저장했습니다"} (${pkg.scope === "user" ? "사용자" : "프로젝트"} settings.json). 새로 여는 세션부터 쓰이고, 열린 세션은 "지금 세션에 반영"이나 다시 열기로 반영합니다.`,
      );
      await load();
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const groups = (Object.keys(PACKAGE_TYPE_LABEL) as Array<keyof typeof PACKAGE_TYPE_LABEL>)
    .map((type) => ({ type, rows: (items ?? []).filter((i) => i.type === type) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="package-filter">
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      {!items && !error && <p className="muted">패키지의 리소스를 읽는 중…</p>}
      {items && items.length === 0 && <p className="muted">이 패키지가 내놓는 확장·스킬·프롬프트·테마가 없습니다.</p>}
      {groups.map((g) => (
        <div key={g.type} className="package-filter-group">
          <div className="package-filter-head">
            {PACKAGE_TYPE_LABEL[g.type]} {g.rows.filter((r) => checked.get(packageResourceKey(r))).length}/{g.rows.length}
          </div>
          {g.rows.map((r) => {
            const key = packageResourceKey(r);
            return (
              <label key={key} className="package-filter-row" title={r.path}>
                <input
                  type="checkbox"
                  checked={checked.get(key) ?? r.enabled}
                  onChange={(e) => setChecked((prev) => new Map(prev).set(key, e.target.checked))}
                />
                <code>{r.pattern}</code>
              </label>
            );
          })}
        </div>
      ))}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
        {pkg.filtered && (
          <button type="button" disabled={busy} onClick={() => void save(true)} title="이 패키지 항목의 필터를 모두 지웁니다">
            필터 지우고 모두 켜기
          </button>
        )}
        <button type="button" className="primary" disabled={busy || changes.length === 0} onClick={() => void save(false)}>
          {busy ? "저장 중…" : changes.length > 0 ? `${changes.length}개 바꾸기` : "바꾼 것 없음"}
        </button>
      </div>
    </div>
  );
}

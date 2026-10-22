import { useEffect, useState } from "react";
import type { ConfiguredPackageInfo } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { isLocalPathSource, packageInstallArgs } from "./copy-view";
import { errorText } from "./folder-browser";
import { filterForPlatform, packageFilterOf, type PackageResourceKind, type PackageScope } from "./market-view";

interface Props {
  hosts: HostDescriptor[];
  fromHostId: string;
  pkg: ConfiguredPackageInfo;
  /** 원본 호스트의 작업 폴더 (프로젝트 범위 패키지의 필터를 읽을 곳) */
  fromCwd: string;
  /** 그 호스트의 pi를 내장 터미널에서 실행한다. projectCwd가 있으면 그 폴더에서. onSuccess는 코드 0으로 끝난 뒤에 */
  onRunPi: (hostId: string, args: string[], title: string, projectCwd?: string, onSuccess?: () => void) => void;
  onClose: () => void;
}

/**
 * 패키지를 다른 호스트에 설치 (설계 §5.9 "Pi 패키지는 파일이 아니라 선언을 옮긴다").
 * 대상 호스트의 내장 터미널에서 같은 소스로 pi install을 실행한다.
 * "일부만 사용" 필터가 있으면 설치가 끝난 뒤 대상의 패키지 항목에 같은 필터를 적는다(경로 구분자는 대상 OS에 맞춤).
 */
export function PackageCopyDialog({ hosts, fromHostId, pkg, fromCwd, onRunPi, onClose }: Props) {
  const targets = hosts.filter((h) => h.id !== fromHostId);
  const [toHostId, setToHostId] = useState(targets[0]?.id ?? "");
  const [scope, setScope] = useState<PackageScope>(pkg.scope);
  const [cwd, setCwd] = useState("");
  const [error, setError] = useState<string | undefined>();
  const local = isLocalPathSource(pkg.source);
  /** 원본 패키지 항목의 필터 (종류별 배열) */
  const [filter, setFilter] = useState<Partial<Record<PackageResourceKind, string[]>> | undefined>();
  const [copyFilter, setCopyFilter] = useState(true);
  const [platform, setPlatform] = useState<string | undefined>();

  useEffect(() => {
    if (!pkg.filtered) return;
    const target = pkg.scope === "project" ? { scope: "project" as const, cwd: fromCwd } : undefined;
    void window.piDesktop.settingsRead(fromHostId, target).then((read) => setFilter(packageFilterOf(read.values, pkg.source)), () => {});
  }, [fromHostId, pkg.source, pkg.scope, fromCwd]);

  // 대상 OS를 알아야 +·- 경로의 구분자를 맞춘다.
  useEffect(() => {
    setPlatform(undefined);
    if (!toHostId) return;
    void window.piDesktop.connectHost(toHostId).then((state) => {
      if (state.status === "connected") setPlatform(state.host.platform);
    });
    return window.piDesktop.onConnection((id, state) => {
      if (id === toHostId && state.status === "connected") setPlatform(state.host.platform);
    });
  }, [toHostId]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal copy-resource" role="dialog" aria-label="다른 호스트에 설치" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="modal-title">다른 호스트에 설치: {pkg.source}</h2>
        <p className="modal-message">
          파일을 옮기지 않고 대상 호스트에서 같은 소스로 pi install을 실행합니다. 대상 호스트가 npm·git에서 직접 받습니다.
        </p>
        {local && <div className="banner error">로컬 경로 패키지는 호스트마다 경로가 달라 그대로 설치할 수 없습니다.</div>}
        {pkg.filtered && filter && (
          <label className="banner info package-copy-filter">
            <input type="checkbox" checked={copyFilter} onChange={(e) => setCopyFilter(e.target.checked)} />
            "일부만 사용" 필터도 옮기기 ({Object.entries(filter).map(([k, v]) => (v.length === 0 ? `${k} 빼기` : `${k} ${v.length}개`)).join(", ")}).
            설치가 끝나면 대상의 패키지 항목에 적습니다.
          </label>
        )}
        {targets.length === 0 ? (
          <div className="banner warn">설치할 다른 호스트가 없습니다.</div>
        ) : (
          <div className="ssh-host-form">
            <label>
              대상 호스트
              <select value={toHostId} onChange={(e) => setToHostId(e.target.value)}>
                {targets.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              범위
              <select value={scope} onChange={(e) => setScope(e.target.value as PackageScope)}>
                <option value="user">사용자 (대상의 모든 폴더)</option>
                <option value="project">프로젝트 (대상 폴더의 .pi/settings.json)</option>
              </select>
            </label>
            {scope === "project" && (
              <label>
                대상 호스트의 프로젝트 폴더
                <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/home/me/project" spellCheck={false} />
              </label>
            )}
          </div>
        )}
        {error && <div className="banner error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="primary"
            disabled={local || !toHostId || (scope === "project" && !cwd.trim())}
            onClick={() => {
              try {
                const args = packageInstallArgs(pkg.source, scope);
                const targetCwd = scope === "project" ? cwd.trim() : "";
                const moved = filter && copyFilter ? filterForPlatform(filter, platform) : undefined;
                const onSuccess = moved
                  ? () => void window.piDesktop.setPackageFilter(toHostId, targetCwd, pkg.source, scope, [], true, moved).catch(() => {})
                  : undefined;
                onRunPi(toHostId, args, `설치: ${pkg.source}`, scope === "project" ? targetCwd : undefined, onSuccess);
                onClose();
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            대상 터미널에서 설치
          </button>
        </div>
      </div>
    </div>
  );
}

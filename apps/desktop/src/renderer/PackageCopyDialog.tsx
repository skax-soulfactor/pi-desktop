import { useState } from "react";
import type { ConfiguredPackageInfo } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { isLocalPathSource, packageInstallArgs } from "./copy-view";
import { errorText } from "./folder-browser";
import type { PackageScope } from "./market-view";

interface Props {
  hosts: HostDescriptor[];
  fromHostId: string;
  pkg: ConfiguredPackageInfo;
  /** 그 호스트의 pi를 내장 터미널에서 실행한다. projectCwd가 있으면 그 폴더에서 */
  onRunPi: (hostId: string, args: string[], title: string, projectCwd?: string) => void;
  onClose: () => void;
}

/**
 * 패키지를 다른 호스트에 설치 (설계 §5.9 "Pi 패키지는 파일이 아니라 선언을 옮긴다").
 * 대상 호스트의 내장 터미널에서 같은 소스로 pi install을 실행한다.
 */
export function PackageCopyDialog({ hosts, fromHostId, pkg, onRunPi, onClose }: Props) {
  const targets = hosts.filter((h) => h.id !== fromHostId);
  const [toHostId, setToHostId] = useState(targets[0]?.id ?? "");
  const [scope, setScope] = useState<PackageScope>(pkg.scope);
  const [cwd, setCwd] = useState("");
  const [error, setError] = useState<string | undefined>();
  const local = isLocalPathSource(pkg.source);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal copy-resource" role="dialog" aria-label="다른 호스트에 설치" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="modal-title">다른 호스트에 설치: {pkg.source}</h2>
        <p className="modal-message">
          파일을 옮기지 않고 대상 호스트에서 같은 소스로 pi install을 실행합니다. 대상 호스트가 npm·git에서 직접 받습니다.
        </p>
        {local && <div className="banner error">로컬 경로 패키지는 호스트마다 경로가 달라 그대로 설치할 수 없습니다.</div>}
        {pkg.filtered && <div className="banner warn">이 패키지의 "일부만 사용" 설정(리소스 필터)은 옮기지 않습니다. 대상에서는 모두 불러옵니다.</div>}
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
                onRunPi(toHostId, args, `설치: ${pkg.source}`, scope === "project" ? cwd.trim() : undefined);
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

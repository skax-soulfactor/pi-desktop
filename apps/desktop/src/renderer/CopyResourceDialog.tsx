import { useEffect, useState } from "react";
import type { ResourceExportResult } from "@pi-desktop/host-protocol/messages";
import type { HostDescriptor } from "../shared/api";
import { copyWarnings, isAlreadyExists } from "./copy-view";
import { errorText } from "./folder-browser";
import { importName, type PackageScope } from "./market-view";
import { formatSize } from "./resources-view";

export interface CopyItem {
  kind: "skill" | "prompt";
  name: string;
  /** 원본 호스트의 파일 경로 (스킬은 SKILL.md) */
  path: string;
  fromPackage: boolean;
}

interface Props {
  hosts: HostDescriptor[];
  fromHostId: string;
  item: CopyItem;
  onClose: () => void;
}

/**
 * 스킬·프롬프트를 다른 호스트로 복사 (설계 §5.9). 원본 호스트 데몬이 읽고 대상 호스트 데몬이 쓴다.
 * 복사한 뒤 두 사본은 서로 영향을 주지 않는다 (자동 동기화 없음).
 */
export function CopyResourceDialog({ hosts, fromHostId, item, onClose }: Props) {
  const targets = hosts.filter((h) => h.id !== fromHostId);
  const [toHostId, setToHostId] = useState(targets[0]?.id ?? "");
  const [platform, setPlatform] = useState<string | undefined>();
  const [scope, setScope] = useState<PackageScope>("user");
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState(importName(item.name));
  const [exported, setExported] = useState<ResourceExportResult | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [exists, setExists] = useState(false);
  const [done, setDone] = useState<{ target: string; backup?: string } | undefined>();

  useEffect(() => {
    void window.piDesktop.exportResource(fromHostId, item.kind, item.path).then(setExported, (e: unknown) => setError(errorText(e)));
  }, [fromHostId, item.path]);

  // 대상 호스트에 연결을 시작하고, 연결되어 있으면 OS를 읽어 스크립트 경고에 쓴다.
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

  async function copy(replace: boolean) {
    if (!exported) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await window.piDesktop.importResourceFiles(toHostId, {
        cwd: scope === "project" ? cwd.trim() : "",
        kind: item.kind,
        scope,
        name: name.trim(),
        files: exported.files.map((f) => ({ path: f.path, contentBase64: f.contentBase64 })),
        ...(replace ? { replace: true } : {}),
      });
      setDone({ target: result.target, ...(result.backup ? { backup: result.backup } : {}) });
      setExists(false);
    } catch (e) {
      const message = errorText(e);
      setExists(isAlreadyExists(message));
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const warnings = exported ? copyWarnings(exported.files, platform) : [];
  const total = exported?.files.reduce((sum, f) => sum + f.size, 0) ?? 0;
  const ready = Boolean(exported) && toHostId !== "" && name.trim() !== "" && (scope === "user" || cwd.trim() !== "");

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal copy-resource" role="dialog" aria-label="다른 호스트로 복사" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          {item.kind === "skill" ? "스킬" : "프롬프트"} 다른 호스트로 복사: {item.name}
        </h2>
        <p className="modal-message">
          {hosts.find((h) => h.id === fromHostId)?.label ?? fromHostId}의 것을 복사합니다. 복사한 뒤 두 사본은 서로 영향을 주지 않습니다.
          {item.fromPackage ? " 패키지에 든 것이라, 대상에서는 패키지와 상관없는 독립 사본이 됩니다." : ""}
        </p>
        {targets.length === 0 ? (
          <div className="banner warn">복사할 다른 호스트가 없습니다. WSL 배포판이나 SSH 호스트가 있어야 합니다.</div>
        ) : done ? (
          <div className="banner ok">
            복사했습니다: {done.target}
            {done.backup ? `\n대상에 있던 이전 것은 ${done.backup}로 옮겼습니다.` : ""}
            {"\n"}대상 호스트에서 새로 여는 세션부터 쓰입니다.{scope === "project" ? " 프로젝트 범위는 그 폴더를 신뢰해야 불러옵니다." : ""}
          </div>
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
                <option value="user">사용자 (대상의 ~/.pi/agent)</option>
                <option value="project">프로젝트 (대상 폴더의 .pi/)</option>
              </select>
            </label>
            {scope === "project" && (
              <label>
                대상 호스트의 프로젝트 폴더
                <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/home/me/project" spellCheck={false} />
              </label>
            )}
            <label>
              이름
              <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
            </label>
            <div className="muted">
              {exported ? `파일 ${exported.files.length}개 · ${formatSize(total)}: ${exported.files.map((f) => f.path).slice(0, 10).join(", ")}${exported.files.length > 10 ? " …" : ""}` : "원본을 읽는 중…"}
            </div>
            {warnings.map((w) => (
              <div key={w} className="banner warn">
                {w}
              </div>
            ))}
            {error && <div className="banner error">{error}</div>}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {done ? "닫기" : "취소"}
          </button>
          {!done && targets.length > 0 && exists && (
            <button type="button" className="danger" disabled={busy || !ready} onClick={() => void copy(true)}>
              대상의 것을 백업하고 바꾸기
            </button>
          )}
          {!done && targets.length > 0 && (
            <button type="button" className="primary" disabled={busy || !ready} onClick={() => void copy(false)}>
              {busy ? "복사 중…" : "복사"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

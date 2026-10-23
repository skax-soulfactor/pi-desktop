import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SettingsTarget } from "@pi-desktop/host-protocol";
import type { ActionLogEntry, CopyRecordInput, GithubImportRequest, SshHostConfig } from "../shared/api";

/**
 * 작업 기록 (설계 §4.5 보안 원칙 "설치와 제거는 모두 활동 로그에 남긴다", 앱 userData의 activity-log.jsonl).
 *
 * 설치·제거·업데이트, 복사·가져오기, 설정·패키지 필터·프로젝트 신뢰 변경, 프로바이더·API 키 저장 같은
 * 관리 작업을 IPC 처리기를 지나는 자리에서 남긴다. 무엇을 했는지와 성공·실패만 적고, 키 값·파일 내용은 적지 않는다.
 * 한 줄에 하나씩 덧붙이고, 너무 길어지면 최근 것만 남긴다.
 */

const KEEP = 2000;
const TRIM_AT = 2500;

/** 기록할 작업: 처리기 인자로 무엇을 했는지 적는다. errorsOnly면 실패만 남긴다 (성공은 다른 기록이 남기는 것) */
interface Describer {
  describe: (args: unknown[]) => { hostId: string; summary: string } | undefined;
  errorsOnly?: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const scopeText = (target: SettingsTarget | undefined) => (target?.scope === "project" ? `프로젝트 ${target.cwd ?? ""}` : "사용자");

/** 채널별 기록 방법. 여기 없는 채널은 기록하지 않는다 (읽기·조회 등) */
export const LOGGED: Record<string, Describer> = {
  "pi:save-ssh-host": { describe: ([host]) => ({ hostId: "app", summary: `SSH 호스트 저장: ${(host as SshHostConfig).name}` }) },
  "pi:remove-ssh-host": { describe: ([name]) => ({ hostId: "app", summary: `SSH 호스트 삭제: ${str(name)}` }) },
  "pi:replace-agent": { describe: ([hostId]) => ({ hostId: str(hostId), summary: "Host Agent 교체" }) },
  "pi:github-import": {
    describe: ([request]) => {
      const r = request as GithubImportRequest;
      return { hostId: r.hostId, summary: `GitHub에서 가져오기: ${r.item.kind === "skill" ? "스킬" : "프롬프트"} ${r.name} (${r.repo.owner}/${r.repo.repo}, ${r.scope === "user" ? "사용자" : "프로젝트"})` };
    },
  },
  "pi:import-update": { describe: ([hostId, target]) => ({ hostId: str(hostId), summary: `가져온 항목 업데이트: ${str(target)}` }) },
  "pi:import-remove": { describe: ([hostId, target]) => ({ hostId: str(hostId), summary: `가져온 항목 제거(백업으로 옮김): ${str(target)}` }) },
  "pi:import-resource-files": {
    errorsOnly: true,
    describe: ([hostId, params]) => {
      const p = params as { kind: string; name: string };
      return { hostId: str(hostId), summary: `리소스 받기: ${p.kind} ${p.name}` };
    },
  },
  "pi:record-copy": {
    describe: ([input]) => {
      const c = input as CopyRecordInput;
      return { hostId: c.toHostId, summary: `다른 호스트에서 복사: ${c.kind} ${c.name} (${c.fromHostId}에서)` };
    },
  },
  "pi:models-import": {
    describe: ([hostId, id, , replace]) => ({ hostId: str(hostId), summary: `models.json 프로바이더 받기: ${str(id)}${replace ? " (바꾸기)" : ""}` }),
  },
  "pi:models-import-model": {
    describe: ([hostId, providerId, model, replace]) => ({
      hostId: str(hostId),
      summary: `models.json 모델 받기: ${str(providerId)}/${str((model as { id?: unknown }).id)}${replace ? " (바꾸기)" : ""}`,
    }),
  },
  "pi:models-save-provider": {
    describe: ([hostId, form]) => ({ hostId: str(hostId), summary: `models.json 프로바이더 저장: ${str((form as { id?: unknown }).id)}` }),
  },
  "pi:models-remove-provider": { describe: ([hostId, id]) => ({ hostId: str(hostId), summary: `models.json 프로바이더 삭제: ${str(id)}` }) },
  "pi:auth-set-api-key": { describe: ([hostId, provider]) => ({ hostId: str(hostId), summary: `API 키 저장: ${str(provider)}` }) },
  "pi:auth-remove": { describe: ([hostId, provider]) => ({ hostId: str(hostId), summary: `자격 증명 삭제: ${str(provider)}` }) },
  "pi:set-package-filter": {
    describe: ([hostId, cwd, source, scope, changes, reset, set, overlay]) => {
      const what = set
        ? `필터 적용: ${Object.entries(set as Record<string, string[]>).map(([k, v]) => (v.length === 0 ? `${k} 빼기` : `${k} ${v.length}개`)).join(", ")}`
        : reset
          ? "모두 켜기"
          : `${(changes as unknown[]).length}개 바꿈`;
      const where = overlay ? `이 프로젝트에서만 ${str(cwd)}` : scope === "project" ? "프로젝트" : "사용자";
      return { hostId: str(hostId), summary: `패키지 필터: ${str(source)} (${where}, ${overlay && reset ? "덧씌우기 지움" : what})` };
    },
  },
  "pi:settings-merge": {
    describe: ([hostId, values, remove, target]) => {
      const keys = [...Object.keys((values ?? {}) as object), ...((remove as string[] | undefined) ?? []).map((k) => `-${k}`)];
      return { hostId: str(hostId), summary: `settings.json 변경 (${scopeText(target as SettingsTarget | undefined)}): ${keys.join(", ")}` };
    },
  },
  "pi:settings-write": {
    describe: ([hostId, , , target]) => ({ hostId: str(hostId), summary: `settings.json JSON 저장 (${scopeText(target as SettingsTarget | undefined)})` }),
  },
  "pi:set-trust": {
    describe: ([hostId, cwd, decision]) => ({
      hostId: str(hostId),
      summary: `프로젝트 신뢰: ${str(cwd)} → ${decision === true ? "신뢰" : decision === false ? "신뢰 안 함" : "기억 지움"}`,
    }),
  },
  "pi:make-dir": { describe: ([hostId, parent, name]) => ({ hostId: str(hostId), summary: `새 폴더: ${str(name)} (${str(parent) || "홈"})` }) },
  "pi:write-resource": { describe: ([hostId, , path]) => ({ hostId: str(hostId), summary: `리소스 저장: ${str(path)}` }) },
  "pi:create-resource": {
    describe: ([hostId, , kind, scope, name]) => ({ hostId: str(hostId), summary: `리소스 만들기: ${str(kind)} ${str(name)} (${scope === "project" ? "프로젝트" : "사용자"})` }),
  },
  "pi:delete-resource": { describe: ([hostId, path]) => ({ hostId: str(hostId), summary: `리소스 삭제(백업으로 옮김): ${str(path)}` }) },
  "pi:data-backup": { describe: ([hostId]) => ({ hostId: str(hostId), summary: "Pi 데이터 백업" }) },
  "pi:data-delete": { describe: ([hostId]) => ({ hostId: str(hostId), summary: "Pi 데이터 삭제" }) },
  "pi:pi-update": {
    describe: ([hostId, target, , force]) => ({ hostId: str(hostId), summary: `Pi 업데이트 (${str(target)}${force ? ", 다시 설치" : ""})` }),
  },
};

export class ActionLog {
  private entries: ActionLogEntry[];

  constructor(private readonly file: string) {
    this.entries = readEntries(file);
  }

  /** 최근 것부터 */
  list(limit = 200): ActionLogEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  add(entry: Omit<ActionLogEntry, "time"> & { time?: number }): void {
    const full: ActionLogEntry = { time: entry.time ?? Date.now(), hostId: entry.hostId, summary: entry.summary, ok: entry.ok };
    if (entry.detail) full.detail = entry.detail;
    if (entry.error) full.error = entry.error;
    this.entries.push(full);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      if (this.entries.length > TRIM_AT) {
        this.entries = this.entries.slice(-KEEP);
        writeFileSync(this.file, this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
      } else {
        appendFileSync(this.file, `${JSON.stringify(full)}\n`);
      }
    } catch {
      // 기록을 못 남겨도 작업 자체는 막지 않는다.
    }
  }

  /** 처리기를 감싸 LOGGED에 있는 채널이면 성공·실패를 남긴다 */
  wrap<E, A extends unknown[], R>(channel: string, handler: (event: E, ...args: A) => R | Promise<R>) {
    const describer = LOGGED[channel];
    if (!describer) return handler;
    return async (event: E, ...args: A): Promise<R> => {
      let what: { hostId: string; summary: string } | undefined;
      try {
        what = describer.describe(args);
      } catch {
        what = undefined;
      }
      try {
        const result = await handler(event, ...args);
        if (what && !describer.errorsOnly) this.add({ ...what, ok: true });
        return result;
      } catch (e) {
        if (what) this.add({ ...what, ok: false, error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    };
  }
}

function readEntries(file: string): ActionLogEntry[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries: ActionLogEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ActionLogEntry;
      if (typeof e.time === "number" && typeof e.summary === "string") entries.push(e);
    } catch {
      // 깨진 줄은 건너뛴다.
    }
  }
  return entries.slice(-KEEP);
}

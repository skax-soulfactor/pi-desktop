import { join } from "node:path";
import {
  bulkUpdate,
  createEntry,
  exportMarkdown,
  knowledgeStats,
  loadAutoLearn,
  loadEntries,
  markReviewed,
  memoryDir,
  mergeEntries,
  needsReview,
  saveAutoLearn,
  updateEntry,
  type BulkAction,
  type EntryInput,
} from "../extensions/memory/store";
import { buildKnowledgeSection } from "../extensions/memory/recall";
import { deleteSkill, listSkillsIn, saveSkill, type SkillInput } from "../extensions/skills/store";
import { loadAudit, loadRules, removeRule } from "../extensions/permissions/store";
import type { Rule } from "../extensions/permissions/rules";
import { loadElevationEnabled, saveElevationEnabled } from "../extensions/elevation/store";
import { loadTasks, tasksDir } from "../extensions/tasks/store";
import { loadSchedules, schedulesPath, updateSchedules } from "../extensions/schedule/store";

/**
 * 에이전트 앱 화면이 쓰는 agent-kit 데이터 함수 (설계 DESIGN-APPS.md §4 Agent ③, §6 D4).
 *
 * 앱이 이 PC의 파일을 직접 읽던 것을, 대화가 도는 호스트의 Host Agent 데몬이 `agent.call`로 대신 부른다.
 * 그래서 WSL·SSH 호스트를 골라도 그 호스트의 기억·스킬·승인·작업이 보인다. 로컬도 같은 길을 쓴다.
 * 함수는 JSON으로 오가는 값만 받고 돌려준다. 이름이 곧 메서드 이름이다.
 */

export interface AppApiContext {
  /** 그 호스트의 Agent 홈 (데몬 홈, `~/.pi-desktop-agent`) */
  home: string;
  /** agent-kit 상태 폴더 (보통 `<home>/data`) */
  dataDir: string;
}

// 메서드마다 인자 모양이 달라 any로 받는다 (데몬은 이름으로만 찾는다)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppApi = Record<string, (...args: any[]) => Promise<unknown>>;

export function appApi(ctx: AppApiContext): AppApi {
  const kb = () => memoryDir(ctx.dataDir);
  const skills = () => join(ctx.home, "skills");
  const schedules = () => schedulesPath(ctx.dataDir);
  return {
    // 지식베이스
    kbList: (includeArchived?: boolean) => loadEntries(kb(), { includeArchived: includeArchived === true }),
    kbSave: async (id: string | undefined, input: EntryInput) => {
      if (!input?.title?.trim() || !input.content?.trim()) throw new Error("제목과 본문을 적어 주세요");
      if (!id) return createEntry(kb(), { ...input, origin: "user" });
      // 사람이 고친 것은 확인된 것으로 본다
      const entry = await updateEntry(kb(), id, { ...input, unverified: false });
      if (!entry) throw new Error("그 항목을 찾지 못했습니다 (다른 곳에서 지웠을 수 있습니다)");
      return entry;
    },
    kbBulk: (ids: string[], action: BulkAction, tag?: string) => bulkUpdate(kb(), ids, action, tag),
    kbMerge: async (keepId: string, dropIds: string[]) => void (await mergeEntries(kb(), keepId, dropIds)),
    kbReviewed: async (id: string) => void (await markReviewed(kb(), id)),
    kbReview: async () => needsReview(await loadEntries(kb())),
    kbStats: async () => knowledgeStats(await loadEntries(kb(), { includeArchived: true })),
    kbPreview: async (prompt: string) => {
      // 클라우드 모델의 예산(8,000자)으로 보인다. 로컬 모델이면 창에 맞춰 더 줄어든다
      const { text, injected } = buildKnowledgeSection(await loadEntries(kb()), prompt ?? "", 8000);
      return { text: text ?? "", chars: text?.length ?? 0, injected: injected.length };
    },
    /** 내보낼 Markdown 글 (파일은 앱이 이 PC에 저장한다) */
    kbExportText: async () => exportMarkdown(await loadEntries(kb(), { includeArchived: true })),
    getAutoLearn: () => loadAutoLearn(kb()),
    setAutoLearn: async (on: boolean) => void (await saveAutoLearn(kb(), on === true)),

    // 스킬 (앱 홈의 skills/. 지운 것은 상태 폴더의 skills-trash/로)
    skillsList: () => listSkillsIn(skills()),
    skillSave: async (previous: string | undefined, input: SkillInput) => void (await saveSkill(skills(), input, previous)),
    skillDelete: async (name: string) => void (await deleteSkill(skills(), name, join(ctx.dataDir, "skills-trash"))),
    skillsDir: async () => skills(),

    // 승인 규칙·판단 기록, 관리자 권한
    listRules: () => loadRules(ctx.dataDir),
    removeRule: async (rule: Rule) => void (await removeRule(ctx.dataDir, rule)),
    listAudit: () => loadAudit(ctx.dataDir, 100),
    getElevation: () => loadElevationEnabled(ctx.dataDir),
    setElevation: async (on: boolean) => void (await saveElevationEnabled(ctx.dataDir, on === true)),

    // 작업·예약
    listTasks: async (limit?: number) => (await loadTasks(tasksDir(ctx.dataDir))).slice(0, limit ?? 30),
    listSchedules: () => loadSchedules(schedules()),
    setScheduleEnabled: async (id: string, enabled: boolean) =>
      void (await updateSchedules(schedules(), (all) => all.map((s) => (s.id === id ? { ...s, enabled: enabled === true } : s)))),
    removeSchedule: async (id: string) => void (await updateSchedules(schedules(), (all) => all.filter((s) => s.id !== id))),
  };
}

/**
 * 명령 팔레트 목록 규칙 (설계 §4.1 "키보드 우선: 명령 팔레트(Ctrl+K)"). 화면과 분리한 순수 함수.
 */
import { matchesQuery } from "./session-search";

export interface PaletteCommand {
  id: string;
  /** 묶음 (탭, 세션, 모델 등). 검색어가 없을 때 이 순서로 보인다 */
  group: string;
  title: string;
  /** 오른쪽에 흐리게 보이는 설명이나 단축키 */
  hint?: string;
  /** 검색에만 쓰는 낱말 (예: 영어 이름) */
  keywords?: string;
  /** 지금은 쓸 수 없음 (목록에서 뺀다) */
  disabled?: boolean;
  run: () => void;
}

/**
 * 검색어로 거른다. 쓸 수 없는 명령은 뺀다.
 * 검색어가 있으면 제목이 첫 낱말로 시작하는 명령을 앞에 두고, 나머지는 원래 순서(묶음 순)를 지킨다.
 */
export function filterPalette(commands: readonly PaletteCommand[], query: string, limit = 200): PaletteCommand[] {
  const usable = commands.filter((c) => !c.disabled && matchesQuery(query, [c.title, c.group, c.hint, c.keywords]));
  const first = query.trim().toLowerCase().split(/\s+/)[0];
  if (!first) return usable.slice(0, limit);
  const starts = (c: PaletteCommand) => c.title.toLowerCase().startsWith(first) || c.group.toLowerCase().startsWith(first);
  return [...usable.filter(starts), ...usable.filter((c) => !starts(c))].slice(0, limit);
}

/** ↑(-1)·↓(+1)로 옮긴다. 끝에서는 반대쪽으로 넘어간다 */
export function cycleIndex(length: number, at: number, step: 1 | -1): number {
  if (length === 0) return -1;
  return (at + step + length) % length;
}

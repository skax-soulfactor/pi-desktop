/**
 * 세션 새로고침이 필요한지 판단한다.
 *
 * Pi는 세션을 시작할 때 쓸 수 있는 모델 목록을 만들어 두고, RPC(get_available_models)는 그 목록만 돌려준다.
 * 그래서 세션이 뜬 뒤 다른 곳(Pi 관리의 프로바이더, 터미널의 /login, 다른 PC)에서 로그인하면
 * 새 프로바이더의 모델이 그 세션에는 보이지 않는다. Pi를 다시 띄워야 한다.
 */

/** 자격 증명이 저장되어 있는데 세션의 모델 목록에는 없는 프로바이더 (이름) */
export function staleProviders(
  providers: ReadonlyArray<{ id: string; name: string; stored?: string }>,
  sessionModels: ReadonlyArray<{ provider: string }>,
): string[] {
  const known = new Set(sessionModels.map((m) => m.provider));
  return providers.filter((p) => p.stored !== undefined && !known.has(p.id)).map((p) => p.name || p.id);
}

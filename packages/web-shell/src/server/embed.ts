/**
 * 휴대폰 웹 서버 셋을 한 프로세스로 (설계 DESIGN-ONE-APP.md P4·"미룬 것").
 * Pi Web 서버(apps/desktop/src/server)가 `--workspaces`로 뜨면 같은 프로세스에서 Agent·Mate 웹 서버 묶음(agent/server.mjs, mate/server.mjs)을
 * 불러온다. 각 묶음은 자기 web-shell(electron 대체)을 따로 가지고 자기 포트에서 듣는다 (화면은 Pi Web의 작업 공간 iframe).
 * 프로세스 전체에 하나뿐인 것(명령줄 인자, process.resourcesPath, 신호 처리, process.exit)은 이 설정으로 대신한다.
 */
export interface EmbeddedApp {
  port: number;
  dataDir: string;
}

export interface WebEmbed {
  host: string;
  agent?: EmbeddedApp;
  mate?: EmbeddedApp;
  /** 불러온 서버가 뜬 뒤 알리는 접속 주소 (토큰 포함) */
  urls: Partial<Record<"agent" | "mate", string>>;
  /** Pi Web 서버가 끌 때 함께 부른다 */
  shutdowns: Array<() => void>;
}

const KEY = "__piWebEmbed";

/** Pi Web 서버가 불러오기 전에 건다 */
export function setWebEmbed(embed: WebEmbed): void {
  (globalThis as Record<string, unknown>)[KEY] = embed;
}

export function webEmbed(): WebEmbed | undefined {
  return (globalThis as Record<string, unknown>)[KEY] as WebEmbed | undefined;
}

/** Agent·Mate 서버: 한 프로세스로 불려 왔으면 그 설정 (아니면 undefined → 명령줄·환경 변수를 쓴다) */
export function embeddedApp(id: "agent" | "mate"): (EmbeddedApp & { embed: WebEmbed }) | undefined {
  const embed = webEmbed();
  const app = embed?.[id];
  return embed && app ? { ...app, embed } : undefined;
}

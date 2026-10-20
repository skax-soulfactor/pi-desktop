declare const __AGENT_VERSION__: string | undefined;

/** 번들할 때 package.json 버전이 주입된다. 테스트처럼 번들 없이 실행하면 "dev". */
export const AGENT_VERSION: string =
  typeof __AGENT_VERSION__ === "string" ? __AGENT_VERSION__ : "dev";

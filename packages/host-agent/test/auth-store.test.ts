import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Methods, type AuthCheckResult, type ProviderInfo } from "@pi-desktop/host-protocol";
import { checkAuth, isProviderId, listProviders, removeCredential, setApiKey } from "../src/auth-store";
import { locatePi } from "../src/pi-locator";
import { isolatedEnv, TestClient } from "./helpers/agent-client";
import { PI_CLI } from "./helpers/real-pi";

const tempAgent = () => mkdtempSync(join(tmpdir(), "pi-auth-store-"));
const readAuth = (dir: string) => JSON.parse(readFileSync(join(dir, "auth.json"), "utf8")) as Record<string, Record<string, unknown>>;

describe("auth.json 쓰기", () => {
  it("API 키를 저장하고 같은 항목의 env는 남긴다", async () => {
    const dir = tempAgent();
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({ cloudflare: { type: "api_key", key: "old", env: { CLOUDFLARE_ACCOUNT_ID: "a" } }, openai: { type: "oauth", access: "t" } }),
    );
    await setApiKey(dir, "cloudflare", "new-key");
    await setApiKey(dir, "groq", "!pass show groq");
    const auth = readAuth(dir);
    expect(auth.cloudflare).toEqual({ type: "api_key", key: "new-key", env: { CLOUDFLARE_ACCOUNT_ID: "a" } });
    expect(auth.groq).toEqual({ type: "api_key", key: "!pass show groq" });
    expect(auth.openai).toEqual({ type: "oauth", access: "t" });
    if (process.platform !== "win32") expect(statSync(join(dir, "auth.json")).mode & 0o777).toBe(0o600);
  });

  it("OAuth 항목에 API 키를 저장하면 OAuth 필드를 남기지 않는다", async () => {
    const dir = tempAgent();
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ openai: { type: "oauth", access: "t", refresh: "r" } }));
    await setApiKey(dir, "openai", "sk-x");
    expect(readAuth(dir).openai).toEqual({ type: "api_key", key: "sk-x" });
  });

  it("지우고, 없으면 false. 깨진 auth.json은 덮어쓰지 않고 오류", async () => {
    const dir = tempAgent();
    await setApiKey(dir, "groq", "k");
    expect(await removeCredential(dir, "groq")).toBe(true);
    expect(await removeCredential(dir, "groq")).toBe(false);
    expect(readAuth(dir)).toEqual({});
    writeFileSync(join(dir, "auth.json"), "{ broken");
    await expect(setApiKey(dir, "groq", "k")).rejects.toThrow();
    expect(readFileSync(join(dir, "auth.json"), "utf8")).toBe("{ broken");
  });

  it("프로바이더 ID 형식", () => {
    expect(["openai", "google-vertex", "xiaomi-token-plan-ams", "my.provider_1"].every(isProviderId)).toBe(true);
    expect(["", "../x", "a b", "__proto__x\n", "-x"].some(isProviderId)).toBe(false);
  });
});

describe("실제 Pi로 프로바이더 목록·확인", () => {
  it("내장 프로바이더와 models.json·auth.json의 프로바이더를 합치고, 키 값은 담지 않는다", async () => {
    const dir = tempAgent();
    writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { "my-llm": { baseUrl: "http://x" } } }));
    await setApiKey(dir, "groq", "sk-secret-value");
    const pi = await locatePi({ piCliPath: PI_CLI });
    const list = await listProviders(pi, dir);
    const byId = Object.fromEntries(list.map((p) => [p.id, p]));
    expect(list.length).toBeGreaterThan(30);
    expect(byId.anthropic).toMatchObject({ name: "Anthropic", apiKey: true, oauth: true, custom: false });
    expect(byId.groq).toMatchObject({ stored: "api_key" });
    expect(byId["my-llm"]).toMatchObject({ custom: true, apiKey: true });
    expect(JSON.stringify(list)).not.toContain("sk-secret-value");
  });

  it("pi auth check: 저장한 키가 있으면 ready, 없으면 not_ready (키는 출력하지 않는다)", async () => {
    const dir = tempAgent();
    const pi = await locatePi({ piCliPath: PI_CLI });
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir, PI_OFFLINE: "1", GROQ_API_KEY: "" };
    expect(await checkAuth(pi, "groq", env)).toMatchObject({ provider: "groq", status: "not_ready" });
    await setApiKey(dir, "groq", "sk-secret-value");
    const ready = await checkAuth(pi, "groq", env);
    expect(ready.status).toBe("ready");
    expect(JSON.stringify(ready)).not.toContain("sk-secret-value");
  });
});

describe("데몬 auth.*", () => {
  it("목록·저장·확인·삭제를 데몬으로 한다", async () => {
    const dir = tempAgent();
    const client = new TestClient(
      await isolatedEnv({ PI_DESKTOP_PI_CLI: PI_CLI, PI_CODING_AGENT_DIR: dir, PI_OFFLINE: "1", GROQ_API_KEY: "" }),
    );
    try {
      await client.request(Methods.authSetApiKey, { provider: "groq", key: "sk-daemon" });
      const list = await client.request<ProviderInfo[]>(Methods.authProviders);
      expect(list.find((p) => p.id === "groq")?.stored).toBe("api_key");
      expect((await client.request<AuthCheckResult>(Methods.authCheck, { provider: "groq" })).status).toBe("ready");
      expect(await client.request(Methods.authRemove, { provider: "groq" })).toEqual({ removed: true });
      await expect(client.request(Methods.authSetApiKey, { provider: "groq", key: "a\nb" })).rejects.toMatchObject({ code: -32602 });
      await expect(client.request(Methods.authSetApiKey, { provider: "../x", key: "k" })).rejects.toMatchObject({ code: -32602 });
    } finally {
      await client.shutdownDaemon();
    }
  });
});

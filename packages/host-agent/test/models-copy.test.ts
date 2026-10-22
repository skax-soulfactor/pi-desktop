import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Methods, type ModelsExportResult } from "@pi-desktop/host-protocol";
import { exportModel, exportProvider, importModel, importProvider } from "../src/models-store";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

function agentWith(providers: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-models-copy-"));
  writeFileSync(join(dir, "models.json"), JSON.stringify({ providers }, null, 2));
  return dir;
}

const read = (dir: string) => JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as { providers: Record<string, Record<string, unknown>> };

describe("exportProvider", () => {
  it("폼 밖 필드는 옮기고, 그대로 값인 apiKey·헤더는 뺀다 (환경 변수·명령 참조는 남김)", async () => {
    const dir = agentWith({
      ollama: {
        baseUrl: "http://localhost:11434/v1",
        api: "openai-completions",
        apiKey: "sk-secret",
        headers: { Authorization: "Bearer xyz", "X-Org": "$ORG_ID", "X-Cmd": "!pass show x" },
        compat: { supportsDeveloperRole: false },
        models: [{ id: "qwen", cost: { input: 0 } }],
      },
    });
    const { provider, dropped } = await exportProvider(dir, "ollama");
    expect(provider).toEqual({
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      headers: { "X-Org": "$ORG_ID", "X-Cmd": "!pass show x" },
      compat: { supportsDeveloperRole: false },
      models: [{ id: "qwen", cost: { input: 0 } }],
    });
    expect(dropped).toEqual(["apiKey", "headers.Authorization"]);
    // 원본 파일은 그대로
    expect(read(dir).providers.ollama!.apiKey).toBe("sk-secret");
  });

  it("환경 변수 apiKey는 그대로 옮기고, 없는 프로바이더는 알린다", async () => {
    const dir = agentWith({ a: { baseUrl: "https://x", apiKey: "${A_KEY}", models: [] } });
    expect((await exportProvider(dir, "a")).provider.apiKey).toBe("${A_KEY}");
    await expect(exportProvider(dir, "none")).rejects.toThrow("없는 프로바이더");
  });
});

describe("importProvider", () => {
  it("없으면 추가하고, 있으면 replace일 때만 바꾸며 대상의 키·헤더 값은 남긴다", async () => {
    const dir = agentWith({ keep: { baseUrl: "https://k" }, ollama: { baseUrl: "http://old", apiKey: "target-secret", headers: { Authorization: "t" } } });
    await importProvider(dir, "lmstudio", { baseUrl: "http://localhost:1234/v1", models: [] }, false);
    expect(read(dir).providers.lmstudio).toEqual({ baseUrl: "http://localhost:1234/v1", models: [] });
    await expect(importProvider(dir, "ollama", { baseUrl: "http://new" }, false)).rejects.toThrow("이미 있는");
    await importProvider(dir, "ollama", { baseUrl: "http://new", headers: { "X-Org": "$ORG" } }, true);
    expect(read(dir).providers.ollama).toEqual({
      baseUrl: "http://new",
      apiKey: "target-secret",
      headers: { Authorization: "t", "X-Org": "$ORG" },
    });
    expect(read(dir).providers.keep).toEqual({ baseUrl: "https://k" });
  });

  it("models.json이 없어도 새로 만든다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-models-copy-empty-"));
    await importProvider(dir, "a", { baseUrl: "https://x" }, false);
    expect(read(dir).providers.a).toEqual({ baseUrl: "https://x" });
  });
});

describe("exportModel·importModel", () => {
  it("모델 하나를 옮기고, 그대로 값인 헤더는 뺀다", async () => {
    const from = agentWith({ ollama: { baseUrl: "http://x", models: [{ id: "q", name: "Q", headers: { A: "secret", B: "$B" } }, { id: "r" }] } });
    const { model, dropped } = await exportModel(from, "ollama", "q");
    expect(model).toEqual({ id: "q", name: "Q", headers: { B: "$B" } });
    expect(dropped).toEqual(["headers.A"]);
    await expect(exportModel(from, "ollama", "zz")).rejects.toThrow("없는 모델");
    await expect(exportModel(from, "none", "q")).rejects.toThrow("없는 프로바이더");
  });

  it("같은 이름의 프로바이더에 넣고, 같은 ID는 replace일 때만 바꾸며 대상 헤더 값은 남긴다", async () => {
    const to = agentWith({ ollama: { baseUrl: "http://y", apiKey: "k", models: [{ id: "q", headers: { A: "mine" } }] } });
    await importModel(to, "ollama", { id: "new", name: "N" }, false);
    expect(read(to).providers.ollama!.models).toEqual([{ id: "q", headers: { A: "mine" } }, { id: "new", name: "N" }]);
    await expect(importModel(to, "ollama", { id: "q", name: "Q" }, false)).rejects.toThrow("이미 있는 모델");
    await importModel(to, "ollama", { id: "q", name: "Q", headers: { B: "$B" } }, true);
    expect((read(to).providers.ollama!.models as unknown[])[0]).toEqual({ id: "q", name: "Q", headers: { A: "mine", B: "$B" } });
    expect(read(to).providers.ollama!.apiKey).toBe("k");
    await expect(importModel(to, "other", { id: "x" }, false)).rejects.toThrow("프로바이더째");
    await expect(importModel(to, "ollama", { name: "no id" }, false)).rejects.toThrow("id가 필요");
  });
});

describe("데몬 models.exportProvider·importProvider", () => {
  let client: TestClient | undefined;
  afterEach(async () => {
    await client?.shutdownDaemon();
    client = undefined;
  });

  it("한 데이터 폴더에서 내보내 다른 데이터 폴더(다른 호스트)로 쓴다", async () => {
    const from = agentWith({ ollama: { baseUrl: "http://localhost:11434/v1", apiKey: "sk", models: [{ id: "q" }] } });
    const to = agentWith({});
    client = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: from }));
    const exported = await client.request<ModelsExportResult>(Methods.modelsExportProvider, { id: "ollama" });
    expect(exported.dropped).toEqual(["apiKey"]);
    await client.shutdownDaemon();
    client = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: to }));
    await client.request(Methods.modelsImportProvider, { id: "ollama", provider: exported.provider });
    expect(read(to).providers.ollama).toEqual({ baseUrl: "http://localhost:11434/v1", models: [{ id: "q" }] });
    await expect(client.request(Methods.modelsImportProvider, { id: "ollama", provider: exported.provider })).rejects.toThrow("이미 있는");
  });
});

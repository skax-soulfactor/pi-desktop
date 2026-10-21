import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Methods, type ModelsFileView, type ModelsProbeResult } from "@pi-desktop/host-protocol";
import { apiKeyView, mergeProvider, probeEndpoint, readModelsFile, removeProvider, saveProvider } from "../src/models-store";
import { isolatedEnv, TestClient } from "./helpers/agent-client";

const tempAgent = () => mkdtempSync(join(tmpdir(), "pi-models-store-"));
const readModels = (dir: string) => JSON.parse(readFileSync(join(dir, "models.json"), "utf8")) as Record<string, any>;

describe("apiKeyView", () => {
  it("환경 변수·명령은 보여주고 그대로 키 값은 가린다", () => {
    expect(apiKeyView("$OPENAI_KEY")).toEqual({ kind: "env", value: "$OPENAI_KEY" });
    expect(apiKeyView("${MY_KEY}")).toEqual({ kind: "env", value: "${MY_KEY}" });
    expect(apiKeyView("!pass show x")).toEqual({ kind: "command", value: "!pass show x" });
    expect(apiKeyView("sk-secret")).toEqual({ kind: "literal" });
    expect(apiKeyView(undefined)).toEqual({ kind: "none" });
  });
});

describe("mergeProvider", () => {
  const original = {
    baseUrl: "http://old/v1",
    api: "openai-completions",
    apiKey: "sk-keep",
    compat: { supportsStore: false },
    headers: { "x-a": "1" },
    models: [{ id: "m1", cost: { input: 1 }, input: ["text", "image"], contextWindow: 1000 }],
  };

  it("폼 밖의 필드(compat·headers·모델 cost)는 남기고, apiKey를 안 보내면 유지한다", () => {
    const merged = mergeProvider(original, {
      id: "p",
      baseUrl: "http://new/v1",
      api: "openai-completions",
      models: [{ id: "m1", image: false, contextWindow: 2000 }, { id: "m2", name: "Two", reasoning: true, image: true }, { id: " " }],
    });
    expect(merged).toEqual({
      baseUrl: "http://new/v1",
      api: "openai-completions",
      apiKey: "sk-keep",
      compat: { supportsStore: false },
      headers: { "x-a": "1" },
      models: [
        { id: "m1", cost: { input: 1 }, contextWindow: 2000 },
        { id: "m2", name: "Two", reasoning: true, input: ["text", "image"] },
      ],
    });
  });

  it("apiKey가 빈 문자열이면 지우고, 값이면 바꾼다", () => {
    expect(mergeProvider(original, { id: "p", baseUrl: "http://x", api: "a", apiKey: "", models: [] }).apiKey).toBeUndefined();
    expect(mergeProvider(original, { id: "p", baseUrl: "http://x", api: "a", apiKey: "$K", models: [] }).apiKey).toBe("$K");
  });
});

describe("models.json 읽기·쓰기", () => {
  it("저장하면 백업을 남기고, 다른 최상위 필드와 프로바이더는 그대로 둔다", async () => {
    const dir = tempAgent();
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({ $schema: "s", providers: { keep: { baseUrl: "http://k", models: [] }, old: { baseUrl: "http://o", apiKey: "sk-x", models: [{ id: "a" }] } } }),
    );
    await saveProvider(dir, { id: "renamed", baseUrl: "http://o2", api: "openai-completions", models: [{ id: "a" }] }, "old");
    const saved = readModels(dir);
    expect(saved.$schema).toBe("s");
    expect(Object.keys(saved.providers)).toEqual(["keep", "renamed"]);
    expect(saved.providers.renamed).toMatchObject({ baseUrl: "http://o2", apiKey: "sk-x" });
    expect(existsSync(join(dir, "models.json.bak"))).toBe(true);

    const view = await readModelsFile(dir);
    expect(view.providers.find((p) => p.id === "renamed")?.apiKey).toEqual({ kind: "literal" });
    expect(JSON.stringify(view)).not.toContain("sk-x");

    expect(await removeProvider(dir, "keep")).toBe(true);
    expect(await removeProvider(dir, "keep")).toBe(false);
  });

  it("파일이 없으면 새로 만들고, 깨졌으면 읽기 오류를 알리고 덮어쓰지 않는다", async () => {
    const dir = tempAgent();
    await saveProvider(dir, { id: "ollama", baseUrl: "http://localhost:11434/v1", api: "openai-completions", apiKey: "ollama", models: [{ id: "qwen" }] });
    expect(readModels(dir).providers.ollama.models).toEqual([{ id: "qwen" }]);

    writeFileSync(join(dir, "models.json"), "{ broken");
    expect((await readModelsFile(dir)).error).toBeTruthy();
    await expect(saveProvider(dir, { id: "x", baseUrl: "http://x", api: "a", models: [] })).rejects.toThrow();
    expect(readFileSync(join(dir, "models.json"), "utf8")).toBe("{ broken");
  });
});

describe("probeEndpoint", () => {
  it("OpenAI 형식(data[].id)과 Ollama 형식(models[].name)을 읽고, 환경 변수 키를 Bearer로 보낸다", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(`${req.url} ${req.headers.authorization ?? "-"}`);
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") res.end(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }));
      else if (req.url === "/ollama/models") res.end(JSON.stringify({ models: [{ name: "qwen:7b" }] }));
      else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect(await probeEndpoint(`${base}/v1/`, "$TEST_KEY", { TEST_KEY: "sk-env" })).toMatchObject({ ok: true, models: ["a", "b"] });
      expect(await probeEndpoint(`${base}/ollama`, "!secret-cmd", {})).toMatchObject({ ok: true, models: ["qwen:7b"] });
      expect(await probeEndpoint(`${base}/nope`, undefined, {})).toMatchObject({ ok: false, status: 404 });
      expect(seen).toEqual(["/v1/models Bearer sk-env", "/ollama/models -", "/nope/models -"]);
      expect((await probeEndpoint("http://127.0.0.1:1", undefined, {})).ok).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe("데몬 models.*", () => {
  it("저장·읽기·연결 시험(저장된 키 사용)·삭제", async () => {
    const dir = tempAgent();
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: req.headers.authorization === "Bearer sk-stored" ? "authed" : "anon" }] }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const client = new TestClient(await isolatedEnv({ PI_CODING_AGENT_DIR: dir }));
    try {
      await client.request(Methods.modelsSaveProvider, {
        provider: { id: "local", baseUrl, api: "openai-completions", apiKey: "sk-stored", models: [{ id: "m" }] },
      });
      const view = await client.request<ModelsFileView>(Methods.modelsRead);
      expect(view.providers[0]).toMatchObject({ id: "local", apiKey: { kind: "literal" }, models: [{ id: "m" }] });
      const probe = await client.request<ModelsProbeResult>(Methods.modelsProbe, { baseUrl, providerId: "local" });
      expect(probe.models).toEqual(["authed"]);
      await expect(
        client.request(Methods.modelsSaveProvider, { provider: { id: "x", baseUrl: "file:///etc", api: "a", models: [] } }),
      ).rejects.toMatchObject({ code: -32602 });
      expect(await client.request(Methods.modelsRemoveProvider, { id: "local" })).toEqual({ removed: true });
    } finally {
      await client.shutdownDaemon();
      server.close();
    }
  });
});

import { readInbox, type InboxItem } from "@pi-desktop/mate-kit";
import { delegateInboxItem, requestOneOff } from "../delegate";
import { applyInboxChange, discardInboxChange } from "../inbox-change";
import { OBSERVER_DUTY_ID, OBSERVER_NAME } from "../observer";
import type { MatePaths } from "../paths";
import { addRequest, listDuties, listRuns, loadConfig, loadInboxState, loadState, readJson, setInboxStatus, writeJsonAtomic } from "../store";
import type { Duty, MateConfig } from "../types";
import type { Exec } from "../watchers";
import {
  chunks,
  confirmApplyButtons,
  escapeHtml,
  folderAlias,
  HELP_TEXT,
  inQuietHours,
  itemButtons,
  itemText,
  parseCallback,
  parseCommand,
  resolveFolder,
  safe,
  shouldNotify,
  type Command,
} from "./messages";
import { TelegramApi, type TgUpdate } from "./telegram-api";

/** 실행기가 쓰는 휴대폰 연결 상태 (Mate 홈 remote.json). 앱은 읽기만 한다 */
export interface RemoteState {
  /** 이 상태가 어느 연결(설정의 pairEpoch) 것인지. 다르면 연결이 없는 것으로 본다 */
  epoch: number;
  chatId?: number;
  chatName?: string;
  pairedAt?: number;
  /** 다 쓴 짝짓기 코드 (다시 쓰지 못하게) */
  usedCode?: string;
  botName?: string;
  /** 텔레그램 getUpdates offset */
  offset?: number;
  /** 보낸 인박스 항목 → 메시지 id */
  sent: Record<string, { messageId: number; at: number }>;
  /** 휴대폰에서 시작한 실행: 임무 id → 요청 시각 (끝나면 결과를 보낸다) */
  pendingRuns: Record<string, number>;
  lastPollAt?: number;
  lastError?: string;
}

const MAX_SEND_PER_CYCLE = 5;
const POLL_TIMEOUT_SEC = 25;

export function remoteStatePath(paths: MatePaths): string {
  return paths.remote;
}

export async function loadRemoteState(paths: MatePaths): Promise<RemoteState> {
  const raw = await readJson<Partial<RemoteState>>(paths.remote, {});
  return { epoch: raw.epoch ?? 0, ...raw, sent: raw.sent ?? {}, pendingRuns: raw.pendingRuns ?? {} } as RemoteState;
}

/**
 * 휴대폰(텔레그램) 연결 (설계 DESIGN-MATE.md §12).
 * 실행기 안에서 따로 돌며(임무 실행 중에도 버튼에 바로 답하도록), 앱과 같은 동작만 한다:
 * 인박스 확인·버리기, 고친 변경 적용(한 번 더 묻기)·버리기, 맡기기·고치기 지시(설정에서 허용했을 때), 살펴보기 지시, 임무 실행.
 * 연결된 개인 채팅 한 곳의 명령만 받는다.
 */
export class TelegramRemote {
  private stopped = false;
  private abort = new AbortController();
  private readonly api: TelegramApi;

  constructor(
    private readonly paths: MatePaths,
    token: string,
    private readonly exec: Exec,
    private readonly log: (message: string) => void,
    private readonly now: () => number = Date.now,
    apiBase?: string,
  ) {
    this.api = new TelegramApi(token, apiBase);
  }

  start(): void {
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.abort.abort();
  }

  private async loop(): Promise<void> {
    let backoff = 5_000;
    while (!this.stopped) {
      try {
        const active = await this.cycle();
        backoff = 5_000;
        if (!active) await sleep(15_000);
      } catch (error) {
        if (this.stopped) break;
        const message = (error as Error).message;
        this.log(`telegram error ${message}`);
        await this.patchState({ lastError: message }).catch(() => undefined);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 120_000);
      }
    }
  }

  /** 한 번 돈다: 받은 것 처리 → 보낼 것 보내기. 꺼져 있으면 false */
  async cycle(pollTimeoutSec = POLL_TIMEOUT_SEC): Promise<boolean> {
    const config = await loadConfig(this.paths);
    if (!config.telegram.enabled) return false;
    let state = await this.syncEpoch(config);
    if (!state.botName) {
      const me = await this.api.getMe();
      state = await this.patchState({ botName: me.username });
    }
    const updates = await this.api.getUpdates(state.offset, pollTimeoutSec, this.abort.signal);
    for (const update of updates) {
      await this.handleUpdate(update, config).catch((error: Error) => this.log(`telegram update error ${error.message}`));
      await this.patchState({ offset: update.update_id + 1 });
    }
    const after = await loadRemoteState(this.paths);
    if (after.chatId) await this.outbound(config, after);
    await this.patchState({ lastPollAt: this.now(), lastError: undefined });
    return true;
  }

  /** 설정의 연결 번호가 바뀌었으면(앱에서 연결 해제) 연결을 버린다 */
  private async syncEpoch(config: MateConfig): Promise<RemoteState> {
    const state = await loadRemoteState(this.paths);
    if (state.epoch === config.telegram.pairEpoch) return state;
    const next: RemoteState = { epoch: config.telegram.pairEpoch, sent: {}, pendingRuns: {}, ...(state.offset ? { offset: state.offset } : {}) };
    await writeJsonAtomic(this.paths.remote, next);
    return next;
  }

  private async patchState(patch: Partial<RemoteState>): Promise<RemoteState> {
    const state = { ...(await loadRemoteState(this.paths)), ...patch };
    for (const key of Object.keys(patch) as Array<keyof RemoteState>) if (patch[key] === undefined) delete state[key];
    await writeJsonAtomic(this.paths.remote, state);
    return state;
  }

  // ── 받은 것 ──

  private async handleUpdate(update: TgUpdate, config: MateConfig): Promise<void> {
    const state = await loadRemoteState(this.paths);
    if (update.message?.text !== undefined) {
      const chat = update.message.chat;
      if (chat.type !== "private") return; // 단체방은 받지 않는다
      const command = parseCommand(update.message.text);
      if (!state.chatId) {
        if (command?.kind === "start" && command.code) await this.tryPair(chat, command.code, config, state);
        else await this.api.sendMessage(chat.id, "Mate와 연결하려면 PC의 Mate 설정 → 휴대폰 연결에서 만든 코드를 <code>/start 코드</code>로 보내 주세요.");
        return;
      }
      if (chat.id !== state.chatId) return; // 연결된 채팅만
      if (command) await this.handleCommand(command, config, state);
      return;
    }
    const cb = update.callback_query;
    if (cb?.message && state.chatId && cb.message.chat.id === state.chatId) {
      await this.handleCallback(cb.id, cb.data, cb.message.message_id, config);
    } else if (cb) {
      await this.api.answerCallback(cb.id, "연결되지 않은 채팅입니다");
    }
  }

  private async tryPair(chat: { id: number; first_name?: string; username?: string }, code: string, config: MateConfig, state: RemoteState): Promise<void> {
    const t = config.telegram;
    const valid = t.pairingCode && t.pairingExpires && this.now() < t.pairingExpires && code.trim() === t.pairingCode && state.usedCode !== t.pairingCode;
    if (!valid) {
      await this.api.sendMessage(chat.id, "코드가 맞지 않거나 시간이 지났어요. Mate 설정에서 새 코드를 만들어 주세요.");
      return;
    }
    const name = chat.username ? `@${chat.username}` : (chat.first_name ?? String(chat.id));
    await this.patchState({ chatId: chat.id, chatName: name, pairedAt: this.now(), usedCode: t.pairingCode! });
    this.log(`telegram paired chat=${chat.id}`);
    await this.api.sendMessage(chat.id, `✅ 연결했어요. 이제 Mate 알림이 여기로 옵니다.\n\n${HELP_TEXT}`);
  }

  private async handleCommand(command: Command, config: MateConfig, state: RemoteState): Promise<void> {
    const chatId = state.chatId!;
    const say = (text: string) => this.api.sendMessage(chatId, text);
    switch (command.kind) {
      case "start":
      case "help":
        await say(HELP_TEXT);
        return;
      case "status":
        await say(await this.statusText(config));
        return;
      case "inbox": {
        const fresh = await this.freshItems();
        if (fresh.length === 0) return void (await say("새 제안이 없어요."));
        const names = await this.dutyNames();
        for (const item of fresh.slice(0, 5)) await this.sendItem(item, names, config, chatId);
        if (fresh.length > 5) await say(`그 밖에 ${fresh.length - 5}건은 PC의 Mate에서 보세요.`);
        return;
      }
      case "duties": {
        const duties = (await listDuties(this.paths)).filter((d) => !isOneOff(d));
        await say(duties.length ? duties.map((d) => `• ${escapeHtml(d.name)} <code>${d.id}</code>`).join("\n") : "임무가 없어요.");
        return;
      }
      case "folders": {
        const folders = await this.knownFolders();
        await say(folders.length ? folders.map((f) => `• <b>${escapeHtml(folderAlias(f))}</b> ${escapeHtml(f)}`).join("\n") : "아는 폴더가 없어요. PC의 Mate에서 임무를 하나 만들어 주세요.");
        return;
      }
      case "run": {
        const q = command.query.toLowerCase();
        const duty = (await listDuties(this.paths)).find((d) => d.id === q || (q && d.name.toLowerCase().includes(q)));
        if (!duty) return void (await say("그 임무를 찾지 못했어요. /duties로 목록을 보세요."));
        await addRequest(this.paths, duty.id, this.now());
        await this.trackRun(duty.id);
        await say(`▶ <b>${escapeHtml(duty.name)}</b>을(를) 실행할게요. 끝나면 알려 드릴게요.`);
        return;
      }
      case "ask":
      case "fix": {
        if (!command.text) return void (await say(`무엇을 할지 함께 보내 주세요. 예: <code>/${command.kind} ${command.kind === "fix" ? "pi-desktop 깨진 테스트 고쳐줘" : "pi-desktop CI 실패 원인 찾아줘"}</code>`));
        if (command.kind === "fix" && !config.telegram.allowFix) {
          return void (await say("휴대폰에서 고치기는 꺼져 있어요. PC의 Mate 설정 → 휴대폰 연결에서 허용할 수 있어요. 지금은 /ask로 살펴보기만 할 수 있어요."));
        }
        const folders = await this.knownFolders();
        const { folder, rest } = resolveFolder(command.text, folders);
        if (!folder || !rest) {
          const list = folders.map((f) => `<b>${escapeHtml(folderAlias(f))}</b>`).join(", ");
          return void (await say(folders.length ? `어느 폴더인지 앞에 써 주세요: ${list}\n예: <code>/${command.kind} ${escapeHtml(folderAlias(folders[0]!))} ${escapeHtml(rest || "할 일")}</code>` : "아는 폴더가 없어요. PC의 Mate에서 임무를 하나 만들어 주세요."));
        }
        const duty = await requestOneOff(
          this.paths,
          { idPrefix: "phone", name: `휴대폰 지시: ${rest}`, cwd: folder, prompt: rest, wantAct: command.kind === "fix" },
          this.exec,
          this.now(),
        );
        await this.trackRun(duty.id);
        const how = duty.profile === "act" ? "별도 작업 공간에서 고치고, 적용은 다시 물을게요" : "읽기만 하며 살펴보고 결과를 보낼게요";
        await say(`📝 받았어요 (<b>${escapeHtml(folderAlias(folder))}</b>): ${safe(rest, 200)}\n${how}.`);
        return;
      }
    }
  }

  private async handleCallback(id: string, data: string | undefined, messageId: number, config: MateConfig): Promise<void> {
    const cb = parseCallback(data);
    const state = await loadRemoteState(this.paths);
    const chatId = state.chatId!;
    if (!cb) return void (await this.api.answerCallback(id));
    const item = (await readInbox(this.paths.inbox)).find((i) => i.id === cb.itemId);
    if (!item) return void (await this.api.answerCallback(id, "이미 없는 항목이에요"));
    const handled = (await loadInboxState(this.paths))[item.id];
    const done = async (label: string) => {
      await this.api.editButtons(chatId, messageId, []);
      await this.api.answerCallback(id, label);
      await this.api.sendMessage(chatId, `${label}: ${safe(item.title, 120)}`);
      this.log(`telegram ${cb.action} item=${item.id}`);
    };
    if (handled && cb.action !== "view") {
      await this.api.editButtons(chatId, messageId, []);
      return void (await this.api.answerCallback(id, "이미 처리한 항목이에요"));
    }
    try {
      switch (cb.action) {
        case "confirmApply":
          await this.api.editButtons(chatId, messageId, confirmApplyButtons(item.id));
          return void (await this.api.answerCallback(id, "PC의 작업 폴더에 적용할까요?"));
        case "cancel":
          await this.api.editButtons(chatId, messageId, itemButtons(item, config.telegram));
          return void (await this.api.answerCallback(id));
        case "apply":
          await applyInboxChange(this.paths, item.id, this.exec);
          return void (await done("✅ 적용했어요 (커밋은 PC에서)"));
        case "discard":
          await discardInboxChange(this.paths, item.id, this.exec);
          return void (await done("🗑 버렸어요"));
        case "accept":
          await setInboxStatus(this.paths, [item.id], "accepted");
          return void (await done("👍 확인했어요"));
        case "dismiss":
          await setInboxStatus(this.paths, [item.id], "dismissed");
          return void (await done("🗑 버렸어요"));
        case "delegate": {
          if (!config.telegram.allowFix) return void (await this.api.answerCallback(id, "휴대폰에서 고치기는 설정에서 허용해야 해요"));
          const duty = await delegateInboxItem(this.paths, item.id, this.exec);
          await this.trackRun(duty.id);
          return void (await done("🛠 맡겼어요. 끝나면 알려 드릴게요"));
        }
        case "view": {
          await this.api.answerCallback(id);
          if (!config.telegram.sendDetail) return;
          const text = item.detail ?? "(자세한 내용 없음)";
          for (const part of chunks(text)) await this.api.sendMessage(chatId, `<pre>${safe(part, 4000)}</pre>`);
          return;
        }
      }
    } catch (error) {
      await this.api.answerCallback(id, "실패했어요");
      await this.api.sendMessage(chatId, `⚠️ ${safe((error as Error).message, 400)}`);
    }
  }

  // ── 보낼 것 ──

  private async outbound(config: MateConfig, state: RemoteState): Promise<void> {
    const chatId = state.chatId!;
    // 휴대폰에서 시작한 실행이 끝났으면 결과를 알린다
    if (Object.keys(state.pendingRuns).length > 0) {
      const runs = await listRuns(this.paths, 100);
      const pending = { ...state.pendingRuns };
      for (const [dutyId, at] of Object.entries(pending)) {
        const run = runs.find((r) => r.dutyId === dutyId && r.startedAt >= at - 1_000 && r.status !== "running");
        if (!run) continue;
        const ok = run.status === "done";
        const lines = [`${ok ? "✅ 끝났어요" : "⚠️ 실패했어요"}: <b>${safe(run.dutyName, 120)}</b>`];
        if (run.error) lines.push(safe(run.error, 400));
        else if (run.summary) lines.push(safe(run.summary, 900));
        if (run.proposals) lines.push(`인박스에 ${run.proposals}건을 남겼어요.`);
        await this.api.sendMessage(chatId, lines.join("\n"));
        delete pending[dutyId];
      }
      await this.patchState({ pendingRuns: pending });
    }
    if (inQuietHours(config.telegram.quiet, this.now())) return;
    const fresh = (await this.freshItems()).filter((i) => i.createdAt >= (state.pairedAt ?? 0) && !state.sent[i.id] && shouldNotify(i, config.telegram.notify));
    if (fresh.length === 0) return;
    const names = await this.dutyNames();
    // 오래된 것부터 보낸다
    for (const item of fresh.reverse().slice(0, MAX_SEND_PER_CYCLE)) await this.sendItem(item, names, config, chatId);
  }

  private async sendItem(item: InboxItem, names: Map<string, string>, config: MateConfig, chatId: number): Promise<void> {
    const sent = await this.api.sendMessage(chatId, itemText(item, names.get(item.dutyId) ?? item.dutyId), itemButtons(item, config.telegram));
    const state = await loadRemoteState(this.paths);
    const map = { ...state.sent, [item.id]: { messageId: sent.message_id, at: this.now() } };
    // 한 달 넘은 기록은 지운다
    for (const [k, v] of Object.entries(map)) if (this.now() - v.at > 30 * 24 * 3_600_000) delete map[k];
    await this.patchState({ sent: map });
  }

  private async freshItems(): Promise<InboxItem[]> {
    const [items, handled] = await Promise.all([readInbox(this.paths.inbox), loadInboxState(this.paths)]);
    return items.filter((i) => !handled[i.id]).sort((a, b) => b.createdAt - a.createdAt);
  }

  private async dutyNames(): Promise<Map<string, string>> {
    return new Map<string, string>([[OBSERVER_DUTY_ID, OBSERVER_NAME], ...(await listDuties(this.paths)).map((d) => [d.id, d.name] as [string, string])]);
  }

  /** 지시할 수 있는 폴더: 임무 폴더 + 활동 관찰이 본 최근 작업 폴더 */
  private async knownFolders(): Promise<string[]> {
    const duties = await listDuties(this.paths);
    const state = await loadState(this.paths);
    const all = [...duties.filter((d) => !isOneOff(d)).map((d) => d.cwd), ...(state.observer?.recent.map((s) => s.cwd) ?? []), ...duties.map((d) => d.cwd)];
    const seen = new Map<string, string>();
    for (const f of all) if (f && !seen.has(f.replace(/\\/g, "/").toLowerCase())) seen.set(f.replace(/\\/g, "/").toLowerCase(), f);
    return [...seen.values()].slice(0, 20);
  }

  private async trackRun(dutyId: string): Promise<void> {
    const state = await loadRemoteState(this.paths);
    await this.patchState({ pendingRuns: { ...state.pendingRuns, [dutyId]: this.now() } });
  }

  private async statusText(config: MateConfig): Promise<string> {
    const [state, fresh] = await Promise.all([loadState(this.paths), this.freshItems()]);
    const cost = state.today.costUsd ? ` · 오늘 비용 $${state.today.costUsd.toFixed(3)}` : "";
    return [
      "<b>Mate 상태</b>",
      `실행기: 동작 중${state.current ? ` (지금 실행 중: ${escapeHtml(state.current.dutyId)})` : ""}`,
      `오늘 자동 실행 ${state.today.count}/${config.dailyRunLimit}회${cost}`,
      `새 제안 ${fresh.length}건${config.paused ? " · 일시 정지 중" : ""}`,
      `모델: ${escapeHtml(config.model || "Pi 기본 모델")}`,
    ].join("\n");
  }
}

/** 휴대폰 지시·맡긴 일처럼 한 번만 도는 임무 */
function isOneOff(duty: Duty): boolean {
  return /^(phone|delegated)-/.test(duty.id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

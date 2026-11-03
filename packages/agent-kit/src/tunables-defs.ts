import type { TunableDef } from "./tunables-core";

/**
 * Pi Desktop Agent의 설정으로 꺼낸 프롬프트와 수치의 정의 (설계 DESIGN-APPS.md §7).
 *
 * 기본값은 여기 하나뿐이다. 코드는 값을 직접 박지 않고 `agentTunables().num(id)`·`.text(id)`(tunables.ts)로 읽는다.
 * 순수 함수는 인자로 받고, 인자가 없으면 `agentDefault(id)`를 쓴다.
 * `locked`가 있는 항목은 화면에 읽기 전용으로 보이고, 저장된 값이 있어도 기본값을 쓴다.
 *
 * 화면(브라우저)과 확장 양쪽에서 불러오므로 어떤 모듈도 import하지 않는다 (타입만).
 */

export const AGENT_TUNABLES: readonly TunableDef[] = [
  // ── 지식베이스 ──────────────────────────────────────────────
  {
    id: "memory.extractSystem",
    group: "지식베이스",
    label: "자동 기억 정리 지시",
    purpose:
      "대화가 끝날 때마다 지금 모델을 한 번 더 불러, 다음 대화에서도 알아야 할 것을 지식베이스에 남기게 하는 시스템 프롬프트입니다. " +
      "무엇을 남기고 무엇을 버릴지(종류·규칙)를 정합니다. 맨 끝의 '출력' JSON 형식은 앱이 그대로 읽으므로 바꾸면 기억이 저장되지 않습니다. " +
      "지식베이스 화면에서 자동 정리를 끄면 쓰이지 않습니다.",
    kind: "text",
    default: `너는 데스크톱 에이전트의 지식베이스 관리자다. 방금 끝난 대화를 검토해 다음 대화에서도 알아야 할 것만 지식베이스에 남긴다.

종류(type):
- user: 사용자의 역할·전문성·쓰는 환경·선호 (예: "커밋 메시지는 한글로", "회사 PC는 Windows")
- requirement: 진행 중인 일·목표·제약·결정 사항
- lesson: 에이전트의 실수와 재발 방지 규칙. 본문은 반드시 아래 네 항목을 빈 줄로 나눠 쓴다
  "**상황:** ...\\n\\n**실수:** ...\\n\\n**원인:** ...\\n\\n**재발 방지:** ..."
- reference: 자료·문서·저장소·주소 같은 외부 자원 위치

규칙:
- title은 한 줄 요약, content는 Markdown 본문, tags는 찾기 쉬운 낱말 몇 개. 모두 한국어로.
- 같은 주제가 이미 있으면 create 대신 update(id 포함)로 고친다. 중복 금지.
- 사용자 말이 기존 항목과 어긋나면 그 항목을 update하거나 archive한다.
- 이번 대화에만 필요한 것, 일회성 내용은 저장하지 않는다.
- 검증되지 않은 진단이나 해결책을 사실로 저장하지 않는다. "A로 B를 해결했다"는 사용자가 해결을 확인했을 때만.
- 비밀번호·API 키·토큰 등 민감 정보는 절대 저장하지 않는다.
- 실패 신호(도구 오류, 승인 거부)가 있으면 lesson을 먼저 검토한다. 단, 거부 자체를 교훈으로 삼지 말고 사용자가 원한 방식이 드러났을 때만 남긴다.
- 저장할 것이 없으면 ops를 빈 배열로 반환한다. 대부분의 대화는 그렇다.

출력: 아래 JSON만 출력한다. 설명·인사·코드 펜스 금지.
{"ops":[{"op":"create","type":"user|requirement|lesson|reference","title":"한 줄 요약","content":"본문","tags":["태그"]},{"op":"update","id":"기존 id","content":"고친 본문"},{"op":"archive","id":"기존 id"}]}`,
    source: "packages/agent-kit/extensions/memory/extract.ts",
  },
  {
    id: "memory.unverifiedRule",
    group: "지식베이스",
    label: "확인 안 된 대화의 규칙",
    purpose:
      "도구로 아무것도 확인하지 않은 대화(모델이 말로만 설명한 대화)를 정리할 때 위 지시 뒤에 덧붙입니다. " +
      "모델이 지어낸 외부 사실이 기억으로 굳지 않도록, 사용자가 직접 말한 것만 남기게 합니다.",
    kind: "text",
    default: `

이번 대화에서는 도구로 확인한 것이 하나도 없다.
- 그러므로 에이전트가 설명한 외부 사실(제품 버전·가격·정책, 도구 동작 원리 등)은 저장하지 않는다. 확신에 차서 말했든 출처를 적었든 마찬가지다.
- 사용자가 직접 말한 것만 저장한다: 선호, 쓰는 환경·도구, 요구사항, 결정, 계획.`,
    source: "packages/agent-kit/extensions/memory/extract.ts",
  },
  {
    id: "memory.sectionIntro",
    group: "지식베이스",
    label: "지식베이스 안내 (시스템 프롬프트)",
    purpose:
      "매 요청마다 시스템 프롬프트의 지식베이스 칸 맨 앞에 붙는 안내입니다. 모델이 기억을 어떻게 다룰지(관련 있을 때만 따르기, 틀리면 고치기)를 알려 줍니다. " +
      "그 뒤에 항목 목록과 관련 항목 본문이 이어집니다.",
    kind: "text",
    default:
      "지식베이스: 사용자와 지난 작업에 대해 알고 있는 것이다. 지금 요청과 관련 있을 때만 따르고, 틀렸으면 memory_save로 고치거나 memory_forget으로 보관하라.\n" +
      "[확인 안 됨]은 도구로 확인하지 않은 대화에서 나온 것이니 근거로 삼기 전에 확인하라. 목록의 본문이 필요하면 memory_read(id)로 읽어라.",
    source: "packages/agent-kit/extensions/memory/recall.ts",
  },
  {
    id: "memory.minRelevance",
    group: "지식베이스",
    label: "관련 항목으로 볼 최소 점수",
    purpose:
      "지금 요청과 지식베이스 항목이 얼마나 겹치는지(0~1) 계산해, 이 값 이상인 항목만 본문까지 시스템 프롬프트에 싣습니다. " +
      "낮추면 더 많은 기억이 실려 문맥을 많이 쓰고, 높이면 꼭 맞는 기억만 실립니다. 고정한 항목은 이 값과 관계없이 늘 실립니다.",
    kind: "number",
    default: 0.2,
    min: 0,
    max: 1,
    source: "packages/agent-kit/extensions/memory/recall.ts",
  },
  {
    id: "memory.dupThreshold",
    group: "지식베이스",
    label: "중복으로 볼 겹침 정도",
    purpose:
      "지식베이스 화면의 '점검'에서 같은 종류의 두 항목이 제목·태그가 이만큼(0~1) 겹치면 '합칠 수 있음'으로 올립니다. " +
      "낮추면 비슷한 것도 중복 후보로 많이 나오고, 높이면 거의 같은 것만 나옵니다.",
    kind: "number",
    default: 0.7,
    min: 0.1,
    max: 1,
    source: "packages/agent-kit/extensions/memory/store.ts",
  },
  {
    id: "memory.staleDays",
    group: "지식베이스",
    label: "오래 안 쓴 항목으로 볼 날 수",
    purpose: "지식베이스 화면의 '점검'에서 이 날 수 동안 한 번도 대화에 실리지 않은 항목을 '오래 쓰이지 않음'으로 올립니다.",
    kind: "number",
    default: 30,
    unit: "일",
    min: 1,
    max: 3650,
    integer: true,
    source: "packages/agent-kit/extensions/memory/store.ts",
  },
  {
    id: "memory.sectionName",
    group: "지식베이스",
    label: "시스템 프롬프트 칸 이름",
    purpose: "지식베이스가 들어가는 시스템 프롬프트 칸의 이름입니다. Pi가 이 이름을 XML 태그로 씁니다.",
    kind: "text",
    default: "agent_memory",
    locked: "Pi의 시스템 프롬프트 칸 이름이라, 바꾸면 이전 요청과 같은 칸으로 알아보지 못해 기억이 두 번 실릴 수 있습니다.",
    source: "packages/agent-kit/extensions/memory/index.ts",
  },
  {
    id: "memory.noShareTag",
    group: "지식베이스",
    label: "공유 제외 태그",
    purpose: "이 태그가 붙은 지식베이스 항목은 피어 답변·에이전트 카드 초안처럼 밖으로 나가는 곳에 쓰지 않습니다.",
    kind: "text",
    default: "공유제외",
    locked: "이미 저장된 항목들이 이 태그로 표시되어 있어, 바꾸면 그 항목들이 밖으로 나갈 수 있습니다.",
    source: "packages/agent-kit/extensions/memory/types.ts",
  },

  // ── 문서 처리 ───────────────────────────────────────────────
  {
    id: "documents.transformSystem",
    group: "문서 처리",
    label: "조각 바꾸기 지시 (번역·교정)",
    purpose:
      "process_document 도구가 transform 방식(번역·교정처럼 문서 전체를 바꿔 내놓는 일)일 때, 문서 조각마다 모델에 주는 시스템 프롬프트입니다. " +
      "조각 결과를 그대로 이어 붙여 결과 파일을 만들므로, 설명을 붙이지 않게 하는 것이 중요합니다.",
    kind: "text",
    default: "너는 긴 문서의 한 부분을 지시대로 바꾼다. 바꾼 본문만 출력하라. 설명·머리말·맺음말을 붙이지 말고, 빠뜨리는 문장 없이 처리하라.",
    source: "packages/agent-kit/extensions/documents/index.ts",
  },
  {
    id: "documents.reduceSystem",
    group: "문서 처리",
    label: "조각 뽑기 지시 (요약·질문)",
    purpose: "process_document 도구가 reduce 방식(요약·질문)일 때, 문서 조각마다 필요한 내용만 뽑게 하는 시스템 프롬프트입니다.",
    kind: "text",
    default: "너는 긴 문서의 한 부분을 읽고, 지시에 답하는 데 필요한 내용만 간결하게 뽑아 적는다. 관련 내용이 없으면 '관련 없음'이라고만 적어라.",
    source: "packages/agent-kit/extensions/documents/index.ts",
  },
  {
    id: "documents.combineSystem",
    group: "문서 처리",
    label: "뽑은 것 모으기 지시",
    purpose: "reduce 방식에서 조각마다 뽑은 내용을 한 번 더 모아 최종 답을 만들 때 쓰는 시스템 프롬프트입니다. 조각이 하나면 쓰이지 않습니다.",
    kind: "text",
    default: "문서를 부분별로 읽고 뽑아 둔 내용이다. 이것을 모아 지시에 답하라. '관련 없음'인 부분은 무시하라.",
    source: "packages/agent-kit/extensions/documents/index.ts",
  },

  // ── 백그라운드 작업 ─────────────────────────────────────────
  {
    id: "tasks.maxRunning",
    group: "백그라운드 작업",
    label: "한 대화에서 동시에 돌릴 작업 수",
    purpose:
      "delegate_task 도구로 맡긴 백그라운드 워커를 한 대화에서 동시에 이만큼까지 돌립니다. 넘으면 모델에게 기다리라고 돌려줍니다. " +
      "워커마다 Pi를 하나씩 띄우고 모델을 따로 부르므로, 늘리면 비용과 PC 부하가 함께 늘어납니다.",
    kind: "number",
    default: 2,
    unit: "개",
    min: 1,
    max: 8,
    integer: true,
    source: "packages/agent-kit/extensions/tasks/index.ts",
  },
  {
    id: "tasks.resultChars",
    group: "백그라운드 작업",
    label: "대화에 넣는 작업 결과 길이",
    purpose: "작업이 끝나면 결과를 [작업 알림]으로 대화에 넣는데, 이 글자 수까지만 넣습니다. 전문은 작업 기록 파일에 남습니다. 늘리면 문맥을 많이 씁니다.",
    kind: "number",
    default: 4000,
    unit: "글자",
    min: 500,
    max: 100_000,
    integer: true,
    source: "packages/agent-kit/extensions/tasks/index.ts",
  },

  // ── 예약 ────────────────────────────────────────────────────
  {
    id: "schedule.maxRunning",
    group: "예약",
    label: "동시에 돌릴 예약 실행 수",
    purpose: "때가 된 예약이 여러 개면 이만큼까지 동시에 실행하고 나머지는 다음 확인 때 돌립니다.",
    kind: "number",
    default: 2,
    unit: "개",
    min: 1,
    max: 8,
    integer: true,
    source: "packages/agent-kit/extensions/schedule/index.ts",
  },
  {
    id: "schedule.minIntervalMinutes",
    group: "예약",
    label: "반복 예약의 최소 간격",
    purpose: "'N분마다' 예약을 만들 때 이보다 짧은 간격은 받지 않습니다. 너무 잦은 실행으로 비용이 쌓이는 것을 막습니다. 이미 만든 예약에는 소급하지 않습니다.",
    kind: "number",
    default: 5,
    unit: "분",
    min: 1,
    max: 1440,
    integer: true,
    source: "packages/agent-kit/extensions/schedule/plan.ts",
  },
  {
    id: "schedule.tickSeconds",
    group: "예약",
    label: "예약 확인 간격",
    purpose:
      "스케줄러가 때가 된 예약이 있는지 이 간격마다 확인합니다. 예약이 정해진 시각보다 최대 이만큼 늦게 시작할 수 있습니다. " +
      "스케줄러가 시작할 때 읽으므로, 바꾼 뒤 앱을 다시 켜야 반영됩니다. 개발용 환경 변수 PI_DESKTOP_AGENT_SCHEDULER_TICK_MS가 있으면 그 값이 먼저입니다.",
    kind: "number",
    default: 30,
    unit: "초",
    min: 5,
    max: 600,
    integer: true,
    source: "packages/agent-kit/extensions/schedule/index.ts",
  },

  // ── 웹 ──────────────────────────────────────────────────────
  {
    id: "web.maxKb",
    group: "웹",
    label: "웹 페이지 받아 올 크기 상한",
    purpose: "web_fetch 도구가 응답을 이 크기까지만 받고 나머지는 버립니다. 아주 큰 파일을 받다 메모리를 많이 쓰는 것을 막습니다.",
    kind: "number",
    default: 2048,
    unit: "KB",
    min: 64,
    max: 51_200,
    integer: true,
    source: "packages/agent-kit/extensions/web/index.ts",
  },
  {
    id: "web.timeoutSeconds",
    group: "웹",
    label: "웹 페이지 기다리는 시간",
    purpose: "web_fetch 도구가 응답을 이 시간까지 기다립니다. 넘으면 실패로 돌려줍니다.",
    kind: "number",
    default: 20,
    unit: "초",
    min: 3,
    max: 300,
    integer: true,
    source: "packages/agent-kit/extensions/web/index.ts",
  },
  {
    id: "web.defaultMaxChars",
    group: "웹",
    label: "웹 페이지 기본 글자 수",
    purpose:
      "web_fetch 도구가 모델에게 돌려주는 본문 길이의 기본값입니다. 모델이 maxChars를 따로 주면 그 값을 씁니다. " +
      "늘리면 긴 문서를 한 번에 읽지만 문맥을 많이 씁니다. 바꾼 값은 새 대화부터 도구 설명에도 보입니다.",
    kind: "number",
    default: 20_000,
    unit: "글자",
    min: 1000,
    max: 500_000,
    integer: true,
    source: "packages/agent-kit/extensions/web/index.ts",
  },

  // ── 반복 막기 ───────────────────────────────────────────────
  {
    id: "loopGuard.spinLimit",
    group: "반복 막기",
    label: "제자리 돌기로 멈출 횟수",
    purpose:
      "한 번의 실행 안에서 같은 조회를 되풀이하거나 같은 문단을 다시 쓰는 '제자리 돌기' 신호가 이만큼 쌓이면 실행을 멈추고 알립니다. " +
      "작은 모델이 같은 일을 끝없이 반복하는 것을 막습니다. 낮추면 일찍 멈추고, 높이면 더 기다립니다.",
    kind: "number",
    default: 3,
    unit: "번",
    min: 1,
    max: 20,
    integer: true,
    source: "packages/agent-kit/extensions/loop-guard/guard.ts",
  },
  {
    id: "loopGuard.minParagraph",
    group: "반복 막기",
    label: "반복으로 셀 최소 문단 길이",
    purpose: "이보다 짧은 문단은 되풀이돼도 반복으로 세지 않습니다. '확인했습니다.' 같은 짧은 말은 자연스럽게 반복되기 때문입니다.",
    kind: "number",
    default: 30,
    unit: "글자",
    min: 5,
    max: 1000,
    integer: true,
    source: "packages/agent-kit/extensions/loop-guard/guard.ts",
  },

  // ── 관리자 권한 ─────────────────────────────────────────────
  {
    id: "elevation.timeoutMinutes",
    group: "관리자 권한",
    label: "관리자 권한 실행 시간 제한",
    purpose: "shell_exec_elevated 도구로 실행한 명령을 이 시간이 지나면 멈춥니다. OS 인증 창에 비밀번호를 넣는 시간도 포함됩니다.",
    kind: "number",
    default: 5,
    unit: "분",
    min: 1,
    max: 120,
    integer: true,
    source: "packages/agent-kit/extensions/elevation/run.ts",
  },
  {
    id: "elevation.maxOutputKb",
    group: "관리자 권한",
    label: "관리자 권한 실행 출력 길이",
    purpose: "관리자 권한으로 실행한 명령의 출력을 이 크기까지만 모델에게 돌려줍니다.",
    kind: "number",
    default: 100,
    unit: "KB",
    min: 4,
    max: 4096,
    integer: true,
    source: "packages/agent-kit/extensions/elevation/run.ts",
  },

  // ── 로컬 모델 ───────────────────────────────────────────────
  {
    id: "localModel.probeTimeoutMs",
    group: "로컬 모델",
    label: "Ollama 확인 기다리는 시간",
    purpose:
      "로컬 모델(Ollama)을 쓸 때 요청 전에 서버에 실제 창 크기와 사고 지원 여부를 묻는데, 이 시간까지만 기다립니다. " +
      "느린 PC에서 확인이 자꾸 빠지면 늘리세요. 확인이 실패해도 대화는 계속됩니다.",
    kind: "number",
    default: 1500,
    unit: "ms",
    min: 200,
    max: 30_000,
    integer: true,
    source: "packages/agent-kit/extensions/local-model/probe.ts",
  },

  // ── 에이전트 네트워크 ───────────────────────────────────────
  {
    id: "peers.sectionIntro",
    group: "에이전트 네트워크",
    label: "피어 안내 (시스템 프롬프트)",
    purpose:
      "연결된 피어가 있을 때 시스템 프롬프트의 피어 칸 맨 앞에 붙는 안내입니다. 언제 다른 에이전트에게 물어볼지, 무엇을 보내면 안 되는지 알려 줍니다. " +
      "그 뒤에 피어 목록이 이어집니다.",
    kind: "text",
    default:
      "다른 사람의 에이전트(피어)와 연결돼 있다. 요청이 내 전문 밖이고 맞는 피어가 있으면 ask_peer로 물어볼 수 있다.\n" +
      "물어보기 전에 어느 피어에게 무엇을 보낼지 사용자에게 알려라. 사용자의 개인정보·자격증명·파일 내용은 질문에 넣지 마라.",
    source: "packages/agent-kit/extensions/peers/index.ts",
  },
  {
    id: "peers.cardInstruction",
    group: "에이전트 네트워크",
    label: "에이전트 카드 초안 지시",
    purpose:
      "네트워크 화면의 '초안 만들기'에서 지식베이스 제목과 대화 주제를 보고 공개용 에이전트 카드(소개·잘하는 것)를 쓰게 하는 지시입니다. " +
      "맨 끝의 JSON 형식은 앱이 그대로 읽으므로 바꾸면 초안을 만들지 못합니다.",
    kind: "text",
    default: `입력은 이 에이전트의 지식베이스 항목 제목과 대화 주제 목록이다. 이것을 보고 다른 사람에게 공개할 "에이전트 카드"의 소개와 잘하는 것을 한국어로 써라.
- description: 이 에이전트가 무엇을 잘 아는지 한 문장 (60자 이내)
- skills: 3~6개. name은 20자 이내, description은 60자 이내
- 공개되는 글이다. 사람 이름, 회사·고객·프로젝트의 내부 이름, 주소·경로·계정·비밀번호·토큰은 쓰지 마라. 기술·분야 수준으로 일반화하라
- 재료에 근거가 없는 능력은 지어내지 마라. 재료가 적으면 적게 써라
- 아래 JSON만 출력하라. 설명·코드 펜스 금지
{"description":"...","skills":[{"name":"...","description":"..."}]}`,
    source: "packages/agent-kit/extensions/peers/card-draft.ts",
  },
  {
    id: "peers.cardMaterialChars",
    group: "에이전트 네트워크",
    label: "카드 초안 재료 길이",
    purpose: "카드 초안을 만들 때 모델에 주는 재료(지식베이스 제목·대화 주제)를 이 글자 수까지만 줍니다.",
    kind: "number",
    default: 6000,
    unit: "글자",
    min: 1000,
    max: 100_000,
    integer: true,
    source: "packages/agent-kit/extensions/peers/card-draft.ts",
  },
  {
    id: "peers.maxTasks",
    group: "에이전트 네트워크",
    label: "동시에 돌릴 받은 작업 수",
    purpose: "다른 에이전트가 맡기고 내가 승인한 작업을 이만큼까지 동시에 돌립니다. 나머지는 차례를 기다립니다.",
    kind: "number",
    default: 2,
    unit: "개",
    min: 1,
    max: 8,
    integer: true,
    source: "packages/agent-kit/extensions/peers/index.ts",
  },
  {
    id: "peers.maxHops",
    group: "에이전트 네트워크",
    label: "피어를 거쳐 부르는 깊이",
    purpose: "피어가 다시 다른 피어를 부를 수 있는 깊이입니다. A→B→A처럼 서로 부르며 끝나지 않는 일을 막습니다.",
    kind: "number",
    default: 2,
    unit: "단계",
    locked: "상대 에이전트도 같은 값으로 순환을 막습니다. 한쪽만 늘리면 에이전트끼리 서로 부르며 비용이 끝없이 쌓일 수 있습니다.",
    source: "packages/agent-kit/extensions/peers/protocol.ts",
  },
  {
    id: "peers.maxBodyKb",
    group: "에이전트 네트워크",
    label: "받는 요청 크기 상한",
    purpose: "피어 수신 서버가 받는 요청 하나의 크기 상한입니다. 넘으면 읽지 않고 끊습니다.",
    kind: "number",
    default: 64,
    unit: "KB",
    locked: "네트워크로 들어오는 요청을 막는 보안 한도입니다. 늘리면 큰 요청으로 앱을 느리게 하거나 멈추게 할 수 있습니다.",
    source: "packages/agent-kit/extensions/peers/server.ts",
  },
  {
    id: "peers.maxPendingPairings",
    group: "에이전트 네트워크",
    label: "기다리는 페어링 요청 수",
    purpose: "아직 승인하지 않은 페어링 요청을 이만큼까지만 받아 둡니다. 넘으면 새 요청을 거절합니다.",
    kind: "number",
    default: 20,
    unit: "개",
    locked: "모르는 곳에서 페어링 요청을 쏟아붓는 것을 막는 보안 한도입니다.",
    source: "packages/agent-kit/extensions/peers/server.ts",
  },
];

/** 정의에 적힌 기본값 (테스트·순수 함수의 기본 인자용) */
export function agentDefault<T extends number | string>(id: string): T {
  const def = AGENT_TUNABLES.find((d) => d.id === id);
  if (!def) throw new Error(`정의되지 않은 설정 항목입니다: ${id}`);
  return def.default as T;
}

# Agent Web · Orca Parallel Desk

모바일과 PC 원격 브라우저에서 여러 코딩 에이전트(**Antigravity(Agy)**, **Codex**, **OpenCode**, **Freebuff**, **Gemini**, **Claude**)를 하나의 화면에서 실행·모니터링·제어할 수 있는 웹 기반 에이전트 워크스페이스(ADE)입니다.

---

## 주요 기능

- **Orca Parallel Desk**
  - 프로젝트 및 Git 워크트리 단위로 에이전트를 **단일 실행**하거나 **병렬(코디네이터 + 워커)** 팀으로 실행할 수 있습니다.
  - 실행 중인 모든 에이전트의 상태(`작업 중`, `응답 대기`, `완료`), 역할(`코디네이터` / `워커`), 대화 기록(`AgyChatThread` 통합 UI) 및 터미널 화면을 실시간으로 확인합니다.
  - 작업 중 **중단(Ctrl+C)**, **다른 에이전트에 인수인계**, **셸 터미널 열기**, **워크트리 생성/삭제**를 지원합니다.
- **모델 · Effort · 사용량 관리**
  - 세션 하단 툴바에서 에이전트별 모델 및 추론 강도(`effort`)를 선택하고, 사용량 한도(Quota) 패널을 바로 열어 확인할 수 있습니다.
- **파일 · 이미지 첨부**
  - 입력창에서 파일 업로드, 드래그 앤 드롭, 클립보드 붙여넣기(최대 20MB)를 지원합니다.
  - Orca 브리지 첨부 파일은 `~/.orca/agent-web-attachments` 공용 경로에 저장되어 다른 에이전트 세션에서도 바로 읽을 수 있습니다.
- **모바일 & PC 원격 브라우저 호환**
  - 모바일 드로어 레이아웃과 PC 와이드 다단 레이아웃(`@media (min-width: 981px)`)을 모두 지원합니다.

---

## 사전 요구사항

- **Node.js** 18 이상 및 **npm**
- **Orca CLI** (`orca`) — Parallel Desk 워크트리/에이전트/오케스트레이션 연동 시 필요
- 사용할 에이전트 CLI (선택): `agy`, `codex`, `opencode`, `freebuff`, `gemini`, `claude` 등

---

## 설치 및 실행

> **설치 팁**: 복잡한 환경 구성(의존성 설치, 브리지·터널 연결 등)은 사용 중인 코딩 에이전트에게 이 README를 참고해 설치해 달라고 맡기면 편합니다.
> 단, **원격 접속을 열기 전에 반드시 접속 비밀번호/토큰(`.agent-web-token`, `.agent-web-auth.json`)을 먼저 본인 것으로 설정**하세요. 해당 인증 파일은 `.gitignore`에 포함되어 있어 저장소에 올라가지 않습니다.

```bash
# 1. 저장소 클론 및 의존성 설치
git clone https://github.com/yxshadxw/agent-web.git
cd agent-web
npm install

# 2. 개발 서버 실행 (Vite + Agy/Orca 브리지 자동 기동)
npm run dev
```

프로덕션 빌드 및 프리뷰:

```bash
npm run build
npm run preview
```

### 주요 npm 스크립트

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | `scripts/serve.mjs dev` 실행 (Vite 개발 서버 `5173` + 브리지 자동 기동) |
| `npm run build` | TypeScript 타입 검사(`tsc --noEmit`) 및 Vite 프로덕션 빌드(`dist/`) |
| `npm run preview` | `scripts/serve.mjs preview` 실행 (빌드된 정적 파일 서빙) |
| `npm run bridge` | `scripts/agy-bridge.mjs` 단독 실행 |

---

## 포트 및 환경 변수

`scripts/serve.mjs` 실행 시 아래 기본 포트를 사용하며, 환경 변수로 변경할 수 있습니다.

| 변수명 | 기본값 | 용도 |
| --- | --- | --- |
| `AGENT_WEB_API_PORT` | `4097` | OpenCode API 서버 포트 |
| `AGY_BRIDGE_PORT` | `4098` | Antigravity(`agy-bridge.mjs`) 브리지 포트 |
| `ORCA_BRIDGE_PORT` | `4099` | Orca(`orca-bridge.mjs`) 브리지 포트 |
| `AGENT_WEB_WORKDIR` | 현재 작업 디렉터리 | 브리지 기본 작업 경로 |

> **인증 안내**: 외부(원격 브라우저 등)에서 접속할 때는 `scripts/auth.mjs`가 생성하는 인증 토큰(`.agent-web-token`, `.agent-web-auth.json`)을 통해 로그인합니다. 인증 파일은 저장소에 커밋하지 마세요.

---

## 원격 접속 (Cloudflare Tunnel 예시)

외부 브라우저나 모바일에서 접속하려면 `cloudflared` 터널을 `http://127.0.0.1:5173`(또는 preview 포트)에 연결해 사용할 수 있습니다.

```bash
cloudflared tunnel run --token <YOUR_TUNNEL_TOKEN>
```

---

## 디렉터리 구조

```text
├── public/                 # 에이전트 로고 SVG/PNG 및 폰트
├── scripts/
│   ├── serve.mjs           # Vite 및 브리지 통합 실행기
│   ├── orca-bridge.mjs     # Orca 워크트리·에이전트·트랜스크립트·첨부 브리지
│   ├── agy-bridge.mjs      # Antigravity 모델/세션/사용량 브리지
│   ├── codex-chat.mjs      # Codex 채팅 브리지
│   └── auth.mjs            # 원격 접속 인증 처리
├── src/
│   ├── components/         # ParallelDesk, CodexPanel, Composer, Quota, Sheets 등 UI 컴포넌트
│   ├── hooks/              # useAgent, useQuota
│   ├── lib/                # api, engine, orca, preferences
│   ├── desk.css            # Parallel Desk 스타일
│   └── styles.css          # 공통 ADE 테마 및 스타일
└── vite.config.ts          # 개발/프리뷰 프록시 설정
```

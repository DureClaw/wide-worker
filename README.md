# Wide Worker

**Windows brain bridge for [webclaw](https://github.com/DureClaw/webclaw).**
webclaw(브라우저 손)가 마커 없는 지시를 위임하는 두뇌(`/brain/exec`)를 윈도우 PC에서 제공한다 — **Claude 구독(CLI)** 이 있으면 API 키 없이 바로, 없으면 **api.baryon.ai** 로 폴백.

```
webclaw(Chrome) ──HTTP──▶ Wide Worker :4111 ──▶ ① Claude Code CLI (구독)
                                              └▶ ② api.baryon.ai (BARYON_API_KEY)
```

## 설치 (원클릭)

```powershell
irm https://raw.githubusercontent.com/DureClaw/wide-worker/main/install.ps1 | iex
```

## 실행

```powershell
cd $env:USERPROFILE\dev\WideWorker
.\start.cmd
```

## webclaw 연동

webclaw 확장 팝업에서:
- **Brain URL**: `http://localhost:4111` (webclaw가 다른 PC면 `http://<이 PC IP>:4111`, 방화벽에서 4111 허용)
- **Brain token**: `config.local.json`의 `BRAIN_TOKEN`과 동일하게 (비우면 인증 없음)

## API

| 엔드포인트 | 설명 |
|---|---|
| `GET /health` | 백엔드 가용성 — `{ok, backends: {"claude-cli": "버전"\|false, "baryon-api": url\|false}}` |
| `POST /brain/exec` `{prompt}` | 실행 — `{output, backend}` (claude-cli → baryon-api 순 폴백) |

## 설정 (`config.local.json` 또는 환경변수)

| 키 | 기본 | 설명 |
|---|---|---|
| `PORT` | 4111 | 수신 포트 |
| `BRAIN_TOKEN` | (없음) | Bearer 인증 토큰 |
| `CLAUDE_BIN` | claude | Claude Code CLI 경로 |
| `BARYON_API_URL` | https://api.baryon.ai | Anthropic 호환 엔드포인트 |
| `BARYON_API_KEY` | (없음) | 설정 시 폴백 활성화 |
| `BARYON_MODEL` | claude-sonnet-5 | 폴백 모델 |

- 의존성 0 (Node 18+ 표준 라이브러리만)
- DureClaw 플릿 패밀리: [dureclaw](https://github.com/DureClaw/dureclaw) · [webclaw](https://github.com/DureClaw/webclaw) · wide-worker

## License

MIT

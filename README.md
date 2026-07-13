# TikTok 댓글 도우미

슬랙 `#틱톡_서포터즈` 채널의 오늘자 메시지에서 내 이름(예: Anthony)에 배정된 TikTok 댓글을 찾아, 각 링크의 댓글창에 자동으로 입력해주는 도구. **게시 버튼은 사람이 직접 누른다** (되돌리기 어려운 공개 행동이라 최종 클릭은 사람이 확인 후 진행).

## 구성

이 저장소에는 3가지 버전이 들어 있다.

### 1) Claude Code 스킬 (권장, 가장 정확)
- 위치: `.claude/skills/tiktok-comment-post/SKILL.md`
- `node`로 `parser.js`를 실행해 파싱하고, Claude-in-Chrome으로 실제 로그인된 브라우저를 조작한다.
- 사용법: 이 폴더에서 Claude Code 실행 후 `/tiktok-comment-post` (인자 없이 실행하면 슬랙 프로필에서 이름을, `#틱톡_서포터즈` 채널에서 오늘자 메시지를 자동으로 가져온다.)

### 2) claude.ai 스킬
- 위치: `claude-ai-skill/tiktok-comment-post/` (업로드용 압축본: `claude-ai-skill/tiktok-comment-post.zip`)
- `node`/로컬 파일 없이, 파싱을 Claude가 직접 추론으로 수행한다. claude.ai의 Skills 업로드 기능으로 등록해 사용.

### 3) Chrome 확장 프로그램 (반자동/자동 입력)
- 파일: `manifest.json`, `background.js`, `content.js`, `panel.html`, `panel.js`, `parser.js`
- 설치: `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → 이 폴더 선택
- 확장 아이콘 클릭 → 슬랙 메시지 붙여넣기 → 링크마다 탭을 열고 댓글 입력 시도.

## 동작 방식 / 안전장치

- **내 이름이 없는 링크는 자동 스킵**한다.
- **이미 동일한 댓글이 달려 있으면 중복 게시하지 않고** 해당 탭을 닫는다.
- TikTok 봇 검증("Please wait...") 화면을 만나면 우회하지 않고, 10/15/20초 간격으로 **최대 3번까지만** 재시도한 뒤 안 풀리면 "차단됨"으로 표시하고 넘어간다.
- 게시 버튼은 절대 자동으로 누르지 않는다. 입력 완료된 탭에서 사람이 확인 후 직접 게시한다.

## 파싱 규칙 (parser.js)

슬랙 메시지를 TikTok 링크별 블록으로 나누고, 각 블록에서 `숫자. 이름` 다음 줄을 그 사람의 댓글로 매칭한다. 슬랙 API 원문의 `*4. Anthony*`식 마크다운 굵게 표기와, 직접 복붙한 `4. Anthony` 평문 둘 다 처리한다. 이름은 앞뒤 공백 제거 후 정확히 일치하는 경우만 인정(부분 일치 금지).

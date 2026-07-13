---
name: tiktok-comment-post
description: 슬랙 #틱톡_서포터즈 채널의 오늘자 메시지에서 내(로그인된 슬랙 프로필) 이름의 TikTok 댓글을 자동으로 찾아, 링크마다 브라우저 탭을 열고 댓글창에 텍스트까지 입력해둔다. 게시 버튼은 사람이 직접 누른다. 사용법 - /tiktok-comment-post (인자 없이 그냥 실행하면 됨. 이름이나 슬랙 텍스트를 직접 줘도 그걸 우선 사용한다)
---

## 배경

`/Users/kimkyuhyun/workspace/댓글자동화/parser.js`에 슬랙 메시지를 링크별로 나누고 이름으로 댓글을 매칭하는 검증된 파싱 로직이 있다 (슬랙 API 원문의 `*4. Anthony*`식 마크다운 굵게 표기도 처리하도록 되어 있다).

실전 테스트로 확인된 사실:
- Chrome 확장의 content script(`execCommand`/합성 이벤트)로 텍스트를 넣으면 화면엔 보여도 TikTok의 Draft.js 내부 상태가 갱신되지 않아 게시 버튼이 계속 비활성 상태로 남는다. Claude-in-Chrome의 `computer` 도구(진짜 키 입력 시뮬레이션)로 타이핑해야 게시 버튼이 정상적으로 활성화된다.
- 타이핑 직후 `javascript_tool`로 입력창 상태를 조회하면 포커스가 빠지면서 방금 입력한 텍스트가 사라지는 경우가 있었다. **타이핑 후 확인은 스크린샷으로만 한다.**
- 같은 탭/링크를 짧은 시간에 여러 번 새로고침하거나 반복 조작하면 TikTok이 "Please wait..." 봇 검증 화면을 띄우는 것이 실제로 재현됐다. **링크당 한 번만 시도한다.**
- 좌표는 `getBoundingClientRect()` 값보다 실제 스크린샷을 보고 판단하는 게 더 정확했다 (스크린샷 픽셀 좌표와 CSS 좌표계가 어긋나는 경우가 있었음).

**게시 버튼 클릭은 이 스킬이 하지 않는다.** 실제 게시는 되돌리기 어려운 공개 행동이라 사람이 각 탭에서 직접 확인하고 눌러야 한다. 이 스킬의 역할은 딱 여기까지: 링크마다 탭을 열고, 댓글 패널을 열고, 텍스트를 입력해두는 것.

## 반드시 지킬 것

- **게시/제출 버튼은 절대 자동으로 클릭하지 않는다.** 텍스트 입력까지만 하고 탭을 그대로 열어둔 채 끝낸다.
- TikTok이 "Please wait..." 같은 봇 검증/캡차 화면을 보여주면 우회하지 않는다. 감지되면 그 탭에 "차단됨 - 직접 확인 필요"라고만 남기고, 새로고침/재시도를 반복하지 않고 다음 항목으로 넘어간다.
- 이미 동일한 텍스트의 댓글이 그 영상에 달려 있으면 입력하지 않고 "이미 게시됨"으로 표시한다 (중복 방지).
- 타이핑 직후에는 `javascript_tool`로 상태를 조회하지 않는다 (포커스 손실로 입력 내용이 사라질 수 있음이 확인됨). 스크린샷으로만 확인한다.

## 절차

1. **이름 결정** — 사용자가 이름을 명시적으로 줬으면 그걸 쓴다. 안 줬으면 `mcp__claude_ai_Slack__slack_read_user_profile`을 인자 없이 호출해 현재 로그인된 사용자의 Display Name/Real Name을 가져오고, `(` 앞부분만 잘라서 이름으로 쓴다 (예: "Anthony(김규현)" → "Anthony").

2. **슬랙 메시지 확보** — 사용자가 슬랙 메시지 원문을 직접 줬으면 그걸 쓴다. 안 줬으면:
   - `mcp__claude_ai_Slack__slack_search_channels`로 "틱톡_서포터즈" 채널을 찾는다 (채널 ID를 이미 알고 있으면 `C0AE6HUC3CY`를 바로 써도 된다).
   - `mcp__claude_ai_Slack__slack_read_channel`로 해당 채널 메시지를 읽는다 (limit 20~30 정도).
   - 오늘 날짜(Asia/Seoul 기준, 메시지의 타임스탬프로 판단)의 메시지만 추린다. 각 메시지 본문이 이미 "링크 + 번호 목록 + Made by" 형태의 블록 하나에 해당한다.
   - 오늘 날짜 메시지가 여러 개면 그 본문 텍스트를 그대로 이어붙여 하나의 텍스트로 만든다.

3. **파싱** — 슬랙 메시지 원문(2단계 결과)을 스크래치패드에 임시 파일로 저장하고, node로 `parser.js`를 그대로 재사용해 파싱한다 (정규식을 새로 짜지 말 것):
   ```
   node -e "
     global.self = global;
     require('/Users/kimkyuhyun/workspace/댓글자동화/parser.js');
     const fs = require('fs');
     const text = fs.readFileSync(process.argv[1], 'utf8');
     const name = process.argv[2];
     console.log(JSON.stringify(global.TikTokCommentParser.matchCommentsForName(text, name), null, 2));
   " <임시파일 경로> "<이름>"
   ```
   - `status === 'ready'` 인 항목만 큐로 삼는다. 그 외 상태(이름 못 찾음/중복 매칭/URL 오류 등)는 사용자에게 알리고 제외한다.
   - 큐에 있는 (링크, 댓글) 목록을 표로 보여준다 (정보 제공용 — 게시를 하는 게 아니므로 승인을 기다릴 필요는 없다. 바로 진행한다).

4. **브라우저 도구 준비**
   - ToolSearch로 `mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp,mcp__claude-in-chrome__list_connected_browsers,mcp__claude-in-chrome__select_browser,mcp__claude-in-chrome__switch_browser` 를 한 번에 로드한다.
   - **어떤 Chrome(창/프로필)에서 작업할지 먼저 정한다** — 개인 구글 계정 창 등 다른 계정 브라우저가 같이 켜져 있어도 TikTok이 로그인된 올바른 창을 골라 쓰기 위함이다.
     - `list_connected_browsers`로 연결된 브라우저 목록을 가져온다.
     - 연결된 브라우저가 **1개뿐이면** 그걸 그대로 쓴다 (별도로 묻지 않는다).
     - **2개 이상이면**, `AskUserQuestion`으로 연결된 브라우저를 하나도 빠짐없이 각각 옵션으로 제시하고(라벨은 display name, 괄호 안에 deviceId), 마지막 옵션으로 정확히 다음 문구를 넣는다: "Open a confirmation screen in every connected Chrome extension and let me select the right one there." 사용자가 특정 브라우저를 고르면 그 deviceId로 `select_browser`를 호출하고, 마지막 옵션을 고르면 `switch_browser`를 호출한다.
   - `tabs_context_mcp`로 (선택된 브라우저 안에서) 탭 그룹을 확인/생성한다.

5. **큐에 있는 항목마다 새 탭을 하나씩 연다** (탭을 재사용하지 않고 항목 수만큼 새로 만든다 — 예: 3개 댓글이면 탭 3개가 끝까지 열려 있어야 함):
   1. `tabs_create_mcp`로 새 탭을 만들고 `navigate`로 해당 링크로 이동.
   2. `computer`의 `screenshot`으로 로드 상태를 확인한다. 화면에 "Please wait" 같은 문구만 있고 실제 영상이 안 보이면 봇 검증 화면이다. 이 경우 곧바로 포기하지 않고, `computer`의 `wait`(10초)로 대기한 뒤 같은 탭에서 `navigate`로 같은 링크에 다시 이동해 스크린샷으로 재확인한다. **최대 3번까지만** 이렇게 재시도한다 (대기 시간을 10초→15초→20초로 조금씩 늘린다). 3번째까지도 봇 검증 화면이면 그때는 "차단됨"으로 기록하고 그대로 둔 채 다음 항목으로 넘어간다 (그 이상 반복하지 않는다 — 과도한 반복 자체가 검증을 더 유발할 수 있음이 테스트로 확인됨).
   3. 오른쪽에 댓글 목록/입력창이 안 보이면, 영상 오른쪽의 댓글 아이콘(말풍선 모양)을 스크린샷으로 위치를 확인해 `computer`의 `left_click`으로 클릭해서 댓글 패널을 연다.
   4. `get_page_text` 또는 `javascript_tool`로 댓글 목록에 게시하려는 댓글과 완전히 동일한 텍스트가 이미 있는지 확인한다. 있으면 "이미 게시됨"으로 기록하고, `tabs_close_mcp`로 이 탭을 닫은 뒤 다음 항목으로 넘어간다 (더 볼 필요가 없으니 열어둘 필요 없음).
   5. 스크린샷을 보고 댓글 입력창의 위치를 파악해 `computer`의 `left_click`으로 클릭한다.
   6. `computer`의 `type` 액션으로 댓글 텍스트를 실제로 타이핑한다.
   7. **스크린샷으로만** 텍스트가 입력창에 정상적으로 남아있는지 확인한다 (이 시점에 `javascript_tool`을 쓰지 않는다). 남아있으면 "입력 완료", 사라졌거나 안 보이면 "입력 실패 - 직접 확인 필요"로 기록한다.
   8. **여기서 멈춘다. 게시 버튼은 누르지 않는다.** 이 탭은 열어둔 채 다음 항목으로 넘어간다.

6. **최종 보고**
   - 사용한 이름, 가져온 슬랙 메시지 기준(오늘 날짜 등), 각 항목의 상태(입력 완료 - 탭 열려있음 / 이미 게시됨 - 탭 닫음 / 차단됨 - 탭 열려있음 / 실패 - 탭 열려있음)를 표로 정리해서 알려준다.
   - "입력 완료된 탭들에서 직접 확인 후 게시 버튼을 눌러주세요. 이미 게시된 항목은 탭을 닫아뒀습니다."라고 안내하며 끝낸다.

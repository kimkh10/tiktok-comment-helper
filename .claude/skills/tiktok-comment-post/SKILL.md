---
name: tiktok-comment-post
description: 슬랙 서포터즈 메시지를 붙여넣으면 내 이름의 TikTok 댓글을 찾아, 링크마다 브라우저 탭을 열고 댓글창에 텍스트까지 입력해둔다. 게시 버튼은 사람이 직접 누른다. 사용법 - /tiktok-comment-post {이름(생략시 Anthony)} {슬랙 메시지 전체 붙여넣기}
---

## 배경

`/Users/kimkyuhyun/workspace/댓글자동화/parser.js`에 슬랙 메시지를 링크별로 나누고 이름으로 댓글을 매칭하는 검증된 파싱 로직이 있다.

이전에 두 가지를 테스트해서 확인한 사실:
- Chrome 확장의 content script(`execCommand`/합성 이벤트)로 텍스트를 넣으면 화면엔 보여도 TikTok의 Draft.js 내부 상태가 갱신되지 않아 게시 버튼이 계속 비활성 상태로 남는다.
- Claude-in-Chrome의 `computer` 도구(진짜 키 입력 시뮬레이션)로 타이핑하면 게시 버튼이 정상적으로 활성화된다.

**게시 버튼 클릭은 이 스킬이 하지 않는다.** 실제 게시는 되돌리기 어려운 공개 행동이라 사람이 각 탭에서 직접 확인하고 눌러야 한다. 이 스킬의 역할은 딱 여기까지: 링크마다 탭을 열고, 댓글 패널을 열고, 텍스트를 입력해두는 것.

## 반드시 지킬 것

- **게시/제출 버튼은 절대 자동으로 클릭하지 않는다.** 텍스트 입력까지만 하고 탭을 그대로 열어둔 채 끝낸다.
- TikTok이 "Please wait..." 같은 봇 검증/캡차 화면을 보여주면 우회하지 않는다. 감지되면 그 탭에 "차단됨 - 직접 확인 필요"라고만 남기고 다음 항목으로 넘어간다.
- 이미 동일한 텍스트의 댓글이 그 영상에 달려 있으면 입력하지 않고 "이미 게시됨"으로 표시한다 (중복 방지).

## 절차

1. **입력 파싱**
   - 사용자가 준 인자에서 이름(기본값 "Anthony")과 슬랙 메시지 원문을 분리한다.
   - 슬랙 메시지 원문을 스크래치패드에 임시 파일로 저장한다.
   - node로 `parser.js`를 그대로 재사용해 파싱한다 (정규식을 새로 짜지 말 것):
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

2. **브라우저 도구 준비**
   - ToolSearch로 `mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__tabs_create_mcp` 를 한 번에 로드한다.
   - `tabs_context_mcp`로 탭 그룹을 확인/생성한다.

3. **큐에 있는 항목마다 새 탭을 하나씩 연다** (탭을 재사용하지 않고 항목 수만큼 새로 만든다 — 예: 3개 댓글이면 탭 3개가 끝까지 열려 있어야 함):
   1. `tabs_create_mcp`로 새 탭을 만들고 `navigate`로 해당 링크로 이동.
   2. 로드 후 `javascript_tool`로 확인: `document.body.innerText`에 "Please wait"류 문구가 있고 `document.querySelector('video')`가 없으면 봇 검증 화면 → 이 탭은 "차단됨"으로 기록하고 다음 항목으로 (이 탭은 그대로 열어두되 아무 것도 입력하지 않는다).
   3. `javascript_tool`로 `[data-e2e="comment-input"] div[contenteditable="true"]`가 있는지 확인. 없으면 `[data-e2e="comment-icon"]`의 클릭 가능한 조상 요소를 찾아 `.click()`으로 댓글 패널을 연다.
   4. `javascript_tool`로 `[data-e2e="comment-level-1"], [data-e2e="comment-text"]` 등의 텍스트를 모아 게시하려는 댓글과 완전히 동일한 텍스트가 이미 있는지 확인한다. 있으면 "이미 게시됨"으로 기록하고 이 탭은 입력 없이 다음 항목으로 넘어간다.
   5. `javascript_tool`로 댓글 입력창의 `getBoundingClientRect()`를 구해 화면 좌표를 얻는다.
   6. `computer` 도구의 `left_click`으로 그 좌표를 클릭해 포커스를 준 뒤, `computer`의 `type` 액션으로 댓글 텍스트를 실제로 타이핑한다 (실제 키 입력이어야 게시 버튼이 활성화된다 — `javascript_tool`만으로 텍스트를 밀어넣지 않는다).
   7. `javascript_tool`로 `[data-e2e="comment-post"]`가 `disabled === false`인지 확인해서 "입력 완료, 게시 버튼 활성화됨" 또는 "입력은 됐지만 게시 버튼 비활성 - 직접 확인 필요"로 기록한다.
   8. **여기서 멈춘다. 게시 버튼은 누르지 않는다.** 이 탭은 열어둔 채 다음 항목으로 넘어간다.

4. **최종 보고**
   - 열어둔 탭 수와 각 탭의 상태(입력 완료 / 이미 게시됨 / 차단됨 / 입력창을 못 찾음)를 표로 정리해서 알려준다.
   - "N개 탭에 댓글이 입력되어 있습니다. 확인 후 각 탭에서 직접 게시 버튼을 눌러주세요."라고 안내하며 끝낸다.

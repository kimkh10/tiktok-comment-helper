// TikTok 영상 페이지에서 실행되어 댓글을 자동으로 입력/게시하고, 게시 결과를 재확인(검증)한다.
// 이 자동화는 일반적인 확장 프로그램의 DOM 조작(폼 자동 채우기 등)과 동일한 방식이며,
// TikTok의 봇 검증 화면 자체를 우회/회피하려는 로직은 포함하지 않는다 — 감지되면 그대로 보고한다.

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none'
  );
}

function waitFor(conditionFn, timeoutMs, intervalMs = 300) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      let result;
      try {
        result = conditionFn();
      } catch (err) {
        result = null;
      }
      if (result) {
        clearInterval(timer);
        resolve(result);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, intervalMs);
  });
}

function detectInterstitial() {
  const bodyText = (document.body && document.body.innerText) || '';
  const trimmed = bodyText.trim();
  const markers = [
    'Please wait',
    '잠시만 기다려',
    'Verify to continue',
    '보안 확인',
    'unusual traffic',
    'unusual activity',
  ];
  const hasMarker = markers.some((m) => trimmed.includes(m));
  const looksLikeRealPage = !!document.querySelector('video');
  return hasMarker && !looksLikeRealPage && trimmed.length < 500;
}

function findCommentBox() {
  let box = document.querySelector('[data-e2e="comment-input"] div[contenteditable="true"]');
  if (box && isVisible(box)) return box;

  box = document.querySelector('div[data-e2e="comment-input"][contenteditable="true"]');
  if (box && isVisible(box)) return box;

  const candidates = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
  return candidates.find((el) => isVisible(el)) || null;
}

function findCommentTrigger() {
  const icon = document.querySelector('[data-e2e="comment-icon"]');
  if (!icon) return null;
  return icon.closest('button, [role="button"], a') || icon;
}

// TikTok 영상 상세 페이지는 댓글 아이콘을 한 번 클릭해서 패널을 열어야만
// 댓글 입력창(comment-input)과 게시 버튼(comment-post)이 DOM에 렌더링된다.
async function ensureCommentPanelOpen() {
  if (findCommentBox()) return true;

  const trigger = await waitFor(() => findCommentTrigger(), 8000, 300);
  if (!trigger) return false;

  trigger.click();
  const box = await waitFor(() => findCommentBox(), 6000, 300);
  return !!box;
}

function findPostButton(box) {
  let btn = document.querySelector('[data-e2e="comment-post"]');
  if (btn) return btn;

  const container = (box && box.closest('form')) || (box && box.parentElement) || document;
  const buttons = Array.from(container.querySelectorAll('button, div[role="button"]'));
  return buttons.find((b) => /post|게시/i.test(b.textContent || '')) || null;
}

function isButtonEnabled(btn) {
  if (!btn) return false;
  if (btn.disabled) return false;
  if (btn.getAttribute('aria-disabled') === 'true') return false;
  if (btn.classList && [...btn.classList].some((c) => /disabled/i.test(c))) return false;
  return true;
}

async function insertComment(box, text) {
  box.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  const inserted = document.execCommand('insertText', false, text);
  if (!inserted) {
    box.textContent = text;
  }
  box.dispatchEvent(
    new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
  );
  box.dispatchEvent(new Event('change', { bubbles: true }));
}

function getCommentTextNodes() {
  return Array.from(
    document.querySelectorAll('[data-e2e="comment-level-1"], [data-e2e="comment-text"], span, p')
  );
}

function hasMatchingComment(text) {
  const normalized = text.trim();
  return getCommentTextNodes().some((node) => (node.textContent || '').trim() === normalized);
}

async function verifyPosted(text) {
  const found = await waitFor(() => (hasMatchingComment(text) ? true : null), 8000, 400);
  return !!found;
}

async function handlePostComment(comment) {
  await waitFor(() => document.readyState === 'complete', 5000, 200);

  if (detectInterstitial()) {
    return { status: 'blocked', detail: '봇 검증(Please wait/캡차) 화면 감지됨 - 직접 확인 후 "다시 시도" 또는 수동으로 붙여넣어주세요' };
  }

  // 댓글 패널을 먼저 열어야 입력창/게시버튼/기존 댓글 목록이 DOM에 나타난다.
  const panelOpened = await ensureCommentPanelOpen();
  if (!panelOpened) {
    return { status: 'failed', detail: '댓글 패널을 열지 못함 - 댓글 아이콘을 찾지 못했거나 입력창이 나타나지 않음' };
  }

  // 이미 동일한 텍스트의 댓글이 달려 있으면(예: 이전 실행에서 이미 게시함) 중복 게시하지 않고 건너뛴다.
  const alreadyThere = hasMatchingComment(comment);
  if (alreadyThere) {
    return { status: 'already_posted', detail: '동일한 댓글이 이미 달려 있어 중복 게시하지 않고 건너뛰었습니다' };
  }

  const box = findCommentBox();
  if (!box) {
    return { status: 'failed', detail: '댓글 입력창을 찾지 못함 - 클립보드에 복사된 내용을 직접 붙여넣어주세요' };
  }

  await insertComment(box, comment);

  const button = await waitFor(() => {
    const b = findPostButton(box);
    return isButtonEnabled(b) ? b : null;
  }, 5000, 300);

  if (!button) {
    return { status: 'failed', detail: '게시 버튼을 찾지 못했거나 계속 비활성 상태 - 직접 게시 버튼을 눌러주세요' };
  }

  button.click();

  const verified = await verifyPosted(comment);
  if (verified) {
    return { status: 'success', detail: '게시 및 댓글 목록 재확인 완료' };
  }
  return { status: 'unverified', detail: '게시 버튼은 눌렀지만 댓글 목록에서 확인되지 않음 - 직접 확인해주세요' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'postComment') return undefined;
  handlePostComment(message.comment)
    .then(sendResponse)
    .catch((err) => sendResponse({ status: 'failed', detail: String((err && err.message) || err) }));
  return true; // 비동기 응답
});

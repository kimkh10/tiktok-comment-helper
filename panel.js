const textEl = document.getElementById('slackText');
const nameEl = document.getElementById('name');
const previewEl = document.getElementById('preview');
const startBtn = document.getElementById('startBtn');
const fatalErrorEl = document.getElementById('fatalError');

const stepCardEl = document.getElementById('stepCard');
const stepProgressEl = document.getElementById('stepProgress');
const stepLinkEl = document.getElementById('stepLink');
const stepCommentEl = document.getElementById('stepComment');
const clipboardNoteEl = document.getElementById('clipboardNote');
const autoStatusEl = document.getElementById('autoStatus');
const recopyBtn = document.getElementById('recopyBtn');
const retryBtn = document.getElementById('retryBtn');
const prevBtn = document.getElementById('prevBtn');
const skipBtn = document.getElementById('skipBtn');
const nextBtn = document.getElementById('nextBtn');
const logEl = document.getElementById('log');

const AUTO_STATUS_LABEL = {
  success: '✅ 자동 게시 및 확인 완료',
  already_posted: '↩️ 이미 동일한 댓글이 있어 중복 게시하지 않고 건너뜀',
  unverified: '⚠️ 게시 시도했지만 댓글 목록에서 확인 안 됨',
  blocked: '⛔ 차단됨 (봇 검증 화면) - 직접 확인 후 "다시 시도"',
  failed: '❌ 자동 입력 실패 - 클립보드 내용을 직접 붙여넣어주세요',
};

const STATUS_LABEL = {
  ready: '준비됨',
  not_found: '이름 못 찾음',
  multiple_matches: '이름 중복 매칭 (확인 필요)',
  empty_comment: '댓글 내용 없음',
  invalid_url: 'URL 형식 오류',
};

let debounceTimer = null;
let lastResults = [];

let queue = [];
let index = 0;
let workingTabId = null;
let log = [];
let lastAutoResponse = null;

function showFatalError(message) {
  fatalErrorEl.textContent = '오류 발생: ' + message;
  fatalErrorEl.style.display = 'block';
  console.error(message);
}

window.addEventListener('error', (event) => {
  showFatalError(event.message || String(event.error));
});
window.addEventListener('unhandledrejection', (event) => {
  showFatalError(String((event.reason && event.reason.message) || event.reason));
});

function getParser() {
  if (!window.TikTokCommentParser) {
    throw new Error('parser.js가 로드되지 않았습니다 (TikTokCommentParser 없음)');
  }
  return window.TikTokCommentParser;
}

function shortUrl(url) {
  return url.replace('https://www.tiktok.com/', '');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- 미리보기 ----------

function renderPreview() {
  const text = textEl.value;
  const name = nameEl.value.trim() || 'Anthony';

  if (!text.trim()) {
    previewEl.innerHTML = '<p class="hint">슬랙 메시지를 붙여넣으면 여기에 미리보기가 표시됩니다.</p>';
    startBtn.disabled = true;
    lastResults = [];
    return;
  }

  let results;
  try {
    results = getParser().matchCommentsForName(text, name);
  } catch (err) {
    showFatalError(err.message || String(err));
    return;
  }
  lastResults = results;

  if (results.length === 0) {
    previewEl.innerHTML = '<p class="hint">TikTok 링크를 찾지 못했습니다.</p>';
    startBtn.disabled = true;
    return;
  }

  const rows = results
    .map((r, i) => {
      const statusLabel = STATUS_LABEL[r.status] || r.status;
      const commentPreview = r.comment ? escapeHtml(r.comment) : '<em>-</em>';
      return `<tr class="status-${r.status}">
        <td>${i + 1}</td>
        <td><a href="${escapeHtml(r.url)}" target="_blank">${escapeHtml(shortUrl(r.url))}</a></td>
        <td>${statusLabel}</td>
        <td>${commentPreview}</td>
      </tr>`;
    })
    .join('');

  previewEl.innerHTML = `<table>
    <thead><tr><th>#</th><th>링크</th><th>상태</th><th>매칭된 댓글</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  const readyCount = results.filter((r) => r.status === 'ready').length;
  startBtn.disabled = readyCount === 0;
  startBtn.textContent = readyCount > 0 ? `진행 시작 (${readyCount}건)` : '진행 시작';
}

textEl.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderPreview, 250);
});
nameEl.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderPreview, 250);
});

// ---------- 진행(걸음) 로직 ----------

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    clipboardNoteEl.textContent = '✅ 클립보드에 복사되었습니다. TikTok 탭에서 붙여넣기(Cmd+V) 하세요.';
  } catch (err) {
    clipboardNoteEl.textContent = '⚠️ 클립보드 복사 실패 - 위 텍스트를 직접 선택해서 복사해주세요. (' + err.message + ')';
  }
}

async function openStepTab(url) {
  if (workingTabId !== null) {
    try {
      await chrome.tabs.update(workingTabId, { url, active: true });
      return;
    } catch (err) {
      workingTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  workingTabId = tab.id;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      }
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        if (!done) {
          done = true;
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(true);
        }
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function renderAutoStatus(response) {
  const label = AUTO_STATUS_LABEL[response.status] || response.status;
  autoStatusEl.innerHTML = `<strong>${escapeHtml(label)}</strong><br><span class="detail">${escapeHtml(
    response.detail || ''
  )}</span>`;
}

async function autoPost(comment) {
  autoStatusEl.textContent = '탭 로딩 대기 중...';
  await waitForTabComplete(workingTabId);
  await sleep(2000); // 페이지 렌더링/하이드레이션 대기
  autoStatusEl.textContent = '댓글 자동 입력/게시 시도 중...';
  try {
    const response = await chrome.tabs.sendMessage(workingTabId, {
      action: 'postComment',
      comment,
    });
    renderAutoStatus(response);
    return response;
  } catch (err) {
    const response = { status: 'failed', detail: '콘텐츠 스크립트 응답 없음: ' + String(err) };
    renderAutoStatus(response);
    return response;
  }
}

function renderLog() {
  if (log.length === 0) {
    logEl.innerHTML = '<p class="hint">아직 진행한 항목이 없습니다.</p>';
    return;
  }
  const items = log
    .map((entry) => {
      const label = entry.status === 'skipped' ? '⏭️ 건너뜀' : '✅ 확인함';
      const autoLabel = entry.autoStatus ? ` (자동 결과: ${escapeHtml(entry.autoStatus)})` : '';
      return `<li class="status-${entry.status}"><strong>${label}</strong>${autoLabel} — ${escapeHtml(
        shortUrl(entry.url)
      )}</li>`;
    })
    .join('');
  logEl.innerHTML = `<ul>${items}</ul>`;
}

async function goToStep() {
  if (index >= queue.length) {
    stepCardEl.style.display = 'none';
    startBtn.disabled = false;
    startBtn.textContent = `진행 시작 (${queue.length}건)`;
    clipboardNoteEl.textContent = '';
    alert(`모두 완료했습니다. (총 ${queue.length}건 중 확인함 ${log.filter((l) => l.status === 'confirmed').length}건)`);
    return;
  }

  const item = queue[index];
  stepCardEl.style.display = 'block';
  stepProgressEl.textContent = `${index + 1} / ${queue.length}`;
  stepLinkEl.textContent = item.url;
  stepLinkEl.href = item.url;
  stepCommentEl.value = item.comment;
  prevBtn.disabled = index === 0;
  autoStatusEl.textContent = '대기 중...';
  lastAutoResponse = null;

  await copyToClipboard(item.comment);
  await openStepTab(item.url);
  lastAutoResponse = await autoPost(item.comment);
}

startBtn.addEventListener('click', async () => {
  queue = lastResults
    .filter((r) => r.status === 'ready')
    .map((r) => ({ url: r.url, comment: r.comment }));
  if (queue.length === 0) return;

  index = 0;
  workingTabId = null;
  log = [];
  renderLog();
  startBtn.disabled = true;
  await goToStep();
});

recopyBtn.addEventListener('click', () => {
  copyToClipboard(stepCommentEl.value);
});

retryBtn.addEventListener('click', async () => {
  try {
    await chrome.tabs.reload(workingTabId);
  } catch (err) {
    // 탭이 없으면 무시하고 그대로 재시도
  }
  lastAutoResponse = await autoPost(stepCommentEl.value);
});

prevBtn.addEventListener('click', async () => {
  if (index === 0) return;
  index -= 1;
  await goToStep();
});

nextBtn.addEventListener('click', async () => {
  const item = queue[index];
  log.push({
    url: item.url,
    comment: stepCommentEl.value,
    status: 'confirmed',
    autoStatus: lastAutoResponse ? lastAutoResponse.status : 'unknown',
  });
  renderLog();
  index += 1;
  await goToStep();
});

skipBtn.addEventListener('click', async () => {
  const item = queue[index];
  log.push({ url: item.url, comment: stepCommentEl.value, status: 'skipped' });
  renderLog();
  index += 1;
  await goToStep();
});

renderPreview();
renderLog();

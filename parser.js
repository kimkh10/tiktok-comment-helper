// 슬랙 서포터즈 메시지 파싱 로직. popup.js와 background.js 양쪽에서 그대로 재사용한다.

const TIKTOK_URL_REGEX = /https?:\/\/(?:www\.)?tiktok\.com\/@[^/\s]+\/video\/\d+/g;
const STRICT_TIKTOK_URL_REGEX = /^https:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/\d+$/;
const FOOTER_REGEX = /[—-]\s*Made by/i;
const NUMBERED_LINE_SPLIT_REGEX = /^\s*\*?\d{1,2}\.\s+/m;

function isValidTiktokUrl(url) {
  return STRICT_TIKTOK_URL_REGEX.test(url);
}

function parseEntries(blockBody) {
  const parts = blockBody
    .split(NUMBERED_LINE_SPLIT_REGEX)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts.map((part) => {
    const lines = part
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    // 슬랙 API 원문은 "*4. Anthony*"처럼 이름이 마크다운 굵게(*)로 감싸여 오는 경우가 있어 제거한다.
    const name = (lines[0] || '').replace(/\*+$/, '').trim();
    const comment = lines.slice(1).join('\n').trim();
    return { name, comment };
  });
}

// 붙여넣은 전체 텍스트를 링크별 블록으로 나누고, 각 블록의 번호 매겨진 항목을 파싱한다.
function parseSlackText(rawText) {
  const urls = [];
  let match;
  TIKTOK_URL_REGEX.lastIndex = 0;
  while ((match = TIKTOK_URL_REGEX.exec(rawText)) !== null) {
    urls.push({ url: match[0], start: match.index, end: match.index + match[0].length });
  }

  return urls.map((u, i) => {
    const sliceEnd = i + 1 < urls.length ? urls[i + 1].start : rawText.length;
    let body = rawText.slice(u.end, sliceEnd);
    const footerMatch = body.match(FOOTER_REGEX);
    if (footerMatch) {
      body = body.slice(0, footerMatch.index);
    }
    return { url: u.url, entries: parseEntries(body) };
  });
}

// status: 'ready' | 'not_found' | 'multiple_matches' | 'empty_comment' | 'invalid_url'
function matchCommentsForName(rawText, targetName) {
  const target = (targetName || '').trim().toLowerCase();
  const blocks = parseSlackText(rawText);

  return blocks.map((block) => {
    if (!isValidTiktokUrl(block.url)) {
      return { url: block.url, comment: null, status: 'invalid_url' };
    }

    const matches = block.entries.filter(
      (e) => e.name.trim().toLowerCase() === target
    );

    if (matches.length === 0) {
      return { url: block.url, comment: null, status: 'not_found' };
    }
    if (matches.length > 1) {
      return { url: block.url, comment: null, status: 'multiple_matches' };
    }
    if (!matches[0].comment) {
      return { url: block.url, comment: null, status: 'empty_comment' };
    }
    return { url: block.url, comment: matches[0].comment, status: 'ready' };
  });
}

const TikTokCommentParser = {
  parseSlackText,
  matchCommentsForName,
  isValidTiktokUrl,
};

// 서비스워커(self)와 popup(window) 양쪽에서 동일하게 접근 가능하도록 등록.
if (typeof self !== 'undefined') {
  self.TikTokCommentParser = TikTokCommentParser;
}

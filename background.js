// 툴바 아이콘을 클릭하면 패널 페이지를 새 탭으로 열거나, 이미 열려 있으면 그 탭으로 포커스한다.
// 패널을 팝업이 아니라 일반 탭으로 여는 이유: 사용자가 TikTok 탭으로 전환해 붙여넣기/게시를 하는 동안
// 액션 팝업은 포커스를 잃으면 자동으로 닫히기 때문에, 순서대로 진행하는 흐름이 끊긴다.
chrome.action.onClicked.addListener(async () => {
  const panelUrl = chrome.runtime.getURL('panel.html');
  const existing = await chrome.tabs.query({ url: panelUrl });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: panelUrl });
  }
});

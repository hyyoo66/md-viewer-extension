// .md 파일(file://) 로 이동하려 하면 확장 프로그램의 뷰어 페이지로 바꿔 보여준다.
// 동작 조건: 확장 프로그램 상세 화면에서 "파일 URL에 대한 액세스 허용" 이 켜져 있어야 한다.
const VIEWER_URL = chrome.runtime.getURL('viewer.html');

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    chrome.tabs.update(details.tabId, {
      url: VIEWER_URL + '?src=' + encodeURIComponent(details.url)
    });
  },
  {
    url: [
      { schemes: ['file'], pathSuffix: '.md' },
      { schemes: ['file'], pathSuffix: '.MD' },
      { schemes: ['file'], pathSuffix: '.markdown' }
    ]
  }
);

// 툴바 아이콘: 설정 안내 / 파일 경로로 열기 페이지
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
});

// 처음 설치하면 설정 안내를 한 번 보여준다
chrome.runtime.onInstalled.addListener((info) => {
  if (info.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
  }
});

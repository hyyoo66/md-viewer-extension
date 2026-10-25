(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  // 파일 URL 접근 허용 여부
  var st = $('fileAccess');
  try {
    chrome.extension.isAllowedFileSchemeAccess(function (ok) {
      st.textContent = ok ? '켜짐 ✅' : '꺼짐 ❌ — 아래 안내대로 켜 주세요';
      st.className = 'state ' + (ok ? 'ok' : 'bad');
    });
  } catch (e) {
    st.textContent = '확인할 수 없음';
  }

  $('btnExt').addEventListener('click', function () {
    chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
  });

  // Windows 경로 → file:// URL (각 경로 조각을 개별 인코딩해서 #, ?, 공백, 한글을 안전하게 처리)
  function toFileUrl(p) {
    p = p.trim().replace(/^"+|"+$/g, '');
    if (!p) return '';
    if (/^file:\/\//i.test(p)) return p;
    var parts = p.replace(/\\/g, '/').split('/');
    var enc = parts.map(function (s, i) {
      return (i === 0 && /^[A-Za-z]:$/.test(s)) ? s : encodeURIComponent(s);
    }).join('/');
    return 'file:///' + enc;
  }

  function openPath() {
    var url = toFileUrl($('pathInput').value);
    if (!url) return;
    location.href = chrome.runtime.getURL('viewer.html') + '?src=' + encodeURIComponent(url);
  }
  $('btnOpen').addEventListener('click', openPath);
  $('pathInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') openPath(); });
})();

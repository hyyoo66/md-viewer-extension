// 뷰어: ?src=<file:// URL> 의 마크다운을 읽어 A4 미리보기로 보여주고, PDF(인쇄) / .docx 로 저장한다.
// F5 로 다시 불러와도 보던 자리가 유지되도록 "화면 맨 위에 보이던 블록"을 기억해 두었다가 복원한다.
(function () {
  'use strict';

  var APP_VERSION = '2026.10.25'; // 의미 있는 변경이 있을 때만 수동으로 올리는 버전 번호

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var src = params.get('src');
  if (!src) { location.replace('help.html'); return; }
  var srcNoHash = src.split('#')[0];

  var toolbar = $('toolbar'), paper = $('paper'), statusEl = $('status'), fnameEl = $('fname');
  $('ver').textContent = 'v' + APP_VERSION;

  var lastMd = '';          // 마지막으로 읽어 온 파일 내용
  var pdfName = 'output.pdf';
  var ready = false;        // 첫 렌더링·위치 복원이 끝나기 전에는 스크롤 위치를 저장하지 않는다
  var restoring = false;    // 프로그램이 스크롤을 움직이는 동안 저장 방지
  var userMoved = false;    // 사용자가 직접 스크롤하면 늦은 보정(폰트 로딩 후)을 하지 않는다

  var SKEY = 'mdview.anchor:' + srcNoHash;

  /* ───────────── 유틸 ───────────── */
  function setStatus(msg, isErr) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (isErr ? ' err' : '');
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fileLabel() {
    try { return decodeURIComponent(srcNoHash.split('/').pop()); } catch (e) { return srcNoHash; }
  }
  // 저장 파일명 기준: .md 파일 자체의 이름 (시험.md → 시험).  파일명에 쓸 수 없는 글자는 제거한다.
  function fileBaseName() {
    return fileLabel().replace(/\.(md|markdown)$/i, '').replace(/[\/:*?"<>|\\]/g, '').trim();
  }
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { /* UTF-8 아님 */ }
    try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { /* 미지원 */ }
    return new TextDecoder('utf-8').decode(buf);
  }
  function readSource() {
    return fetch(srcNoHash, { cache: 'no-store' }).then(function (res) {
      if (res.status >= 400) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(decodeText);
  }

  /* ───────────── 스크롤 위치(앵커) 저장/복원 ─────────────
     화면 맨 위에 보이던 블록(제목/문단/표 …)의 "내용 서명 + 순번 + 화면 상단에서의 거리"를 기억한다.
     F5 후에는 같은 서명의 블록을 찾아 같은 거리에 오도록 스크롤하므로,
     보이는 부분 위쪽 내용이 수정되어 길이가 바뀌어도 보던 내용이 그대로 보인다. */
  function sigOf(el) {
    return el.tagName + ':' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function toolbarBottom() { return toolbar.getBoundingClientRect().bottom; }

  function captureAnchor() {
    var blocks = paper.children;
    if (!blocks.length) return null;
    var top = toolbarBottom(), idx = blocks.length - 1, k;
    for (k = 0; k < blocks.length; k++) {
      if (blocks[k].getBoundingClientRect().bottom > top + 1) { idx = k; break; }
    }
    var sig = sigOf(blocks[idx]);
    return {
      idx: idx, sig: sig, pre: sig.slice(0, 28),
      off: Math.round(blocks[idx].getBoundingClientRect().top - top),
      y: Math.round(window.scrollY), n: blocks.length
    };
  }
  function saveAnchor() {
    if (!ready) return;
    var a = captureAnchor();
    if (!a) return;
    try { sessionStorage.setItem(SKEY, JSON.stringify(a)); } catch (e) { /* 무시 */ }
  }
  function loadSavedAnchor() {
    try { return JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) { return null; }
  }
  function jump(y) {
    restoring = true;
    window.scrollTo({ top: Math.max(0, y), left: 0, behavior: 'instant' });
    setTimeout(function () { restoring = false; }, 250);
  }
  function restoreAnchor(a) {
    if (!a) return;
    var blocks = paper.children;
    if (!blocks.length) return;
    if (a.y <= 0) { jump(0); return; }

    var target = -1, best = Infinity, k, d;
    // 1) 서명이 완전히 같은 블록 중 예전 순번에 가장 가까운 것
    for (k = 0; k < blocks.length; k++) {
      if (sigOf(blocks[k]) === a.sig) { d = Math.abs(k - a.idx); if (d < best) { best = d; target = k; } }
    }
    // 2) 앞부분(28자)만 같은 블록 (그 블록을 조금 고친 경우)
    if (target < 0) {
      best = Infinity;
      for (k = 0; k < blocks.length; k++) {
        if (sigOf(blocks[k]).indexOf(a.pre) === 0) { d = Math.abs(k - a.idx); if (d < best) { best = d; target = k; } }
      }
    }
    // 3) 블록 개수가 그대로면 같은 순번, 아니면 예전 픽셀 위치
    if (target < 0) {
      if (a.n === blocks.length) target = a.idx;
      else { jump(a.y); return; }
    }
    var abs = blocks[target].getBoundingClientRect().top + window.scrollY;
    jump(abs - toolbarBottom() - a.off);
  }

  var saveTimer = 0;
  window.addEventListener('scroll', function () {
    if (!ready || restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAnchor, 150);
  }, { passive: true });
  window.addEventListener('pagehide', saveAnchor);          // F5 / 닫기 직전
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveAnchor(); });
  ['wheel', 'touchstart', 'mousedown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { userMoved = true; }, { passive: true, capture: true });
  });

  /* ───────────── 렌더링 ───────────── */
  // 마크다운 안의 상대 경로 링크를 파일 위치 기준으로 풀어 주고, 다른 .md 는 이 뷰어로 연다.
  function fixLinks() {
    var links = paper.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i], h = a.getAttribute('href') || '';
      if (/^(https?:|mailto:)/i.test(h)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; continue; }
      if (h.charAt(0) === '#' || h === '') { a.addEventListener('click', function (e) { e.preventDefault(); }); continue; }
      try {
        var u = new URL(h, srcNoHash);
        if (u.protocol === 'file:' && /\.(md|markdown)$/i.test(u.pathname)) {
          a.href = location.pathname + '?src=' + encodeURIComponent(u.href.split('#')[0]);
        } else {
          a.href = u.href;
        }
      } catch (e) { /* 그대로 둔다 */ }
    }
  }

  function renderAll() {
    var md = cleanMd(lastMd);
    setRenderOptions({ hrAuto: true, subtitle: true });   // H2 자동줄 · 소제목 자동감지: 항상 켜짐(고정)
    pdfName = fileBaseName() ? fileBaseName() + '.pdf' : getPdfName(md);   // 파일 이름 기준 (비면 첫 제목으로 대체)
    fnameEl.textContent = fileLabel();   // 읽어 들인 .md 파일 이름 (저장 파일명은 pdfName / docx 에서 별도로 사용)
    try { fnameEl.title = decodeURIComponent(srcNoHash.replace(/^file:\/\/\/?/i, '')); } catch (e) { fnameEl.title = srcNoHash; }   // 마우스를 올리면 전체 경로
    document.title = pdfName.replace(/\.pdf$/i, '') + ' — MD 뷰어';
    paper.innerHTML = md.trim() ? mdToHtml(md) : '<p class="empty">(빈 파일입니다)</p>';
    fixLinks();
    var typeset =(window.MathJax && MathJax.typesetPromise)
      ? MathJax.startup.promise.then(function () {
          MathJax.typesetClear([paper]);
          return MathJax.typesetPromise([paper]);
        }).catch(function (e) { console.warn('MathJax 오류:', e); })
      : Promise.resolve();
    return typeset.then(waitImages);
  }

  // 그림이 디코딩되어 실제 높이가 정해진 뒤에 스크롤 위치를 맞추기 위해 기다린다
  function waitImages() {
    var imgs = paper.querySelectorAll('img');
    return Promise.all(Array.prototype.map.call(imgs, function (im) {
      return im.decode ? im.decode().catch(function () {}) : Promise.resolve();
    }));
  }

  function showLoadError(e) {
    var msg = (e && e.message) ? e.message : String(e);
    setStatus('❌ 파일을 읽을 수 없습니다: ' + msg, true);
    if (!paper.children.length) {
      paper.innerHTML =
        '<div class="load-error"><h2>파일을 열 수 없습니다</h2>' +
        '<p>' + escapeHtml(fileLabel()) + '</p><ul>' +
        '<li>확장 프로그램 상세 화면에서 <b>"파일 URL에 대한 액세스 허용"</b>이 켜져 있는지 확인하세요.</li>' +
        '<li>파일이 이동되었거나 삭제되지 않았는지 확인하세요.</li></ul>' +
        '<p><a href="help.html">설정 안내 열기</a></p></div>';
    }
  }

  // 파일을 다시 읽어 렌더링하고, anchor 위치로 스크롤을 되돌린다.
  function loadFile(anchor) {
    return readSource().then(function (text) {
      lastMd = text;
      return renderAll();       // 렌더링 때마다 AI 지시서 유무도 다시 검사한다 (처음 열기 / F5 / ↻ 새로고침 모두 이 경로)
    }).then(function () {
      restoreAnchor(anchor);
      setStatus('');            // 불러오기 성공 메시지는 표시하지 않는다
      return true;
    }, function (e) {
      showLoadError(e);
      return false;
    });
  }

  /* ───────────── 버튼 ───────────── */
  $('btnReload').addEventListener('click', function () { loadFile(captureAnchor()); });

  // PDF 저장 = 인쇄창. 저장 파일명은 인쇄 순간의 문서 제목으로 정해진다.
  var titleBeforePrint = '';
  window.addEventListener('beforeprint', function () { titleBeforePrint = document.title; document.title = pdfName; });
  window.addEventListener('afterprint', function () { if (titleBeforePrint) document.title = titleBeforePrint; });
  $('btnPdf').addEventListener('click', function () { window.print(); });

  $('btnDocx').addEventListener('click', function () {
    var btn = $('btnDocx');
    btn.disabled = true;
    setStatus('docx 변환 중…');
    buildDocx(lastMd, fileBaseName()).then(function (r) {
      var url = URL.createObjectURL(r.blob);
      var a = document.createElement('a');
      a.href = url; a.download = r.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      setStatus('✅ ' + r.filename + ' 저장');
    }).catch(function (e) {
      console.error(e);
      setStatus('❌ 변환 오류: ' + (e && e.message ? e.message : e), true);
    }).then(function () { btn.disabled = false; });
  });

  /* ───────────── 그림 삽입 기능 안내 (AI 지시서 + 복사 버튼) ─────────────
     file:// 로 연 파일은 확장 프로그램이 쓸 수 없으므로, 지시서는 클립보드로 복사해서 에디터에서 직접 붙여넣는다. */
  var guide = $('guide'), guideCopyMsg = $('guideCopyMsg'), guideMsgTimer = 0;
  $('guideBlock').textContent = AI_INSTRUCTION_BLOCK;     // 안내창 안에 지시서 본문을 그대로 보여준다

  function openGuide() { guide.hidden = false; guide.scrollTop = 0; }
  function closeGuide() { guide.hidden = true; }

  function showCopyMsg(msg, isErr) {
    guideCopyMsg.textContent = msg;
    guideCopyMsg.className = 'copymsg' + (isErr ? ' err' : '');
    clearTimeout(guideMsgTimer);
    guideMsgTimer = setTimeout(function () { guideCopyMsg.textContent = ''; }, 5000);
  }
  function copyInstructions() {
    return navigator.clipboard.writeText(AI_INSTRUCTION_BLOCK).then(function () {
      showCopyMsg('✅ 복사했습니다. AI 대화창에 붙여넣으세요.');
    }, function () {
      showCopyMsg('❌ 복사에 실패했습니다. 아래 지시서를 직접 선택(클릭)해 Ctrl+C 하세요.', true);
    });
  }

  $('btnGuide').addEventListener('click', openGuide);
  $('guideClose').addEventListener('click', closeGuide);
  $('guideCopy').addEventListener('click', copyInstructions);
  guide.addEventListener('mousedown', function (e) { if (e.target === guide) closeGuide(); });   // 바깥 영역 클릭
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !guide.hidden) closeGuide(); });

  /* ───────────── 시작 ───────────── */
  try { history.scrollRestoration = 'manual'; } catch (e) { /* 무시 */ }

  var saved = loadSavedAnchor();
  loadFile(saved).then(function (ok) {
    if (!ok) return;           // 읽기 실패 시에는 예전에 저장된 위치를 덮어쓰지 않는다
    ready = true;
    if (saved) {
      // 수식 폰트 로딩 등으로 높이가 뒤늦게 바뀔 수 있어, 사용자가 아직 움직이지 않았다면 한 번 더 맞춘다
      var again = function () { if (!userMoved) restoreAnchor(saved); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(again, 60); });
      setTimeout(again, 500);
    }
  });
})();

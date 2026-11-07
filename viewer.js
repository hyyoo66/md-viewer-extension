// 뷰어: ?src=<file:// URL> 의 마크다운을 읽어 A4 미리보기로 보여주고, PDF(인쇄) / .docx 로 저장한다.
// F5 로 다시 불러와도 보던 자리가 유지되도록 "화면 맨 위에 보이던 블록"을 기억해 두었다가 복원한다.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var src = params.get('src');
  var pasteMode = !src && params.has('paste');     // viewer.html?paste=1 : 파일 없이 붙여넣은 md 를 보는 모드
  if (!src && !pasteMode) { location.replace('help.html'); return; }
  var srcNoHash = (src || '').split('#')[0];
  var PKEY = 'mdview.pasteText';                   // 붙여넣은 글은 세션 저장소에 두어 F5 로 새로고침해도 유지한다

  var toolbar = $('toolbar'), paper = $('paper'), statusEl = $('status'), fnameEl = $('fname');

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
    if (pasteMode) return '(붙여넣은 글)';
    try { return decodeURIComponent(srcNoHash.split('/').pop()); } catch (e) { return srcNoHash; }
  }
  // 저장 파일명 기준: .md 파일 자체의 이름 (시험.md → 시험).  파일명에 쓸 수 없는 글자는 제거한다.
  function fileBaseName() {
    if (pasteMode) return '';
    return fileLabel().replace(/\.(md|markdown)$/i, '').replace(/[\/:*?"<>|\\]/g, '').trim();
  }
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { /* UTF-8 아님 */ }
    try { return new TextDecoder('euc-kr').decode(buf); } catch (e) { /* 미지원 */ }
    return new TextDecoder('utf-8').decode(buf);
  }
  function readSource() {
    if (pasteMode) {
      var t = '';
      try { t = sessionStorage.getItem(PKEY) || ''; } catch (e) { /* 무시 */ }
      return Promise.resolve(t);
    }
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
      return renderAll();       // 처음 열기 / F5 / ↻ 새로고침 모두 이 경로
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
  /* ───────────── 글 전체 복사 (마우스로 드래그해서 복사하는 것과 같은 결과: 서식·표·그림 포함) ───────────── */
  var copyAllTimer = 0;
  function copyAllMsg(msg, isErr) {
    setStatus(msg, isErr);
    clearTimeout(copyAllTimer);
    copyAllTimer = setTimeout(function () { setStatus(''); }, 4000);
  }
  // 번호·불릿 목록은 줄마다 <ol>/<ul> 이 따로 있어 붙여넣으면 번호가 모두 "1." 이 되거나 간격이 벌어진다.
  // 복사하는 동안만 연속된 줄을 하나의 목록으로 합쳐 두고, 끝나면 원래 노드로 되돌린다.
  function flattenLists() {
    var undo = [], kids = Array.prototype.slice.call(paper.children), i = 0;
    while (i < kids.length) {
      if (kids[i].tagName === 'UL') {     // 불릿도 줄마다 <ul> 이 따로 있어 붙여넣으면 간격이 벌어진다 → 하나의 목록으로 합친다 (들여쓰기 단계는 중첩으로 유지)
        var urun = [];
        while (i < kids.length && kids[i].tagName === 'UL') urun.push(kids[i++]);
        var root = document.createElement('ul');
        root.style.margin = '3pt 0 3pt 18pt';
        var stack = [{ ul: root, lv: 0 }];
        urun.forEach(function (ul) {
          var lv = Math.max(0, Math.round(((parseFloat(ul.style.marginLeft) || 18) - 18) / 16));
          Array.prototype.forEach.call(ul.children, function (li) {
            while (stack.length > 1 && stack[stack.length - 1].lv > lv) stack.pop();
            var top = stack[stack.length - 1];
            if (top.lv < lv) {
              var sub = document.createElement('ul');
              sub.style.listStyleType = 'circle';
              (top.ul.lastElementChild || top.ul).appendChild(sub);
              stack.push({ ul: sub, lv: lv });
              top = stack[stack.length - 1];
            }
            top.ul.appendChild(li.cloneNode(true));
          });
        });
        urun[0].parentNode.insertBefore(root, urun[0]);
        urun.forEach(function (ul) { paper.removeChild(ul); });
        undo.push([root, urun]);
        continue;
      }
      if (kids[i].tagName !== 'OL') { i++; continue; }
      var run = [];
      while (i < kids.length && kids[i].tagName === 'OL') run.push(kids[i++]);
      var nol = document.createElement('ol'), expect = 0;
      nol.style.margin = '3pt 0 3pt 20pt';
      run.forEach(function (ol) {
        var n = parseInt(ol.getAttribute('start'), 10);
        if (isNaN(n)) n = 1;
        Array.prototype.forEach.call(ol.children, function (li, k) {
          var c = li.cloneNode(true), num = n + k;
          if (!nol.children.length) { if (num !== 1) nol.setAttribute('start', num); }
          else if (num !== expect) c.setAttribute('value', num);      // 번호가 이어지지 않는 항목만 직접 지정
          nol.appendChild(c);
          expect = num + 1;
        });
      });
      run[0].parentNode.insertBefore(nol, run[0]);
      run.forEach(function (ol) { paper.removeChild(ol); });
      undo.push([nol, run]);
    }
    return function () {
      undo.forEach(function (u) {
        u[1].forEach(function (ol) { u[0].parentNode.insertBefore(ol, u[0]); });
        u[0].parentNode.removeChild(u[0]);
      });
    };
  }
  function copyViaSelection() {
    var sel = window.getSelection(), saved = [], i, ok = false;
    for (i = 0; i < sel.rangeCount; i++) saved.push(sel.getRangeAt(i));
    var restore = flattenLists();      // 목록을 먼저 합치고 나서 범위를 잡는다 (먼저 잡으면 선택 끝이 앞으로 당겨져 맨 뒤 블록이 빠진다)
    var range = document.createRange();
    range.selectNodeContents(paper);
    sel.removeAllRanges(); sel.addRange(range);
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    sel.removeAllRanges();
    restore();
    saved.forEach(function (r) { sel.addRange(r); });
    return ok;
  }
  function copyViaClipboardApi() {
    if (!(navigator.clipboard && window.ClipboardItem)) return Promise.reject(new Error('unsupported'));
    var restore = flattenLists(), html = paper.innerHTML, text = paper.innerText;
    restore();
    return navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' })
    })]);
  }
  $('btnCopyAll').addEventListener('click', function () {
    if (!paper.children.length || paper.querySelector('.empty,.load-error')) { copyAllMsg('복사할 내용이 없습니다.', true); return; }
    if (copyViaSelection()) { copyAllMsg('✅ 글 전체를 복사했습니다 (붙여넣기: Ctrl+V)'); return; }
    copyViaClipboardApi().then(function () {
      copyAllMsg('✅ 글 전체를 복사했습니다 (붙여넣기: Ctrl+V)');
    }, function () {
      copyAllMsg('❌ 복사하지 못했습니다. 본문을 드래그해서 직접 복사해 주세요.', true);
    });
  });

  var ED = {                                       // 확장 프로그램 쪽 동작 (블록 본문은 독립형과 같다)
    empty: function () { return pasteMode && !lastMd.trim(); },
    beforeNew: function () {
      if (!pasteMode) { window.open('viewer.html?paste=1', '_blank'); return false; }   // 파일을 보던 탭은 그대로 두고 새 탭에서 만든다
      return true;
    },
    saveName: function (text) { return getPdfName(cleanMd(text)).replace(/\.pdf$/i, '') + '.md'; },   // 이름은 첫 제목 기준 (열려 있는 파일 이름은 쓰지 않는다)
    apply: function (text) {
      var a = captureAnchor();
      lastMd = text;
      try { sessionStorage.setItem(PKEY, text); } catch (e) { /* 용량 초과 등: 새로고침하면 사라진다 */ }
      return renderAll().then(function () {
        restoreAnchor(a);
        setStatus('✏ 붙여넣은 글 (파일에 저장하지 않음)');
      });
    }
  };

  /* ───────────── 새 파일 만들기 (붙여넣기 → 화면에 보기 → 새 .md 로 저장) ─────────────
     열려 있는 파일의 내용은 이 창에 넣지 않으므로, 열려 있는 원본을 고쳐서 저장하는 길 자체가 없다.
     저장은 항상 "새 파일"이다: 저장 창은 바탕화면에서 시작하고, 내용이 있는 기존 파일은 덮어쓰지 않는다.
     이 블록은 확장 프로그램(viewer.js)과 독립형(standalone_app.js)에 똑같이 들어간다. 다른 점은 위의 ED 에만 둔다. */
  var editor = $('editor'), edText = $('edText'), edMsg = $('edMsg'), edMsgTimer = 0, edApplied = '';
  function edShow(msg, isErr) {
    edMsg.textContent = msg || '';
    edMsg.className = 'copymsg' + (isErr ? ' err' : '');
    clearTimeout(edMsgTimer);
    if (msg) edMsgTimer = setTimeout(function () { edMsg.textContent = ''; }, 10000);
  }
  function openEditor() {
    edText.value = '';
    edApplied = '';
    edShow('');
    editor.hidden = false;
    editor.scrollTop = 0;
    edText.focus();
  }
  function applyEditor() {
    var text = edText.value;
    return ED.apply(text).then(function () { edApplied = text; });
  }
  function closeEditor() {
    editor.hidden = true;
    if (edText.value.trim() && edText.value !== edApplied) {      // 붙여넣은 글을 화면에 보여 준다
      applyEditor().catch(function (e) { console.error(e); });
    }
  }
  function newFile() {
    if (ED.beforeNew() === false) return;
    openEditor();
  }
  $('btnNew').addEventListener('click', newFile);
  if ($('btnNew2')) $('btnNew2').addEventListener('click', newFile);
  $('edClose').addEventListener('click', closeEditor);

  /* ── 새 .md 파일로 저장 ──
     저장 위치 선택창(showSaveFilePicker)은 클릭 직후에만 열 수 있으므로 가장 먼저 호출한다.
     저장 창이 만들어 준 파일(또는 사용자가 고른 기존 파일)에 이미 내용이 있으면 쓰지 않는다. */
  function downloadText(text, name) {
    var url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
  function writeTo(h, text) {
    return h.createWritable().then(function (w) {
      return w.write(text).then(function () { return w.close(); });
    });
  }
  function doSave() {
    var text = edText.value;
    if (!text.trim()) { edShow('저장할 내용이 없습니다. 먼저 붙여넣으세요.', true); return; }
    var name = ED.saveName(text), target;
    if (window.showSaveFilePicker) {
      target = window.showSaveFilePicker({
        suggestedName: name,
        startIn: 'desktop',
        types: [{ description: '마크다운', accept: { 'text/markdown': ['.md'] } }]
      });
    } else {
      target = Promise.resolve(null);      // 저장 위치 선택을 지원하지 않는 브라우저: 다운로드 폴더로 받는다
    }
    return target.then(function (th) {
      if (!th) {
        downloadText(text, name);
        edShow('✅ ' + name + ' 을(를) 다운로드했습니다. (이 브라우저는 저장 위치를 고를 수 없어 다운로드 폴더로 받습니다)');
        return applyEditor();
      }
      return th.getFile().then(function (f) {
        if (f.size > 0) {
          var err = new Error('이미 내용이 있는 파일이라 덮어쓰지 않습니다. 다른 이름으로 저장하세요.');
          err.name = 'Exists';
          throw err;
        }
        return writeTo(th, text);
      }).then(function () {
        edShow('✅ ' + th.name + ' 을(를) 만들었습니다.');
        return applyEditor();
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;      // 저장 위치 선택을 취소함
      edShow('❌ ' + (e && e.name === 'Exists' ? e.message : '저장하지 못했습니다: ' + (e && e.message ? e.message : e)), true);
    });
  }
  $('edSave').addEventListener('click', doSave);

  // 아무 파일도 열려 있지 않을 때는 창 아무 곳에서나 Ctrl+V 로 바로 연다 (입력란에 붙여넣는 경우는 건드리지 않는다)
  document.addEventListener('paste', function (e) {
    if (!ED.empty() || !editor.hidden) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!text || !text.trim()) return;
    e.preventDefault();
    ED.apply(text);
  });

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

  /* ───────────── MD 뷰어 안내 / 확장 프로그램 안내 (안내창 2개) ─────────────
     file:// 로 연 파일은 확장 프로그램이 쓸 수 없으므로, 설명글은 클립보드로 복사해서 AI 대화창에 붙여넣는다. */
  var IN_EXT = !!(window.chrome && chrome.runtime && chrome.runtime.id);   // 확장 프로그램 안에서 실행 중인지
  var guide = $('guide'), extGuide = $('extGuide'), guideCopyMsg = $('guideCopyMsg'), guideMsgTimer = 0;
  $('guideBlock').textContent = AI_INSTRUCTION_BLOCK;     // 설명글 본문 (접힌 상태로 들어 있고, 펼치면 보인다)

  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  // 확장 프로그램 안내: 확장 프로그램 안에서는 "설치되어 있습니다 + 관리", 웹페이지(독립형/블로그)에서는 "설치 방법"을 보여준다
  each(extGuide.querySelectorAll('[data-env]'), function (el) {
    el.hidden = (el.getAttribute('data-env') === 'ext') !== IN_EXT;
  });

  function openModal(m) { m.hidden = false; m.scrollTop = 0; }
  function closeModal(m) { m.hidden = true; }
  $('btnGuide').addEventListener('click', function () { openModal(guide); });
  $('btnExtGuide').addEventListener('click', function () { openModal(extGuide); });
  $('guideClose').addEventListener('click', function () { closeModal(guide); });
  $('extGuideClose').addEventListener('click', function () { closeModal(extGuide); });
  each([guide, extGuide], function (m) {
    m.addEventListener('mousedown', function (e) { if (e.target === m) closeModal(m); });   // 바깥 영역 클릭
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    each([guide, extGuide], function (m) { if (!m.hidden) closeModal(m); });
  });

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
      showCopyMsg('❌ 복사에 실패했습니다. "AI에게 전달할 설명글 내용 보기"를 펼쳐 직접 선택(클릭)해 Ctrl+C 하세요.', true);
    });
  }
  $('guideCopy').addEventListener('click', copyInstructions);

  // 확장 프로그램 관리 주소: 확장 프로그램 안에서는 클릭하면 바로 열린다.
  // (일반 웹페이지는 chrome:// 주소를 링크로 열 수 없으므로, 그 경우에는 주소를 복사해 준다)
  function extMsgOf(link) { return link.parentNode.querySelector('.extmsg'); }
  function showExtHint(link) {
    var m = extMsgOf(link); if (!m) return;
    m.className = 'extmsg copymsg'; m.style.color = 'var(--ink3)';
    m.textContent = ' ← 클릭하면 주소가 복사됩니다 (Ctrl+L → Ctrl+V → Enter)';
  }
  function showExtMsg(link, msg, isErr) {
    var m = extMsgOf(link); if (!m) return;
    m.style.color = ''; m.className = 'extmsg copymsg' + (isErr ? ' err' : ''); m.textContent = ' ' + msg;
    clearTimeout(m._t); m._t = setTimeout(function () { showExtHint(link); }, 6000);
  }
  each(extGuide.querySelectorAll('.extlink'), function (link) {
    if (!IN_EXT) {
      link.title = '웹페이지에서는 chrome:// 주소를 열 수 없어서, 클릭하면 주소가 복사됩니다';
      showExtHint(link);
    }
    link.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.chrome && chrome.tabs && chrome.tabs.create) { chrome.tabs.create({ url: 'chrome://extensions' }); return; }
      navigator.clipboard.writeText('chrome://extensions').then(function () {
        showExtMsg(link, '주소를 복사했습니다. 새 탭 주소창에 붙여넣고 Enter 를 누르세요.');
      }, function () {
        showExtMsg(link, '복사에 실패했습니다. 주소창에 chrome://extensions 를 직접 입력하세요.', true);
      });
    });
  });

  /* ───────────── 시작 ───────────── */
  try { history.scrollRestoration = 'manual'; } catch (e) { /* 무시 */ }

  var saved = loadSavedAnchor();
  loadFile(saved).then(function (ok) {
    if (!ok) return;           // 읽기 실패 시에는 예전에 저장된 위치를 덮어쓰지 않는다
    ready = true;
    if (pasteMode && !lastMd.trim()) openEditor();      // 붙여넣기 모드로 처음 열면 바로 붙여넣기 창을 연다
    if (saved) {
      // 수식 폰트 로딩 등으로 높이가 뒤늦게 바뀔 수 있어, 사용자가 아직 움직이지 않았다면 한 번 더 맞춘다
      var again = function () { if (!userMoved) restoreAnchor(saved); };
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(again, 60); });
      setTimeout(again, 500);
    }
  });
})();

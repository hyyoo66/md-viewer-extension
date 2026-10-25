// MathJax 설정: 확장 프로그램 CSP 때문에 인라인 <script> 를 쓸 수 없어 별도 파일로 분리했다.
// 자동 typeset 은 끄고, viewer.js 가 렌더링 후 직접 호출한다.
window.MathJax = {
  tex: {
    inlineMath: [['$', '$'], ['\\(', '\\)']],
    displayMath: [['$$', '$$'], ['\\[', '\\]']],
    processEscapes: true
  },
  chtml: {
    scale: 1.1,
    matchFontHeight: false,
    fontURL: chrome.runtime.getURL('lib/mathjax/output/chtml/fonts/woff-v2')
  },
  options: {
    skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre']
  },
  startup: {
    typeset: false
  }
};

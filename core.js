// 확장 프로그램용 코어: 원본 markdown_word_PDF_converter.html 의 변환 로직을 그대로 가져온 것.
// (LaTeX 파서 / OMML 변환 / 마크다운 파서 / docx 생성)  UI 는 포함하지 않는다. 그림은 md 안의 Base64(data:) 만 지원.

let hrAutoMode=true;        // false=원문 충실, true=H2 자동줄
let subtitleDetectMode=true; // false=소제목 감지 끔, true=소제목 자동감지
function setRenderOptions(o){
  if(o&&typeof o.hrAuto==='boolean')hrAutoMode=o.hrAuto;
  if(o&&typeof o.subtitle==='boolean')subtitleDetectMode=o.subtitle;
}

function stripMd(t){return t.replace(/\*{1,3}(.+?)\*{1,3}/g,'$1').replace(/_{1,3}(.+?)_{1,3}/g,'$1').replace(/`(.+?)`/g,'$1').trim();}
function getFilename(md){
  for(const l of md.split('\n').filter(x=>x.trim())){const m=l.match(/^\s*#{1,3}\s+(.+)/);if(m){const n=stripMd(m[1]).replace(/[/:*?"<>|\\]/g,'').trim();return(n||'output')+'.docx';}}
  return(stripMd((md.split('\n').find(x=>x.trim())||'')).replace(/[/:*?"<>|\\]/g,'').slice(0,30)||'output')+'.docx';
}

// ════════════════════════════════════════════════════════
// LaTeX 파서 (재귀 토큰 방식)
// ════════════════════════════════════════════════════════
const _SYMS={
  alpha:'α',beta:'β',gamma:'γ',delta:'δ',epsilon:'ε',zeta:'ζ',eta:'η',
  theta:'θ',iota:'ι',kappa:'κ',lambda:'λ',mu:'μ',nu:'ν',xi:'ξ',pi:'π',rho:'ρ',
  sigma:'σ',tau:'τ',upsilon:'υ',phi:'φ',chi:'χ',psi:'ψ',omega:'ω',
  Gamma:'Γ',Delta:'Δ',Theta:'Θ',Lambda:'Λ',Xi:'Ξ',Pi:'Π',Sigma:'Σ',Phi:'Φ',Psi:'Ψ',Omega:'Ω',
  infty:'∞',pm:'±',mp:'∓',times:'×',div:'÷',cdot:'·',leq:'≤',geq:'≥',neq:'≠',
  Re:'ℜ',Im:'ℑ',
  le:'≤',ge:'≥',ne:'≠',ll:'≪',gg:'≫',propto:'∝',circ:'∘',degree:'°',angle:'∠',
  varepsilon:'ε',vartheta:'ϑ',varphi:'φ',omicron:'ο',leftrightarrow:'↔',Rightarrow:'⇒',uparrow:'↑',downarrow:'↓',
  approx:'≈',equiv:'≡',sim:'∼',sum:'∑',prod:'∏',int:'∫',oint:'∮',partial:'∂',nabla:'∇',
  forall:'∀',exists:'∃',in:'∈',notin:'∉',subset:'⊂',supset:'⊃',cup:'∪',cap:'∩',
  to:'→',rightarrow:'→',leftarrow:'←',Rightarrow:'⇒',Leftrightarrow:'⟺',
  ldots:'…',cdots:'⋯',vdots:'⋮',hbar:'ℏ',ell:'ℓ',
};
const _FUNCS=new Set(['sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan',
  'sinh','cosh','tanh','log','ln','exp','lim','max','min','sup','inf','det','deg']);

function parseLaTeX(latex){
  let pos=0;
  // ChatGPT가 \, 대신 백슬래시 없는 쉼표를 숫자-단위 사이 공백으로 잘못 쓰는 경우 정규화 (예: 5,k\Omega → 5\,k\Omega)
  // 일반 공백 문자로 바꾸면 토크나이저가 그냥 건너뛰어(eatSp) 공백 자체가 사라지므로, 실제 공백 토큰을 만드는 \, 명령으로 치환한다.
  // Preserve punctuation exactly as supplied; do not turn normal commas into LaTeX spacing commands.
  const s=latex.trim();
  const peek=()=>s[pos];
  const eat=c=>{if(s[pos]===c){pos++;return true;}return false;};
  const eatSp=()=>{while(pos<s.length&&' \t\n\r'.includes(s[pos]))pos++;};

  function group(){
    eatSp();
    if(peek()==='{'){
      pos++;const nodes=[];
      while(pos<s.length&&peek()!=='}')nodes.push(...expr1());
      eat('}');const f=nodes.filter(Boolean);
      if(!f.length)return{type:'mrow',ch:[]};if(f.length===1)return f[0];return{type:'mrow',ch:f};
    }
    const t=token();return t||{type:'mrow',ch:[]};
  }

  function token(){
    eatSp();if(pos>=s.length||peek()==='}')return null;
    if(peek()==='\\'){
      pos++;let cmd='';
      if(pos<s.length&&/[a-zA-Z]/.test(s[pos])){while(pos<s.length&&/[a-zA-Z]/.test(s[pos]))cmd+=s[pos++];}
      else cmd=s[pos++];
      if(cmd==='frac'){const n=group(),d=group();return{type:'mfrac',ch:[n,d]};}
      if(cmd==='sqrt'){eatSp();if(peek()==='['){pos++;let r='';while(pos<s.length&&peek()!==']')r+=s[pos++];eat(']');return{type:'mroot',ch:[group(),parseLaTeX(r)]};}return{type:'msqrt',ch:[group()]};}
      if(cmd==='left'||cmd==='right'){eatSp();if(pos<s.length)pos++;return null;}
      if(cmd==='text'||cmd==='mathrm'||cmd==='textrm'||cmd==='operatorname'){
        // \text{ kHz}, \operatorname{Re} 처럼 중괄호 안 원문을 공백까지 그대로 보존하는 정자체 텍스트로 처리
        if(cmd==='operatorname')eat('*'); // \operatorname*{...}
        eatSp();
        if(peek()==='{'){
          pos++;let depth=1,raw='';
          while(pos<s.length&&depth>0){const c=s[pos++];if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)break;}raw+=c;}
          return{type:'mtext',val:raw};
        }
        return group();
      }
      // 글꼴 지정 명령: 글꼴은 무시하고 내용만 사용 (명령 이름이 글자로 찍히는 것 방지)
      if(cmd==='mathbf'||cmd==='mathit'||cmd==='mathbb'||cmd==='mathcal'||cmd==='mathsf'||cmd==='mathtt'||cmd==='boldsymbol'||cmd==='bm')return group();
      if(cmd==='vec'||cmd==='hat'||cmd==='tilde'||cmd==='overline')return{type:'mover',ch:[group(),{type:'mo',val:{vec:'→',hat:'^',tilde:'~',overline:'‾'}[cmd]}]};
      if(cmd==='quad'||cmd==='qquad')return{type:'mspace'};
      if(cmd===','||cmd===';'||cmd===':'||cmd===' ')return{type:'mo',val:' '}; // \, \; \: \  → 공백
      if(cmd==='!')return{type:'mspace'}; // \! (음의 공백) → 무시
      if(cmd==='%')return{type:'mo',val:'%'};
      if(_SYMS[cmd])return{type:'mo',val:_SYMS[cmd]};
      if(_FUNCS.has(cmd))return{type:'mi',val:cmd};
      return{type:'mo',val:cmd}; // 알 수 없는 명령어는 그냥 텍스트로
    }
    if(peek()==='{'){
      pos++;const nodes=[];
      while(pos<s.length&&peek()!=='}')nodes.push(...expr1());
      eat('}');const f=nodes.filter(Boolean);
      if(!f.length)return{type:'mrow',ch:[]};if(f.length===1)return f[0];return{type:'mrow',ch:f};
    }
    if(/\d/.test(peek())){let n='';while(pos<s.length&&/[\d.]/.test(s[pos]))n+=s[pos++];return{type:'mn',val:n};}
    const c=s[pos++];
    if(c===' '||c==='\t')return null;
    if(/[a-zA-Z]/.test(c))return{type:'mi',val:c};
    return{type:'mo',val:c};
  }

  function expr1(){
    eatSp();if(pos>=s.length||peek()==='}')return[];
    const base=token();if(!base)return[];eatSp();
    let sub=null,sup=null,it=0;
    while((peek()==='_'||peek()==='^')&&it++<6){
      if(eat('_'))sub=group();else if(eat('^'))sup=group();eatSp();
    }
    if(sub&&sup)return[{type:'msubsup',ch:[base,sub,sup]}];
    if(sub)return[{type:'msub',ch:[base,sub]}];
    if(sup)return[{type:'msup',ch:[base,sup]}];
    return[base];
  }

  const nodes=[];while(pos<s.length){nodes.push(...expr1());eatSp();}
  const f=nodes.filter(Boolean);if(f.length===1)return f[0];return{type:'mrow',ch:f};
}

// ════════════════════════════════════════════════════════
// AST → OMML 문자열 (DOM 없이 직접 생성)
// ════════════════════════════════════════════════════════
function _esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function astToOmml(n){
  if(!n)return'';
  const t=(tag,c)=>`<m:${tag}>${c}</m:${tag}>`;
  switch(n.type){
    case 'mn':return t('r',`<m:rPr/><m:t xml:space="preserve">${_esc(n.val)}</m:t>`);
    case 'mo':return t('r',`<m:rPr/><m:t xml:space="preserve">${_esc(n.val)}</m:t>`);
    case 'mi':return t('r',`<m:rPr><m:sty m:val="${n.val&&n.val.length===1?'i':'p'}"/></m:rPr><m:t xml:space="preserve">${_esc(n.val)}</m:t>`);
    case 'mtext':return t('r',`<m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">${_esc(n.val||'')}</m:t>`);
    case 'mrow':return(n.ch||[]).map(astToOmml).join('');
    case 'mspace':return'';
    case 'mfrac':return t('f',t('num',astToOmml(n.ch[0]))+t('den',astToOmml(n.ch[1])));
    case 'msqrt':return t('rad',t('radPr','<m:degHide m:val="1"/>')+t('deg','')+t('e',astToOmml(n.ch[0])));
    case 'mroot':return t('rad',t('radPr','')+t('deg',astToOmml(n.ch[1]))+t('e',astToOmml(n.ch[0])));
    case 'msup':return t('sSup',t('e',astToOmml(n.ch[0]))+t('sup',astToOmml(n.ch[1])));
    case 'msub':return t('sSub',t('e',astToOmml(n.ch[0]))+t('sub',astToOmml(n.ch[1])));
    case 'msubsup':return t('sSubSup',t('e',astToOmml(n.ch[0]))+t('sub',astToOmml(n.ch[1]))+t('sup',astToOmml(n.ch[2])));
    case 'mover':return t('acc',t('accPr','')+t('e',astToOmml(n.ch[0])));
    case 'munder':return t('limLow',t('e',astToOmml(n.ch[0]))+t('lim',astToOmml(n.ch[1])));
    default:return'';
  }
}

function latexToOmmlStr(latex, display){
  // xmlns:m는 document 레벨에서 선언되므로 여기선 생략
  const inner=astToOmml(parseLaTeX(latex));
  if(display)return`<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>${inner}</m:oMath></m:oMathPara>`;
  return`<m:oMath>${inner}</m:oMath>`;
}

// ════════════════════════════════════════════════════════
// 마커 시스템 + JSZip 후처리
// ════════════════════════════════════════════════════════
const mathQueue=[];
const BPX='XMATHBX', IPX='XMATHIX'; // 짧고 고유한 prefix

function makeMathMarker(latex, display){
  const id=mathQueue.length;
  const marker=display?`${BPX}${id}X`:`${IPX}${id}X`;
  mathQueue.push({latex,display,marker});
  return marker;
}

async function patchMathInBlob(blob){
  if(!mathQueue.length)return blob;

  // JSZip 은 lib/jszip.min.js 로 로컬에 내장되어 있다 (확장 프로그램은 CDN 스크립트를 불러올 수 없음)
  const zip=await JSZip.loadAsync(blob);
  let xml=await zip.file('word/document.xml').async('string');

  // m: 네임스페이스 선언 추가
  if(!xml.includes('xmlns:m='))
    xml=xml.replace('<w:document ','<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ');

  for(const {latex,display,marker} of mathQueue){
    try{
      const omml=latexToOmmlStr(latex,display);
      const em=marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if(display){
        const re=new RegExp(`<w:p\\b[^>]*>(?:(?!</w:p>)[\\s\\S])*?${em}(?:(?!</w:p>)[\\s\\S])*?</w:p>`);
        // A display Office Math paragraph must remain inside a Word paragraph.
        // Replacing the whole w:p with a bare m:oMathPara corrupts the DOCX.
        xml=xml.replace(re,`<w:p>${omml}</w:p>`);
      } else {
        const re=new RegExp(`<w:r\\b[^>]*>(?:(?!</w:r>)[\\s\\S])*?${em}(?:(?!</w:r>)[\\s\\S])*?</w:r>`);
        xml=xml.replace(re,omml);
      }
    } catch(e){console.warn('수식 오류:',latex,e);}
  }

  zip.file('word/document.xml',xml);
  return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

// ════════════════════════════════════════════════════════
// 주석 / 그림 (md 파일 안의 Base64 그림)
//  - <!-- ... --> 주석(한 줄·여러 줄)은 미리보기·PDF·docx 어디에도 나오지 않는다. (AI용 메모를 적어 두는 용도)
//  - 그림은 본문에 ![설명][이름] (또는 ![설명](data:image/...)) 로 쓰고,
//    파일 맨 아래에 [이름]: data:image/jpeg;base64,.... 형태의 참조 정의로 모아 둔다.
//    참조 정의 줄은 화면에 출력하지 않고 imageRefs 에만 모은다.
// ════════════════════════════════════════════════════════
let imageRefs={};   // 참조이름(소문자·공백정리) → data:image/... URL
function normRef(s){return String(s||'').trim().replace(/\s+/g,' ').toLowerCase();}

// 코드 펜스(```) 안은 건드리지 않고 <!-- ... --> 를 제거. 주석만 있는 줄은 줄째 사라진다.
function stripHtmlComments(md){
  const out=[];let inCode=false,inCmt=false;
  for(const raw of md.split('\n')){
    if(!inCmt&&/^\s*```/.test(raw)){inCode=!inCode;out.push(raw);continue;}
    if(inCode){out.push(raw);continue;}
    let kept='',pos=0;
    while(pos<raw.length){
      if(inCmt){
        const e=raw.indexOf('-->',pos);
        if(e<0){pos=raw.length;break;}
        inCmt=false;pos=e+3;
      }else{
        const b=raw.indexOf('<!--',pos);
        if(b<0){kept+=raw.slice(pos);pos=raw.length;break;}
        kept+=raw.slice(pos,b);inCmt=true;pos=b+4;
      }
    }
    if(kept.trim()===''&&(raw.trim()!==''||inCmt))continue; // 주석만 있던 줄 / 주석 안쪽 줄
    out.push(kept);
  }
  return out.join('\n');
}

// "[이름]: data:image/...;base64,..." 정의 줄을 imageRefs 에 모으고 본문에서는 뺀다.
function extractImageRefs(md){
  imageRefs={};
  const out=[];let inCode=false;
  for(const raw of md.split('\n')){
    if(/^\s*```/.test(raw)){inCode=!inCode;out.push(raw);continue;}
    if(!inCode){
      const m=raw.match(/^\s{0,3}\[([^\]]+)\]:\s*<?(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/i);
      if(m){imageRefs[normRef(m[1])]=m[2];continue;}
    }
    out.push(raw);
  }
  return out.join('\n');
}

// 그림만 있는 줄: ![설명][이름]  또는  ![설명](url)  (여러 개 가능)
function isImageLine(t){
  return /^(?:!\[[^\]]*\](?:\([^)]+\)|\[[^\]]*\])\s*)+$/.test((t||'').trim());
}
// 그림 바로 아래 캡션: *그림 1. 설명*  /  _..._  /  그림 1. 설명  /  Figure 1: ...
function isCaptionLine(t){
  t=(t||'').trim();
  if(!t||t.length>200)return false;
  if(/^\*[^*].*\*$/.test(t))return true;
  if(/^_[^_].*_$/.test(t))return true;
  return /^(?:그림|Figure|Fig\.)\s*\d+\s*[.:)]/.test(t);
}

// ════════════════════════════════════════════════════════
// 줄바꿈(soft-wrap) 병합: 사람이 가독성 때문에 문단/불릿 중간에서
// 그냥 줄바꿈만 해둔 경우, 새 블록(헤딩/불릿/표/hr/코드펜스/빈줄)이
// 아니면 이전 줄에 이어붙인다. 코드펜스(```) 내부는 절대 건드리지 않음.
// ════════════════════════════════════════════════════════
function _isBlockStartLine(t){
  if(t==='')return true;
  if(/^```/.test(t))return true;
  if(/^#{1,6}\s/.test(t))return true;
  if(/^[-=]{3,}\s*$/.test(t))return true;
  if(t.startsWith('|'))return true;
  if(/^(?:[-*+](?=\s)|[•◦▪▸◆→])\s*/.test(t))return true;
  if(/^\d+\.\s/.test(t))return true;
  if(/^[가-힣]\.\s/.test(t))return true; // 한글 순번 목록 (가. 나. 다. ...)
  if(/^\$\$/.test(t)||/^\\\[/.test(t)||/^\[\s*$/.test(t))return true; // 블록 수식 시작
  if(/^!\[[^\]]*\](?:\([^)]+\)|\[[^\]]*\])/.test(t))return true; // 그림
  if(/^\[\/\/\]:\s*#\s*\(/.test(t))return true; // 마크다운 주석(링크 참조 정의) 트릭
  if(/^>\s?/.test(t))return true; // 인용구
  return false;
}
// [//]: # (내용) 형태의 "마크다운 주석" 줄. 다른 마크다운 렌더러도 링크 참조 정의로 보고 아무것도 렌더링하지 않으므로
// 여기서도 완전히 무시한다. (이미지 기능을 뺐기 때문에 예전 `[//]: # (![..](img://..))` 줄도 그냥 사라진다.)
function isMdComment(line){
  return /^\s*\[\/\/\]:\s*#(?:\s|$)/.test(line||'');
}
function joinWrappedLines(arr){
  const out=[];
  let inCode=false;
  for(let idx=0;idx<arr.length;idx++){
    const raw=arr[idx];
    const t=raw.trim();
    if(/^```/.test(t)){inCode=!inCode;out.push(raw);continue;}
    if(inCode){out.push(raw);continue;}
    if(t===''){out.push(raw);continue;}
    if(_isBlockStartLine(t)||out.length===0){out.push(raw);continue;}
    const prev=out[out.length-1],prevT=prev.trim();
    const prevIsMergeable=prevT!==''&&!/^```/.test(prevT)&&!/^#{1,6}\s/.test(prevT)&&!/^[-=]{3,}\s*$/.test(prevT)&&!prevT.startsWith('|')&&!isMdComment(prevT)&&!isImageLine(prevT);
    if(prevIsMergeable)out[out.length-1]=prev.replace(/\s+$/,'')+' '+t;
    else out.push(raw);
  }
  return out;
}

// ════════════════════════════════════════════════════════
// 소제목 감지용 헬퍼
// ════════════════════════════════════════════════════════
function isActualListLine(l){
  const t=(l||'').trim();
  if(!t)return false;
  if(/^[-=]{3,}\s*$/.test(t))return false; // 수평선 제외
  return /^[-*+]\s/.test(t)||/^\d+\.\s/.test(t);
}

// 소제목 후보인지 판별: 짧고, 목록/마크다운 기호 아니고, 문장형이 아닌 줄
function isSubtitleCandidate(t, nextLine){
  t=(t||'').trim();
  if(!t||t.length>60)return false;
  // 마크다운 기호로 시작하면 소제목 아님 (번호 목록 항목, 인용구 포함)
  if(/^[-*+#|$>]/.test(t)||/^\d+\.\s/.test(t))return false;
  // 바로 다음 줄이 실제 목록이어야 함
  if(!isActualListLine(nextLine))return false;
  // 문장형 종결 패턴이면 소제목 아님 (본문)
  // 한국어 종결어미: 다, 요, 오, 죠, 까, 음, 함, 됨, 임 + 마침표/느낌표/물음표
  const stripped=t.replace(/\*{1,3}|`/g,'').trim();
  if(/[.!?。]$/.test(stripped))return false;
  if(/[다요오죠까음함됨임네세]\.?$/.test(stripped))return false;
  if(/니다\.?$|세요\.?$|습니다\.?$|됩니다\.?$|합니다\.?$|입니다\.?$|있습니다\.?$/.test(stripped))return false;
  return true;
}

// 블록 수식 델리미터 감지: $$...$$ / \[...\] (단일·여러 줄) / ChatGPT가 종종 출력하는 단독 [ ... ] 줄 형태
// arr: 줄 배열, idx: 시작 인덱스. 매치되면 {latex, nextIdx} 반환, 아니면 null.
function extractBlockMath(arr, idx){
  const line=arr[idx];
  // 한 줄짜리: $$...$$ 또는 \[...\]
  const single=line.match(/^\s*\$\$(.+?)\$\$\s*$/)||line.match(/^\s*\\\[(.+?)\\\]\s*$/);
  if(single)return{latex:single[1].trim(),nextIdx:idx+1};
  // 시작 구분자와 수식이 같은 줄에 있고, 닫는 $$가 다음 줄에 있는 형태
  // 예: $$P_{in}=...  (다음 줄에 $$)
  const prefixed=line.match(/^\s*\$\$\s*(\S[\s\S]*)$/);
  if(prefixed){
    const body=[prefixed[1]];let j=idx+1;
    while(j<arr.length&&!/^\s*\$\$\s*$/.test(arr[j])){body.push(arr[j]);j++;}
    if(j<arr.length)return{latex:body.join('\n').trim(),nextIdx:j+1};
  }
  // 여러 줄 시작: $$ 단독, \[ 단독, 또는 [ 단독
  const openM=line.match(/^\s*(\$\$|\\\[|\[)\s*$/);
  if(openM){
    const opener=openM[1];
    const closer=opener==='$$'?'$$':(opener==='\\['?'\\]':']');
    const closeRe=new RegExp('^\\s*'+closer.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$');
    const body=[];let j=idx+1;
    while(j<arr.length&&!closeRe.test(arr[j])){body.push(arr[j]);j++;}
    if(j<arr.length){
      const latex=body.join('\n').trim();
      if(latex)return{latex,nextIdx:j+1};
    }
  }
  return null;
}

// ChatGPT/클립보드가 수식 구분자를 누락한 경우에도, 수식 명령과 등호를
// 포함하는 단독 줄은 블록 수식으로 안전하게 인식한다. 일반 문장은 제외한다.
function extractBareLatexMath(line){
  const t=(line||'').trim();
  if(!t||/^[$|]|^\\\[|^\\\(/.test(t))return null; // '|'로 시작하는 표 행은 제외
  if(/^(?:>|#{1,6}\s|[-*+]\s|\d+\.\s)/.test(t))return null;   // 인용구·제목·목록 줄은 수식이 아님 ('>' 가 비교 기호로 잡히는 것 방지)
  if(/\$|\\\(/.test(t))return null;                           // 이미 $...$ / \(...\) 로 감싼 수식이 있는 줄은 "구분 기호 빠진 수식"이 아니라 문장
  if(/[가-힣]/.test(t.replace(/\\(?:text|textrm|mathrm|operatorname)\{[^}]*\}/g,'')))return null; // 한글 문장이 섞인 줄은 수식이 아님
  if(!/[=<>≤≥≈]/.test(t))return null;
  if(!/\\(?:frac|sqrt|eta|alpha|beta|gamma|delta|theta|lambda|mu|pi|rho|sigma|phi|omega|sum|int|times|cdot|mathrm|mathbf)\b/.test(t))return null;
  return t;
}

// ════════════════════════════════════════════════════════
// MD 파서
// ════════════════════════════════════════════════════════
function parseMd(md){
  mathQueue.length=0; // 매 변환마다 초기화

  const{Paragraph,TextRun,Table,TableRow,TableCell,
        HeadingLevel,AlignmentType,BorderStyle,WidthType,
        ShadingType,LevelFormat,ExternalHyperlink,UnderlineType,LineRuleType,TabStopType,ImageRun}=docx;
  const CW=9360;
  const cb={style:BorderStyle.SINGLE,size:1,color:'AAAAAA'};
  const cbs={top:cb,bottom:cb,left:cb,right:cb};

  // 인라인 파서: 볼드/이탤릭 내부에 수식이 있어도 정확히 처리
  function parseInlineTokens(text, bold=false, italic=false){
    const tokens=[];let i=0;
    while(i<text.length){
      // \(...\) 인라인 수식
      if(text[i]==='\\'&&text[i+1]==='('){const e=text.indexOf('\\)',i+2);if(e>i){tokens.push({type:'math',latex:text.slice(i+2,e)});i=e+2;continue;}}
      // $...$ 수식
      if(text[i]==='$'&&text[i+1]!=='$'){const e=text.indexOf('$',i+1);if(e>i){tokens.push({type:'math',latex:text.slice(i+1,e)});i=e+1;continue;}}
      // 그림: ![alt](url) / ![alt][이름] / ![이름][]
      if(text[i]==='!'&&text[i+1]==='['){
        const rest=text.slice(i);
        let m=rest.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if(m){tokens.push({type:'image',alt:m[1],ref:'',url:m[2].trim()});i+=m[0].length;continue;}
        m=rest.match(/^!\[([^\]]*)\]\[([^\]]*)\]/);
        if(m){const ref=m[2]||m[1];tokens.push({type:'image',alt:m[1],ref:ref,url:imageRefs[normRef(ref)]||''});i+=m[0].length;continue;}
        tokens.push({type:'text',text:'!',bold,italic});i++;continue; // 그림 문법이 아닌 '!['
      }
      // [text](url) 링크
      if(text[i]==='['){const m=text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);if(m){tokens.push({type:'link',text:m[1],url:m[2]});i+=m[0].length;continue;}else{tokens.push({type:'text',text:'[',bold,italic});i++;continue;}}
      // https:// URL
      if(text.slice(i,i+4)==='http'){const m=text.slice(i).match(/^https?:\/\/[^\s<>"]+/);if(m){tokens.push({type:'link',text:m[0],url:m[0]});i+=m[0].length;continue;}}
      // ***bold+italic***
      if(text.slice(i,i+3)==='***'){const e=text.indexOf('***',i+3);if(e>i){tokens.push(...parseInlineTokens(text.slice(i+3,e),true,true));i=e+3;continue;}}
      // **bold**
      if(text.slice(i,i+2)==='**'){const e=text.indexOf('**',i+2);if(e>i){tokens.push(...parseInlineTokens(text.slice(i+2,e),true,italic));i=e+2;continue;}}
      // *italic*
      if(text[i]==='*'&&text[i+1]!=='*'){const e=text.indexOf('*',i+1);if(e>i&&text[e+1]!=='*'){tokens.push(...parseInlineTokens(text.slice(i+1,e),bold,true));i=e+1;continue;}}
      // `code`
      if(text[i]==='`'){const e=text.indexOf('`',i+1);if(e>i){tokens.push({type:'text',text:text.slice(i+1,e),bold,italic});i=e+1;continue;}}
      // 일반 텍스트 축적
      let j=i;
      while(j<text.length&&!'$[*`'.includes(text[j])&&!(text[j]==='\\'&&text[j+1]==='(')&&!(text[j]==='h'&&text.slice(j,j+4)==='http')&&!(text[j]==='!'&&text[j+1]==='['))j++;
      if(j>i){tokens.push({type:'text',text:text.slice(i,j),bold,italic});i=j;}else i++;
    }
    return tokens;
  }

  function inline(text,opts={}){
    const fs=opts.size||22,baseBold=opts.bold||false,col=opts.color||'1a1917',fnt=opts.font||'HY바탕';
    const tokens=parseInlineTokens(text,baseBold,false);
    const out=[];
    for(const tk of tokens){
      if(tk.type==='math'){
        out.push(new TextRun({text:makeMathMarker(tk.latex.trim(),false),font:'Arial',size:fs}));
      } else if(tk.type==='image'){
        const info=tk.url?docxImgCache[tk.url]:null;
        if(info){
          const{width,height}=fitImg(info.width,info.height);
          out.push(new ImageRun({data:info.data,transformation:{width,height}}));
        } else if(tk.url&&!/^data:image\//i.test(tk.url)){
          out.push(new TextRun({text:'[이미지: '+(tk.alt||tk.url)+']',font:fnt,size:fs,color:'888888'})); // 외부 URL 은 지원하지 않음
        } else {
          out.push(new TextRun({text:'[이미지 없음: '+(tk.ref||tk.alt||'')+']',font:fnt,size:fs,color:'C00000'}));
        }
      } else if(tk.type==='link'){
        out.push(new ExternalHyperlink({link:tk.url,children:[new TextRun({text:tk.text,color:'0563C1',underline:{type:UnderlineType.SINGLE},font:fnt,size:fs,bold:tk.bold||baseBold})]}));
      } else if(tk.type==='text'&&tk.text){
        out.push(new TextRun({text:tk.text,font:fnt,size:fs,bold:tk.bold||baseBold,italics:tk.italic||false,color:col}));
      }
    }
    return out.length?out:[new TextRun({text:''})];
  }

  const hLv={1:HeadingLevel.HEADING_1,2:HeadingLevel.HEADING_2,3:HeadingLevel.HEADING_3,4:HeadingLevel.HEADING_4,5:HeadingLevel.HEADING_5,6:HeadingLevel.HEADING_6};
  const hSz={1:36,2:30,3:26,4:24,5:22,6:22},hCol={1:'1F3864',2:'1F3864',3:'2E5FA3',4:'2E5FA3',5:'2E5FA3',6:'2E5FA3'};
  const hSp={1:{before:360,after:60},2:{before:280,after:40},3:{before:200,after:20},4:{before:160,after:0},5:{before:120,after:0},6:{before:100,after:00}};
  const ch=[];
  const linesRaw=md.replace(/^\uFEFF/,'').replace(/\n{3,}/g,'\n\n').split('\n');
  const lines=joinWrappedLines(linesRaw);
  // 연속 빈 줄 → 최대 1개로 압축
  const linesClean=[];let prevEmpty=false;
  for(const l of lines){const empty=!l.trim();if(empty&&prevEmpty)continue;linesClean.push(l);prevEmpty=empty;}
  const linesF=linesClean;
  let i=0,afterFigure=false;

  while(i<linesF.length){
    if(isMdComment(linesF[i])){i++;continue;}
    const line=linesF[i];

    // 코드블록 ```...``` : 원문 그대로, 고정폭 폰트로 보존 (인라인 서식/헤딩/소제목 감지 등 전혀 적용 안 함)
    if(/^\s*```/.test(line)){
      i++;
      const codeLines=[];
      while(i<linesF.length&&!/^\s*```/.test(linesF[i])){codeLines.push(linesF[i]);i++;}
      if(i<linesF.length)i++; // 닫는 ``` 건너뜀
      for(const cl of codeLines){
        ch.push(new Paragraph({shading:{fill:'F2F1EC',type:ShadingType.CLEAR},children:[new TextRun({text:cl,font:'Consolas',size:18,color:'333333'})],spacing:{after:0}}));
      }
      ch.push(new Paragraph({children:[new TextRun('')],spacing:{after:80}}));
      continue;
    }

    // 그림 줄(그림만 있는 줄): 가운데 정렬, 다음 줄(캡션)과 한 페이지에 머물도록 keepNext
    if(isImageLine(line)){
      ch.push(new Paragraph({alignment:AlignmentType.CENTER,keepNext:true,spacing:{before:120,after:40},children:inline(line.trim())}));
      afterFigure=true;i++;continue;
    }
    // 그림 바로 아래 캡션: 가운데 정렬 (*그림 1. 설명* 의 *는 이탤릭으로 처리됨)
    if(afterFigure&&isCaptionLine(line)){
      ch.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:0,after:160},children:inline(line.trim(),{size:20,color:'444444'})}));
      afterFigure=false;i++;continue;
    }
    if(line.trim()!=='')afterFigure=false; // 그림 다음에 캡션이 아닌 내용이 오면 캡션 대기 해제 (빈 줄은 유지)

    // 헤딩
    const hm=line.match(/^\s*(#{1,6})(?!#)\s+(.+)/);
    if(hm){const lv=hm[1].length;
      const hBorder=(hrAutoMode&&lv===2)?{bottom:{style:BorderStyle.SINGLE,size:6,color:'2E5FA3',space:4}}:undefined;
      ch.push(new Paragraph({heading:hLv[lv],children:inline(hm[2],{bold:true,size:hSz[lv],color:hCol[lv],font:'맑은 고딕'}),spacing:hSp[lv],border:hBorder}));i++;while(i<linesF.length&&!linesF[i].trim())i++;continue;}

    // 수평선 --- 또는 ===
    if(/^[-=]{3,}\s*$/.test(line.trim())){
      if(!hrAutoMode){
        // 원문 충실: 가로줄로 렌더링
        ch.push(new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,size:4,color:'2E5FA3',space:1}},spacing:{before:80,after:80},children:[new TextRun({text:''})]}));
      }
      // H2 자동줄 모드: --- 무시 (skip)
      i++;while(i<linesF.length&&!linesF[i].trim())i++;
      continue;
    }

    // 블록 수식 $$...$$ / \[...\] / [ ... ] (ChatGPT 출력 형태)
    const bmx=extractBlockMath(linesF,i);
    if(bmx){
      const marker=makeMathMarker(bmx.latex,true);
      const lastCh=ch.length?ch[ch.length-1]:null;
      const lastIsEmpty=lastCh&&lastCh.children&&lastCh.children[0]&&lastCh.children[0].text==='';
      if(!lastIsEmpty){ch.push(new Paragraph({spacing:{before:0,after:0},children:[new TextRun({text:''})]}))};
      ch.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:0,after:120},children:[new TextRun({text:marker,font:'Arial',size:22})]}));
      i=bmx.nextIdx;continue;
    }

    // 구분자가 빠진 단독 LaTeX 수식 줄 자동 인식
    const bareMath=extractBareLatexMath(line);
    if(bareMath){
      const marker=makeMathMarker(bareMath,true);
      ch.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:0,after:120},children:[new TextRun({text:marker,font:'Arial',size:22})]}));
      i++;continue;
    }

    // 표
    if(line.trim().startsWith('|')){
      const tl=[];while(i<linesF.length&&linesF[i].trim().startsWith('|')){tl.push(linesF[i]);i++;}
      const rows=tl.filter(l=>!/^\s*\|[\s\-:|]+\|\s*$/.test(l)).map(l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim()));
      if(rows.length){
        const nc=Math.max(...rows.map(r=>r.length)),cw=Math.floor(CW/nc);
        ch.push(new Table({width:{size:CW,type:WidthType.DXA},columnWidths:Array(nc).fill(cw),rows:rows.map((row,ri)=>{
          while(row.length<nc)row.push('');const isH=ri===0;
          return new TableRow({tableHeader:isH,children:row.map(cell=>new TableCell({borders:cbs,width:{size:cw,type:WidthType.DXA},shading:isH?{fill:'DAEEF3',type:ShadingType.CLEAR}:undefined,margins:{top:80,bottom:80,left:120,right:120},children:[new Paragraph({children:inline(cell,{bold:isH,size:20,color:isH?'000000':'222222',font:isH?'맑은 고딕':'HY바탕'})})]}))});
        })}));
        ch.push(new Paragraph({children:[new TextRun('')],spacing:{after:80}}));
      }
      while(i<linesF.length&&!linesF[i].trim())i++;
      continue;
    }

    // 소제목: 짧은 텍스트 줄 + 바로 다음 줄이 목록 + 문장형 아님
    {
      const _t=line.trim(),_nL=linesF[i+1]?linesF[i+1].trim():'';
      if(subtitleDetectMode&&isSubtitleCandidate(_t,_nL)){
        ch.push(new Paragraph({children:[new TextRun({text:_t,bold:true,font:'맑은 고딕',size:22,color:'2E5FA3'})],spacing:{before:160,after:40}}));
        i++;continue;
      }
    }

    // 불릿 (- * + 및 유니코드 •, 다음 줄에 내용이 오는 패턴도 처리)
    const bmPat=/^(\s*)(?:[-*+](?=\s)|[\u2022\u25e6\u25aa\u25b8\u25c6\u2192])\s*(.*)$/;
    const bm=line.match(bmPat);
    if(bm){
      // "* \n내용" 패턴: 내용이 비어있으면 다음 줄을 내용으로 사용
      let bmContent=bm[2]||'';
      if(!bmContent.trim()&&i+1<linesF.length&&lines[i+1].trim()&&!lines[i+1].trim().startsWith('#')){
        // 다음 줄이 소제목 후보(뒤에 목록이 이어짐)면 끌어오지 않음
        const _nl=lines[i+1].trim();
        const _nnl=lines[i+2]?lines[i+2].trim():'';
        const _nextIsSub=isSubtitleCandidate(_nl,_nnl);
        if(!_nextIsSub){i++; bmContent=linesF[i];}
      }
      if(bmContent.trim()){
        ch.push(new Paragraph({numbering:{reference:'bullets',level:Math.floor((bm[1]||'').length/2)},children:inline(bmContent),spacing:{after:(()=>{let j=i+1;while(j<linesF.length&&!linesF[j].trim())j++;return /^[-=]{3,}\s*$/.test((linesF[j]||'').trim())?0:40;})()}}));
      }
      i++;while(i<linesF.length&&!linesF[i].trim())i++;continue;
    }

    // 번호 목록: Word의 자동 번호 매기기는 문서 전체에서 이어지므로(조항이 바뀌어도 리셋 안 됨),
    // 원문에 적힌 번호를 그대로 텍스트로 박아서 항상 원문과 동일하게 표시되게 한다.
    const nm=line.match(/^(\s*)(\d+)\.\s+(.+)/);
    if(nm){
      const nmIndent=720+Math.floor(nm[1].length/2)*360;
      ch.push(new Paragraph({
        indent:{left:nmIndent,hanging:360},
        tabStops:[{type:TabStopType.LEFT,position:nmIndent}],
        children:[new TextRun({text:nm[2]+'.',font:'Arial',size:22}),new TextRun({text:'\t',font:'Arial',size:22}),...inline(nm[3])],
        spacing:{after:(()=>{let j=i+1;while(j<linesF.length&&!linesF[j].trim())j++;return /^[-=]{3,}\s*$/.test((linesF[j]||'').trim())?0:40;})()}
      }));i++;continue;
    }

    // 인용구(> 텍스트): 들여쓰기 + 왼쪽 세로선 + 옅은 배경으로 강조
    const qm=line.match(/^\s*>\s?(.*)/);
    if(qm){
      ch.push(new Paragraph({
        indent:{left:400},
        border:{left:{style:BorderStyle.SINGLE,size:12,color:'2E5FA3',space:8}},
        shading:{fill:'F2F1EC',type:ShadingType.CLEAR},
        spacing:{before:80,after:80},
        children:inline(qm[1])
      }));i++;continue;
    }

    // 빈 줄 → 작은 단락으로 변환
    if(!line.trim()){ch.push(new Paragraph({spacing:{before:0,after:120},children:[new TextRun({text:''})]}));i++;continue;}

    // 일반 텍스트
    // 바로 다음 줄이 목록인 짧은 단독 줄 + 문장형 아님 → 소제목 스타일
    const nextLine=linesF[i+1]?linesF[i+1].trim():'';
    if(subtitleDetectMode&&isSubtitleCandidate(line.trim(),nextLine)){
      ch.push(new Paragraph({children:[new TextRun({text:line.trim(),bold:true,font:'맑은 고딕',size:22,color:'2E5FA3'})],spacing:{before:160,after:40}}));
    }else{
      ch.push(new Paragraph({children:inline(line),spacing:{after:40,line:312,lineRule:LineRuleType.AUTO}}));
    }
    i++;
  }
  return ch;
}

// ════════════════════════════════════════════════════════
// 변환 & 다운로드
// ════════════════════════════════════════════════════════
  function mdToHtml(md){
    md = md.replace(/\[cite[^\]]*\]/gi, '');
    const linesRaw=md.replace(/﻿/,'').replace(/\n{3,}/g,'\n\n').split('\n');
    const lines=joinWrappedLines(linesRaw);
    let html='',i=0,afterFigure=false;
    while(i<lines.length){
      if(isMdComment(lines[i])){i++;continue;}
      const line=lines[i];
      // 코드블록 ```...``` : 원문 그대로, 고정폭 폰트로 보존
      if(/^\s*```/.test(line)){
        i++;
        const codeLines=[];
        while(i<lines.length&&!/^\s*```/.test(lines[i])){codeLines.push(lines[i]);i++;}
        if(i<lines.length)i++; // 닫는 ``` 건너뜀
        html+=`<pre style="background:#f2f1ec;border:1px solid #ddd;padding:8pt 10pt;font-family:'IBM Plex Mono',Consolas,monospace;font-size:8pt;white-space:pre;overflow:hidden;line-height:1.4;margin:6pt 0">${codeLines.map(_esc).join('\n')}</pre>`;
        continue;
      }
      // 그림 줄 / 그림 바로 아래 캡션: 가운데 정렬 (인쇄 시 그림과 캡션이 갈라지지 않게)
      if(isImageLine(line)){
        html+=`<p style="text-align:center;margin:8pt 0 2pt;page-break-inside:avoid;break-after:avoid">${inlineHtml(line.trim())}</p>`;
        afterFigure=true;i++;continue;
      }
      if(afterFigure&&isCaptionLine(line)){
        html+=`<p style="text-align:center;font-size:9.5pt;color:#444;margin:2pt 0 8pt">${inlineHtml(line.trim())}</p>`;
        afterFigure=false;i++;continue;
      }
      if(line.trim()!=='')afterFigure=false;
      const hm=line.match(/^\s*(#{1,6})(?!#)\s+(.+)/);
      if(hm){
        const lv=hm[1].length;
        const hStyle=(hrAutoMode&&lv===2)?'border-bottom:0.7px solid #2E5FA3;padding-bottom:3px;':'';
        html+=`<h${lv} style="${hStyle}">${inlineHtml(hm[2])}</h${lv}>`;i++;continue;
      }
      if(line.trim().startsWith('|')){
        const tl=[];while(i<lines.length&&lines[i].trim().startsWith('|')){tl.push(lines[i]);i++;}
        const rows=tl.filter(l=>!/^\s*\|[\s\-:|]+\|\s*$/.test(l)).map(l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim()));
        if(rows.length){html+='<table>';rows.forEach((row,ri)=>{html+='<tr>';row.forEach(cell=>html+=ri===0?`<th>${inlineHtml(cell)}</th>`:`<td>${inlineHtml(cell)}</td>`);html+='</tr>';});html+='</table>';}
        continue;
      }
      // 수평선 --- 또는 ===
      if(/^[-=]{3,}\s*$/.test(line.trim())){
        if(!hrAutoMode) html+='<hr style="border:none;border-top:0.7px solid #2E5FA3;margin:8pt 0">';
        i++;while(i<lines.length&&!lines[i].trim())i++;
        continue;
      }
      // 소제목 체크 — 짧고 문장형 아닌 줄 + 바로 다음 줄이 목록
      {const _t=line.trim(),_nL=lines[i+1]?lines[i+1].trim():'';
      if(subtitleDetectMode&&isSubtitleCandidate(_t,_nL)){html+=`<p style="font-weight:bold;color:#2E5FA3;font-family:'맑은 고딕',sans-serif;margin:8pt 0 2pt">${inlineHtml(_t)}</p>`;i++;continue;}}
      const bm=line.match(/^(\s*)(?:[-*+](?=\s)|[\u2022\u25e6])\s*(.*)/);
      if(bm){let c=bm[2]||'';
        if(!c.trim()&&i+1<lines.length&&lines[i+1].trim()){
          const _nl=lines[i+1].trim(),_nnl=lines[i+2]?lines[i+2].trim():'';
          const _isSub=isSubtitleCandidate(_nl,_nnl);
          if(!_isSub){i++;c=lines[i];}
        }
        // 하위 불릿: 원문 들여쓰기 2칸마다 한 단계씩 안쪽으로 (docx 쪽 level 처리와 동일한 기준)
        if(c.trim()){const lv=Math.floor((bm[1]||'').length/2);html+=`<ul style="margin-left:${18+lv*16}pt${lv?';list-style-type:circle':''}"><li>${inlineHtml(c)}</li></ul>`;}
        i++;continue;}
            // 번호 목록
      const nm=line.match(/^(\s*)(\d+)\.\s+(.+)/);
      if(nm){html+=`<ol start="${nm[2]}" style="margin:3pt 0 3pt 20pt"><li style="margin:2pt 0">${inlineHtml(nm[3])}</li></ol>`;i++;continue;}
      // 블록 수식 $$...$$ / \[...\] / [ ... ] (ChatGPT 출력 형태)
      const bmx=extractBlockMath(lines,i);
      if(bmx){html+=`<p style="text-align:center">$$${_esc(bmx.latex)}$$</p>`;i=bmx.nextIdx;continue;}
      // 구분자가 빠진 단독 LaTeX 수식 줄 (docx 쪽 parseMd 와 동일하게 인식)
      const bareMath=extractBareLatexMath(line);
      if(bareMath){html+=`<p style="text-align:center">$$${_esc(bareMath)}$$</p>`;i++;continue;}
      // 인용구(> 텍스트)
      const qm=line.match(/^\s*>\s?(.*)/);
      if(qm){html+=`<blockquote style="margin:6pt 0;padding:4pt 10pt;border-left:3px solid #2E5FA3;background:#F2F1EC">${inlineHtml(qm[1])}</blockquote>`;i++;continue;}
      if(!line.trim()){i++;continue;}
      html+=`<p>${inlineHtml(line)}</p>`;i++;
    }
    return html;
  }
  // data: 그림은 <img> 로, 참조 이름을 못 찾았거나 외부 URL 이면 자리 표시 텍스트로 (alt 는 이미 이스케이프된 상태)
  function imgHtml(alt,url,ref){
    if(/^data:image\//i.test(url))return `<img src="${url}" alt="${alt}" style="max-width:100%;height:auto">`;
    if(url)return `<span class="img-ph">[이미지: ${alt||url}]</span>`;
    return `<span class="img-ph" style="color:#C00000">[이미지 없음: ${ref||alt}]</span>`;
  }
  function inlineHtml(t){
    // 확장 프로그램 페이지에서 파일 내용을 그대로 HTML 로 넣지 않도록 특수문자를 먼저 이스케이프하고,
    // 표 셀 줄바꿈 등에 흔히 쓰이는 안전한 태그(<br>, <sub>, <sup>, <b>, <i>, <u>, <strong>, <em>)만 다시 허용한다.
    t=_esc(t).replace(/&lt;br\s*\/?&gt;/gi,'<br>').replace(/&lt;(\/?)(sub|sup|b|i|u|strong|em)&gt;/gi,'<$1$2>');
    return t.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,function(_,alt,url){return imgHtml(alt,url.trim(),'');})
      .replace(/!\[([^\]]*)\]\[([^\]]*)\]/g,function(_,alt,ref){ref=ref||alt;return imgHtml(alt,imageRefs[normRef(ref)]||'',ref);})
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,function(_,txt,url){
        url=url.trim().replace(/"/g,'%22');
        if(/^javascript:/i.test(url))url='#';
        return `<a href="${url}">${txt}</a>`;
      }).replace(/`([^`]+)`/g,'<code>$1</code>');
  }

// ════════════════════════════════════════════════════════
// 파일 내용 정리 / .docx 생성 (원본 convert() 에서 화면(UI) 부분만 뺀 것)
// ════════════════════════════════════════════════════════
function cleanMdBase(raw){return String(raw||'').replace(/^﻿/,'').replace(/\[cite[^\]]*\]/gi,'');}
// BOM·[cite] 제거 → <!-- --> 주석 제거 → 그림 참조 정의 추출(imageRefs 갱신, 정의 줄은 본문에서 제거)
function cleanMd(raw){return extractImageRefs(stripHtmlComments(cleanMdBase(raw)));}
function getPdfName(md){return getFilename(md).replace(/\.docx$/i,'.pdf');}

// ── AI 에게 알려줄 설명글 ──
// AI 대화창(ChatGPT, Claude 등)에 붙여넣는 설명글. 이 .md 파일의 본문·그림 구성을 AI 가 이해하게 한다. (.md 파일에는 넣지 않는다)
// 문구를 바꾸려면 이 상수만 고치면 된다. 안내창의 표시와 복사에 같이 반영된다. (백틱·${ 는 쓸 수 없고, 역슬래시는 두 번 써야 한다)
const AI_INSTRUCTION_BLOCK=`[이 마크다운 파일의 구성 설명]
지금부터 내가 올리는 마크다운(.md) 파일은 전용 뷰어에서 A4 용지 모양으로 보고, PDF나 Word로 저장하는 문서야.
아래는 이 파일이 어떻게 구성되어 있는지에 대한 설명이야. 파일을 읽거나 고칠 때 이 구성을 그대로 이해하고 유지해 줘.

1. 본문의 구성
   - 일반 마크다운이야. 제목(#, ##, ###), 목록(-, 1.), 표(|), 인용구(>), 굵은 글씨(**)를 써.
   - 수식은 LaTeX(라텍스) 형식이야. 문장 안에서는 $...$ 또는 \\(...\\), 독립된 줄에서는 $$...$$ 또는 \\[...\\] 로 써.
   - <!-- ... --> 로 감싼 주석은 화면·PDF·Word에 나오지 않아.

2. 그림의 구성
   그림 한 장은 세 부분으로 이루어져 있고, 서로 "이름"으로 연결돼.

   (가) 본문의 그림 자리
       그림이 들어갈 곳에 그림만 있는 한 줄로 적어.
           ![LLC 공진 파형][회로도1]
       앞 대괄호는 그림 설명, 뒤 대괄호(회로도1)는 연결 이름이야.

   (나) 그림 바로 아랫줄의 캡션
       그림 줄 바로 다음 줄에 기울임 문장으로 적고, 가운데 정렬되어 표시돼.
           *그림 1. LLC 공진 파형*
       번호는 본문에 나오는 순서대로 1, 2, 3 ... 이고, 본문에서 "그림 1"을 언급한 문장도 같은 번호를 써.

   (다) 파일 맨 아래의 그림 데이터
       실제 그림은 파일 맨 아래에 Base64 문자열로 모아 둬. 구역의 시작 표시 주석 밑에 그림마다 한 줄씩 있어.
           <!-- [그림 데이터] 아래에 참조 정의만 둘 것 -->
           [회로도1]: data:image/jpeg;base64,/9j/4AAQ....
       - 대괄호 안의 이름이 (가)의 두 번째 대괄호와 같아야 연결돼. (대소문자·공백 차이는 무시)
       - 그림 하나가 반드시 한 줄이야. 수만 글자로 매우 길고, 줄바꿈이 섞이면 그림이 표시되지 않아.
       - 그림은 가로 1000px 이하의 JPG(품질 85)로 줄여서 넣어.
       - 이름이 연결되지 않으면 뷰어에 [이미지 없음: 이름] 이라고 표시돼.

3. 이 구성에서 그림 작업이 의미하는 것
   - 그림 추가: (가)와 (나)를 지정한 제목 바로 아래에 넣고, (다)를 맨 아래에 추가해. 연결 이름은 내용을 알 수 있게 붙이고(예: 회로도1, 파형_LLC) 이미 쓴 이름과 겹치지 않게 해.
   - 그림 교체: (다)의 데이터만 바꿔. 특별한 말이 없으면 (가)와 (나)는 그대로야.
   - 그림 삭제: (가), (나), (다) 세 부분을 함께 지워.
   - 그림이 추가·삭제·이동되면 본문 순서에 맞게 모든 그림 번호와 본문 속 "그림 N" 언급을 다시 맞춰.

4. 작업할 때 알아둘 점
   - 그림을 줄이고 Base64로 바꾸려면 코드 실행 도구(Python 등)로 실제로 처리해 줘. 코드를 실행할 수 없으면 Base64 값을 지어내지 말고 할 수 없다고 알려 줘.
   - 그림 작업과 상관없는 본문은 건드리지 말고, 기존 그림 데이터 줄은 한 글자도 바꾸지 마.
   - 작업이 끝나면 수정된 .md 전체를 돌려줘. 가능하면 다운로드 파일로, 채팅창에 줄 때는 일부를 생략하지 마.

이 구성을 이해했으면 "이해했습니다"라고만 답하고, 내가 파일과 요청을 줄 때까지 기다려 줘.`;

// ── docx 용 그림 준비 ──
// docx 8.5.0 의 ImageRun 은 데이터를 항상 .png 로 취급하므로, PNG 가 아닌 그림(JPEG/GIF/WebP 등)은 PNG 로 변환해서 넣는다.
let docxImgCache={};   // data URL → {data:Uint8Array, width, height}
function fitImg(w,h){  // 페이지 본문 폭(약 600px)과 높이(약 820px) 안으로 비율 유지 축소
  if(!w||!h)return{width:300,height:200};
  const s=Math.min(1,600/w,820/h);
  return{width:Math.round(w*s),height:Math.round(h*s)};
}
function b64ToBytes(b64){
  const bin=atob(b64),bytes=new Uint8Array(bin.length);
  for(let k=0;k<bin.length;k++)bytes[k]=bin.charCodeAt(k);
  return bytes;
}
async function loadImgInfo(url){
  const m=url.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+\/=]+)$/i);
  if(!m)return null;
  let mime=m[1].toLowerCase(),bytes=b64ToBytes(m[2]);
  const bmp=await createImageBitmap(new Blob([bytes],{type:mime}));
  const w=bmp.width,h=bmp.height;
  if(mime!=='image/png'){
    const sc=Math.min(1,1200/w);                       // 변환본이 너무 커지지 않도록 가로 1200px 까지만
    const cv=document.createElement('canvas');
    cv.width=Math.max(1,Math.round(w*sc));cv.height=Math.max(1,Math.round(h*sc));
    const cx=cv.getContext('2d');
    cx.fillStyle='#fff';cx.fillRect(0,0,cv.width,cv.height); // 투명 배경은 흰색으로
    cx.drawImage(bmp,0,0,cv.width,cv.height);
    const png=await new Promise(function(res){cv.toBlob(res,'image/png');});
    bytes=new Uint8Array(await png.arrayBuffer());
  }
  if(bmp.close)bmp.close();
  return{data:bytes,width:w,height:h};
}
async function prepareDocxImages(md){
  docxImgCache={};
  const urls=new Set(Object.keys(imageRefs).map(function(k){return imageRefs[k];}));
  const re=/!\[[^\]]*\]\((data:image\/[^)\s]+)\)/g;let m;
  while((m=re.exec(md)))urls.add(m[1]);
  for(const u of urls){
    try{const info=await loadImgInfo(u);if(info)docxImgCache[u]=info;}
    catch(e){console.warn('그림을 읽을 수 없습니다:',e);}
  }
}

// baseName 이 주어지면(.md 파일 이름 기준) "<baseName>.docx" 로, 없으면 문서 첫 제목으로 파일명을 정한다.
async function buildDocx(rawMd,baseName){
  if(typeof docx==='undefined')throw new Error('docx 라이브러리를 불러오지 못했습니다.');
  const md=cleanMd(rawMd);
  if(!md.trim())throw new Error('내용이 비어 있습니다.');
  await prepareDocxImages(md);
  const{Document,Packer,LevelFormat,AlignmentType,UnderlineType}=docx;
  const doc2=new Document({
    numbering:{config:[
      {reference:'bullets',levels:[
        {level:0,format:LevelFormat.BULLET,text:'•',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:720,hanging:360}},run:{font:'Arial',size:22}}},
        {level:1,format:LevelFormat.BULLET,text:'◦',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:1080,hanging:360}},run:{font:'Arial',size:22}}},
      ]},
    ]},
    styles:{
      default:{document:{run:{font:'Arial',size:22}}},
      paragraphStyles:[
        {id:'Heading1',name:'Heading 1',basedOn:'Normal',next:'Normal',run:{size:36,bold:true,font:'Arial',color:'111111'},paragraph:{spacing:{before:160,after:180},outlineLevel:0,keepWithNext:false}},
        {id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',run:{size:30,bold:true,font:'Arial',color:'222222'},paragraph:{spacing:{before:120,after:150},outlineLevel:1,keepWithNext:false}},
        {id:'Heading3',name:'Heading 3',basedOn:'Normal',next:'Normal',run:{size:26,bold:true,font:'Arial',color:'333333'},paragraph:{spacing:{before:80,after:120},outlineLevel:2,keepWithNext:false}},
        {id:'Heading4',name:'Heading 4',basedOn:'Normal',next:'Normal',run:{size:24,bold:true,font:'Arial',color:'444444'},paragraph:{spacing:{before:60,after:100},outlineLevel:3,keepWithNext:false}},
        {id:'Heading5',name:'Heading 5',basedOn:'Normal',next:'Normal',run:{size:22,bold:true,font:'Arial',color:'555555'},paragraph:{spacing:{before:40,after:80},outlineLevel:4,keepWithNext:false}},
        {id:'Heading6',name:'Heading 6',basedOn:'Normal',next:'Normal',run:{size:22,bold:false,font:'Arial',color:'666666'},paragraph:{spacing:{before:20,after:60},outlineLevel:5,keepWithNext:false}},
        {id:'Hyperlink',name:'Hyperlink',basedOn:'Normal',run:{color:'0563C1',underline:{type:UnderlineType.SINGLE}}},
      ]
    },
    sections:[{properties:{page:{size:{width:12240,height:15840},margin:{top:1440,right:1440,bottom:1440,left:1440}}},children:parseMd(md)}]
  });
  let blob=await Packer.toBlob(doc2);
  if(mathQueue.length>0)blob=await patchMathInBlob(blob);
  return{blob,filename:baseName?baseName+'.docx':getFilename(md)};
}

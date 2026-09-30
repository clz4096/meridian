import{T as f,d as g,h as w,u as e}from"./index-CIVtPabV.js";const U=`/*
 * Meridian design tokens. The one place a raw color, size, or duration may appear.
 *
 * Direction: a researcher's instrument (Swiss grid, hairlines, tabular figures,
 * small-caps labels) lit by a warm, diffuse palette (cream, coral, salmon, peach, sand).
 *
 * Variant A is the default on :root. Variant B overrides colors only, under
 * :root[data-palette="b"]. scripts/contrast.mjs parses this file, so keep every color
 * an opaque hex or a var() alias, and add any new text pair to scripts/contrastCore.mjs.
 * Why A won: design/palette-decision.md.
 */

/* Fonts: Adobe Source Sans 3 + Source Code Pro, variable weight, latin subset, OFL.
   One file per family covers every weight we use, which is smaller than three statics. */
@font-face {
  font-family: 'Source Sans 3';
  font-style: normal;
  font-display: swap;
  font-weight: 200 900;
  src: url('../assets/fonts/source-sans-3-latin-wght.woff2') format('woff2-variations'),
    url('../assets/fonts/source-sans-3-latin-wght.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
/* Metric-matched stand-in for Source Sans 3 while the web font loads (font-display:
   swap). Arial scaled to Source Sans 3's advance widths and vertical metrics, so a
   line that fits in the fallback still fits after the swap and nothing reflows (the
   "Today's studies" heading wrapped, then un-wrapped, on slow networks). Measured in
   Chrome: Source Sans 3 ascent 1.02 em, descent 0.40 em, no line gap; average advance
   0.925 of Arial at 400 and 0.889 of Arial Bold at 600 (headings and labels). Same
   unicode-range as the web font, so symbols outside it still come from the system font. */
@font-face {
  font-family: 'Source Sans 3 Fallback';
  font-style: normal;
  font-weight: 200 500;
  src: local('Arial'), local('ArialMT'), local('Helvetica');
  size-adjust: 92.5%;
  ascent-override: 110.3%;
  descent-override: 43.2%;
  line-gap-override: 0%;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Source Sans 3 Fallback';
  font-style: normal;
  font-weight: 600 900;
  src: local('Arial Bold'), local('Arial-BoldMT'), local('Helvetica Bold'), local('Helvetica-Bold');
  size-adjust: 88.9%;
  ascent-override: 114.7%;
  descent-override: 45%;
  line-gap-override: 0%;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Source Code Pro';
  font-style: normal;
  font-display: swap;
  font-weight: 200 900;
  src: url('../assets/fonts/source-code-pro-latin-wght.woff2') format('woff2-variations'),
    url('../assets/fonts/source-code-pro-latin-wght.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}


/* The type scale is in rem, so the root size must be the browser default (16px, or the
   reader's own setting). The old app.css sets html to 15px, which shrank every token by
   1/16 and put body text under the 16px floor; this file loads after it and wins. */
html {
  font-size: 100%;
}

:root {
  color-scheme: light;

  /* ---------- color: variant A, "Cream and Coral" ---------- */
  --bg: #FAF6F0;            /* warm cream page */
  --surface: #FFFDFA;       /* cards: lifted by a hairline and a soft shadow, not by tint */
  --surface-2: #F3ECE2;     /* inset wells, table stripes, pressed quiet buttons */
  --ink: #2A211C;           /* warm near-black; pure black is harsh on cream */
  --ink-2: #584A40;         /* secondary text */
  --ink-3: #6F6054;         /* faint meta; still 4.5:1 on every surface */
  --rule: #E7DDD0;          /* hairline dividers; decorative, so no contrast floor */
  --rule-strong: #948272;   /* control borders that must be seen (3:1, also on --surface-2) */
  --track: #EDE3D6;         /* progress track */
  --accent: #C8432E;        /* coral red: primary fills, progress fill */
  --accent-2: #EE9A82;      /* salmon: decorative fills only, never text */
  --accent-ink: #B03A26;    /* coral as text on light surfaces */
  --on-accent: #FFFFFF;     /* label on --accent */
  --accent-wash: #FBE9E2;   /* selected row, today marker */
  --peach: #F9DCC8;         /* chip fill */
  --sand: #E9DAC4;          /* tag fill, wood-toned neutral */
  --ok: #2F6B3E;
  --warn: #8A5300;
  --danger: #A3123A;        /* crimson, pulled toward blue so it never reads as the coral accent */
  --focus: #2C5A8C;         /* the one cool hue: focus must not look like a brand accent */
  /* Data series, in order of use. Tuned for 3:1 on the page and for separation under
     simulated deuteranopia and protanopia (see design/contrast.md). */
  --series-1: #C8432E;      /* coral */
  --series-2: #1D6F78;      /* teal */
  --series-3: #B58100;      /* ochre, kept light so it separates from coral by lightness */
  --series-4: #3D4FA0;      /* indigo */
  --series-5: #4A3B32;      /* walnut */
  --shadow-rgb: 74 48 32;   /* warm brown shadow; grey shadows look dirty on cream */

  /* ---------- type ---------- */
  --font-sans: 'Source Sans 3', 'Source Sans 3 Fallback', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'Source Code Pro', ui-monospace, SFMono-Regular, Menlo, monospace;
  /* Seven steps. Source Sans has a small x-height, so body is 17px to read like 16px
     in most sans faces; nothing a user must read is under 14px. */
  --fs-1: 0.875rem;  --lh-1: 1.45;  /* 14px meta, units */
  --fs-2: 1rem;      --lh-2: 1.5;   /* 16px labels, dense rows */
  --fs-3: 1.0625rem; --lh-3: 1.55;  /* 17px body */
  --fs-4: 1.25rem;   --lh-4: 1.4;   /* 20px card titles */
  --fs-5: 1.5rem;    --lh-5: 1.3;   /* 24px section titles */
  --fs-6: 2rem;      --lh-6: 1.2;   /* 32px page titles */
  --fs-7: 2.75rem;   --lh-7: 1.05;  /* 44px display numbers */
  --fs-body: var(--fs-3);
  --fs-label: var(--fs-2);
  --fw-regular: 400;
  --fw-medium: 500;
  --fw-semibold: 600;
  --fw-bold: 700;
  --ls-caps: 0.06em;    /* small caps need air to stay legible */
  --ls-tight: -0.015em; /* display sizes */

  /* ---------- space: 4px base ---------- */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;
  --sp-7: 48px;
  --sp-8: 64px;

  /* ---------- radius ---------- */
  --r-1: 4px;
  --r-2: 8px;
  --r-3: 12px;
  --r-4: 16px;
  --r-pill: 999px;

  /* ---------- shadow: soft, diffuse, low alpha ---------- */
  --shadow-1: 0 1px 2px rgb(var(--shadow-rgb) / 0.06), 0 4px 14px rgb(var(--shadow-rgb) / 0.05);
  --shadow-2: 0 2px 4px rgb(var(--shadow-rgb) / 0.06), 0 12px 32px rgb(var(--shadow-rgb) / 0.08);
  --shadow-3: 0 4px 10px rgb(var(--shadow-rgb) / 0.08), 0 24px 56px rgb(var(--shadow-rgb) / 0.12);

  /* ---------- motion: calm, short ---------- */
  --dur-1: 120ms;  /* press, hover */
  --dur-2: 200ms;  /* small state changes */
  --dur-3: 320ms;  /* panels, reveals */
  --dur-4: 1400ms; /* skeleton shimmer period */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0, 0, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --ease-calm: cubic-bezier(0.33, 0, 0.15, 1);

  /* ---------- layout ---------- */
  --content-max: 44rem;               /* about 70 characters of body text */
  --measure: 66ch;
  --gutter: clamp(16px, 5vw, 32px);
  --tap: 44px;                        /* minimum touch target */
  --hairline: 1px;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --pad-left: max(var(--gutter), var(--safe-left));
  --pad-right: max(var(--gutter), var(--safe-right));

  /* ---------- z-index ---------- */
  --z-base: 0;
  --z-raised: 10;
  --z-sticky: 30;
  --z-overlay: 50;
  --z-toast: 60;
  --z-modal: 70;
}

/* ---------- color: variant B, "Ember" (peach field, plum series) ---------- */
:root[data-palette="b"] {
  --bg: #FBEEE4;
  --surface: #FFF8F2;
  --surface-2: #F5E3D5;
  --ink: #2E1F18;
  --ink-2: #5C4336;
  --ink-3: #6E5446;
  --rule: #EBD6C6;
  --rule-strong: #98786A;
  --track: #F1DCCB;
  --accent: #D2452B;
  --accent-2: #F19A7C;
  --accent-ink: #AE3219;
  --on-accent: #FFFFFF;
  --accent-wash: #FADCCF;
  --peach: #F7CDB2;
  --sand: #E6CFB3;
  --ok: #2E6A3A;
  --warn: #8A4E00;
  --danger: #9E1030;
  --focus: #27588F;
  --series-1: #C8432E;
  --series-2: #1D6F78;
  --series-3: #A88400;
  --series-4: #3D4FA0;
  --series-5: #8A4F8A;
  --shadow-rgb: 92 48 28;
}

/* Reduced motion: keep state changes, drop the travel. A near-zero duration (not 0)
   still fires transitionend, which some components wait on. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-1: 0.01ms;
    --dur-2: 0.01ms;
    --dur-3: 0.01ms;
  }
}
`,S=s=>s.replace(/\/\*[\s\S]*?\*\//g,"");function A(s){const t=[];let a=0;for(;a<s.length;){const r=s.indexOf("{",a);if(r<0)break;const l=s.slice(a,r).trim();let c=1,n=r+1;for(;n<s.length&&c>0;)s[n]==="{"?c++:s[n]==="}"&&c--,n++;l.startsWith("@")||t.push({selector:l,body:s.slice(r+1,n-1)}),a=n}return t}function y(s){const t={};for(const a of s.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g))t[a[1]]=a[2].trim();return t}function C(s){const t=A(S(s)),a={},r={};for(const{selector:l,body:c}of t){const n=l.replace(/\s+/g,"").replace(/'/g,'"');n===":root"?Object.assign(a,y(c)):n===':root[data-palette="b"]'&&Object.assign(r,y(c))}return{a,b:{...a,...r}}}function m(s,t,a=new Set){if(a.has(t))throw new Error(`token cycle at ${t}`);a.add(t);const r=s[t];if(r===void 0)throw new Error(`missing token ${t}`);const l=r.match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/);return l?m(s,l[1],a):r}function E(s){const t=s.trim().replace(/^#/,"");if(!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t))throw new Error(`not an opaque hex color: ${s}`);const a=t.length===3?[...t].map(r=>r+r).join(""):t;return[0,2,4].map(r=>parseInt(a.slice(r,r+2),16))}const D=s=>{const t=s/255;return t<=.04045?t/12.92:((t+.055)/1.055)**2.4};function v(s){const[t,a,r]=E(s).map(D);return .2126*t+.7152*a+.0722*r}function F(s,t){const a=v(s),r=v(t);return(Math.max(a,r)+.05)/(Math.min(a,r)+.05)}const i=4.5,d=3,p=["--bg","--surface","--surface-2"],o=(s,t,a,r)=>t.map(l=>({fg:s,bg:l,min:a,use:r})),B=[...o("--ink",p,i,"body text"),...o("--ink-2",p,i,"secondary text"),...o("--ink-3",p,i,"faint meta text, captions"),...o("--accent-ink",p,i,"links, accent labels"),...o("--ok",["--bg","--surface"],i,"success text"),...o("--warn",["--bg","--surface"],i,"warning text"),...o("--danger",["--bg","--surface"],i,"error text"),{fg:"--on-accent",bg:"--accent",min:i,use:"primary button label"},{fg:"--ink",bg:"--peach",min:i,use:"chip label"},{fg:"--ink-2",bg:"--peach",min:i,use:"chip meta"},{fg:"--ink",bg:"--sand",min:i,use:"tag label"},{fg:"--ink",bg:"--accent-wash",min:i,use:"selected row text"},{fg:"--accent-ink",bg:"--accent-wash",min:i,use:"selected row accent"},{fg:"--ink-3",bg:"--accent-wash",min:i,use:"selected row meta"},{fg:"--on-accent",bg:"--accent-ink",min:i,use:"primary button label, hover"},{fg:"--on-accent",bg:"--ok",min:i,use:"banked button label, done step number"},{fg:"--on-accent",bg:"--danger",min:i,use:"teach badge label"},...o("--series-2",["--bg","--surface"],i,"mastered level word"),{fg:"--bg",bg:"--ink",min:i,use:"intro wordmark, Enter label"},{fg:"--rule",bg:"--ink",min:i,use:"intro tagline and hint"},{fg:"--accent-2",bg:"--ink",min:i,use:"intro wordmark accent, Enter hover"},{fg:"--sand",bg:"--ink",min:d,use:"intro Enter border"},{fg:"--accent-2",bg:"--ink",min:d,use:"intro focus ring"},...o("--focus",p,d,"focus ring"),...o("--accent",["--bg","--surface"],d,"primary button edge, progress fill"),{fg:"--accent",bg:"--track",min:d,use:"progress fill vs track"},...o("--rule-strong",["--bg","--surface","--surface-2"],d,"control borders"),...["--series-1","--series-2","--series-3","--series-4","--series-5"].flatMap(s=>o(s,["--bg","--surface"],d,"chart series"))];function T(s,t=B){return t.map(a=>{const r=m(s,a.fg),l=m(s,a.bg),c=F(r,l);return{...a,fgHex:r,bgHex:l,ratio:c,pass:c>=a.min}})}const k={a:"A · Cream and Coral",b:"B · Ember"},$=[{title:"Surfaces",tokens:["--bg","--surface","--surface-2"]},{title:"Ink",tokens:["--ink","--ink-2","--ink-3"]},{title:"Accent",tokens:["--accent","--accent-2","--accent-ink","--on-accent","--accent-wash"]},{title:"Neutrals",tokens:["--peach","--sand","--rule","--rule-strong","--track"]},{title:"State",tokens:["--ok","--warn","--danger","--focus"]},{title:"Data series",tokens:["--series-1","--series-2","--series-3","--series-4","--series-5"]}],M=[{step:7,use:"Display numbers",sample:"64°"},{step:6,use:"Page title",sample:"Today"},{step:5,use:"Section title",sample:"Today's studies"},{step:4,use:"Card title",sample:"Applied Probability & Statistics"},{step:3,use:"Body",sample:"A hypothesis test asks how surprising the data would be if nothing were going on."},{step:2,use:"Labels, dense rows",sample:"Finish practice test 2"},{step:1,use:"Meta, units",sample:"Updated 8:14 AM · 0.12 in"}],P=[1,2,3,4,5,6,7,8],z=["--r-1","--r-2","--r-3","--r-4","--r-pill"],R=["--shadow-1","--shadow-2","--shadow-3"],W=["--ease-standard","--ease-enter","--ease-exit","--ease-calm"],x=s=>`${s.toFixed(2)}:1`;function O(s){s==="a"?delete document.documentElement.dataset.palette:document.documentElement.dataset.palette=s}function V(){const s=f(()=>C(U),[]),[t,a]=g(()=>document.documentElement.dataset.palette==="b"?"b":"a"),r=s[t],l=f(()=>T(r),[r]),c=m(r,"--bg");return w(()=>{O(t)},[t]),w(()=>{const n=document.documentElement.dataset.palette;return()=>{n===void 0?delete document.documentElement.dataset.palette:document.documentElement.dataset.palette=n}},[]),e("div",{class:"sg-root",children:[e("header",{class:"sg-head",children:[e("p",{class:"m-label",children:"Meridian · design system"}),e("h1",{class:"sg-h1",children:"Styleguide"}),e("div",{class:"sg-toggle",role:"group","aria-label":"Palette variant",children:["a","b"].map(n=>e("button",{type:"button",class:"m-chip","aria-pressed":t===n,onClick:()=>a(n),children:k[n]},n))}),e("p",{class:"sg-note",children:["Variant A is the default. Why: ",e("span",{class:"m-mono",children:"design/palette-decision.md"}),"."]})]}),e(h,{label:"Direction",title:"Today, in the new system",children:e("div",{class:"sg-direction",children:[e(H,{}),e(N,{})]})}),e(h,{label:"Color",title:`Palette ${k[t]}`,children:[$.map(n=>e("div",{class:"sg-swatch-group",children:[e("h3",{class:"m-label",children:n.title}),e("ul",{class:"sg-swatches",children:n.tokens.map(u=>{const b=m(r,u);return e("li",{class:"sg-swatch",children:[e("span",{class:"sg-chip",style:{background:`var(${u})`},"aria-hidden":"true"}),e("span",{class:"m-mono sg-token",children:u}),e("span",{class:"m-mono sg-hex",children:b}),e("span",{class:"m-num sg-ratio",children:[x(F(b,c))," on bg"]})]},u)})})]},n.title)),e("h3",{class:"m-label sg-sub",children:"Every allowed pair"}),e("div",{class:"sg-table-wrap",children:e("table",{class:"sg-table m-num",children:[e("thead",{children:e("tr",{children:[e("th",{scope:"col",children:"Sample"}),e("th",{scope:"col",children:"Foreground"}),e("th",{scope:"col",children:"Background"}),e("th",{scope:"col",children:"Ratio"}),e("th",{scope:"col",children:"Needs"})]})}),e("tbody",{children:l.map(n=>e("tr",{children:[e("td",{children:e("span",{class:"sg-pair",style:{color:`var(${n.fg})`,background:`var(${n.bg})`},children:"Aa 42"})}),e("td",{class:"m-mono",children:n.fg}),e("td",{class:"m-mono",children:n.bg}),e("td",{children:x(n.ratio)}),e("td",{children:[n.min,":1 ",n.pass?"":e("strong",{class:"sg-fail",children:"fails"})]})]},`${n.fg}${n.bg}`))})]})})]}),e(h,{label:"Type",title:"Source Sans 3 and Source Code Pro",children:[e("ul",{class:"sg-type",children:M.map(n=>e("li",{class:"sg-type-row",children:[e("span",{class:"m-mono sg-type-meta",children:["--fs-",n.step," · ",n.use]}),e("span",{class:"sg-type-sample",style:{fontSize:`var(--fs-${n.step})`,lineHeight:`var(--lh-${n.step})`},children:n.sample})]},n.step))}),e("div",{class:"sg-type-extras",children:[e("p",{class:"m-label",children:"Small caps label, synthesized, tracked"}),e("p",{class:"m-num sg-figures",children:"Tabular 1,111.11 / 8,888.88"}),e("p",{class:"m-mono",children:"Mono 0O 1lI · p = 0.032, n = 48"}),e("p",{class:"sg-weights",children:[e("span",{style:{fontWeight:"var(--fw-regular)"},children:"Regular"})," ",e("span",{style:{fontWeight:"var(--fw-medium)"},children:"Medium"})," ",e("span",{style:{fontWeight:"var(--fw-semibold)"},children:"Semibold"})," ",e("span",{style:{fontWeight:"var(--fw-bold)"},children:"Bold"})]})]})]}),e(h,{label:"Space, radius, shadow",title:"Structure",children:[e("h3",{class:"m-label",children:"Spacing, 4px base"}),e("ul",{class:"sg-spaces",children:P.map(n=>e("li",{children:[e("span",{class:"m-mono sg-space-name",children:["--sp-",n]}),e("span",{class:"sg-space-bar",style:{width:`var(--sp-${n})`}})]},n))}),e("h3",{class:"m-label sg-sub",children:"Radius"}),e("div",{class:"sg-boxes",children:z.map(n=>e("div",{class:"sg-box",style:{borderRadius:`var(${n})`},children:e("span",{class:"m-mono",children:n})},n))}),e("h3",{class:"m-label sg-sub",children:"Shadow"}),e("div",{class:"sg-boxes",children:R.map(n=>e("div",{class:"sg-box sg-box-lift",style:{boxShadow:`var(${n})`},children:e("span",{class:"m-mono",children:n})},n))})]}),e(h,{label:"Motion",title:"Calm and short",children:e(I,{})}),e(h,{label:"Primitives",title:"Every state",children:e(L,{})})]})}function h(s){return e("section",{class:"sg-section",children:[e("div",{class:"m-section",children:[e("h2",{class:"sg-h2",children:s.title}),e("span",{class:"m-label",children:s.label})]}),s.children]})}function H(){return e("header",{class:"sg-wx","aria-label":"Date and weather",children:[e("p",{class:"m-label",children:"Tuesday · 29 September"}),e("div",{class:"sg-wx-main",children:[e("div",{children:[e("h2",{class:"sg-wx-place",children:"Brooklyn"}),e("p",{class:"sg-wx-cond",children:"Light rain"})]}),e("p",{class:"sg-wx-temp m-num",children:["64",e("span",{class:"sg-wx-unit",children:"°F"})]})]}),e("dl",{class:"sg-wx-grid m-num",children:[e("div",{children:[e("dt",{class:"m-label",children:"High"}),e("dd",{children:"68°"})]}),e("div",{children:[e("dt",{class:"m-label",children:"Low"}),e("dd",{children:"55°"})]}),e("div",{children:[e("dt",{class:"m-label",children:"Rain"}),e("dd",{children:"40%"})]}),e("div",{children:[e("dt",{class:"m-label",children:"Amount"}),e("dd",{children:["0.12 ",e("span",{class:"sg-wx-unit-sm",children:"in"})]})]})]}),e("p",{class:"sg-wx-updated m-num",children:"Updated 8:14 AM"})]})}function N(){const a=15.384615384615385;return e("button",{type:"button",class:"m-card sg-path",children:[e("span",{class:"sg-path-top",children:[e("span",{class:"m-label",children:"WGU"}),e("span",{class:"m-num sg-path-count",children:[2," of ",13]})]}),e("span",{class:"sg-path-course",children:"C955 · Applied Probability & Statistics"}),e("span",{class:"sg-path-next",children:[e("span",{class:"m-label sg-path-next-label",children:"Next"}),e("span",{class:"sg-path-next-text",children:"Finish practice test 2"})]}),e("span",{class:"m-progress",role:"progressbar","aria-label":"WGU courses done","aria-valuemin":0,"aria-valuemax":13,"aria-valuenow":2,"aria-valuetext":"2 of 13 courses",children:e("span",{class:"m-progress-fill",style:{"--m-progress":`${a}%`}})}),e("span",{class:"sg-path-caption m-num",children:[Math.round(a),"% · ",2," of ",13," courses"]})]})}function I(){const[s,t]=g(!1);return e("div",{children:[e("button",{type:"button",class:"m-btn",onClick:()=>t(!s),"aria-pressed":s,children:s?"Return":"Play"}),e("ul",{class:"sg-motion",children:W.map(a=>e("li",{children:[e("span",{class:"m-mono sg-motion-name",children:a}),e("span",{class:"sg-motion-track",children:e("span",{class:`sg-motion-dot${s?" is-on":""}`,style:{transitionTimingFunction:`var(${a})`}})})]},a))}),e("p",{class:"sg-note",children:["Durations: ",e("span",{class:"m-mono",children:"--dur-1"})," 120ms press, ",e("span",{class:"m-mono",children:"--dur-2"})," 200ms state,"," ",e("span",{class:"m-mono",children:"--dur-3"})," 320ms reveal. Under reduced motion they drop to near zero and the skeleton stops shimmering."]})]})}function L(){const[s,t]=g("week"),[a,r]=g(0);return e("div",{class:"sg-prims",children:[e("h3",{class:"m-label",children:"Buttons"}),e("div",{class:"sg-row-wrap",children:[e("button",{type:"button",class:"m-btn m-btn-primary",children:"Log set"}),e("button",{type:"button",class:"m-btn",children:"Add a todo"}),e("button",{type:"button",class:"m-btn m-btn-quiet",children:"Capture an idea"}),e("button",{type:"button",class:"m-btn",disabled:!0,children:"Disabled"})]}),e("p",{class:"sg-note",children:"Tab to any control to see the focus ring. Every button is at least 44px tall."}),e("h3",{class:"m-label sg-sub",children:"Chips"}),e("div",{class:"sg-row-wrap",children:[e("span",{class:"m-chip",children:"Stats"}),e("span",{class:"m-chip m-chip-sand",children:"Proof"}),["day","week","month"].map(l=>e("button",{type:"button",class:"m-chip","aria-pressed":s===l,onClick:()=>t(l),children:l},l))]}),e("h3",{class:"m-label sg-sub",children:"Section header and rows"}),e("div",{class:"m-section",children:[e("span",{class:"m-label",children:"Your day"}),e("span",{class:"m-num sg-note",children:"3 due"})]}),e("ul",{class:"sg-list",children:[e("li",{class:"m-row",children:["Review regression notes ",e("span",{class:"m-row-meta m-num",children:"9:00"})]}),e("li",{class:"m-row","aria-current":"true",children:["Practice test 2, section B ",e("span",{class:"m-row-meta m-num",children:"Now"})]}),e("li",{class:"m-row",children:["Walk, 30 min ",e("span",{class:"m-row-meta m-num",children:"18:30"})]})]}),e("h3",{class:"m-label sg-sub",children:"Progress"}),[0,2,13].map(l=>e("div",{class:"sg-progress",children:[e("span",{class:"m-progress",role:"progressbar","aria-label":"Courses done","aria-valuemin":0,"aria-valuemax":13,"aria-valuenow":l,"aria-valuetext":`${l} of 13`,children:e("span",{class:"m-progress-fill",style:{"--m-progress":`${l/13*100}%`}})}),e("span",{class:"m-num sg-note",children:[l," of 13"]})]},l)),e("h3",{class:"m-label sg-sub",children:"Card, loading"}),e("div",{class:"m-card sg-skel-card","aria-busy":"true","aria-label":"Loading WGU path",children:[e("span",{class:"m-skel m-skel-line sg-w-25"}),e("span",{class:"m-skel m-skel-line sg-w-80"}),e("span",{class:"m-skel m-skel-line sg-w-60"}),e("span",{class:"m-skel sg-skel-bar"})]}),e("h3",{class:"m-label sg-sub",children:"Empty"}),e("div",{class:"m-state","data-kind":"empty",children:[e("p",{class:"m-state-title",children:"All 13 courses are done."}),e("p",{class:"m-state-body",children:"Next step: request your degree audit."})]}),e("h3",{class:"m-label sg-sub",children:"Error"}),e("div",{class:"m-state","data-kind":"error",role:"alert",children:[e("p",{class:"m-state-title",children:"Weather didn't load."}),e("p",{class:"m-state-body",children:["The forecast service didn't answer",a?` (tried ${a+1} times)`:"","."]}),e("button",{type:"button",class:"m-btn",onClick:()=>r(a+1),children:"Try again"})]}),e("h3",{class:"m-label sg-sub",children:"Offline"}),e("div",{class:"m-card",children:[e("p",{class:"sg-offline-content",children:"Brooklyn · 64°F · Light rain"}),e("p",{class:"m-state m-num","data-kind":"offline",children:"Offline · Saved 8:14 AM"})]})]})}export{V as StyleguideView};

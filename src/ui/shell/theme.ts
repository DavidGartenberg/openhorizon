/**
 * Flight-sim shell theme: dark translucent glass panels, a thin accent,
 * clean sans text, square-cornered windows with a title bar — the visual
 * language of modern consumer flight simulators. Original styling; no
 * third-party fonts or artwork are shipped (system font stack only).
 */
export const SHELL_CSS = `
:root{
  --oh-glass: rgba(16,21,29,.84); --oh-glass-strong: rgba(12,16,23,.94);
  --oh-head: linear-gradient(180deg, rgba(44,53,66,.96), rgba(28,35,46,.96));
  --oh-line: rgba(255,255,255,.09); --oh-line-strong: rgba(255,255,255,.18);
  --oh-text: #f1f4f8; --oh-dim: #98a3b0; --oh-faint: #66717e;
  --oh-select: #2b7fd6; --oh-slate: #39445a; --oh-slate-deep: #1b222d; --oh-good: #3fe06a;
  --oh-accent: #1fa3ff; --oh-accent-soft: rgba(31,163,255,.16); --oh-warn: #ffb020; --oh-alert: #ff4a3d;
  --oh-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
.oh-ui, .oh-ui *{box-sizing:border-box;font-family:var(--oh-font)}
.oh-ui button{font:inherit}

/* ---- toolbar ---- */
#oh-toolbar{position:fixed;top:0;left:50%;transform:translate(-50%,0);z-index:60;display:flex;align-items:stretch;
  background:var(--oh-glass);backdrop-filter:blur(14px) saturate(1.2);-webkit-backdrop-filter:blur(14px) saturate(1.2);
  border:1px solid var(--oh-line);border-top:none;border-radius:0 0 6px 6px;box-shadow:0 10px 30px rgba(0,0,0,.35);
  transition:transform .28s ease, opacity .28s ease;padding:0 6px}
#oh-toolbar.hidden{transform:translate(-50%,-100%);opacity:0}
#oh-toolbar .oh-tb{position:relative;width:52px;height:50px;border:none;background:transparent;color:var(--oh-text);cursor:pointer;
  display:flex;align-items:center;justify-content:center;opacity:.86;transition:background .15s, opacity .15s}
#oh-toolbar .oh-tb:hover{background:rgba(255,255,255,.07);opacity:1}
#oh-toolbar .oh-tb.on{opacity:1;color:#fff}
#oh-toolbar .oh-tb.on::after{content:'';position:absolute;left:12px;right:12px;bottom:0;height:3px;border-radius:2px;background:var(--oh-accent)}
#oh-toolbar .oh-sep{width:1px;margin:10px 4px;background:var(--oh-line-strong)}
#oh-toolbar .oh-tip{position:absolute;top:56px;left:50%;transform:translateX(-50%);white-space:nowrap;pointer-events:none;
  font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--oh-text);background:var(--oh-glass-strong);
  border:1px solid var(--oh-line);padding:4px 8px;border-radius:3px;opacity:0;transition:opacity .12s}
#oh-toolbar .oh-tb:hover .oh-tip{opacity:1}
#oh-toolbar-hotzone{position:fixed;top:0;left:0;right:0;height:14px;z-index:59}

/* ---- windows: slate title bar, controls on the right, deep slate body ---- */
.oh-window{position:fixed;z-index:50;min-width:260px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 70px);display:flex;flex-direction:column;
  background:rgba(27,34,45,.97);border:1px solid rgba(255,255,255,.1);border-radius:2px;box-shadow:0 18px 50px rgba(0,0,0,.5);color:var(--oh-text);font-size:13px}
.oh-window[hidden]{display:none}
.oh-window .oh-head{display:flex;align-items:center;gap:10px;height:40px;padding:0 4px 0 14px;background:linear-gradient(180deg,#46526a,#39445a);
  border-bottom:1px solid rgba(0,0,0,.35);cursor:move;user-select:none;flex:0 0 auto}
.oh-window .oh-head svg{color:#cfd9ea}
.oh-window .oh-title{flex:1;font-size:12.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#f3f6fb}
.oh-window .oh-x,.oh-window .oh-min{width:32px;height:32px;border:none;background:transparent;color:#cfd9ea;cursor:pointer;border-radius:2px;display:flex;align-items:center;justify-content:center}
.oh-window .oh-x:hover,.oh-window .oh-min:hover{background:rgba(255,255,255,.12);color:#fff}
.oh-window .oh-x:hover{background:#d8453b}
.oh-window .oh-body{padding:12px 14px 14px;overflow:auto;flex:1 1 auto}
.oh-window .oh-body.flush{padding:0}
.oh-window.oh-collapsed .oh-body{display:none}
.oh-window .oh-body::-webkit-scrollbar{width:8px}.oh-window .oh-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:4px}

/* tabs: letter-spaced caps, active = brighter with a blue underline */
.oh-tabs{display:flex;background:#27303d;border-bottom:1px solid rgba(0,0,0,.4)}
.oh-tabs button{flex:1;position:relative;border:none;background:transparent;color:#9aa6b8;font:600 11.5px var(--oh-font);letter-spacing:.14em;text-transform:uppercase;
  padding:11px 6px 10px;cursor:pointer}
.oh-tabs button:hover{color:#e4ebf6;background:rgba(255,255,255,.05)}
.oh-tabs button.sel{color:#fff;background:#303a49}
.oh-tabs button.sel::after{content:'';position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--oh-select)}

/* section header bars inside a window */
.oh-sec{background:#2b3544;color:#aeb9cb;font:600 11px var(--oh-font);letter-spacing:.16em;text-transform:uppercase;padding:7px 14px;border-top:1px solid rgba(0,0,0,.3);border-bottom:1px solid rgba(0,0,0,.3)}

/* option rows: solid blue when selected */
.oh-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:none;border-bottom:1px solid rgba(255,255,255,.05);background:transparent;color:#e6ecf5;
  padding:11px 14px;font:500 13.5px var(--oh-font);cursor:pointer}
.oh-opt:hover{background:rgba(255,255,255,.06)}
.oh-opt.sel{background:var(--oh-select);color:#fff}
.oh-opt small{margin-left:auto;color:#8f9bb0;font-size:11.5px}
.oh-opt.sel small{color:#dbe9fb}

/* slider row */
.oh-slider{display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center;padding:10px 14px 12px;border-bottom:1px solid rgba(255,255,255,.05)}
.oh-slider label{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#aeb9cb}
.oh-slider output{font:600 13px ui-monospace,monospace;color:#fff;background:#10151c;border:1px solid rgba(255,255,255,.1);padding:2px 8px;min-width:54px;text-align:right}
.oh-slider input[type=range]{grid-column:1 / -1;width:100%;-webkit-appearance:none;appearance:none;height:4px;background:#47536a;border-radius:2px;outline:none}
.oh-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--oh-select);border:2px solid #fff;cursor:pointer}
.oh-slider input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--oh-select);border:2px solid #fff;cursor:pointer}

/* switch row */
.oh-switchrow{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.05);font-size:13.5px}
.oh-switchrow .oh-sw{margin-left:auto;position:relative;width:42px;height:22px;border-radius:11px;background:#47536a;border:none;cursor:pointer;transition:background .15s;padding:0}
.oh-switchrow .oh-sw::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}
.oh-switchrow .oh-sw.on{background:var(--oh-select)}
.oh-switchrow .oh-sw.on::after{transform:translateX(20px)}

/* checklist rows */
.oh-ck{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:none;border-bottom:1px solid rgba(255,255,255,.05);background:transparent;color:#e6ecf5;padding:10px 14px;font:500 13.5px var(--oh-font);cursor:default}
.oh-ck.manual{cursor:pointer}.oh-ck.manual:hover{background:rgba(255,255,255,.06)}
.oh-ck .oh-tick{flex:0 0 auto;width:20px;height:20px;border-radius:50%;border:2px solid #6d7a91;display:flex;align-items:center;justify-content:center;color:transparent}
.oh-ck.done .oh-tick{background:var(--oh-good);border-color:var(--oh-good);color:#06210f}
.oh-ck .oh-resp{margin-left:auto;color:#9aa6b8;font:600 12px var(--oh-font);letter-spacing:.08em}
.oh-ck.done .oh-resp{color:#9fe8b4}
.oh-ck .oh-auto{font:700 9px var(--oh-font);letter-spacing:.14em;color:#8fb7ee;border:1px solid rgba(143,183,238,.5);padding:1px 4px;border-radius:2px}
.oh-ckbar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#222a36;border-top:1px solid rgba(0,0,0,.4)}
.oh-ckbar .oh-prog{flex:1;height:6px;background:#3b475b;border-radius:3px;overflow:hidden}
.oh-ckbar .oh-prog i{display:block;height:100%;background:var(--oh-good);transition:width .2s}
.oh-ckbar span{font:600 12px ui-monospace,monospace;color:#cfd9ea}

/* Legacy panels re-hosted inside windows: the window is the chrome now. */
.oh-window .oh-body > details{position:static !important;inset:auto !important;width:100% !important;max-width:none !important;max-height:none !important;
  background:transparent !important;border:none !important;box-shadow:none !important;padding:0 !important;margin:0 !important;color:var(--oh-text) !important;
  font:13px/1.5 var(--oh-font) !important;overflow:visible !important}
.oh-window .oh-body > details > summary{display:none}
.oh-window .oh-body > details > .controls, .oh-window .oh-body > details > .loading-controls{border-top:none !important;padding:0 !important}
.oh-window select, .oh-window input[type=text], .oh-window input[type=number], .oh-window input:not([type]){background:rgba(255,255,255,.06) !important;
  color:var(--oh-text) !important;border:1px solid var(--oh-line-strong) !important;border-radius:3px !important;padding:6px 8px !important;font:inherit !important}
.oh-window button:not(.oh-x):not(.oh-min):not(.oh-row):not(.oh-chip):not(.oh-opt):not(.oh-ck):not(.oh-sw):not(.oh-tab){background:rgba(255,255,255,.07) !important;color:var(--oh-text) !important;border:1px solid var(--oh-line-strong) !important;
  border-radius:3px !important;padding:6px 10px !important;cursor:pointer;font:inherit !important}
.oh-window button:not(.oh-x):not(.oh-min):not(.oh-row):not(.oh-chip):not(.oh-opt):not(.oh-ck):not(.oh-sw):not(.oh-tab):hover{background:var(--oh-accent-soft) !important;border-color:var(--oh-accent) !important}
.oh-window pre{font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d3dd;white-space:pre-wrap}
.oh-window output{color:var(--oh-dim)}

/* ---- list rows / chips ---- */
.oh-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;border-left:3px solid transparent;background:transparent;color:var(--oh-text);
  padding:9px 10px;cursor:pointer;border-radius:2px}
.oh-row:hover{background:rgba(255,255,255,.06)}
.oh-row.sel{background:var(--oh-accent-soft);border-left-color:var(--oh-accent)}
.oh-row .oh-num{color:var(--oh-accent);font-weight:700;min-width:18px}
.oh-chip{border:1px solid var(--oh-line-strong);background:rgba(255,255,255,.05);color:var(--oh-text);padding:7px 12px;border-radius:3px;cursor:pointer;
  font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.oh-chip:hover{border-color:var(--oh-accent)}
.oh-chip.sel{background:var(--oh-accent);border-color:var(--oh-accent);color:#04121f;font-weight:700}
.oh-label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--oh-dim);margin:14px 0 6px}

/* ---- notification banners: title + hint on a slate card with a coloured bar ---- */
#oh-notify{position:fixed;top:62px;left:50%;transform:translateX(-50%);z-index:70;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}
.oh-note{min-width:300px;max-width:min(620px,92vw);padding:10px 18px 10px 16px;border-radius:2px;
  background:rgba(27,34,45,.96);border:1px solid rgba(255,255,255,.1);border-left:4px solid var(--oh-select);color:var(--oh-text);
  box-shadow:0 10px 28px rgba(0,0,0,.4);animation:oh-in .22s ease-out}
.oh-note .oh-note-title{font:700 13px var(--oh-font);letter-spacing:.08em;text-transform:uppercase}
.oh-note .oh-note-hint{margin-top:3px;font:500 12px var(--oh-font);letter-spacing:.03em;color:#aeb9cb}
.oh-note.warn{border-left-color:var(--oh-warn)}.oh-note.alert{border-left-color:var(--oh-alert)}
.oh-note.out{opacity:0;transform:translateY(-6px);transition:opacity .35s, transform .35s}
@keyframes oh-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}

/* ---- flight info strip ---- */
#hud{position:fixed !important;left:12px !important;bottom:12px !important;top:auto !important;z-index:40 !important;white-space:normal !important;pointer-events:none !important;
  background:var(--oh-glass) !important;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--oh-line) !important;border-radius:4px !important;
  padding:0 !important;color:var(--oh-text) !important;font:12px var(--oh-font) !important;box-shadow:0 10px 30px rgba(0,0,0,.35)}
#hud[hidden]{display:none !important}
#hud .oh-fi-head{display:flex;justify-content:space-between;gap:16px;padding:7px 12px;border-bottom:1px solid var(--oh-line);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--oh-dim)}
#hud .oh-fi-head b{color:var(--oh-text);font-weight:600}
#hud .oh-fi-grid{display:grid;grid-template-columns:repeat(4,minmax(74px,auto));gap:2px 14px;padding:8px 12px}
#hud .oh-fi-cell span{display:block;font-size:10px;letter-spacing:.12em;color:var(--oh-faint);text-transform:uppercase}
#hud .oh-fi-cell b{display:block;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--oh-text)}
#hud .oh-fi-cell b small{font-size:11px;color:var(--oh-dim);font-weight:500;margin-left:2px}
#hud .oh-fi-foot{padding:6px 12px 8px;border-top:1px solid var(--oh-line);font-size:11px;color:var(--oh-dim);max-width:520px}
#hud .oh-fi-alert{padding:6px 12px;font-weight:700;letter-spacing:.06em;color:#140a00;background:var(--oh-warn)}
#hud .oh-fi-alert.red{background:var(--oh-alert);color:#fff}
#hud .oh-fi-co{padding:5px 12px;color:#bfe6ff;font-size:12px;border-top:1px solid var(--oh-line)}

/* ---- quick search ---- */
.oh-search{position:fixed !important;top:76px !important;left:50% !important;transform:translateX(-50%) !important;width:min(520px,92vw) !important;z-index:65 !important;
  padding:12px 16px 12px 42px !important;font:15px var(--oh-font) !important;color:var(--oh-text) !important;background:var(--oh-glass-strong) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='%2398a3b0' stroke-width='1.8' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6'/%3E%3Cpath d='M15 15l5 5'/%3E%3C/svg%3E") no-repeat 14px 50% !important;
  border:1px solid var(--oh-accent) !important;border-radius:3px !important;box-shadow:0 14px 40px rgba(0,0,0,.5) !important}
`

let installed = false
export function installShellTheme(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  const style = document.createElement('style')
  style.id = 'oh-shell-theme'
  style.textContent = SHELL_CSS
  document.head.appendChild(style)
}

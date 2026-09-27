// 浮動視窗（Document Picture-in-Picture）：只顯示倒數與狀態，不顯示鏡頭畫面

let pipWin = null;
let els = {};

const CSS = `
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, "PingFang TC", "Noto Sans TC", sans-serif;
  background: #fffdf7; color: #4a3b32;
}
.wrap { padding: 12px 14px; text-align: center; }
.top { display: flex; justify-content: space-between; font-size: 13px; color: #806b5b; }
#pClock { font-size: 52px; font-weight: 700; color: #e45745; letter-spacing: 2px; line-height: 1.15; }
.bar { height: 8px; background: #f0ddd5; border-radius: 999px; overflow: hidden; margin: 4px 0 10px; }
#pBar { height: 100%; width: 0; background: #e85d4a; border-radius: inherit; transition: width .4s linear; }
.pill { padding: 8px 10px; border-radius: 12px; color: #fff; font-weight: 700; font-size: 16px; background: #a99b90; }
.pill.FOCUSED { background: #2e9e5b; }
.pill.DISTRACTED { background: #e08a1e; }
.pill.ABSENT { background: #d04343; }
#pGrowth { margin-top: 8px; font-size: 12px; color: #806b5b; }
`;

const HTML = `
<div class="wrap">
  <div class="top"><span id="pMode"></span><span id="pPhase"></span></div>
  <div id="pClock">--:--</div>
  <div class="bar"><div id="pBar"></div></div>
  <div id="pStatus" class="pill">...</div>
  <div id="pGrowth"></div>
</div>
`;

export function isPipSupported() {
  return "documentPictureInPicture" in window;
}

export function isPipOpen() {
  return !!pipWin && !pipWin.closed;
}

// 必須在使用者點擊的事件裡呼叫（瀏覽器規定）
export async function openPip(onClose) {
  if (!isPipSupported()) throw new Error("此瀏覽器不支援浮動視窗");
  if (isPipOpen()) return;

  pipWin = await window.documentPictureInPicture.requestWindow({
    width: 300,
    height: 210,
  });

  const doc = pipWin.document;
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.append(style);
  doc.body.innerHTML = HTML;

  const g = (id) => doc.getElementById(id);
  els = {
    mode: g("pMode"),
    phase: g("pPhase"),
    clock: g("pClock"),
    bar: g("pBar"),
    status: g("pStatus"),
    growth: g("pGrowth"),
  };

  // 使用者按右上角關閉視窗時
  pipWin.addEventListener("pagehide", () => {
    pipWin = null;
    els = {};
    onClose?.();
  });
}

export function closePip() {
  if (isPipOpen()) pipWin.close();
}

export function updatePip(d) {
  if (!isPipOpen() || !els.clock) return;
  els.mode.textContent = d.mode;
  els.phase.textContent = d.phase;
  els.clock.textContent = d.clock;
  els.bar.style.width = d.progress || "0%";
  els.status.textContent = d.status;
  els.status.className = "pill " + (d.statusClass || "");
  els.growth.textContent = d.growth;
}

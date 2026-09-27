import Chart from "chart.js/auto";

const KEY = "pomodoro-history";
const COLORS = { FOCUSED: "#2e9e5b", DISTRACTED: "#e08a1e", ABSENT: "#d04343" };
const NAMES = { FOCUSED: "專注", DISTRACTED: "分心", ABSENT: "離座" };

let pieChart = null;
let lineChart = null;

const $ = (id) => document.getElementById(id);

// ===== 資料處理 =====
// 把「每秒一筆」的陣列壓縮成 [[狀態, 秒數], ...]，節省儲存空間
export function rle(timeline) {
  const out = [];
  for (const st of timeline) {
    const last = out[out.length - 1];
    if (last && last[0] === st) last[1] += 1;
    else out.push([st, 1]);
  }
  return out;
}

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

export function saveSession(session) {
  const h = loadHistory();
  h.push(session);
  while (h.length > 50) h.shift(); // 最多保留 50 筆
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {}
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

function fmtDur(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

function ratio(session) {
  const s = session.seconds;
  const total = s.FOCUSED + s.DISTRACTED + s.ABSENT || 1;
  return (s.FOCUSED / total) * 100;
}

// ===== 本輪報告 =====
export function renderReport(session) {
  const box = $("report");
  box.hidden = false; // 先顯示，圖表才抓得到尺寸

  const s = session.seconds;
  const counted = s.FOCUSED + s.DISTRACTED + s.ABSENT;

  $("reportMeta").textContent =
    `（${session.mode === "CODING" ? "開發模式" : "閱讀模式"}・` +
    `${new Date(session.ts).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}）`;

  // 數據卡片
  const cards = [
    ["專注比例", `${ratio(session).toFixed(0)}%`],
    ["專注時間", fmtDur(s.FOCUSED)],
    ["分心次數", `${session.distractCount} 次`],
    ["離座次數", `${session.absentCount} 次`],
    ["最長連續專注", fmtDur(session.longestStreak)],
  ];
  $("cards").innerHTML = cards
    .map(([label, value]) => `<div class="card"><div class="v">${value}</div><div class="l">${label}</div></div>`)
    .join("");

  // 時間軸色塊
  const totalSec = session.segments.reduce((sum, seg) => sum + seg[1], 0) || 1;
  $("timelineBar").innerHTML = session.segments
    .map(
      ([st, secs]) =>
        `<div class="seg" title="${NAMES[st]} ${fmtDur(secs)}" ` +
        `style="width:${(secs / totalSec) * 100}%;background:${COLORS[st]}"></div>`
    )
    .join("");
  $("axisEnd").textContent = fmtDur(totalSec);

  // 圓環圖
  if (pieChart) pieChart.destroy();
  pieChart = new Chart($("pieChart"), {
    type: "doughnut",
    data: {
      labels: ["專注", "分心", "離座"],
      datasets: [
        {
          data: [s.FOCUSED, s.DISTRACTED, s.ABSENT],
          backgroundColor: [COLORS.FOCUSED, COLORS.DISTRACTED, COLORS.ABSENT],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: { label: (ctx) => ` ${ctx.label}：${fmtDur(ctx.parsed)}` },
        },
      },
    },
  });

  $("coverage").textContent =
    `已統計 ${Math.round(counted)}s / 設定 ${session.plannedSec}s` +
    `（差距過大代表切到背景時有漏偵測）`;
}

// ===== 歷史趨勢 =====
export function renderHistory() {
  const h = loadHistory();
  $("historyEmpty").hidden = h.length > 0;
  $("historyBox").hidden = h.length === 0;
  $("clearHistoryBtn").hidden = h.length === 0;

  if (lineChart) {
    lineChart.destroy();
    lineChart = null;
  }
  if (h.length === 0) return;

  const labels = h.map((x) => {
    const d = new Date(x.ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  lineChart = new Chart($("historyChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "專注比例 (%)",
          data: h.map((x) => Math.round(ratio(x))),
          borderColor: COLORS.FOCUSED,
          backgroundColor: "rgba(46,158,91,0.15)",
          fill: true,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100 } },
    },
  });
}

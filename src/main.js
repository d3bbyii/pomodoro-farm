import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
import {
  rle,
  saveSession,
  loadHistory,
  clearHistory,
  renderReport,
  renderHistory,
} from "./report.js";
import { isPipSupported, isPipOpen, openPip, closePip, updatePip } from "./pip.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const camOffEl = $("camOff");
const statusEl = $("status");
const infoEl = $("info");
const phaseEl = $("phase");
const clockEl = $("clock");
const calibrateBtn = $("calibrateBtn");
const startBtn = $("startBtn");
const resetBtn = $("resetBtn");
const backBtn = $("backBtn");
const pipBtn = $("pipBtn");
const pipAuto = $("pipAuto");
const focusMinEl = $("focusMin");
const breakMinEl = $("breakMin");
const clearHistoryBtn = $("clearHistoryBtn");
const farmPage = $("farmPage");
const focusPage = $("focusPage");
const modeModal = $("modeModal");
const modeBadge = $("modeBadge");
const progressBar = $("progressBar");
const growthEl = $("growth");
const harvestEl = $("harvest");
const farmCountEl = $("farmCount");

// ===== 可調參數 =====
const TICK_MS = 100; // 偵測間隔（約 10 FPS）

// 開發模式
const FLIP_YAW = false;
const FLIP_PITCH = false;
const YAW_LIMIT = 30;
const PITCH_LIMIT = 25;
const SMOOTH = 0.3;

// 閱讀模式
const VIS_MIN = 0.5;
const TILT_LIMIT = 35;
const SPEED_LIMIT = 0.6;

// 時間緩衝（秒）
const DELAY = { DISTRACTED: 3, ABSENT: 8, FOCUSED: 1 };

// ===== 番茄鐘時長（預設 25 / 5 分鐘，使用者可改） =====
let FOCUS_SEC = 25 * 60;
let BREAK_SEC = 5 * 60;

function clamp(v, min, max, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function readDurations() {
  const f = clamp(focusMinEl.value, 1, 180, 25);
  const b = clamp(breakMinEl.value, 1, 60, 5);
  focusMinEl.value = f;
  breakMinEl.value = b;
  FOCUS_SEC = f * 60;
  BREAK_SEC = b * 60;
  try {
    localStorage.setItem("pomodoro-durations", JSON.stringify({ f, b }));
  } catch {}
  if (phase === "IDLE") clockEl.textContent = fmt(FOCUS_SEC);
}

function loadDurations() {
  try {
    const saved = JSON.parse(localStorage.getItem("pomodoro-durations"));
    if (saved) {
      focusMinEl.value = saved.f;
      breakMinEl.value = saved.b;
    }
  } catch {}
  readDurations();
}

focusMinEl.addEventListener("change", readDurations);
breakMinEl.addEventListener("change", readDurations);

// ===== 偵測狀態 =====
let faceLandmarker = null;
let poseLandmarker = null;
let modelsReady = false;
let modelsStarted = false;
let mode = "CODING";

// 鏡頭狀態
let stream = null;
let cameraOn = false;
let cameraBusy = false;

let baseYaw = 0, basePitch = 0;
let smoothYaw = null, smoothPitch = null;
let prevMid = null;
let smoothSpeed = 0;

let confirmedState = "FOCUSED";
let candidate = "FOCUSED";
let candidateSince = performance.now();
let calibrating = false;
let calSamples = [];

// ===== 番茄鐘狀態 =====
let phase = "IDLE"; // IDLE | FOCUS | BREAK
let endTime = 0;
let phaseTotal = 1;
let plannedFocusSec = FOCUS_SEC;
let lastFrame = performance.now();
let secAcc = 0;
let stats = newStats();

function newStats() {
  return {
    seconds: { FOCUSED: 0, DISTRACTED: 0, ABSENT: 0 },
    distractCount: 0,
    absentCount: 0,
    longestStreak: 0,
    currentStreak: 0,
    timeline: [],
  };
}

// ===== 狀態列 / 鏡頭提示 =====
function setStatus(msg) {
  statusEl.className = "";
  statusEl.textContent = msg;
}

function setCamOff(msg) {
  camOffEl.hidden = !msg;
  if (msg) camOffEl.textContent = msg;
}

// ===== 浮動視窗 =====
if (!isPipSupported()) {
  pipBtn.hidden = true;
  $("pipAutoLabel").hidden = true;
}

try {
  pipAuto.checked = localStorage.getItem("pomodoro-pip-auto") !== "0";
} catch {}
pipAuto.addEventListener("change", () => {
  try {
    localStorage.setItem("pomodoro-pip-auto", pipAuto.checked ? "1" : "0");
  } catch {}
});

function onPipClosed() {
  pipBtn.textContent = "📌 浮動視窗";
}

async function togglePip() {
  if (isPipOpen()) {
    closePip();
    return;
  }
  try {
    await openPip(onPipClosed);
    pipBtn.textContent = "📌 關閉浮動視窗";
  } catch (err) {
    console.error(err);
    alert("無法開啟浮動視窗：" + err.message);
  }
}

pipBtn.addEventListener("click", togglePip);

// 把主頁面上的資訊同步到浮動視窗（直接讀主頁面元素）
function syncPip() {
  if (!isPipOpen()) return;
  updatePip({
    mode: modeBadge.textContent,
    phase: phaseEl.textContent,
    clock: clockEl.textContent,
    status: statusEl.textContent,
    statusClass: statusEl.className,
    progress: progressBar.style.width,
    growth: growthEl.textContent,
  });
}

// ===== 鏡頭開關 =====
// 什麼時候需要鏡頭：在專注頁，而且不是休息中
function wantCamera() {
  return currentPage === "focus" && phase !== "BREAK";
}

async function startCamera() {
  if (stream || cameraBusy) return;
  cameraBusy = true;
  setCamOff("📷 正在開啟鏡頭...");
  setStatus("正在開啟鏡頭...（若跳出詢問視窗請按允許）");

  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    // 等待期間如果已經不需要鏡頭（例如使用者按了返回），立刻關掉
    if (!wantCamera()) {
      s.getTracks().forEach((t) => t.stop());
      cameraBusy = false;
      setCamOff("📷 鏡頭已關閉");
      return;
    }
    stream = s;
    video.srcObject = s;
    await video.play();
    cameraOn = true;
    setCamOff(null);
  } catch (err) {
    cameraBusy = false;
    stopCamera();
    setCamOff("📷 鏡頭無法使用");
    setStatus(`❌ 鏡頭開啟失敗：${err.name}（${err.message}）`);
    console.error(err);
    return;
  }

  cameraBusy = false;
  updateButtons();
  if (modelsReady && phase === "IDLE") setStatus("按「開始專注」開始");
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop()); // 真正關閉鏡頭（瀏覽器的錄影圖示會消失）
    stream = null;
  }
  video.srcObject = null;
  cameraOn = false;
  resetDetection();
  setCamOff(phase === "BREAK" ? "☕ 休息中，鏡頭已關閉" : "📷 鏡頭已關閉");
  updateButtons();
}

// 依目前頁面與階段，決定鏡頭該開還是關
async function syncCamera() {
  if (wantCamera()) await startCamera();
  else stopCamera();
}

// ===== 模型（只載入一次） =====
function modelFail(msg, err) {
  setStatus(msg);
  console.error(err);
  modelsStarted = false; // 下次進專注頁會再試一次
}

async function ensureModels() {
  if (modelsStarted || modelsReady) return;
  modelsStarted = true;

  let fileset;
  try {
    setStatus("正在載入 MediaPipe 執行環境...");
    fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
    );
  } catch (err) {
    return modelFail(`❌ 執行環境載入失敗（可能連不到 jsDelivr）：${err.message}`, err);
  }

  try {
    setStatus("正在載入臉部模型（1/2）...");
    faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      },
      runningMode: "VIDEO",
      outputFacialTransformationMatrixes: true,
      numFaces: 1,
    });
  } catch (err) {
    return modelFail(`❌ 臉部模型載入失敗（可能連不到 Google 儲存空間）：${err.message}`, err);
  }

  try {
    setStatus("正在載入姿態模型（2/2）...");
    poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  } catch (err) {
    return modelFail(`❌ 姿態模型載入失敗：${err.message}`, err);
  }

  modelsReady = true;
  updateButtons();
  if (cameraOn && phase === "IDLE") setStatus("按「開始專注」開始");
}

// 進入專注頁：先開鏡頭，再載入模型
async function prepareFocusPage() {
  await syncCamera();
  if (!wantCamera()) return;
  await ensureModels();
}

// ===== 頁面切換 =====
let currentPage = "farm";

function showPage(name) {
  currentPage = name;
  farmPage.hidden = name !== "farm";
  focusPage.hidden = name !== "focus";
  window.scrollTo(0, 0);

  if (name === "farm") {
    stopCamera(); // 回農場：關鏡頭
    closePip(); // 回農場：一併關掉浮動視窗
    renderFarm();
  } else {
    renderHistory();
    prepareFocusPage();
  }
}

// 農場：顯示今天收成的番茄
function renderFarm() {
  const today = new Date().toDateString();
  const n = loadHistory().filter((s) => new Date(s.ts).toDateString() === today).length;
  harvestEl.textContent = n > 0 ? "🍅".repeat(Math.min(n, 30)) : "";
  farmCountEl.textContent =
    n > 0 ? `今天已收成 ${n} 顆番茄 🎉` : "今天還沒有收成，點一顆番茄開始吧！";
}

// 點農場上的番茄 → 彈出選模式視窗
document.querySelectorAll(".tomato").forEach((btn) => {
  btn.addEventListener("click", () => {
    modeModal.hidden = false;
  });
});

$("modeCancel").addEventListener("click", () => (modeModal.hidden = true));
modeModal.addEventListener("click", (e) => {
  if (e.target === modeModal) modeModal.hidden = true; // 點背景也能關閉
});

// 選擇模式 → 進入專注頁
document.querySelectorAll(".mode-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    modeBadge.textContent = mode === "CODING" ? "💻 開發模式" : "📖 閱讀模式";
    calibrateBtn.style.display = mode === "CODING" ? "" : "none";
    resetDetection();
    $("report").hidden = true;
    modeModal.hidden = true;
    showPage("focus");
  });
});

backBtn.addEventListener("click", () => {
  if (phase === "IDLE") showPage("farm");
});

// ===== 按鈕 =====
calibrateBtn.addEventListener("click", () => {
  calibrating = true;
  calSamples = [];
  statusEl.className = "";
  statusEl.textContent = "校準中，請正視螢幕 2 秒...";
  setTimeout(() => {
    if (calSamples.length > 0) {
      baseYaw = calSamples.reduce((s, v) => s + v.yaw, 0) / calSamples.length;
      basePitch = calSamples.reduce((s, v) => s + v.pitch, 0) / calSamples.length;
    }
    calibrating = false;
    resetDetection();
  }, 2000);
});

startBtn.addEventListener("click", () => {
  // 必須放在點擊事件裡，瀏覽器才允許開浮動視窗
  if (pipAuto.checked && isPipSupported() && !isPipOpen()) togglePip();

  readDurations();
  plannedFocusSec = FOCUS_SEC;
  stats = newStats();
  secAcc = 0;
  $("report").hidden = true;
  resetDetection();
  startPhase("FOCUS", FOCUS_SEC);
});

resetBtn.addEventListener("click", () => {
  phase = "IDLE";
  clockEl.textContent = fmt(FOCUS_SEC);
  phaseEl.textContent = "尚未開始";
  updateGrowth(0);
  updateButtons();
  syncCamera(); // 如果是在休息時按重置，鏡頭要重新開啟
});

clearHistoryBtn.addEventListener("click", () => {
  if (confirm("確定要清除所有歷史紀錄嗎？")) {
    clearHistory();
    renderHistory();
  }
});

function resetDetection() {
  confirmedState = "FOCUSED";
  candidate = "FOCUSED";
  candidateSince = performance.now();
  smoothYaw = smoothPitch = null;
  prevMid = null;
  smoothSpeed = 0;
}

function startPhase(p, sec) {
  phase = p;
  phaseTotal = sec;
  endTime = Date.now() + sec * 1000;
  phaseEl.textContent = p === "FOCUS" ? "🍅 專注中" : "☕ 休息中";
  if (p === "BREAK") setStatus("☕ 休息一下，鏡頭已關閉");
  updateButtons();
  syncCamera(); // 進入休息 → 關鏡頭
}

function updateButtons() {
  const camReady = modelsReady && cameraOn;
  startBtn.disabled = phase !== "IDLE" || !camReady;
  calibrateBtn.disabled = phase !== "IDLE" || !camReady;
  backBtn.disabled = phase !== "IDLE";
  focusMinEl.disabled = phase !== "IDLE";
  breakMinEl.disabled = phase !== "IDLE";
}

function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// 進度條 + 番茄成長文字
function updateGrowth(remain) {
  if (phase === "IDLE") {
    progressBar.style.width = "0%";
    growthEl.textContent = "🌱 準備種下一顆番茄";
    return;
  }
  const p = Math.min(1, Math.max(0, 1 - remain / phaseTotal));
  progressBar.style.width = `${(p * 100).toFixed(1)}%`;

  if (phase === "BREAK") {
    growthEl.textContent = "☕ 休息一下，番茄正在曬太陽";
    return;
  }
  growthEl.textContent =
    p < 0.33 ? "🌱 種子正在發芽" : p < 0.66 ? "🌿 小番茄正在成長" : "🍅 快成熟了！";
}

// ===== 兩種模式的單幀判定 =====
function analyzeCoding(now) {
  const res = faceLandmarker.detectForVideo(video, now);
  const m = res.facialTransformationMatrixes?.[0]?.data;

  if (!m) {
    smoothYaw = smoothPitch = null;
    return { raw: "ABSENT", text: "偵測不到臉" };
  }

  let yaw = (Math.asin(-m[2]) * 180) / Math.PI;
  let pitch = (Math.atan2(m[6], m[10]) * 180) / Math.PI;
  if (FLIP_YAW) yaw = -yaw;
  if (FLIP_PITCH) pitch = -pitch;

  smoothYaw = smoothYaw === null ? yaw : smoothYaw + SMOOTH * (yaw - smoothYaw);
  smoothPitch = smoothPitch === null ? pitch : smoothPitch + SMOOTH * (pitch - smoothPitch);

  if (calibrating) calSamples.push({ yaw: smoothYaw, pitch: smoothPitch });

  const dy = smoothYaw - baseYaw;
  const dp = smoothPitch - basePitch;
  const raw = Math.abs(dy) > YAW_LIMIT || Math.abs(dp) > PITCH_LIMIT ? "DISTRACTED" : "FOCUSED";
  return { raw, text: `相對基準 yaw: ${dy.toFixed(1)}°  pitch: ${dp.toFixed(1)}°` };
}

function analyzeStudy(now, dt) {
  const res = poseLandmarker.detectForVideo(video, now);
  const lm = res.landmarks?.[0];

  if (!lm) {
    prevMid = null;
    return { raw: "ABSENT", text: "偵測不到人體" };
  }

  const l = lm[11];
  const r = lm[12];
  const ok = (p) => (p.visibility ?? 1) > VIS_MIN && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1;

  if (!ok(l) || !ok(r)) {
    prevMid = null;
    return { raw: "ABSENT", text: "肩膀不在畫面內" };
  }

  const tilt = (Math.atan(Math.abs(r.y - l.y) / Math.max(Math.abs(r.x - l.x), 1e-6)) * 180) / Math.PI;

  const mid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  if (prevMid && dt > 0) {
    const speed = Math.hypot(mid.x - prevMid.x, mid.y - prevMid.y) / dt;
    smoothSpeed += 0.2 * (speed - smoothSpeed);
  }
  prevMid = mid;

  const unstable = tilt > TILT_LIMIT || smoothSpeed > SPEED_LIMIT;
  return {
    raw: unstable ? "DISTRACTED" : "FOCUSED",
    text: `肩線傾角: ${tilt.toFixed(1)}°  移動速度: ${smoothSpeed.toFixed(2)}`,
  };
}

// ===== 時間緩衝 =====
function updateState(newCandidate, now) {
  if (newCandidate !== candidate) {
    candidate = newCandidate;
    candidateSince = now;
  }
  const elapsed = (now - candidateSince) / 1000;
  if (candidate !== confirmedState && elapsed >= DELAY[candidate]) {
    confirmedState = candidate;
    if (phase === "FOCUS") {
      if (confirmedState === "DISTRACTED") stats.distractCount++;
      if (confirmedState === "ABSENT") stats.absentCount++;
    }
  }
}

// ===== 統計 =====
function record(dt) {
  stats.seconds[confirmedState] += dt;

  if (confirmedState === "FOCUSED") {
    stats.currentStreak += dt;
    stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
  } else {
    stats.currentStreak = 0;
  }

  secAcc += dt;
  while (secAcc >= 1) {
    stats.timeline.push(confirmedState);
    secAcc -= 1;
  }
}

// 專注時段結束：存檔並顯示報告
function finishFocus() {
  const s = stats.seconds;
  const session = {
    ts: Date.now(),
    mode,
    plannedSec: plannedFocusSec,
    seconds: {
      FOCUSED: Math.round(s.FOCUSED),
      DISTRACTED: Math.round(s.DISTRACTED),
      ABSENT: Math.round(s.ABSENT),
    },
    distractCount: stats.distractCount,
    absentCount: stats.absentCount,
    longestStreak: Math.round(stats.longestStreak),
    segments: rle(stats.timeline),
  };
  saveSession(session);
  renderReport(session);
  renderHistory();
}

const LABEL = {
  FOCUSED: "✅ 專注中",
  DISTRACTED: "⚠️ 分心",
  ABSENT: "🚫 離座",
};

// ===== 每次 tick 做的事 =====
function tickInner() {
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 2);
  lastFrame = now;

  // 1. 番茄鐘倒數（不依賴鏡頭，休息時照常計時）
  if (phase !== "IDLE") {
    const remain = (endTime - Date.now()) / 1000;
    clockEl.textContent = fmt(remain);
    updateGrowth(remain);

    if (remain <= 0) {
      if (phase === "FOCUS") {
        finishFocus();
        startPhase("BREAK", BREAK_SEC); // 會自動關閉鏡頭
      } else {
        phase = "IDLE";
        phaseEl.textContent = "休息結束，可以開始下一輪";
        clockEl.textContent = fmt(FOCUS_SEC);
        updateGrowth(0);
        updateButtons();
        syncCamera(); // 休息結束 → 重新開鏡頭
      }
    }
  }

  // 2. 影像偵測：只有「鏡頭開著、模型就緒、在專注頁、非休息」才做
  const detecting =
    modelsReady && cameraOn && currentPage === "focus" && phase !== "BREAK" && video.readyState >= 2;
  if (!detecting) return;

  const { raw, text } = mode === "CODING" ? analyzeCoding(now) : analyzeStudy(now, dt);

  if (calibrating) {
    // 校準中不更新狀態
  } else if (phase === "FOCUS") {
    updateState(raw, now);
    record(dt);
    statusEl.className = confirmedState;
    statusEl.textContent = LABEL[confirmedState];
  } else {
    statusEl.className = "";
    statusEl.textContent = "按「開始專注」開始";
  }

  infoEl.textContent = text;
}

// 每次 tick：先做事，再把結果同步到浮動視窗
function tick() {
  tickInner();
  syncPip();
}

// 用 Web Worker 當計時器：比 requestAnimationFrame 更不容易在背景被暫停
const worker = new Worker(
  URL.createObjectURL(
    new Blob([`setInterval(() => postMessage(0), ${TICK_MS});`], {
      type: "text/javascript",
    })
  )
);
worker.onmessage = tick;

// ===== 啟動 =====
loadDurations();
updateButtons();
showPage("farm");

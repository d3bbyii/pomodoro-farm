# 🍅 Pomodoro Farm

**基於電腦視覺之雙模式情境感知番茄鐘系統**

🔗 **[立即體驗 →](https://pomodoro-farm.vercel.app)** ｜ 原始碼：[github.com/d3bbyii/pomodoro-farm](https://github.com/d3bbyii/pomodoro-farm)

一款開瀏覽器就能用、無需安裝的專注力追蹤工具。透過 [Google MediaPipe](https://ai.google.dev/edge/mediapipe) 在本機瀏覽器即時分析視訊影像，判斷使用者是否處於專注狀態，並依「開發」與「閱讀」兩種情境切換不同的判定邏輯。**所有影像運算都在本機完成，不會上傳任何影像到伺服器。**

## 特色

- **雙模式偵測** — 開發模式看頭部姿態，閱讀模式看肩膀姿態，允許低頭看書、抄筆記
- **時間緩衝機制** — 短暫的分心或起身不會被誤判
- **隱私優先** — 影像不落地、不上傳雲端，鏡頭只在專注時段開啟
- **視覺化報告** — 專注比例、分心/離座次數、時間軸、歷史趨勢圖
- **浮動視窗** — 專注時可切換到其他視窗工作，仍看得到倒數與狀態
- **番茄農場介面** — 每完成一輪專注，農場就多一顆番茄

## 快速開始

```bash
npm install
npm run dev
```

開啟終端機顯示的網址（預設 `http://localhost:5173`）。瀏覽器建議使用 **Chrome** 或 **Edge**（對 MediaPipe 與 Picture-in-Picture API 支援較完整）。

## 打包部署

```bash
npm run build
```

`dist/` 資料夾即為可部署的靜態網站。**鏡頭權限需要 HTTPS 或 localhost 環境才能使用。**

本專案已部署於 Vercel：**https://pomodoro-farm.vercel.app**

## 檔案結構

```
pomodoro-farm/
├─ index.html          頁面結構（農場頁、模式選擇、專注頁）
├─ package.json
└─ src/
   ├─ main.js           主邏輯：鏡頭與模型管理、狀態判定、番茄鐘計時
   ├─ report.js         報告與歷史紀錄：資料壓縮儲存、圖表渲染
   ├─ pip.js             浮動視窗：Document Picture-in-Picture
   └─ style.css          視覺樣式
```

## 技術棧

| 項目 | 選擇 |
|---|---|
| 建構工具 | Vite（原生 JavaScript） |
| 電腦視覺 | MediaPipe Tasks Vision（FaceLandmarker、PoseLandmarker） |
| 資料視覺化 | Chart.js |
| 資料持久化 | localStorage |
| 背景常駐 | Document Picture-in-Picture API |
| 計時機制 | Web Worker |

## 授權

僅供個人學習與專題使用。

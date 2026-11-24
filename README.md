# AI 多帳號額度儀表板（AI Quota Dashboard）

> **Local-First · 全本機運作 · 零密碼接觸 · 跨 Windows / macOS ＋ Google Chrome 多設定檔**

整合 **Claude（真實 5h／每週額度）**、**Gemini（多帳號網頁版 ＋ Antigravity CLI ＋ 選用 Gemini CLI）** 與 **ChatGPT Plus（模型分類計數＋限流校準）** 的輕量桌面看板，附帶 **獨立寬版統計與月繳／年繳 CP 值體檢視窗** 及 **滿血復活＋低用量停訂提醒**。

---

## 一、朋友端 3 分鐘快速安裝指南

請前往本專案的 **[GitHub Releases 頁面](https://github.com/dong1121/ai-quota-dashboard/releases)** 下載最新版本：

### 步驟 1：安裝桌面小工具
- **Windows**：
  - 推薦下載 `AI Quota Dashboard Setup x.y.z.exe`（支援未來一鍵自動更新），或下載 `Portable` 免安裝版。
  - 若出現 Windows SmartScreen 藍色提醒，點「其他資訊」→「仍要執行」即可。
- **macOS（Apple Silicon `arm64` / Intel `x64`）**：
  - 下載對應晶片的 `.dmg`，將 App 拖進「應用程式（Applications）」。
  - 首次開啟若出現未簽章提示：在「應用程式」中對 App **按右鍵 → 打開**，或於「系統設定 → 隱私權與安全性」點「仍要打開」一次即可。

### 步驟 2：載入內建 Chrome / Edge 擴充套件（免另外下載 ZIP，以後自動跟隨更新！）
1. 打開桌面小工具右上角 **`[⚙️]`** 設定頁，點擊 **「📂 開啟內建 Chrome / Edge 擴充套件資料夾」**（會直接開啟自動同步目錄 `%APPDATA%\AIQuotaDashboard\chrome-extension`）。
2. 在 Chrome 網址列輸入 `chrome://extensions`（若您是從 **Microsoft Edge** 安裝 Gemini 應用程式，請改開 `edge://extensions`），開啟「**開發人員模式**」。
3. 點擊「**載入未封裝項目**」，選擇剛剛開啟的那個 `chrome-extension` 資料夾（這輩子只需做這 1 次，未來桌面端自動更新時擴充套件也會自動無感重載升級！）。

> 💡 **使用 Claude Cowork、Gemini 桌面應用程式或 Antigravity 桌面 App 的朋友必看**：
> - **Antigravity (CLI / 桌面應用程式)**：開箱自動同時偵測 `~/.gemini/antigravity-cli` 與 `~/.gemini/antigravity`，免額外設定。
> - **Claude Cowork / Gemini 桌面 App**：只要在安裝了擴充套件的 Chrome（或 Edge）中**登入過一次 `claude.ai` 與 `gemini.google.com`**，擴充套件就會每 3–5 分鐘於背景自動同步額度與新增對話！

### 步驟 3：輸入本機配對碼（只需一次）
1. 打開桌面小工具右上角 **`[⚙️]`** 設定頁，複製專屬的 8 碼配對碼（例如 `K8M2-94Q1`）。
2. 點開 Chrome 工具列上的「AI 額度儀表板探針」，貼上配對碼並按「**儲存並測試連線**」。
3. 打開 `claude.ai`、`gemini.google.com` 或 `chatgpt.com`，3 秒內看板就會自動長出對應卡片！

> 💡 **小提示**：
> - 免費版 Gemini CLI 使用者可於桌面小工具 `[⚙️]` →「本機 CLI 監看設定」中開啟「監看標準 Gemini CLI」。
> - 點擊看板標題列 **`[📊]`** 可開啟獨立寬版統計視窗，填寫月繳／年繳費用與扣款日後，系統會自動計算單次成本並在扣款前評估低用量方案。
> - 日後想更新只需在 `[⚙️]` →「版本與自動更新」點 **「檢查更新」** 即可自動下載升級！

---

## 二、作者端：首次上傳 GitHub 與日後發版教學

本專案已內建 `.github/workflows/release.yml` 自動化流程，**不用買 Mac 也能同時打包 Windows `.exe` 與 macOS `.dmg`！**

### A. 首次上傳到 GitHub（只需做一次）
1. 登入 GitHub（帳號 `dong1121`），點右上角 `+` → `New repository`。
2. Repository name 填入 **`ai-quota-dashboard`**，權限選擇 **Public**（免費享有 Windows＋macOS 雲端打包與自動更新託管），不要勾選 Initialize README，點 **Create repository**。
3. 在專案資料夾開啟終端機，依序執行：
   ```powershell
   git init
   git add .
   git commit -m "feat: initial release v0.3.0"
   git branch -M main
   git remote add origin https://github.com/dong1121/ai-quota-dashboard.git
   git push -u origin main
   git tag v0.3.0
   git push origin v0.3.0
   ```
4. 推上 `v0.3.0` 標籤後，打開 GitHub 網頁的 **Actions** 分頁，等待約 4–6 分鐘，完成後所有安裝檔（Windows `.exe`、Portable `.exe`、macOS `.dmg`/`.zip`、Chrome 擴充套件 `.zip`）就會自動出現在 **Releases** 頁面！

### B. 日後修正 Bug 或加新功能：2 步驟輕鬆發新版！
1. 修改完程式碼並更新版本號（例如 `package.json`、`apps/desktop/package.json`、`apps/desktop/src/main/index.ts` 的 `APP_VERSION` 改為 `0.3.1`）。
2. 提交並推上新標籤：
   ```powershell
   git add .
   git commit -m "fix: 修正內容說明"
   git push
   git tag v0.3.1
   git push origin v0.3.1
   ```
3. GitHub Actions 會自動完成測試、雙平台打包與發佈，**所有朋友打開小工具點「檢查更新」就會自動下載安裝新版！**

---

## 三、開發者本機常用指令

```powershell
# 啟動已編譯版桌面看板（日常推薦）
npm.cmd run start:desktop

# 開發模式（熱重載）
npm.cmd run dev:desktop

# 全專案編譯、型別檢查與自動化測試
npm.cmd run build
npm.cmd run typecheck
npm.cmd test

# 本機打包 Chrome 擴充套件 ZIP 與 Windows 安裝檔
npm.cmd run pack:extension
npm.cmd run package:win
```

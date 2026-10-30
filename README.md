# 智慧叫號排隊系統 (Smart Queue Calling System)

專為診所、餐飲手搖、櫃檯服務、活動現場設計的現代化叫號排隊系統。  
零伺服器依賴、純前端設計，可直接部署在 **GitHub Pages** 免費使用！

---

## 🌟 核心功能

1. **🎫 取號功能按鈕**
   - 點擊「按此取號」即可自動按序取號（001、002...）。
   - 提供彈出取號確認小卡，清楚顯示自己的號碼以及前方等候人數。
   - 支援「今日已發」與「目前等候人數」即時統計。

2. **📢 目前顯示到幾號（叫號大看板）**
   - 媲美銀行、診所等級的超大數位 LED 叫號看板，具備發光與閃爍動畫。
   - 支援「叫下一號」、「重新叫號」、「上一號」快捷操作。
   - 可自選叫號櫃檯（例如：1 號櫃檯、2 號櫃檯、快速取餐口）。
   - **真人中文語音廣播**（Web Speech API）＋ **經典排隊「叮咚～」兩聲提示音**（Web Audio API 原生合成音，完全不需載入外部音檔，離線也能響）。

3. **✅ 列表按下去代表這一號好了（核心特色）**
   - 清楚直觀的等候清單卡片。
   - **只要點擊列表中的任意號碼卡片，即代表「這號好了 / 服務完成」**！
   - 點擊後平滑移入「已完成清單」，並附帶處理耗時記錄。
   - 若剛好完成了當前叫號號碼，系統會自動流暢順延至下一位。
   - 提供「誤按復原」功能，防範不小心手滑。

4. **💾 本地資料持久化**
   - 使用瀏覽器 `LocalStorage`，重新整理網頁、關閉瀏覽器後叫號資料都不會遺失。
   - 支援重置歸零與全螢幕大看板模式。

---

## 🚀 部署至 GitHub Pages 教學

你可以輕鬆將這個專案推送到 GitHub，並開啟 GitHub Pages 讓所有平板、手機、電視螢幕共同使用：

### 步驟 1：在 GitHub 上建立一個新的儲存庫 (Repository)
1. 登入 [GitHub](https://github.com/)。
2. 點擊右上角 `+` -> **New repository**。
3. 倉庫名稱輸入例如：`queue-system`。
4. 設定為 **Public**（公開），不要勾選 initialize with README。
5. 點擊 **Create repository**。

### 步驟 2：推送到 GitHub
在終端機（PowerShell 或 Bash）進入本資料夾：

```bash
cd queue-calling-system

# 初始化 Git
git init
git add .
git commit -m "feat: initial commit for queue calling system"

# 將分支重新命名為 main
git branch -M main

# 關聯到你在 GitHub 建立的倉庫（請替換成你的 GitHub 帳號與倉庫名稱）
git remote add origin https://github.com/<你的GitHub帳號>/queue-system.git

# 推送上傳
git push -u origin main
```

### 步驟 3：開啟 GitHub Pages 免費網頁
1. 進入你的 GitHub 儲存庫頁面。
2. 點擊上方的 **Settings**（設定）。
3. 在左側選單點擊 **Pages**。
4. 在 **Build and deployment** 下方的 **Branch** 選擇 `main`，資料夾選擇 `/(root)`。
5. 點擊 **Save**。
6. 等候約 1 分鐘，GitHub 就會產生專屬網址（例如：`https://<你的帳號>.github.io/queue-system/`），任何手機、電腦點開都能直接使用！

---

## 💻 本地離線測試

只要直接用滑鼠雙擊打開資料夾中的 `index.html` 即可在 Chrome、Edge、Safari、Firefox 等任何現代瀏覽器中完整運行！

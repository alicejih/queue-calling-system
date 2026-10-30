/**
 * 智慧叫號排隊系統 - 全域雲端設定檔 (Global Cloud Configuration)
 * 
 * 1. Cloudflare Workers 設定（推薦）：
 *    填入 Cloudflare Worker 網址後，全體顧客與店家將享有毫秒級雙向即時同步！
 *    100% 免費方案（每日 10 萬次請求），免綁卡。
 * 
 * 2. Google 試算表設定（備用）：
 *    支援試算表作為後備資料庫與歷史報表紀錄。
 */

const QUEUE_CONFIG = {
  // Cloudflare Worker 網址 (例如：https://queue-calling.xxxx.workers.dev)
  cloudflareWorkerUrl: '',

  // Google 試算表公開 ID
  spreadsheetId: '1ysyfQCF1XrjR5Ps2tfQexaeUi5gdNdy0Xrl6GwD7KJs',

  // Google Apps Script 網頁應用程式網址 (例如：https://script.google.com/macros/s/.../exec)
  scriptApiUrl: ''
};

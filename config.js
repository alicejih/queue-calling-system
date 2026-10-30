/**
 * 智慧叫號排隊系統 - 全域雲端設定檔 (Global Cloud Configuration)
 * 
 * 只要在此填入 Google Apps Script 部署產生的網頁應用程式網址 (/exec 結尾)，
 * 所有顧客的手機與店家的電腦就會「100% 自動全體連線」，完全不需任何手動設定！
 */

const QUEUE_CONFIG = {
  // Google 試算表公開 ID
  spreadsheetId: '1ysyfQCF1XrjR5Ps2tfQexaeUi5gdNdy0Xrl6GwD7KJs',

  // Google Apps Script 網頁應用程式網址 (例如：https://script.google.com/macros/s/AKfycb.../exec)
  // 店家於後台綁定後會自動存入；若直接填在此處，所有顧客手機進站立即自動同步！
  scriptApiUrl: ''
};

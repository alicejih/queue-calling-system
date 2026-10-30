/**
 * 智慧叫號系統 - Google 試算表雲端專屬後端 (Google Apps Script)
 * 
 * ========================================================
 * 📋 3 分鐘設定教學 (完全免費、100% 掌握在您的 Google 帳號下)
 * ========================================================
 * 1. 打開 Google 雲端硬碟 (Google Drive)，建立一個新的「Google 試算表」，可命名為「叫號系統資料庫」。
 * 2. 點擊試算表頂部選單的【擴充功能】➔【Apps Script】。
 * 3. 把 Apps Script 編輯器內原本的所有程式碼刪除，將本檔案的內容全部複製貼上。
 * 4. 點擊編輯器右上角藍色【部署】按鈕 ➔ 選擇【新部署】。
 * 5. 點擊左側齒輪 ⚙️「選取類型」➔ 選擇【網頁應用程式 (Web App)】：
 *    - 說明：智慧叫號 API
 *    - 執行身分：選「我」(您的 Google 帳號)
 *    - 誰可以存取：選「任何人 (Anyone)」(讓顧客手機與店員能讀取進度)
 * 6. 點擊【部署】(若彈出權限確認，點進階 ➔ 前往專案 ➔ 允許)。
 * 7. 複製產生的「網頁應用程式網址 (URL)」(格式例如：https://script.google.com/macros/s/.../exec)。
 * 8. 回到管理後台 (admin.html)，點擊【📊 試算表設定】貼上網址即可！
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var statusSheet = getOrCreateSheet(ss, "即時狀態");
  
  // 讀取狀態
  var currentNumber = statusSheet.getRange("B2").getValue();
  var lastIssuedNumber = statusSheet.getRange("B3").getValue();
  var counter = statusSheet.getRange("B4").getValue();
  var lastUpdated = statusSheet.getRange("B5").getValue();
  
  // 讀取等候清單
  var waitSheet = getOrCreateSheet(ss, "等候清單");
  var waitData = waitSheet.getDataRange().getValues();
  var waitingList = [];
  for (var i = 1; i < waitData.length; i++) {
    if (waitData[i][0] && waitData[i][1]) {
      waitingList.push({
        id: String(waitData[i][0]),
        number: parseInt(waitData[i][1], 10),
        time: String(waitData[i][2]),
        timestamp: Number(waitData[i][3])
      });
    }
  }
  
  var response = {
    status: "success",
    currentNumber: currentNumber ? parseInt(currentNumber, 10) : null,
    lastIssuedNumber: parseInt(lastIssuedNumber, 10) || 0,
    counter: counter ? String(counter) : "1 號櫃檯",
    lastUpdated: String(lastUpdated),
    waitingList: waitingList
  };
  
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  // 最多等待 10 秒鎖定，保證多人同時取號/叫號不會衝突
  lock.tryLock(10000);
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var statusSheet = getOrCreateSheet(ss, "即時狀態");
    var waitSheet = getOrCreateSheet(ss, "等候清單");
    var logSheet = getOrCreateSheet(ss, "叫號歷史紀錄報表(CSV)");
    
    // 初始化工作表結構
    initSheetsIfEmpty(statusSheet, waitSheet, logSheet);
    
    var data = JSON.parse(e.postData.contents);
    var action = data.action; 
    var payload = data.payload || {};
    var now = new Date();
    var timeStr = Utilities.formatDate(now, "Asia/Taipei", "HH:mm:ss");
    var dateStr = Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd");
    
    if (action === "CALL_NUMBER") {
      statusSheet.getRange("B2").setValue(payload.number);
      if (payload.counter) statusSheet.getRange("B4").setValue(payload.counter);
      statusSheet.getRange("B5").setValue(dateStr + " " + timeStr);
      
      // 寫入 CSV 紀錄
      logSheet.appendRow([dateStr, timeStr, "叫號呼叫", payload.number, payload.counter || "1 號櫃檯", payload.note || "店員叫號"]);
    } 
    else if (action === "TAKE_TICKET") {
      var ticket = payload.ticket;
      statusSheet.getRange("B3").setValue(ticket.number);
      statusSheet.getRange("B5").setValue(dateStr + " " + timeStr);
      
      waitSheet.appendRow([ticket.id, ticket.number, ticket.time, ticket.timestamp]);
      logSheet.appendRow([dateStr, timeStr, "線上/櫃檯取號", ticket.number, "--", "領取號碼牌"]);
    }
    else if (action === "COMPLETE_TICKET") {
      var ticketId = payload.ticketId;
      var rows = waitSheet.getDataRange().getValues();
      for (var r = 1; r < rows.length; r++) {
        if (String(rows[r][0]) === String(ticketId)) {
          waitSheet.deleteRow(r + 1);
          break;
        }
      }
      
      if (payload.nextNumber !== undefined) {
        statusSheet.getRange("B2").setValue(payload.nextNumber || "");
      }
      statusSheet.getRange("B5").setValue(dateStr + " " + timeStr);
      logSheet.appendRow([dateStr, timeStr, "服務完成(這號好了)", payload.number, payload.counter || "1 號櫃檯", "完成辦理"]);
    }
    else if (action === "RESET") {
      statusSheet.getRange("B2").setValue("");
      statusSheet.getRange("B3").setValue(0);
      statusSheet.getRange("B5").setValue(dateStr + " " + timeStr);
      
      // 清空等候清單
      waitSheet.clear();
      waitSheet.appendRow(["TicketID", "Number", "Time", "Timestamp"]);
      logSheet.appendRow([dateStr, timeStr, "系統歸零重置", "--", "--", "清空今日排隊隊列"]);
    }
    else if (action === "SYNC_ALL") {
      var st = payload.state;
      if (st) {
        statusSheet.getRange("B2").setValue(st.currentNumber || "");
        statusSheet.getRange("B3").setValue(st.lastIssuedNumber || 0);
        statusSheet.getRange("B4").setValue(st.settings && st.settings.counter ? st.settings.counter : "1 號櫃檯");
        statusSheet.getRange("B5").setValue(dateStr + " " + timeStr);
        
        waitSheet.clear();
        waitSheet.appendRow(["TicketID", "Number", "Time", "Timestamp"]);
        if (st.waitingList && st.waitingList.length > 0) {
          st.waitingList.forEach(function(t) {
            waitSheet.appendRow([t.id, t.number, t.time, t.timestamp]);
          });
        }
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "success", 
      action: action, 
      timestamp: now.getTime() 
    })).setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "error", 
      message: err.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function initSheetsIfEmpty(statusSheet, waitSheet, logSheet) {
  if (statusSheet.getLastRow() === 0) {
    statusSheet.appendRow(["項目", "數值"]);
    statusSheet.appendRow(["目前叫號 (CurrentNumber)", ""]);
    statusSheet.appendRow(["今日發號流水號 (LastIssued)", "0"]);
    statusSheet.appendRow(["當前櫃檯 (Counter)", "1 號櫃檯"]);
    statusSheet.appendRow(["最後異動時間 (LastUpdated)", ""]);
  }
  if (waitSheet.getLastRow() === 0) {
    waitSheet.appendRow(["TicketID", "Number", "Time", "Timestamp"]);
  }
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(["日期", "時間", "操作動作", "排隊號碼", "櫃檯", "備註說明"]);
  }
}

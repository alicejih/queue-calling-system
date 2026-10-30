/**
 * 智慧叫號系統 - Google 試算表專屬後端 (精確對應使用者欄位設計)
 * 試算表網址：https://docs.google.com/spreadsheets/d/1ysyfQCF1XrjR5Ps2tfQexaeUi5gdNdy0Xrl6GwD7KJs/edit
 * 
 * 欄位結構：
 * 【工作區】
 * A: 目前叫號 | B: 當前櫃檯 | C: 今日發號 | D: 最後更新 | E: 排隊號碼 | F: 取號時間 | G: 當前狀態 | H: ID | I: 時間戳記
 * 
 * 【LOG】
 * A: 日期 | B: 時間 | C: 操作動作 | D: 排隊號碼 | E: 服務櫃檯 | F: 備註詳細
 */

const SHEET_WORKSPACE = "工作區";
const SHEET_LOG = "LOG";

// GET: 顧客手機與店家後台即時讀取最新叫號狀態與現場等候名單
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = getOrCreateSheet(ss, SHEET_WORKSPACE);
  initSheetsIfEmpty(ws, getOrCreateSheet(ss, SHEET_LOG));

  // 讀取 A2:D2 控制台狀態
  var currentNumRaw = ws.getRange("A2").getValue();
  var currentNumber = currentNumRaw !== "" && !isNaN(currentNumRaw) ? parseInt(currentNumRaw, 10) : null;
  var counter = ws.getRange("B2").getValue() || "1 號櫃檯";
  var lastIssuedNumber = parseInt(ws.getRange("C2").getValue(), 10) || 0;
  var lastUpdated = ws.getRange("D2").getValue() || "";

  // 讀取 E~I 欄 (排隊號碼、取號時間、當前狀態、ID、時間戳記)
  var waitingList = [];
  var lastRow = ws.getLastRow();
  if (lastRow >= 2) {
    var rangeData = ws.getRange(2, 5, lastRow - 1, 5).getValues();
    for (var i = 0; i < rangeData.length; i++) {
      var num = rangeData[i][0];
      var time = rangeData[i][1];
      var status = rangeData[i][2];
      var ticketId = rangeData[i][3];
      var ts = rangeData[i][4];
      if (num !== "" && !isNaN(num)) {
        waitingList.push({
          number: parseInt(num, 10),
          time: String(time),
          status: String(status || "等候中"),
          id: String(ticketId || ("T-" + num)),
          timestamp: Number(ts || Date.now())
        });
      }
    }
  }

  var response = {
    status: "success",
    currentNumber: currentNumber,
    lastIssuedNumber: lastIssuedNumber,
    counter: String(counter),
    lastUpdated: String(lastUpdated),
    waitingList: waitingList
  };

  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// POST: 叫號、抽號、完成服務時，寫入工作區並自動留存 LOG 紀錄
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); // 10秒防並發鎖

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ws = getOrCreateSheet(ss, SHEET_WORKSPACE);
    var logSheet = getOrCreateSheet(ss, SHEET_LOG);

    initSheetsIfEmpty(ws, logSheet);

    var data = JSON.parse(e.postData.contents);
    var action = data.action; 
    var payload = data.payload || {};
    var now = new Date();
    var timeStr = Utilities.formatDate(now, "Asia/Taipei", "HH:mm:ss");
    var dateStr = Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd");

    if (action === "CALL_NUMBER") {
      // 1. 更新工作區 A2(目前叫號)、B2(當前櫃檯)、D2(最後更新)
      ws.getRange("A2").setValue(payload.number);
      if (payload.counter) ws.getRange("B2").setValue(payload.counter);
      ws.getRange("D2").setValue(dateStr + " " + timeStr);

      // 2. 更新隊列中該號碼的狀態為「🔔 叫號中」
      updateTicketStatusInWorkspace(ws, payload.number, "🔔 叫號中");

      // 3. 寫入 LOG 工作表
      logSheet.appendRow([dateStr, timeStr, "叫號呼叫", payload.number, payload.counter || "1 號櫃檯", payload.note || "店員叫號"]);
    }
    else if (action === "TAKE_TICKET") {
      var ticket = payload.ticket;

      // 1. 更新工作區 C2(今日發號)、D2(最後更新)
      ws.getRange("C2").setValue(ticket.number);
      ws.getRange("D2").setValue(dateStr + " " + timeStr);

      // 2. 在工作區 E:I 欄位末端加入新票券
      appendTicketToWorkspace(ws, ticket);

      // 3. 寫入 LOG 工作表
      logSheet.appendRow([dateStr, timeStr, "取號抽牌", ticket.number, "--", "領取號碼牌"]);
    }
    else if (action === "COMPLETE_TICKET") {
      // 1. 從工作區 E:I 欄位移除該票券
      removeTicketFromWorkspace(ws, payload.ticketId, payload.number);

      if (payload.nextNumber !== undefined) {
        ws.getRange("A2").setValue(payload.nextNumber || "");
      }
      ws.getRange("D2").setValue(dateStr + " " + timeStr);

      // 2. 寫入 LOG 工作表
      logSheet.appendRow([dateStr, timeStr, "服務完成(這號好了)", payload.number, payload.counter || "1 號櫃檯", "完成辦理"]);
    }
    else if (action === "RESET") {
      // 1. 清空工作區叫號與流水號
      ws.getRange("A2").setValue("");
      ws.getRange("C2").setValue(0);
      ws.getRange("D2").setValue(dateStr + " " + timeStr);

      // 清空 E:I 欄位的排隊隊列
      var lastRow = ws.getLastRow();
      if (lastRow >= 2) {
        ws.getRange(2, 5, lastRow - 1, 5).clearContent();
      }

      // 2. 寫入 LOG 工作表
      logSheet.appendRow([dateStr, timeStr, "系統歸零重置", "--", "--", "清空今日排隊隊列"]);
    }
    else if (action === "SYNC_ALL") {
      var st = payload.state;
      if (st) {
        ws.getRange("A2").setValue(st.currentNumber || "");
        ws.getRange("B2").setValue(st.settings && st.settings.counter ? st.settings.counter : "1 號櫃檯");
        ws.getRange("C2").setValue(st.lastIssuedNumber || 0);
        ws.getRange("D2").setValue(dateStr + " " + timeStr);

        var lastRow = ws.getLastRow();
        if (lastRow >= 2) {
          ws.getRange(2, 5, lastRow - 1, 5).clearContent();
        }

        if (st.waitingList && st.waitingList.length > 0) {
          var rows = [];
          st.waitingList.forEach(function(t) {
            rows.push([
              t.number,
              t.time,
              (t.number === st.currentNumber ? "🔔 叫號中" : "⏳ 等候中"),
              t.id,
              t.timestamp || now.getTime()
            ]);
          });
          ws.getRange(2, 5, rows.length, 5).setValues(rows);
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

// 輔助函式：取得或建立工作表
function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

// 初始化工作表標題列 (精確對應用戶定義的欄位名稱)
function initSheetsIfEmpty(ws, logSheet) {
  // 1. 初始化「工作區」
  if (ws.getRange("A1").getValue() === "") {
    ws.getRange("A1:I1").setValues([[
      "目前叫號", "當前櫃檯", "今日發號", "最後更新", 
      "排隊號碼", "取號時間", "當前狀態", "ID", "時間戳記"
    ]]);
    ws.getRange("A1:I1").setFontWeight("bold").setBackground("#e2e8f0");
  }

  // 2. 初始化「LOG」
  if (logSheet.getRange("A1").getValue() === "") {
    logSheet.getRange("A1:F1").setValues([[
      "日期", "時間", "操作動作", "排隊號碼", "服務櫃檯", "備註詳細"
    ]]);
    logSheet.getRange("A1:F1").setFontWeight("bold").setBackground("#cbd5e1");
  }
}

// 在工作區 E:I 欄位加入新票券
function appendTicketToWorkspace(ws, ticket) {
  var lastRow = ws.getLastRow();
  var targetRow = 2; // 從第 2 列開始尋找第一個空行

  if (lastRow >= 2) {
    var existingNums = ws.getRange(2, 5, lastRow - 1, 1).getValues();
    for (var i = 0; i < existingNums.length; i++) {
      if (existingNums[i][0] === "") {
        targetRow = 2 + i;
        break;
      }
      targetRow = 3 + i;
    }
  }

  ws.getRange(targetRow, 5, 1, 5).setValues([[
    ticket.number,
    ticket.time,
    "⏳ 等候中",
    ticket.id,
    ticket.timestamp || Date.now()
  ]]);
}

// 更新工作區中某號碼的狀態
function updateTicketStatusInWorkspace(ws, number, newStatus) {
  var lastRow = ws.getLastRow();
  if (lastRow < 2) return;
  var data = ws.getRange(2, 5, lastRow - 1, 3).getValues(); // Col E, F, G
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] == number) {
      ws.getRange(2 + i, 7).setValue(newStatus);
      break;
    }
  }
}

// 從工作區 E:I 欄位移除完成的票券並緊縮整理
function removeTicketFromWorkspace(ws, ticketId, number) {
  var lastRow = ws.getLastRow();
  if (lastRow < 2) return;
  var data = ws.getRange(2, 5, lastRow - 1, 5).getValues();
  var remaining = [];

  for (var i = 0; i < data.length; i++) {
    var matchId = ticketId && String(data[i][3]) === String(ticketId);
    var matchNum = (data[i][0] == number);
    if (!matchId && !matchNum && data[i][0] !== "") {
      remaining.push(data[i]);
    }
  }

  // 先清空原本所有 E:I 內容
  ws.getRange(2, 5, lastRow - 1, 5).clearContent();

  // 若還有剩餘的排隊號碼，寫回第 2 列開始
  if (remaining.length > 0) {
    ws.getRange(2, 5, remaining.length, 5).setValues(remaining);
  }
}

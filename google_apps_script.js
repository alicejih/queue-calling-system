/**
 * 智慧叫號系統 - Google 試算表專屬後端 (對應「工作區」與「LOG」兩張工作表)
 * 試算表網址：https://docs.google.com/spreadsheets/d/1ysyfQCF1XrjR5Ps2tfQexaeUi5gdNdy0Xrl6GwD7KJs/edit
 */

const SHEET_WORKSPACE = "工作區";
const SHEET_LOG = "LOG";

// GET: 供顧客手機與店家後台即時抓取最新叫號號碼與等候隊列
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = getOrCreateSheet(ss, SHEET_WORKSPACE);
  initWorkspaceIfEmpty(ws);

  // 讀取頂部狀態 (第 1 列)
  var currentNumRaw = ws.getRange("B1").getValue();
  var currentNumber = currentNumRaw !== "" && !isNaN(currentNumRaw) ? parseInt(currentNumRaw, 10) : null;
  var counter = ws.getRange("D1").getValue() || "1 號櫃檯";
  var lastIssuedNumber = parseInt(ws.getRange("F1").getValue(), 10) || 0;
  var lastUpdated = ws.getRange("H1").getValue() || "";

  // 讀取現場等候清單 (從第 4 列開始)
  var waitingList = [];
  var lastRow = ws.getLastRow();
  if (lastRow >= 4) {
    var rangeData = ws.getRange(4, 1, lastRow - 3, 5).getValues();
    for (var i = 0; i < rangeData.length; i++) {
      var num = rangeData[i][0];
      var time = rangeData[i][1];
      var ticketId = rangeData[i][3];
      var ts = rangeData[i][4] || Date.now();
      if (num !== "" && !isNaN(num)) {
        waitingList.push({
          number: parseInt(num, 10),
          time: String(time),
          status: String(rangeData[i][2] || "等候中"),
          id: String(ticketId || ("T-" + num)),
          timestamp: Number(ts)
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

// POST: 店員點叫號、完成、或顧客手機抽號時，寫入工作區並自動留存 LOG 紀錄
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000); // 10秒防並發鎖

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ws = getOrCreateSheet(ss, SHEET_WORKSPACE);
    var logSheet = getOrCreateSheet(ss, SHEET_LOG);

    initWorkspaceIfEmpty(ws);
    initLogIfEmpty(logSheet);

    var data = JSON.parse(e.postData.contents);
    var action = data.action; 
    var payload = data.payload || {};
    var now = new Date();
    var timeStr = Utilities.formatDate(now, "Asia/Taipei", "HH:mm:ss");
    var dateStr = Utilities.formatDate(now, "Asia/Taipei", "yyyy-MM-dd");

    if (action === "CALL_NUMBER") {
      // 1. 更新工作區目前叫號
      ws.getRange("B1").setValue(payload.number);
      if (payload.counter) ws.getRange("D1").setValue(payload.counter);
      ws.getRange("H1").setValue(dateStr + " " + timeStr);

      // 更新等候清單中該號碼的狀態為「🔔 叫號中」
      updateStatusInWaitingList(ws, payload.number, "🔔 叫號中");

      // 2. 寫入 LOG 工作表 (永久留存)
      logSheet.appendRow([dateStr, timeStr, "叫號呼叫", payload.number, payload.counter || "1 號櫃檯", payload.note || "店員叫號"]);
    }
    else if (action === "TAKE_TICKET") {
      var ticket = payload.ticket;
      // 1. 更新工作區最新流水號
      ws.getRange("F1").setValue(ticket.number);
      ws.getRange("H1").setValue(dateStr + " " + timeStr);

      // 2. 在工作區等候清單新增一列
      var nextRow = Math.max(ws.getLastRow() + 1, 4);
      ws.getRange(nextRow, 1, 1, 5).setValues([[
        ticket.number,
        ticket.time,
        "⏳ 等候中",
        ticket.id,
        ticket.timestamp || now.getTime()
      ]]);

      // 3. 寫入 LOG 工作表
      logSheet.appendRow([dateStr, timeStr, "取號抽牌", ticket.number, "--", "領取號碼牌"]);
    }
    else if (action === "COMPLETE_TICKET") {
      // 1. 從工作區等候清單移除該號碼
      removeTicketFromWaitingList(ws, payload.ticketId, payload.number);

      if (payload.nextNumber !== undefined) {
        ws.getRange("B1").setValue(payload.nextNumber || "");
      }
      ws.getRange("H1").setValue(dateStr + " " + timeStr);

      // 2. 寫入 LOG 工作表
      logSheet.appendRow([dateStr, timeStr, "服務完成(這號好了)", payload.number, payload.counter || "1 號櫃檯", "完成辦理"]);
    }
    else if (action === "RESET") {
      // 1. 清空工作區叫號與流水號
      ws.getRange("B1").setValue("");
      ws.getRange("F1").setValue(0);
      ws.getRange("H1").setValue(dateStr + " " + timeStr);

      // 清空等候名單 (保留前 3 列標題)
      if (ws.getLastRow() >= 4) {
        ws.getRange(4, 1, ws.getLastRow() - 3, 5).clearContent();
      }

      // 2. 寫入 LOG 工作表
      logSheet.appendRow([dateStr, timeStr, "系統歸零重置", "--", "--", "清空今日排隊隊列"]);
    }
    else if (action === "SYNC_ALL") {
      var st = payload.state;
      if (st) {
        ws.getRange("B1").setValue(st.currentNumber || "");
        ws.getRange("D1").setValue(st.settings && st.settings.counter ? st.settings.counter : "1 號櫃檯");
        ws.getRange("F1").setValue(st.lastIssuedNumber || 0);
        ws.getRange("H1").setValue(dateStr + " " + timeStr);

        if (ws.getLastRow() >= 4) {
          ws.getRange(4, 1, ws.getLastRow() - 3, 5).clearContent();
        }

        if (st.waitingList && st.waitingList.length > 0) {
          var rows = [];
          st.waitingList.forEach(function(t) {
            rows.push([
              t.number,
              t.time,
              (t.number === st.currentNumber ? "🔔 叫號中" : "⏳ 等候中"),
              t.id,
              t.timestamp
            ]);
          });
          ws.getRange(4, 1, rows.length, 5).setValues(rows);
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

// 初始化「工作區」格式與標題列
function initWorkspaceIfEmpty(ws) {
  if (ws.getRange("A1").getValue() === "") {
    // 第 1 列：控制儀表板數值
    ws.getRange("A1:H1").setValues([[
      "目前叫號:", "", 
      "當前櫃檯:", "1 號櫃檯", 
      "今日發號:", 0, 
      "最後更新:", Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd HH:mm:ss")
    ]]);
    ws.getRange("A1:H1").setFontWeight("bold");

    // 第 3 列：等候清單表頭
    ws.getRange("A3:E3").setValues([[
      "排隊號碼", "取號時間", "當前狀態", "票號唯一ID", "時間戳記"
    ]]);
    ws.getRange("A3:E3").setBackground("#e2e8f0").setFontWeight("bold");
  }
}

// 初始化「LOG」工作表表頭
function initLogIfEmpty(logSheet) {
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(["日期", "時間", "操作動作", "排隊號碼", "服務櫃檯", "備註詳細"]);
    logSheet.getRange("A1:F1").setBackground("#cbd5e1").setFontWeight("bold");
  }
}

// 更新等候清單狀態
function updateStatusInWaitingList(ws, number, newStatus) {
  var lastRow = ws.getLastRow();
  if (lastRow < 4) return;
  var nums = ws.getRange(4, 1, lastRow - 3, 1).getValues();
  for (var i = 0; i < nums.length; i++) {
    if (nums[i][0] == number) {
      ws.getRange(4 + i, 3).setValue(newStatus);
    } else {
      if (ws.getRange(4 + i, 3).getValue() === "🔔 叫號中") {
        ws.getRange(4 + i, 3).setValue("⏳ 等候中");
      }
    }
  }
}

// 移除已完成的排隊票券
function removeTicketFromWaitingList(ws, ticketId, number) {
  var lastRow = ws.getLastRow();
  if (lastRow < 4) return;
  var rows = ws.getRange(4, 1, lastRow - 3, 4).getValues();
  for (var i = 0; i < rows.length; i++) {
    if ((ticketId && String(rows[i][3]) === String(ticketId)) || (rows[i][0] == number)) {
      ws.deleteRow(4 + i);
      break;
    }
  }
}

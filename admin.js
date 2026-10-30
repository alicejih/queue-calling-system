/**
 * 智慧叫號排隊系統 - 管理端 / 櫃檯控制台邏輯 (Operator & Admin Console Logic)
 * 專為櫃檯人員、店員、護理師與後台管理設計
 */

const adminElements = {
  // 叫號控制台
  adminCurrentNumber: document.getElementById('adminCurrentNumber'),
  adminCounterSelect: document.getElementById('adminCounterSelect'),
  adminCallNextBtn: document.getElementById('adminCallNextBtn'),
  adminCallPrevBtn: document.getElementById('adminCallPrevBtn'),
  adminRepeatCallBtn: document.getElementById('adminRepeatCallBtn'),
  adminIssueTicketBtn: document.getElementById('adminIssueTicketBtn'),
  adminStatusSummary: document.getElementById('adminStatusSummary'),

  // 清單區
  waitingGrid: document.getElementById('adminWaitingGrid'),
  emptyWaitingNotice: document.getElementById('adminEmptyWaitingNotice'),
  completedTableBody: document.getElementById('adminCompletedTableBody'),
  emptyCompletedNotice: document.getElementById('adminEmptyCompletedNotice'),
  logsTableBody: document.getElementById('adminLogsTableBody'),
  emptyLogsNotice: document.getElementById('adminEmptyLogsNotice'),

  waitingListContainer: document.getElementById('waitingListContainer'),
  completedListContainer: document.getElementById('completedListContainer'),
  logsListContainer: document.getElementById('logsListContainer'),

  // 計數器標籤
  tabWaitingCount: document.getElementById('tabWaitingCount'),
  tabCompletedCount: document.getElementById('tabCompletedCount'),
  tabLogsCount: document.getElementById('tabLogsCount'),
  adminWaitingTotal: document.getElementById('adminWaitingTotal'),
  adminIssuedTotal: document.getElementById('adminIssuedTotal'),
  adminCompletedTotal: document.getElementById('adminCompletedTotal'),
  tabBtns: document.querySelectorAll('.tab-btn'),

  // 頂部控制項
  voiceToggleBtn: document.getElementById('voiceToggleBtn'),
  voiceStatusText: document.getElementById('voiceStatusText'),
  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundStatusText: document.getElementById('soundStatusText'),
  openCustomerViewBtn: document.getElementById('openCustomerViewBtn'),
  resetAllBtn: document.getElementById('resetAllBtn'),
  currentYear: document.getElementById('currentYear'),

  // 匯出/匯入按鈕
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  importJsonBtn: document.getElementById('importJsonBtn'),
  jsonFileInput: document.getElementById('jsonFileInput')
};

const ADMIN_PIN_KEY = 'ADMIN_PIN_CODE_V1';
const ADMIN_AUTH_KEY = 'ADMIN_SESSION_AUTH_OK';

function setupAdminAuth() {
  const overlay = document.getElementById('adminAuthOverlay');
  const pinInput = document.getElementById('adminPinInput');
  const loginBtn = document.getElementById('adminLoginBtn');
  const errorMsg = document.getElementById('adminPinError');

  // 若本階段已通過驗證
  if (sessionStorage.getItem(ADMIN_AUTH_KEY) === 'true') {
    if (overlay) overlay.classList.add('hidden');
    return;
  }

  function verifyPin() {
    const entered = (pinInput ? pinInput.value : '').trim();
    const correctPin = localStorage.getItem(ADMIN_PIN_KEY) || '8888';

    if (entered === correctPin) {
      sessionStorage.setItem(ADMIN_AUTH_KEY, 'true');
      if (overlay) overlay.classList.add('hidden');
      if (errorMsg) errorMsg.style.display = 'none';
    } else {
      if (errorMsg) {
        errorMsg.style.display = 'block';
        errorMsg.textContent = 'PIN 碼錯誤！請重新輸入';
      }
      if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
      }
    }
  }

  if (loginBtn) loginBtn.addEventListener('click', verifyPin);
  if (pinInput) {
    pinInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') verifyPin();
    });
    setTimeout(() => pinInput.focus(), 300);
  }
}

function initAdminView() {
  setupAdminAuth();
  loadState();
  setupAdminEventListeners();
  setInterval(updateDurations, 30000);

  if (adminElements.adminCounterSelect) {
    adminElements.adminCounterSelect.value = appState.settings.counter || '1 號櫃檯';
  }

  renderAdminUI();
  updateAudioControlsUI();

  if (adminElements.currentYear) {
    adminElements.currentYear.textContent = new Date().getFullYear();
  }

  // 監聽顧客端或其他視窗更新 (包含跨裝置 MQTT 雲端連線)
  listenToSyncEvents((event) => {
    renderAdminUI();
  });
}

function updateDurations() {
  const badges = document.querySelectorAll('.item-wait-badge');
  badges.forEach(badge => {
    const ts = Number(badge.getAttribute('data-ts'));
    if (ts) {
      badge.textContent = calculateWaitDurationText(ts);
    }
  });
}

// 叫指定號碼 (自動寫入一筆活動日誌)
function adminCall(number) {
  loadState(); // 確保讀取最新狀態
  getAudioContext();
  appState.currentNumber = number;
  const currentCounter = appState.settings.counter || '1 號櫃檯';

  // 寫入動作日誌 (即時紀錄於 JSON / CSV 資料庫)
  logActivity('叫號呼叫', number, currentCounter, '櫃檯廣播叫號');

  saveState('CALL_NUMBER', {
    number: number,
    counter: currentCounter
  });

  renderAdminUI();

  // 本地播放音效與語音
  playDingDong();
  speakCall(number, currentCounter);
}

// 叫下一號
function adminCallNext() {
  loadState(); // 確保讀取最新清單
  if (appState.waitingList.length === 0) {
    alert('目前沒有等候中的號碼！可點擊上方「櫃檯代客發號」。');
    return;
  }

  let targetTicket = null;
  if (appState.currentNumber === null) {
    targetTicket = appState.waitingList[0];
  } else {
    const currentIndex = appState.waitingList.findIndex(t => t.number === appState.currentNumber);
    if (currentIndex !== -1 && currentIndex + 1 < appState.waitingList.length) {
      targetTicket = appState.waitingList[currentIndex + 1];
    } else {
      targetTicket = appState.waitingList.find(t => t.number > (appState.currentNumber || 0)) || appState.waitingList[0];
    }
  }

  if (targetTicket) {
    adminCall(targetTicket.number);
  }
}

// 上一號
function adminCallPrev() {
  loadState();
  if (appState.waitingList.length === 0) return;
  const currentIndex = appState.waitingList.findIndex(t => t.number === appState.currentNumber);
  if (currentIndex > 0) {
    adminCall(appState.waitingList[currentIndex - 1].number);
  } else {
    adminCall(appState.waitingList[0].number);
  }
}

// 重新叫號 (自動寫入一筆活動日誌)
function adminRepeatCall() {
  loadState();
  if (appState.currentNumber === null) {
    if (appState.waitingList.length > 0) {
      adminCall(appState.waitingList[0].number);
    } else {
      alert('目前尚無叫號中的號碼！');
    }
    return;
  }

  logActivity('重新叫號', appState.currentNumber, appState.settings.counter, '再次廣播');
  adminCall(appState.currentNumber);
}

// 櫃檯代客發號 (自動寫入一筆活動日誌)
function adminIssueTicket() {
  loadState(); // 確保流水號最新
  getAudioContext();
  appState.lastIssuedNumber += 1;
  const currentNum = appState.lastIssuedNumber;
  const now = new Date();

  const ticket = {
    id: 'T-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    number: currentNum,
    time: getTimeString(now),
    timestamp: now.getTime()
  };

  appState.waitingList.push(ticket);
  logActivity('櫃檯代客發號', currentNum, appState.settings.counter, '櫃檯發出新號碼');
  saveState('TICKET_TAKEN', { ticket });

  renderAdminUI();
  playSuccessChime();
}

// 核心功能 3：點擊列表號碼代表這一號好了！(自動寫入一筆活動日誌)
function markTicketCompleted(ticketId) {
  loadState(); // 確保以最新狀態操作
  const index = appState.waitingList.findIndex(t => t.id === ticketId);
  if (index === -1) return;

  const ticket = appState.waitingList[index];
  const now = new Date();
  const durationMinutes = Math.max(1, Math.round((now.getTime() - ticket.timestamp) / 60000));

  // 從等候移至已完成
  appState.waitingList.splice(index, 1);
  appState.completedList.unshift({
    ...ticket,
    completedTime: getTimeString(now),
    duration: durationMinutes,
    counter: appState.settings.counter || '1 號櫃檯'
  });

  // 自動寫入完成日誌
  logActivity('服務完成(這號好了)', ticket.number, appState.settings.counter, `等候歷時約 ${durationMinutes} 分鐘`);

  playSuccessChime();

  // 若標記完成的是目前叫號中的號碼，自動順延
  if (appState.currentNumber === ticket.number) {
    if (appState.waitingList.length > 0) {
      const nextTicket = appState.waitingList[0];
      appState.currentNumber = nextTicket.number;
      setTimeout(() => {
        adminCall(nextTicket.number);
      }, 350);
    } else {
      appState.currentNumber = null;
    }
  }

  saveState('TICKET_COMPLETED', { ticketId });
  renderAdminUI();
}

// 誤按復原
function undoCompleted(ticketId) {
  loadState();
  const idx = appState.completedList.findIndex(t => t.id === ticketId);
  if (idx === -1) return;
  const item = appState.completedList.splice(idx, 1)[0];
  appState.waitingList.push({
    id: item.id,
    number: item.number,
    time: item.time,
    timestamp: item.timestamp
  });

  appState.waitingList.sort((a, b) => a.number - b.number);
  logActivity('誤按復原', item.number, '', '放回等候隊列');
  saveState('TICKET_RESTORED');
  renderAdminUI();
}

// 匯出 CSV 試算表報表 (包含完整每一次叫號日誌，Excel 直接開啟)
function exportToCSV() {
  loadState();
  const logs = appState.activityLogs || [];

  if (logs.length === 0 && appState.completedList.length === 0 && appState.waitingList.length === 0) {
    alert('今日尚無任何叫號或取號紀錄可供匯出！');
    return;
  }

  // 加上 UTF-8 BOM (\uFEFF) 讓 Excel 打開不會亂碼
  let csvContent = '\uFEFF紀錄序號,日期,時間,操作動作,排隊號碼,服務櫃檯,備註詳細\n';
  
  if (logs.length > 0) {
    logs.forEach((log, idx) => {
      csvContent += `"${logs.length - idx}","${log.date}","${log.time}","${log.action}","${log.number}","${log.counter}","${log.note}"\n`;
    });
  } else {
    // 備援：若無 activityLogs 則匯出 completedList
    appState.completedList.forEach((t, idx) => {
      csvContent += `"${idx + 1}","今日","${t.completedTime}","服務完成","${formatNumber(t.number)}","${t.counter || '1 號櫃檯'}","等候約 ${t.duration} 分鐘"\n`;
    });
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = `叫號服務完整日誌紀錄_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 匯出 JSON 完整資料 (包含完整狀態與每筆叫號紀錄)
function exportToJSON() {
  loadState();
  const jsonStr = JSON.stringify(appState, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = `queue_full_records_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 匯入 JSON 備份
function importFromJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && (Array.isArray(parsed.waitingList) || Array.isArray(parsed.activityLogs))) {
        applyIncomingState(parsed, 'RESTORE_BACKUP');
        saveState('RESTORE_BACKUP');
        alert('🎉 成功匯入並還原叫號排隊紀錄！');
        renderAdminUI();
      } else {
        alert('檔案格式不符，請確認是有效的叫號備份 JSON 檔案。');
      }
    } catch (err) {
      alert('讀取 JSON 檔案失敗：' + err.message);
    }
  };
  reader.readAsText(file);
}

// 渲染管理端介面
function renderAdminUI() {
  // 1. 叫號面板
  if (appState.currentNumber !== null) {
    adminElements.adminCurrentNumber.textContent = formatNumber(appState.currentNumber);
    adminElements.adminStatusSummary.textContent = `正呼叫 ${formatNumber(appState.currentNumber)} 號至 ${appState.settings.counter || '1 號櫃檯'}`;
    adminElements.adminStatusSummary.className = 'admin-status-text active';
  } else {
    adminElements.adminCurrentNumber.textContent = '---';
    adminElements.adminStatusSummary.textContent = appState.waitingList.length > 0
      ? `等待叫號：尚有 ${appState.waitingList.length} 位顧客等候中`
      : '目前無待辦號碼，可點「代客發號」或等候顧客抽號';
    adminElements.adminStatusSummary.className = 'admin-status-text';
  }

  // 2. 統計數據
  const logCount = (appState.activityLogs || []).length;
  if (adminElements.tabWaitingCount) adminElements.tabWaitingCount.textContent = appState.waitingList.length;
  if (adminElements.tabCompletedCount) adminElements.tabCompletedCount.textContent = appState.completedList.length;
  if (adminElements.tabLogsCount) adminElements.tabLogsCount.textContent = logCount;
  if (adminElements.adminWaitingTotal) adminElements.adminWaitingTotal.textContent = appState.waitingList.length;
  if (adminElements.adminIssuedTotal) adminElements.adminIssuedTotal.textContent = appState.lastIssuedNumber;
  if (adminElements.adminCompletedTotal) adminElements.adminCompletedTotal.textContent = appState.completedList.length;

  // 3. 等候清單（點擊代表這一號好了）
  adminElements.waitingGrid.innerHTML = '';
  if (appState.waitingList.length === 0) {
    adminElements.emptyWaitingNotice.classList.remove('hidden');
  } else {
    adminElements.emptyWaitingNotice.classList.add('hidden');
    appState.waitingList.forEach(ticket => {
      const isCurrent = (ticket.number === appState.currentNumber);
      const card = document.createElement('div');
      card.className = `ticket-item-card admin-interactive ${isCurrent ? 'is-current' : ''}`;
      card.title = `點擊卡片標記「${formatNumber(ticket.number)} 號」服務完成`;

      card.innerHTML = `
        <span class="ticket-badge-current">${isCurrent ? '🔔 叫號中' : '等候中'}</span>
        <div class="card-num-row">
          <span class="item-num">${formatNumber(ticket.number)}</span>
          <span class="item-wait-badge" data-ts="${ticket.timestamp}">${calculateWaitDurationText(ticket.timestamp)}</span>
        </div>
        <div class="item-time-info">取號時間：${ticket.time}</div>
        
        <div class="admin-card-actions">
          <button class="call-this-btn" type="button" title="直接廣播叫此號">
            📢 叫此號
          </button>
          <button class="click-to-finish-btn" type="button" title="標記完成">
            ✅ 這號好了
          </button>
        </div>
      `;

      // 點擊「叫此號」
      const callBtn = card.querySelector('.call-this-btn');
      callBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        adminCall(ticket.number);
      });

      // 點擊卡片或「這號好了」標記完成
      card.addEventListener('click', () => {
        markTicketCompleted(ticket.id);
      });

      adminElements.waitingGrid.appendChild(card);
    });
  }

  // 4. 已完成清單
  adminElements.completedTableBody.innerHTML = '';
  if (appState.completedList.length === 0) {
    adminElements.emptyCompletedNotice.classList.remove('hidden');
  } else {
    adminElements.emptyCompletedNotice.classList.add('hidden');
    appState.completedList.forEach(ticket => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="num-tag">${formatNumber(ticket.number)}</span></td>
        <td>${ticket.time}</td>
        <td>${ticket.completedTime}</td>
        <td>約 ${ticket.duration} 分鐘</td>
        <td>${ticket.counter || '1 號櫃檯'}</td>
        <td>
          <button class="undo-btn" data-id="${ticket.id}" title="誤按復原">↩ 復原</button>
        </td>
      `;

      tr.querySelector('.undo-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        undoCompleted(ticket.id);
      });

      adminElements.completedTableBody.appendChild(tr);
    });
  }

  // 5. 即時動作日誌 (即時 CSV / JSON 紀錄預覽)
  if (adminElements.logsTableBody) {
    adminElements.logsTableBody.innerHTML = '';
    const logs = appState.activityLogs || [];
    if (logs.length === 0) {
      if (adminElements.emptyLogsNotice) adminElements.emptyLogsNotice.classList.remove('hidden');
    } else {
      if (adminElements.emptyLogsNotice) adminElements.emptyLogsNotice.classList.add('hidden');
      logs.forEach(log => {
        const tr = document.createElement('tr');
        let badgeClass = 'badge-call';
        if (log.action.includes('取號')) badgeClass = 'badge-ticket';
        if (log.action.includes('完成')) badgeClass = 'badge-complete';
        if (log.action.includes('重置')) badgeClass = 'badge-danger';

        tr.innerHTML = `
          <td>${log.time}</td>
          <td><span class="action-tag ${badgeClass}">${log.action}</span></td>
          <td><span class="num-tag">${log.number}</span></td>
          <td>${log.counter}</td>
          <td>${log.note}</td>
        `;
        adminElements.logsTableBody.appendChild(tr);
      });
    }
  }
}

function updateAudioControlsUI() {
  if (adminElements.voiceToggleBtn) {
    if (appState.settings.voiceEnabled) {
      adminElements.voiceToggleBtn.classList.add('active');
      adminElements.voiceStatusText.textContent = '開啟';
    } else {
      adminElements.voiceToggleBtn.classList.remove('active');
      adminElements.voiceStatusText.textContent = '靜音';
    }
  }

  if (adminElements.soundToggleBtn) {
    if (appState.settings.soundEnabled) {
      adminElements.soundToggleBtn.classList.add('active');
      adminElements.soundStatusText.textContent = '開啟';
    } else {
      adminElements.soundToggleBtn.classList.remove('active');
      adminElements.soundStatusText.textContent = '靜音';
    }
  }
}

function setupAdminEventListeners() {
  // 叫號控制
  adminElements.adminCallNextBtn.addEventListener('click', adminCallNext);
  adminElements.adminCallPrevBtn.addEventListener('click', adminCallPrev);
  adminElements.adminRepeatCallBtn.addEventListener('click', adminRepeatCall);
  adminElements.adminIssueTicketBtn.addEventListener('click', adminIssueTicket);

  // 櫃檯切換
  adminElements.adminCounterSelect.addEventListener('change', (e) => {
    appState.settings.counter = e.target.value;
    saveState('SETTINGS_UPDATED');
    renderAdminUI();
  });

  // 頁籤切換 (等候中 / 已完成 / 即時日誌)
  adminElements.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      adminElements.tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      adminElements.waitingListContainer.classList.add('hidden');
      adminElements.completedListContainer.classList.add('hidden');
      if (adminElements.logsListContainer) adminElements.logsListContainer.classList.add('hidden');

      if (tab === 'waiting') {
        adminElements.waitingListContainer.classList.remove('hidden');
      } else if (tab === 'completed') {
        adminElements.completedListContainer.classList.remove('hidden');
      } else if (tab === 'logs') {
        if (adminElements.logsListContainer) adminElements.logsListContainer.classList.remove('hidden');
      }
    });
  });

  // 音效與語音
  adminElements.voiceToggleBtn.addEventListener('click', () => {
    appState.settings.voiceEnabled = !appState.settings.voiceEnabled;
    updateAudioControlsUI();
    saveState('SETTINGS_UPDATED');
  });

  adminElements.soundToggleBtn.addEventListener('click', () => {
    appState.settings.soundEnabled = !appState.settings.soundEnabled;
    updateAudioControlsUI();
    saveState('SETTINGS_UPDATED');
    if (appState.settings.soundEnabled) playDingDong();
  });

  // 顧客手機查號 QR Code 彈窗
  const showQrBtn = document.getElementById('showQrCodeBtn');
  const qrModal = document.getElementById('qrModal');
  const closeQrBtn = document.getElementById('closeQrModalBtn');
  const copyUrlBtn = document.getElementById('copyCustomerUrlBtn');
  const qrImage = document.getElementById('qrImage');
  const qrText = document.getElementById('qrCustomerUrlText');

  function getCustomerPortalUrl() {
    let baseUrl = window.location.origin + window.location.pathname.replace(/admin\.html.*$/, 'index.html');
    if (!baseUrl.startsWith('http')) {
      baseUrl = 'https://alicejih.github.io/queue-calling-system/';
    }
    const apiUrl = getSheetApiUrl();
    if (apiUrl) {
      return `${baseUrl}?api=${encodeURIComponent(apiUrl)}`;
    }
    return baseUrl;
  }

  if (showQrBtn && qrModal) {
    showQrBtn.addEventListener('click', () => {
      const url = getCustomerPortalUrl();
      if (qrImage) {
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
      }
      if (qrText) {
        qrText.textContent = url;
      }
      qrModal.classList.remove('hidden');
    });
  }
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
      const url = getCustomerPortalUrl();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          alert('📋 顧客查號專用網址已複製！您可以發送至 LINE 或公告。');
        }).catch(() => {
          prompt('請複製以下顧客查號連結：', url);
        });
      } else {
        prompt('請複製以下顧客查號連結：', url);
      }
    });
  }
  if (closeQrBtn && qrModal) {
    closeQrBtn.addEventListener('click', () => {
      qrModal.classList.add('hidden');
    });
  }
  if (qrModal) {
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) qrModal.classList.add('hidden');
    });
  }

  // Google 試算表連線設定彈窗
  const openSheetBtn = document.getElementById('openSheetSettingsBtn');
  const sheetModal = document.getElementById('sheetSettingsModal');
  const closeSheetBtn = document.getElementById('closeSheetModalBtn');
  const saveSheetBtn = document.getElementById('saveSheetUrlBtn');
  const sheetInput = document.getElementById('sheetApiUrlInput');

  if (openSheetBtn && sheetModal) {
    openSheetBtn.addEventListener('click', () => {
      if (sheetInput) sheetInput.value = getSheetApiUrl();
      sheetModal.classList.remove('hidden');
    });
  }
  if (closeSheetBtn && sheetModal) {
    closeSheetBtn.addEventListener('click', () => {
      sheetModal.classList.add('hidden');
    });
  }
  if (sheetModal) {
    sheetModal.addEventListener('click', (e) => {
      if (e.target === sheetModal) sheetModal.classList.add('hidden');
    });
  }
  if (saveSheetBtn && sheetInput) {
    saveSheetBtn.addEventListener('click', () => {
      const url = sheetInput.value.trim();
      setSheetApiUrl(url);
      alert(url ? '🎉 成功綁定 Google 試算表！系統已啟動雙向自動同步與 CSV 寫入。' : '已清除 Google 試算表網址，切換為本地模式。');
      if (sheetModal) sheetModal.classList.add('hidden');
      renderAdminUI();
    });
  }

  // 打開顧客端網頁
  if (adminElements.openCustomerViewBtn) {
    adminElements.openCustomerViewBtn.addEventListener('click', () => {
      window.open('index.html', 'CustomerWindow');
    });
  }

  // 匯出 CSV 與 JSON
  if (adminElements.exportCsvBtn) {
    adminElements.exportCsvBtn.addEventListener('click', exportToCSV);
  }
  if (adminElements.exportJsonBtn) {
    adminElements.exportJsonBtn.addEventListener('click', exportToJSON);
  }
  if (adminElements.importJsonBtn && adminElements.jsonFileInput) {
    adminElements.importJsonBtn.addEventListener('click', () => {
      adminElements.jsonFileInput.click();
    });
    adminElements.jsonFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importFromJSON(e.target.files[0]);
        e.target.value = ''; // 重置 input
      }
    });
  }

  // 重置歸零
  adminElements.resetAllBtn.addEventListener('click', () => {
    if (confirm('確定要清空今天所有號碼與排隊紀錄並歸零嗎？此動作將同步清除現場大螢幕！建議清空前可先點「📥 匯出 CSV」留存紀錄。')) {
      logActivity('系統歸零重置', '--', '--', '清空今日排隊資料');
      appState.currentNumber = null;
      appState.lastIssuedNumber = 0;
      appState.waitingList = [];
      appState.completedList = [];
      saveState('RESET_ALL');
      renderAdminUI();
    }
  });
}

window.addEventListener('DOMContentLoaded', initAdminView);

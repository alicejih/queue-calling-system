/**
 * 智慧叫號排隊系統 - 顧客手機查號專屬邏輯 (Live Customer Calling Board)
 * 專為顧客在手機隨時查閱現場叫號進度、輸入自己號碼即時計算差幾人與自訂震動提醒設計
 */

const customerElements = {
  // 現場叫號大看板
  currentNumberDisplay: document.getElementById('currentNumberDisplay'),
  displaySubtext: document.getElementById('displaySubtext'),
  activeCounterBadge: document.getElementById('activeCounterBadge'),
  waitingCountDisplay: document.getElementById('waitingCountDisplay'),
  totalIssuedDisplay: document.getElementById('totalIssuedDisplay'),
  liveClock: document.getElementById('liveClock'),

  // 顧客號碼牌查詢與計算
  myNumberInput: document.getElementById('myNumberInput'),
  checkMyNumberBtn: document.getElementById('checkMyNumberBtn'),
  clearMyNumberBtn: document.getElementById('clearMyNumberBtn'),
  myResultBox: document.getElementById('myResultBox'),
  myResultMainText: document.getElementById('myResultMainText'),
  myResultSubText: document.getElementById('myResultSubText'),
  myResultVibrateHint: document.getElementById('myResultVibrateHint'),

  // 可直接到櫃檯領取清單
  pickupNumbersGrid: document.getElementById('pickupNumbersGrid'),
  pickupCountBadge: document.getElementById('pickupCountBadge'),

  // 是否需要到號震動提醒 (是/否)
  needVibrateSelect: document.getElementById('needVibrateSelect')
};

const CUSTOMER_SAVED_NUMBER_KEY = 'CUSTOMER_TRACKED_NUMBER_V1';
const CUSTOMER_NEED_VIBRATE_KEY = 'CUSTOMER_NEED_VIBRATE_V1';
let lastNotifiedCallNumber = null;
let lastVibratedKey = null;

function initCustomerView() {
  loadState();

  // 還原先前輸入的號碼牌
  const savedNum = localStorage.getItem(CUSTOMER_SAVED_NUMBER_KEY);
  if (savedNum && customerElements.myNumberInput) {
    customerElements.myNumberInput.value = savedNum;
  }

  // 還原是否需要到號震動提醒 (預設為 'yes')
  const savedVibrate = localStorage.getItem(CUSTOMER_NEED_VIBRATE_KEY);
  if (savedVibrate && customerElements.needVibrateSelect) {
    customerElements.needVibrateSelect.value = savedVibrate;
  }

  setupCustomerEventListeners();
  updateClock();
  setInterval(updateClock, 1000);

  renderCustomerUI();
  updateMyNumberStatus();

  // 監聽來自店家櫃檯後台的即時叫號操作 (支援本地、Google 試算表即時雙向連線)
  listenToSyncEvents((event) => {
    renderCustomerUI();
    updateMyNumberStatus();

    // 叫號跳動與震動提醒
    if (event.type === 'CALL_NUMBER' || event.type === 'SHEET_SYNC_UPDATE') {
      if (event.number !== null && event.number !== undefined && event.number !== lastNotifiedCallNumber) {
        lastNotifiedCallNumber = event.number;
        handleIncomingCallEvent(event.number, event.counter);
      }
    }
  });
}

function updateClock() {
  if (customerElements.liveClock) {
    customerElements.liveClock.textContent = getTimeString();
  }
}

// 收到叫號事件時的顧客端處理 (純視覺閃爍與震動，無任何音效廣播)
function handleIncomingCallEvent(calledNum, counter) {
  // 畫面數字閃爍動畫
  if (customerElements.currentNumberDisplay) {
    customerElements.currentNumberDisplay.classList.remove('flash');
    void customerElements.currentNumberDisplay.offsetWidth;
    customerElements.currentNumberDisplay.classList.add('flash');
  }

  checkAndTriggerVibration(calledNum);
}

// 執行震動
function doVibrate(pattern) {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}

// 檢查是否叫到自己號碼（到號時差 0 人自動震動提醒）
function checkAndTriggerVibration(calledNum) {
  const needVibrate = customerElements.needVibrateSelect ? customerElements.needVibrateSelect.value : 'yes';
  if (needVibrate === 'no') return;

  const myNumStr = customerElements.myNumberInput ? customerElements.myNumberInput.value.trim() : '';
  if (!myNumStr || isNaN(myNumStr)) return;
  const myNum = parseInt(myNumStr, 10);
  if (myNum <= 0) return;

  const pickupNumbers = getCalledPendingPickupNumbers();

  // 到號時震動 (差 0 人)：現場叫到自己號碼或在可取件名單時震動
  if (calledNum === myNum || pickupNumbers.includes(myNum)) {
    const key = `PICKUP_${myNum}`;
    if (lastVibratedKey !== key) {
      lastVibratedKey = key;
      doVibrate([500, 200, 500, 200, 500]);
    }
  }
}

// 核心計算：顧客輸入自己的號碼牌，即時計算前面還差幾個人與震動提示
function updateMyNumberStatus() {
  const input = customerElements.myNumberInput;
  if (!input) return;

  const valStr = input.value.trim();
  const resultBox = customerElements.myResultBox;
  const mainText = customerElements.myResultMainText;
  const subText = customerElements.myResultSubText;
  const clearBtn = customerElements.clearMyNumberBtn;
  const vibrateHint = customerElements.myResultVibrateHint;
  const needVibrate = customerElements.needVibrateSelect ? customerElements.needVibrateSelect.value : 'yes';

  // 即時更新上方可領取號碼清單（若顧客輸入號碼，該號碼牌會同步高亮標示）
  renderPickupReadyNumbers();

  if (!valStr || isNaN(valStr)) {
    if (resultBox) resultBox.classList.add('hidden');
    if (clearBtn) clearBtn.classList.add('hidden');
    return;
  }

  const myNum = parseInt(valStr, 10);
  if (myNum <= 0) {
    if (resultBox) resultBox.classList.add('hidden');
    return;
  }

  // 儲存號碼到本地快取
  localStorage.setItem(CUSTOMER_SAVED_NUMBER_KEY, String(myNum));
  if (clearBtn) clearBtn.classList.remove('hidden');
  if (resultBox) {
    resultBox.classList.remove('hidden');
    resultBox.style.display = 'block';
  }

  const cur = appState.currentNumber;
  const waitingList = Array.isArray(appState.waitingList) ? appState.waitingList : [];
  const pickupNumbers = getCalledPendingPickupNumbers();
  const isReadyForPickup = pickupNumbers.includes(myNum);

  // 情況 1：已叫號，可直接前往櫃檯領取！（已叫號但尚未更改為好了）
  if (isReadyForPickup) {
    resultBox.style.background = 'rgba(16, 185, 129, 0.22)';
    resultBox.style.border = '1.5px solid #10b981';
    resultBox.style.color = '#34d399';
    mainText.innerHTML = '🎉 您的號碼已叫號！可直接前往櫃檯領取';
    subText.textContent = `您持有的號碼為 ${formatNumber(myNum)} 號，已叫號完成，請立即至【${appState.settings.counter || '1 號櫃檯'}】領取/辦理！`;
    if (vibrateHint) {
      if (needVibrate === 'no') {
        vibrateHint.innerHTML = '🔕 已到號（已關閉震動提醒）';
      } else {
        vibrateHint.innerHTML = '📳 <strong>已到號，手機已發出震動提醒！</strong>';
      }
    }
    checkAndTriggerVibration(myNum);
    return;
  }

  // 情況 2：號碼已過號（小於目前叫號且不在可領取名單中）
  if (cur !== null && myNum < cur) {
    resultBox.style.background = 'rgba(239, 68, 68, 0.18)';
    resultBox.style.border = '1.5px solid #ef4444';
    resultBox.style.color = '#f87171';
    mainText.innerHTML = `⚠️ 您的號碼 ${formatNumber(myNum)} 號可能已過號或已取件完成`;
    subText.textContent = `現場目前叫至 ${formatNumber(cur)} 號，若您尚未領取請直接向櫃檯人員洽詢辦理！`;
    if (vibrateHint) {
      vibrateHint.innerHTML = 'ℹ️ 若需補辦或取件請洽現場工作人員';
    }
    return;
  }

  // 情況 3：排隊等候中，計算目前還差幾個人
  resultBox.style.background = 'rgba(59, 130, 246, 0.18)';
  resultBox.style.border = '1.5px solid #3b82f6';
  resultBox.style.color = '#60a5fa';

  let ahead = 0;
  // 若隊列中含有該號碼，隊列排序位置即為前面人數
  const idxInWait = waitingList.findIndex(t => t.number === myNum);
  if (idxInWait !== -1) {
    ahead = idxInWait;
  } else {
    // 若號碼不在隊列物件中，以目前叫號比對差額計算
    if (cur !== null) {
      ahead = Math.max(0, myNum - cur);
    } else {
      ahead = myNum;
    }
  }

  if (ahead === 0) {
    mainText.innerHTML = '⚡ 下一位即將輪到您！';
    subText.textContent = `您是第 ${formatNumber(myNum)} 號，請在櫃檯附近準備！`;
  } else {
    mainText.innerHTML = `⏳ 目前前面還差 <strong style="font-size: 1.6rem; color: #fbbf24; font-family: 'Share Tech Mono', monospace; text-shadow: 0 0 10px rgba(251,191,36,0.3);">${ahead}</strong> 個人`;
    subText.textContent = `您的號碼牌：${formatNumber(myNum)} 號 ｜ 現場叫至：${cur !== null ? formatNumber(cur) + ' 號' : '無叫號'}`;
  }

  if (vibrateHint) {
    if (needVibrate === 'no') {
      vibrateHint.innerHTML = '🔕 已設定為不需到號震動提醒';
    } else {
      vibrateHint.innerHTML = '📳 到號時（差 0 人）手機將自動震動提醒';
    }
  }
}

// 渲染「可直接到櫃檯領取（已叫號但尚未更改狀態為好了）」號碼清單
function renderPickupReadyNumbers() {
  if (!customerElements.pickupNumbersGrid) return;

  const pickupNumbers = getCalledPendingPickupNumbers();
  const myNumStr = customerElements.myNumberInput ? customerElements.myNumberInput.value.trim() : '';
  const myNum = myNumStr && !isNaN(myNumStr) ? parseInt(myNumStr, 10) : null;

  if (customerElements.pickupCountBadge) {
    customerElements.pickupCountBadge.textContent = `${pickupNumbers.length} 個`;
  }

  if (pickupNumbers.length === 0) {
    customerElements.pickupNumbersGrid.innerHTML = '<div class="pickup-empty-hint">目前無待領取的已叫號號碼</div>';
    return;
  }

  customerElements.pickupNumbersGrid.innerHTML = '';
  pickupNumbers.forEach(num => {
    const isMine = (myNum !== null && num === myNum);
    const pill = document.createElement('div');
    pill.className = `pickup-pill ${isMine ? 'is-mine' : ''}`;
    pill.innerHTML = `
      <span class="pickup-pill-num">${formatNumber(num)} 號</span>
      <span class="pickup-pill-tag">${isMine ? '您的號碼' : '可領取'}</span>
    `;
    customerElements.pickupNumbersGrid.appendChild(pill);
  });
}

// 渲染現場叫號看板
function renderCustomerUI() {
  if (!customerElements.currentNumberDisplay) return;

  if (appState.currentNumber !== null) {
    customerElements.currentNumberDisplay.textContent = formatNumber(appState.currentNumber);
    if (customerElements.activeCounterBadge) {
      customerElements.activeCounterBadge.textContent = appState.settings.counter || '1 號櫃檯';
      customerElements.activeCounterBadge.style.display = 'inline-block';
    }
    if (customerElements.displaySubtext) {
      customerElements.displaySubtext.textContent = `請 ${formatNumber(appState.currentNumber)} 號至 ${appState.settings.counter || '櫃檯'} 辦理`;
      customerElements.displaySubtext.classList.add('highlight');
    }
  } else {
    customerElements.currentNumberDisplay.textContent = '---';
    if (customerElements.activeCounterBadge) {
      customerElements.activeCounterBadge.style.display = 'none'; // 絕不顯示待命中
    }
    if (customerElements.displaySubtext) {
      const waitCount = Array.isArray(appState.waitingList) ? appState.waitingList.length : 0;
      customerElements.displaySubtext.textContent = waitCount > 0
        ? `目前現場有 ${waitCount} 位貴賓等候中`
        : '目前暫無叫號中顧客';
      customerElements.displaySubtext.classList.remove('highlight');
    }
  }

  // 統計數字 (僅現場等候)
  if (customerElements.waitingCountDisplay) {
    customerElements.waitingCountDisplay.textContent = Array.isArray(appState.waitingList) ? appState.waitingList.length : 0;
  }

  // 渲染可至櫃檯領取號碼清單
  renderPickupReadyNumbers();
}

function setupCustomerEventListeners() {
  // 查詢我的號碼牌按鈕與即時輸入事件
  if (customerElements.checkMyNumberBtn) {
    customerElements.checkMyNumberBtn.addEventListener('click', updateMyNumberStatus);
  }
  if (customerElements.myNumberInput) {
    customerElements.myNumberInput.addEventListener('input', updateMyNumberStatus);
    customerElements.myNumberInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') updateMyNumberStatus();
    });
  }
  if (customerElements.clearMyNumberBtn) {
    customerElements.clearMyNumberBtn.addEventListener('click', () => {
      customerElements.myNumberInput.value = '';
      localStorage.removeItem(CUSTOMER_SAVED_NUMBER_KEY);
      lastVibratedKey = null;
      updateMyNumberStatus();
    });
  }

  // 是否需要到號震動提醒切換事件 (是/否)
  if (customerElements.needVibrateSelect) {
    customerElements.needVibrateSelect.addEventListener('change', () => {
      localStorage.setItem(CUSTOMER_NEED_VIBRATE_KEY, customerElements.needVibrateSelect.value);
      lastVibratedKey = null;
      updateMyNumberStatus();
    });
  }
}

window.addEventListener('DOMContentLoaded', initCustomerView);

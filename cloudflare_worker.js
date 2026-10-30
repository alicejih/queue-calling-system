/**
 * 智慧叫號排隊系統 - Cloudflare Worker 雲端超高速即時後端
 * 
 * 特色：
 * 1. 0 費用保證：完全使用 Cloudflare 免費方案（每日 100,000 次免費請求額度，終生免費，無需綁卡）
 * 2. 毫秒級極速回應：利用全球邊緣節點（台灣台北/香港/東京節點），延遲低至 10~30ms
 * 3. 完美支援 CORS：跨域無阻礙，顧客手機與店家後台直接雙向通訊
 * 4. 支援 KV 永久儲存：可綁定 KV Namespace (QUEUE_KV)，亦具備記憶體自動容錯 fallback
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json; charset=utf-8'
};

// 邊緣記憶體狀態暫存
let memoryState = {
  currentNumber: null,
  lastIssuedNumber: 0,
  waitingList: [],
  completedList: [],
  counter: '1 號櫃檯',
  updatedAt: Date.now()
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 處理瀏覽器 CORS OPTIONS 預檢
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    // 取得即時狀態 (優先從 KV，若無綁定則從記憶體)
    async function getState() {
      if (env && env.QUEUE_KV) {
        try {
          const val = await env.QUEUE_KV.get('queue_state', { type: 'json' });
          if (val) return val;
        } catch (e) {
          console.error('KV get error:', e);
        }
      }
      return memoryState;
    }

    // 寫入儲存狀態
    async function saveState(newState) {
      newState.updatedAt = Date.now();
      memoryState = newState;
      if (env && env.QUEUE_KV) {
        try {
          await env.QUEUE_KV.put('queue_state', JSON.stringify(newState));
        } catch (e) {
          console.error('KV put error:', e);
        }
      }
      return newState;
    }

    // 1. GET 路由：取得當前叫號最新狀態
    if (request.method === 'GET') {
      const state = await getState();
      return new Response(JSON.stringify({ status: 'success', data: state }), {
        headers: CORS_HEADERS
      });
    }

    // 2. POST 路由：執行叫號、取號、完成或重置動作
    if (request.method === 'POST') {
      try {
        const body = await request.json();
        const action = body.action || '';
        const payload = body.payload || {};
        let state = await getState();

        if (action === 'CALL_NUMBER') {
          const num = payload.number;
          state.currentNumber = num;
          if (payload.counter) state.counter = payload.counter;

          if (Array.isArray(state.waitingList)) {
            state.waitingList = state.waitingList.map(t => {
              if (t.number === num) {
                return { ...t, called: true, status: '叫號中（可領取）' };
              }
              return t;
            });
          }
        } else if (action === 'TAKE_TICKET') {
          const ticket = payload.ticket;
          if (ticket && ticket.number) {
            state.lastIssuedNumber = Math.max(state.lastIssuedNumber || 0, ticket.number);
            if (!Array.isArray(state.waitingList)) state.waitingList = [];
            const exists = state.waitingList.some(t => t.number === ticket.number);
            if (!exists) {
              state.waitingList.push(ticket);
            }
          }
        } else if (action === 'COMPLETE_TICKET') {
          const num = payload.number;
          const ticketId = payload.ticketId;
          if (Array.isArray(state.waitingList)) {
            const foundIdx = state.waitingList.findIndex(t => (num && t.number === num) || (ticketId && t.id === ticketId));
            if (foundIdx !== -1) {
              const [completed] = state.waitingList.splice(foundIdx, 1);
              if (!Array.isArray(state.completedList)) state.completedList = [];
              state.completedList.unshift({
                ...completed,
                completedAt: Date.now(),
                status: '已完成'
              });
            }
          }
          if (state.currentNumber === num) {
            state.currentNumber = null;
          }
        } else if (action === 'RESET' || action === 'RESET_ALL') {
          state = {
            currentNumber: null,
            lastIssuedNumber: 0,
            waitingList: [],
            completedList: [],
            counter: state.counter || '1 號櫃檯',
            updatedAt: Date.now()
          };
        } else if (action === 'SYNC_ALL') {
          if (payload.state) {
            state = {
              currentNumber: payload.state.currentNumber ?? null,
              lastIssuedNumber: payload.state.lastIssuedNumber ?? 0,
              waitingList: Array.isArray(payload.state.waitingList) ? payload.state.waitingList : [],
              completedList: Array.isArray(payload.state.completedList) ? payload.state.completedList : [],
              counter: payload.state.settings?.counter || state.counter || '1 號櫃檯',
              updatedAt: Date.now()
            };
          }
        }

        const saved = await saveState(state);
        return new Response(JSON.stringify({ status: 'success', data: saved }), {
          headers: CORS_HEADERS
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: 'error', message: err.message }), {
          status: 400,
          headers: CORS_HEADERS
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: CORS_HEADERS
    });
  }
};

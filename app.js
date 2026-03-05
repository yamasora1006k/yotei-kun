// ============================================================
// Firebase 設定
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBgAPSkl6z3g3gpx4lrdhzFGCGGt2O-D5k",
  authDomain:        "yotei-kun-6f3c9.firebaseapp.com",
  projectId:         "yotei-kun-6f3c9",
  storageBucket:     "yotei-kun-6f3c9.firebasestorage.app",
  messagingSenderId: "1054294396317",
  appId:             "1:1054294396317:web:5bba7e8d9cbf3086737374",
  measurementId:     "G-MZW4ZD5QBE"
};

// Firebase 関数リファレンス（動的インポート後にセット）
// ※ 静的 import の代わりに動的インポートを使うことで、
//   Firebase CDN が読めない環境でも他の機能が確実に動作する
let db = null;
let isFirebaseReady = false;
let _doc, _setDoc, _getDoc, _updateDoc, _onSnapshot, _runTransaction, _deleteDoc;

// Firebase 初期化完了を待つための Promise（handleRoute が完了前に走らないようにするため）
let firebaseInitialized;

// ============================================================
// UID / 作成者トークン管理
// ============================================================
function getOrCreateUid() {
  let uid = localStorage.getItem('yotei_uid');
  if (!uid) {
    uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    localStorage.setItem('yotei_uid', uid);
  }
  return uid;
}

function saveCreatorToken(eventId) {
  const tokens = JSON.parse(localStorage.getItem('yotei_creator') || '{}');
  tokens[eventId] = true;
  localStorage.setItem('yotei_creator', JSON.stringify(tokens));
}

function isCreator(eventId) {
  const tokens = JSON.parse(localStorage.getItem('yotei_creator') || '{}');
  return !!tokens[eventId];
}

// ============================================================
// 締め切り/削除/作成 同期（Firebase更新失敗時の再同期）
// ============================================================
const PENDING_CLOSE_KEY = 'yotei_pending_close';
const PENDING_DELETE_KEY = 'yotei_pending_delete';
const PENDING_EVENT_KEY = 'yotei_pending_events';
const DELETED_KEY = 'yotei_deleted_events';
const HIDDEN_KEY = 'yotei_hidden_events';

function getPendingCloseIds() {
  try { return JSON.parse(localStorage.getItem(PENDING_CLOSE_KEY) || '[]'); } catch { return []; }
}

function addPendingClose(eventId) {
  const list = getPendingCloseIds();
  if (!list.includes(eventId)) {
    list.push(eventId);
    localStorage.setItem(PENDING_CLOSE_KEY, JSON.stringify(list));
  }
}

function removePendingClose(eventId) {
  const list = getPendingCloseIds().filter(id => id !== eventId);
  localStorage.setItem(PENDING_CLOSE_KEY, JSON.stringify(list));
}

async function syncPendingClose() {
  if (!isFirebaseReady) return;
  const list = getPendingCloseIds();
  if (!list.length) return;
  for (const id of list) {
    try {
      await _updateDoc(_doc(db, 'events', id), { closed: true });
      removePendingClose(id);
    } catch(e) {
      console.warn('pending close sync failed:', e);
      if (e?.code === 'not-found' || e?.code === 'permission-denied') removePendingClose(id);
    }
  }
}

function getPendingEvents() {
  try { return JSON.parse(localStorage.getItem(PENDING_EVENT_KEY) || '{}'); } catch { return {}; }
}

function setPendingEvent(eventId, data) {
  const pending = getPendingEvents();
  pending[eventId] = data;
  localStorage.setItem(PENDING_EVENT_KEY, JSON.stringify(pending));
}

function removePendingEvent(eventId) {
  const pending = getPendingEvents();
  if (pending[eventId]) {
    delete pending[eventId];
    localStorage.setItem(PENDING_EVENT_KEY, JSON.stringify(pending));
  }
}

async function syncPendingEvents() {
  if (!isFirebaseReady) return;
  const pending = getPendingEvents();
  const ids = Object.keys(pending);
  if (!ids.length) return;
  for (const id of ids) {
    try {
      const ref = _doc(db, 'events', id);
      const snap = await _getDoc(ref);
      if (!snap.exists()) {
        await _setDoc(ref, pending[id]);
      }
      removePendingEvent(id);
    } catch(e) {
      console.warn('pending event sync failed:', e);
    }
  }
}

function getPendingDeleteIds() {
  try { return JSON.parse(localStorage.getItem(PENDING_DELETE_KEY) || '[]'); } catch { return []; }
}

function addPendingDelete(eventId) {
  const list = getPendingDeleteIds();
  if (!list.includes(eventId)) {
    list.push(eventId);
    localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(list));
  }
}

function removePendingDelete(eventId) {
  const list = getPendingDeleteIds().filter(id => id !== eventId);
  localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(list));
}

async function syncPendingDelete() {
  if (!isFirebaseReady) return;
  const list = getPendingDeleteIds();
  if (!list.length) return;
  for (const id of list) {
    try {
      await _deleteDoc(_doc(db, 'events', id));
      removePendingDelete(id);
    } catch(e) {
      console.warn('pending delete sync failed:', e);
      if (e?.code === 'not-found' || e?.code === 'permission-denied') removePendingDelete(id);
    }
  }
}

function getDeletedEventIds() {
  try { return JSON.parse(localStorage.getItem(DELETED_KEY) || '[]'); } catch { return []; }
}

function getHiddenEventIds() {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); } catch { return []; }
}

function hideEvent(id) {
  const list = getHiddenEventIds();
  if (!list.includes(id)) {
    list.push(id);
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(list));
  }
}

function unhideEvent(id) {
  const list = getHiddenEventIds().filter(eid => eid !== id);
  localStorage.setItem(HIDDEN_KEY, JSON.stringify(list));
}

function isHiddenEvent(id) {
  return getHiddenEventIds().includes(id);
}

function markDeletedEvent(eventId) {
  const list = getDeletedEventIds();
  if (!list.includes(eventId)) {
    list.push(eventId);
    localStorage.setItem(DELETED_KEY, JSON.stringify(list));
  }
}

function isDeletedEvent(eventId) {
  return getDeletedEventIds().includes(eventId);
}

function markDeletedCache(eventId) {
  markDeletedEvent(eventId);
  const raw = sessionStorage.getItem(`event_${eventId}`);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      data.deleted = true;
      sessionStorage.setItem(`event_${eventId}`, JSON.stringify(data));
    } catch(e) {}
  }
}

// ============================================================
// イベント履歴管理（ログイン不要のマイリスト）
// ============================================================
function trackEvent(id, name, role, startDate, endDate, createdAt = null) {
  const events = JSON.parse(localStorage.getItem('yotei_events') || '[]');
  const filtered = events.filter(e => e.id !== id);
  filtered.unshift({ id, name, role, startDate, endDate, createdAt, savedAt: Date.now() });
  if (filtered.length > 100) filtered.splice(100);
  localStorage.setItem('yotei_events', JSON.stringify(filtered));
}

function getTrackedEvents() {
  return JSON.parse(localStorage.getItem('yotei_events') || '[]');
}

function deleteTrackedEvent(id) {
  const events = getTrackedEvents().filter(e => e.id !== id);
  localStorage.setItem('yotei_events', JSON.stringify(events));
  sessionStorage.removeItem(`event_${id}`);
  unhideEvent(id);
  const tokens = JSON.parse(localStorage.getItem('yotei_creator') || '{}');
  if (tokens[id]) {
    delete tokens[id];
    localStorage.setItem('yotei_creator', JSON.stringify(tokens));
  }
}

async function requestDeleteEvent(id, name, isOwner, isHidden) {
  if (!isOwner) {
    if (!isHidden) {
      if (!confirm(`「${name}」を非表示にしますか？\n後で一覧に戻せます。`)) return;
      hideEvent(id);
      showToast('非表示にしました');
      buildEventList();
      return;
    }
    unhideEvent(id);
    showToast('再表示しました');
    buildEventList();
    return;
  }
  const msg = `「${name}」を削除しますか？\nFirebaseからも完全に削除されます。この操作は取り消せません。`;
  if (!confirm(msg)) return;

  // ローカルから即座に削除
  markDeletedCache(id);
  deleteTrackedEvent(id);
  buildEventList();
  showToast('削除しました');

  // Firebaseから完全削除
  if (isFirebaseReady) {
    try {
      await _deleteDoc(_doc(db, 'events', id));
    } catch(e) {
      console.error('Firebase delete failed:', e);
      // オフライン時は再接続後に同期
      addPendingDelete(id);
    }
  } else {
    addPendingDelete(id);
  }
}

// ============================================================
// State
// ============================================================
const COLORS = ['#1a1a1a', '#2d7a4f', '#3d5a9a', '#8a4020', '#6a2d7a', '#1a6a7a'];
let focusedName = null;
let unsubscribe = null;
let showHiddenEvents = false;
let checkingDeletedEvents = false;

const S = {
  mode: 'time', id: '', name: '',
  startDate: '', endDate: '', tStart: '09:00', tEnd: '21:00',
  step: 60,
  createdAt: null,
  answers: [], closed: false,
  cur: { name: '', uid: '', sel: new Set(), comment: '' }
};

// HTML の onclick 属性から S.id を参照できるようグローバル公開
window.S = S;

// ============================================================
// Helpers
// ============================================================
const getDates = (s, e) => {
  const r = []; let c = new Date(s), en = new Date(e);
  while (c <= en) { r.push(new Date(c)); c.setDate(c.getDate() + 1); }
  return r;
};
const fmtYmd = v => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '不明';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
};
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const getSlots = (s, e, step = 60) => { const r = []; let c = toMin(s), en = toMin(e); while (c < en) { r.push(fromMin(c)); c += step; } return r; };
const DAY = ['日', '月', '火', '水', '木', '金', '土'];
const fmtD = d => `${d.getMonth() + 1}/${d.getDate()}(${DAY[d.getDay()]})`;
const key = (di, ti) => `${di}-${ti}`;
const isoD = d => d.toISOString().slice(0, 10);
const genId = () => Math.random().toString(36).slice(2, 9);
const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const encodeShareData = data => {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(data)))); } catch(e) { return null; }
};
const decodeShareData = str => {
  try { return JSON.parse(decodeURIComponent(escape(atob(str)))); } catch(e) { return null; }
};
const normalizeEventData = (id, data) => {
  if (!data) return null;
  return {
    name: data.name || '',
    mode: data.mode || 'time',
    startDate: data.startDate || '',
    endDate: data.endDate || '',
    tStart: data.tStart || '09:00',
    tEnd: data.tEnd || '21:00',
    step: data.step || 60,
    answers: Array.isArray(data.answers) ? data.answers : [],
    closed: !!data.closed,
    deleted: !!data.deleted,
    createdAt: data.createdAt || Date.now(),
    id
  };
};
const buildSharePayload = (id, data) => ({
  id,
  name: data.name,
  mode: data.mode,
  startDate: data.startDate,
  endDate: data.endDate,
  tStart: data.tStart,
  tEnd: data.tEnd,
  step: data.step || 60,
  createdAt: data.createdAt,
  closed: !!data.closed,
  deleted: !!data.deleted
});
const buildShareUrlForView = (id, data, view = 'result') => {
  const payload = buildSharePayload(id, data);
  const encoded = encodeShareData(payload);
  const base = `${location.origin}${location.pathname}`;
  const hash = view === 'answer' ? `#event/${id}/answer` : `#event/${id}/result`;
  if (!encoded) return `${base}${hash}`;
  return `${base}?d=${encodeURIComponent(encoded)}${hash}`;
};
const buildShareUrl = (id, data) => buildShareUrlForView(id, data, 'result');
const ensureShareUrl = (id, data) => {
  const encoded = encodeShareData(buildSharePayload(id, data));
  if (!encoded) return;
  const params = new URLSearchParams(location.search);
  if (params.get('d') === encoded) return;
  params.set('d', encoded);
  const query = params.toString();
  const newUrl = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
  history.replaceState(null, '', newUrl);
};
const getSharedEventFromUrl = (eventId) => {
  const raw = new URLSearchParams(location.search).get('d');
  if (!raw) return null;
  const data = decodeShareData(raw);
  if (!data) return null;
  if (data.id && data.id !== eventId) return null;
  return normalizeEventData(eventId, data);
};

const SHARE_MODAL_KEY = 'yotei_share_modal_shown';
const shouldShowShareModal = (eventId) => !localStorage.getItem(`${SHARE_MODAL_KEY}_${eventId}`);
const markShareModalShown = (eventId) => localStorage.setItem(`${SHARE_MODAL_KEY}_${eventId}`, '1');

function periodText() {
  const dates = getDates(S.startDate, S.endDate);
  return `${fmtD(dates[0])} 〜 ${fmtD(dates[dates.length - 1])}　${S.answers.length}人が回答中`;
}

// ============================================================
// Toast
// ============================================================
function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ============================================================
// ルーティング — URLハッシュで状態管理
// ============================================================
function navigateTo(view, eventId = '') {
  if (view === 'home')   location.hash = '#home';
  else if (view === 'create') location.hash = '#create';
  else if (view === 'answer') location.hash = `#event/${eventId}/answer`;
  else if (view === 'result') location.hash = `#event/${eventId}/result`;
}

async function handleRoute() {
  const hash = location.hash;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  // ホーム（デフォルト）
  if (!hash || hash === '' || hash === '#home') {
    buildEventList();
    showView('view-home');
    if (firebaseInitialized) firebaseInitialized.then(() => cleanupDeletedEvents());
    return;
  }

  // イベント作成
  if (hash === '#create') {
    showView('view-create');
    if (!isFirebaseReady) document.getElementById('firebase-notice').style.display = 'block';
    return;
  }

  // イベントURL
  const m = hash.match(/^#event\/([^/]+)\/(answer|result)$/);
  if (!m) { navigateTo('home'); return; }

  const [, eventId, view] = m;
  showView('view-loading');

  const sharedEvent = getSharedEventFromUrl(eventId);

  if (isDeletedEvent(eventId)) { showView('view-deleted'); return; }

  // Firebase 初期化が終わるまで待つ（競合状態を防ぐ）
  if (firebaseInitialized) await firebaseInitialized;

  // ハッシュがルーティング処理中に変わっていたら中止
  if (location.hash !== hash) return;

  let eventData = await loadEvent(eventId);
  if (!eventData && sharedEvent) {
    eventData = sharedEvent;
    await saveEvent(eventId, sharedEvent);
  }
  if (!eventData) { showToast('イベントが見つかりませんでした'); navigateTo('home'); return; }
  if (eventData.deleted) {
    markDeletedCache(eventId);
    deleteTrackedEvent(eventId);
    showView('view-deleted');
    return;
  }

  ensureShareUrl(eventId, eventData);

  S.id = eventId;
  S.name = eventData.name;
  S.mode = eventData.mode;
  S.startDate = eventData.startDate;
  S.endDate = eventData.endDate;
  S.tStart = eventData.tStart;
  S.tEnd = eventData.tEnd;
  S.step = eventData.step || 60;
  S.createdAt = eventData.createdAt || null;
  S.closed = eventData.closed || false;
  S.answers = (eventData.answers || []).map(a => ({ ...a, sel: new Set(a.sel || []) }));

  if (view === 'answer') renderAnswer();
  else renderResult();

  // リアルタイムリスナー（Firebase 有効時）
  if (isFirebaseReady) {
    unsubscribe = _onSnapshot(_doc(db, 'events', eventId), snap => {
      if (!snap.exists()) {
        // ドキュメントがFirebaseから完全削除された
        markDeletedCache(eventId);
        deleteTrackedEvent(eventId);
        showView('view-deleted');
        return;
      }
      const d = snap.data();
      if (d.deleted) {
        markDeletedCache(eventId);
        deleteTrackedEvent(eventId);
        showView('view-deleted');
        return;
      }
      S.answers = (d.answers || []).map(a => ({ ...a, sel: new Set(a.sel || []) }));
      S.closed = d.closed || false;
      if (view === 'result') buildResult();
      if (view === 'answer') {
        const countEl = document.getElementById('answer-event-period');
        if (countEl) countEl.textContent = periodText();
        if (S.closed) renderAnswer();
      }
    });
  }
}

window.addEventListener('hashchange', handleRoute);

// ============================================================
// Firebase / ローカル データ操作
// ============================================================
async function loadEvent(id) {
  if (isFirebaseReady) {
    try {
      // サーバーから最新データを直接取得（キャッシュを使わない）
      const { getDocFromServer } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const snap = await getDocFromServer(_doc(db, 'events', id));
      if (snap.exists()) {
        // Firestoreから取得できたらローカルキャッシュも更新
        sessionStorage.setItem(`event_${id}`, JSON.stringify(snap.data()));
        return snap.data();
      } else {
        // Firestoreに無いがローカルにある場合は同期を試す
        const rawLocal = sessionStorage.getItem(`event_${id}`);
        if (rawLocal) {
          try {
            const data = JSON.parse(rawLocal);
            await _setDoc(_doc(db, 'events', id), data);
            removePendingEvent(id);
            return data;
          } catch(e) {
            console.warn('local event sync failed:', e);
            try { setPendingEvent(id, JSON.parse(rawLocal)); } catch(err) {}
            return JSON.parse(rawLocal);
          }
        }
      }
    } catch(e) { console.error('loadEvent error:', e); }
  }
  // フォールバック: ローカルキャッシュ
  const raw = sessionStorage.getItem(`event_${id}`);
  return raw ? JSON.parse(raw) : null;
}

async function saveEvent(id, data) {
  // 常にローカルにキャッシュ（Firebase障害・ネットワーク切断時のフォールバック）
  sessionStorage.setItem(`event_${id}`, JSON.stringify(data));
  if (isFirebaseReady) {
    try {
      const ref = _doc(db, 'events', id);
      const snap = await _getDoc(ref);
      if (!snap.exists()) await _setDoc(ref, data);
      removePendingEvent(id);
    } catch(e) {
      console.error('saveEvent error:', e);
      setPendingEvent(id, data);
    }
  } else {
    setPendingEvent(id, data);
  }
}

async function saveAnswer(eventId, answer) {
  const serialized = { ...answer, sel: Array.from(answer.sel) };

  // ローカルキャッシュを先に更新（即時反映・オフライン対応）
  const raw = sessionStorage.getItem(`event_${eventId}`);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      data.answers = (data.answers || []).filter(a => a.uid !== answer.uid);
      data.answers.push(serialized);
      sessionStorage.setItem(`event_${eventId}`, JSON.stringify(data));
    } catch(e) {}
  }

  if (isFirebaseReady) {
    try {
      const ref = _doc(db, 'events', eventId);
      // トランザクションで原子的に更新（同時回答による上書きを防止）
      await _runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        if (!snap.exists()) throw new Error('event not found');
        // UID で重複排除（自分の再回答は上書き、同名別人は別エントリ）
        const existing = (snap.data().answers || []).filter(a => a.uid !== answer.uid);
        transaction.update(ref, { answers: [...existing, serialized] });
      });
    } catch(e) {
      console.error('saveAnswer error:', e);
    }
  }
}

async function closeEvent() {
  if (!confirm('回答を締め切りますか？\n締め切ると新規回答ができなくなります。')) return;
  const btn = document.getElementById('close-event-btn');
  if (btn) { btn.disabled = true; btn.textContent = '処理中…'; }

  let updatedRemote = false;
  if (isFirebaseReady) {
    try {
      await _updateDoc(_doc(db, 'events', S.id), { closed: true });
      updatedRemote = true;
      removePendingClose(S.id);
    } catch(e) {
      console.error(e);
      addPendingClose(S.id);
    }
  }

  const raw = sessionStorage.getItem(`event_${S.id}`);
  if (raw) {
    const data = JSON.parse(raw);
    data.closed = true;
    sessionStorage.setItem(`event_${S.id}`, JSON.stringify(data));
  }

  S.closed = true;
  showToast((updatedRemote || !isFirebaseReady) ? '締め切りました' : '締め切りました（同期待ち）');
  buildResult();
}

async function reopenEvent() {
  if (!confirm('締め切りを解除しますか？\n解除すると再び回答を受け付けます。')) return;
  const btn = document.getElementById('close-event-btn');
  if (btn) { btn.disabled = true; btn.textContent = '処理中…'; }

  removePendingClose(S.id);
  if (isFirebaseReady) {
    try {
      await _updateDoc(_doc(db, 'events', S.id), { closed: false });
    } catch(e) {
      console.error(e);
    }
  }

  const raw = sessionStorage.getItem(`event_${S.id}`);
  if (raw) {
    const data = JSON.parse(raw);
    data.closed = false;
    sessionStorage.setItem(`event_${S.id}`, JSON.stringify(data));
  }

  S.closed = false;
  showToast('締め切りを解除しました');
  buildResult();
}

// ============================================================
// Views
// ============================================================
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const isDeletedView = id === 'view-deleted';
  document.body.classList.toggle('deleted-mode', isDeletedView);
  if (id !== 'view-result') closeShareModal();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getShareDataForListEvent(ev) {
  const raw = sessionStorage.getItem(`event_${ev.id}`);
  if (raw) {
    try { return normalizeEventData(ev.id, JSON.parse(raw)); } catch(e) {}
  }
  return normalizeEventData(ev.id, {
    name: ev.name,
    mode: ev.mode,
    startDate: ev.startDate,
    endDate: ev.endDate,
    tStart: ev.tStart,
    tEnd: ev.tEnd,
    createdAt: ev.createdAt,
    closed: ev.closed,
    deleted: ev.deleted
  });
}

function copyAnswerLink(eventId, data) {
  const url = buildShareUrlForView(eventId, data, 'answer');
  navigator.clipboard.writeText(url).catch(() => {});
  showToast('回答リンクをコピーしました');
}

async function cleanupDeletedEvents() {
  if (!isFirebaseReady || checkingDeletedEvents) return;
  checkingDeletedEvents = true;
  const events = getTrackedEvents();
  const toRemove = [];
  for (const ev of events) {
    try {
      const snap = await _getDoc(_doc(db, 'events', ev.id));
      if (!snap.exists()) {
        toRemove.push({ id: ev.id, deleted: false });
        continue;
      }
      const data = snap.data();
      if (data?.deleted) toRemove.push({ id: ev.id, deleted: true });
    } catch(e) {
      console.warn('cleanup deleted events failed:', e);
    }
  }
  if (toRemove.length) {
    toRemove.forEach(item => {
      if (item.deleted) markDeletedCache(item.id);
      deleteTrackedEvent(item.id);
    });
    buildEventList();
  }
  checkingDeletedEvents = false;
}

function updateHiddenToggle() {
  const btn = document.getElementById('toggle-hidden-btn');
  if (!btn) return;
  const hiddenCount = getHiddenEventIds().length;
  if (!hiddenCount) {
    showHiddenEvents = false;
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';
  btn.textContent = showHiddenEvents ? '非表示を隠す' : `非表示を表示 (${hiddenCount})`;
}

function toggleHiddenList() {
  showHiddenEvents = !showHiddenEvents;
  buildEventList();
}

// ============================================================
// Home — イベント一覧
// ============================================================
function buildEventList() {
  const events = getTrackedEvents().filter(ev => !isDeletedEvent(ev.id));
  const eventIdSet = new Set(events.map(e => e.id));
  const hiddenRaw = getHiddenEventIds();
  const hiddenIds = hiddenRaw.filter(id => eventIdSet.has(id));
  if (hiddenIds.length !== hiddenRaw.length) {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenIds));
  }
  const hasHidden = hiddenIds.length > 0;
  const visibleEvents = showHiddenEvents ? events : events.filter(ev => !hiddenIds.includes(ev.id));
  const listEl = document.getElementById('event-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  updateHiddenToggle();

  const landingEl = document.getElementById('home-landing');
  const headerEl = document.getElementById('home-events-header');

  // ランディングは常に非表示（ボタンで開閉）
  if (landingEl) landingEl.style.display = 'none';
  if (headerEl) headerEl.style.display = 'flex';

  if (!visibleEvents.length) {
    if (hasHidden && !showHiddenEvents) {
      listEl.innerHTML = `
        <div class="event-list-empty">
          <div class="event-list-empty-icon">🙈</div>
          <p>非表示のイベントがあります</p>
          <button class="btn btn-secondary" onclick="toggleHiddenList()" style="display:inline-flex;width:auto;margin-top:18px;padding:10px 20px">非表示を表示</button>
        </div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="event-list-empty">
        <div class="event-list-empty-icon">📅</div>
        <p>まだイベントがありません</p>
        <button class="btn btn-primary" onclick="navigateTo('create')" style="display:inline-flex;width:auto;margin-top:20px;padding:12px 24px">＋ 最初のイベントを作る</button>
      </div>`;
    return;
  }

  visibleEvents.forEach(ev => {
    const card = document.createElement('div');
    card.className = 'event-list-card';
    let dateRange = '';
    try {
      const dates = getDates(ev.startDate, ev.endDate);
      if (dates.length) dateRange = `${fmtD(dates[0])} 〜 ${fmtD(dates[dates.length - 1])}`;
    } catch(e) {}

    const isOwner = ev.role === 'creator';
    const isHidden = hiddenIds.includes(ev.id);
    if (isHidden) card.classList.add('event-list-card-hidden');
    const shareData = getShareDataForListEvent(ev);
    let createdAt = ev.createdAt;
    if (!createdAt) {
      const raw = sessionStorage.getItem(`event_${ev.id}`);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          if (data?.createdAt) createdAt = data.createdAt;
        } catch(e) {}
      }
    }
    const createdText = createdAt ? fmtYmd(createdAt) : '不明';
    const actionLabel = isOwner ? '削除' : (isHidden ? '表示する' : '非表示');
    const hiddenBadge = isHidden ? `<span class="ev-list-hidden">非表示</span>` : '';
    card.innerHTML = `
      <div class="ev-list-header">
        <div class="ev-list-name">${escapeHtml(ev.name)}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${hiddenBadge}
          <span class="ev-list-role ${isOwner ? 'ev-list-role-creator' : 'ev-list-role-participant'}">${isOwner ? '作成者' : '参加者'}</span>
        </div>
      </div>
      <div class="ev-list-date">${dateRange}</div>
      <div class="ev-list-created">作成日：${createdText}</div>
      <div class="ev-list-actions-row">
        <div class="ev-list-actions">
          <button class="btn btn-sm" onclick="event.stopPropagation();navigateTo('result','${ev.id}')">結果を見る</button>
          <button class="btn btn-sm" onclick="event.stopPropagation();navigateTo('answer','${ev.id}')">回答する</button>
          <button class="btn btn-sm ${isOwner ? 'btn-danger' : 'btn-ghost'}" data-action="delete">${actionLabel}</button>
        </div>
        <button class="btn btn-icon" data-action="copy-answer" aria-label="回答リンクをコピー" title="回答リンクをコピー">⧉</button>
      </div>`;
    card.addEventListener('click', () => navigateTo('result', ev.id));
    const delBtn = card.querySelector('[data-action="delete"]');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestDeleteEvent(ev.id, ev.name, isOwner, isHidden);
      });
    }
    const copyBtn = card.querySelector('[data-action="copy-answer"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyAnswerLink(ev.id, shareData);
      });
    }
    listEl.appendChild(card);
  });
}

// ============================================================
// Create
// ============================================================
function setMode(m) {
  S.mode = m;
  ['time', 'day'].forEach(k => document.getElementById('mode-' + k).classList.toggle('active', k === m));
  document.getElementById('time-range-field').style.display = m === 'time' ? 'block' : 'none';
  document.getElementById('slot-step-field').style.display = m === 'time' ? 'block' : 'none';
}

function setSlotStep(step) {
  ['60', '30', '15', 'custom'].forEach(v => {
    const btn = document.getElementById(`step-${v}`);
    if (btn) btn.classList.toggle('active', String(step) === v);
  });
  const customField = document.getElementById('step-custom-field');
  if (customField) customField.style.display = step === 'custom' ? 'block' : 'none';
  if (step !== 'custom') S.step = Number(step);
}

function getStepValue() {
  const activeBtn = document.querySelector('#slot-step-field .toggle-btn.active');
  if (!activeBtn) return 60;
  if (activeBtn.id === 'step-custom') {
    const raw = parseInt(document.getElementById('step-custom-value')?.value, 10);
    return raw > 0 && raw <= 120 ? raw : 60;
  }
  return parseInt(activeBtn.id.replace('step-', ''), 10) || 60;
}

async function createYotei() {
  const name = document.getElementById('event-name').value.trim();
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;
  if (!name || !start || !end) { showToast('イベント名と期間を入力してください'); return; }
  if (start > end) { showToast('開始日を終了日より前にしてください'); return; }

  const btn = document.getElementById('create-btn');
  btn.disabled = true; btn.textContent = '作成中…';

  S.id = genId(); S.name = name; S.startDate = start; S.endDate = end;
  S.tStart = document.getElementById('time-start').value;
  S.tEnd = document.getElementById('time-end').value;
  S.step = S.mode === 'time' ? getStepValue() : 60;
  S.answers = [];
  S.closed = false;

  const eventData = {
    name: S.name, mode: S.mode, startDate: S.startDate, endDate: S.endDate,
    tStart: S.tStart, tEnd: S.tEnd, step: S.step, answers: [], closed: false, deleted: false, createdAt: Date.now()
  };
  S.createdAt = eventData.createdAt;
  await saveEvent(S.id, eventData);
  saveCreatorToken(S.id);
  trackEvent(S.id, S.name, 'creator', S.startDate, S.endDate, eventData.createdAt);

  btn.disabled = false; btn.textContent = 'URLを発行する';
  navigateTo('result', S.id);
}

function copyUrl() {
  const el = document.getElementById('share-url-text');
  let text = el ? el.textContent : location.href;
  if (!text || text === '') text = location.href;
  navigator.clipboard.writeText(text).catch(() => {});
  document.getElementById('copy-hint').textContent = 'コピーしました ✓';
  setTimeout(() => document.getElementById('copy-hint').textContent = 'タップでコピー', 2000);
}

// ============================================================
// Answer
// ============================================================
function renderAnswer() {
  const closedBanner = document.getElementById('event-closed-banner');
  const nameStep = document.getElementById('name-step');
  const gridStep = document.getElementById('grid-step');
  const alreadyVotedEl = document.getElementById('already-voted');

  if (S.closed) {
    if (closedBanner) closedBanner.style.display = 'block';
    if (nameStep) nameStep.style.display = 'none';
    if (gridStep) gridStep.style.display = 'none';
    if (alreadyVotedEl) alreadyVotedEl.style.display = 'none';
    showView('view-answer');
    return;
  }
  if (closedBanner) closedBanner.style.display = 'none';

  const myUid = getOrCreateUid();
  const alreadyAnswered = S.answers.some(a => a.uid === myUid);

  if (alreadyVotedEl) alreadyVotedEl.style.display = alreadyAnswered ? 'block' : 'none';
  if (nameStep) nameStep.style.display = alreadyAnswered ? 'none' : 'block';
  if (gridStep) gridStep.style.display = 'none';

  const titleEl = document.getElementById('answer-event-title');
  const periodEl = document.getElementById('answer-event-period');
  if (titleEl) titleEl.textContent = S.name;
  if (periodEl) periodEl.textContent = periodText();

  S.cur = { name: '', uid: myUid, sel: new Set(), comment: '' };
  document.getElementById('answer-name').value = '';
  document.getElementById('answer-comment').value = '';
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.textContent = '回答を送信する';
  setStep(1);
  showView('view-answer');
}

function startEditingAnswer() {
  const myUid = getOrCreateUid();
  const myAnswer = S.answers.find(a => a.uid === myUid);
  if (!myAnswer) { showToast('回答データが見つかりませんでした'); return; }

  S.cur = {
    name: myAnswer.name,
    uid: myUid,
    sel: new Set(myAnswer.sel),
    comment: myAnswer.comment || ''
  };

  document.getElementById('already-voted').style.display = 'none';
  document.getElementById('name-step').style.display = 'none';
  document.getElementById('grid-step').style.display = 'block';
  document.getElementById('name-display').textContent = myAnswer.name;
  document.getElementById('answer-comment').value = S.cur.comment;
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) submitBtn.textContent = '回答を更新する';
  setStep(2);
  buildAnswerGrid();
}

function setStep(n) {
  ['step1', 'step2', 'step3'].forEach((id, i) => {
    document.getElementById(id).className = 'step' + (i + 1 < n ? ' done' : i + 1 === n ? ' active' : '');
  });
}

function startAnswering() {
  const name = document.getElementById('answer-name').value.trim();
  if (!name) { showToast('名前を入力してください'); return; }
  S.cur.name = name;
  document.getElementById('name-display').textContent = name;
  document.getElementById('name-step').style.display = 'none';
  document.getElementById('grid-step').style.display = 'block';
  setStep(2);
  buildAnswerGrid();
}

function backToName() {
  document.getElementById('name-step').style.display = 'block';
  document.getElementById('grid-step').style.display = 'none';
  setStep(1);
}

function buildAnswerGrid() {
  const dates = getDates(S.startDate, S.endDate);
  const slots = S.mode === 'time' ? getSlots(S.tStart, S.tEnd, S.step || 60) : ['終日'];
  const isMobile = window.innerWidth <= 600;
  const cellW = isMobile ? 40 : 36;
  const labelW = isMobile ? 46 : 52;
  const grid = document.getElementById('answer-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `${labelW}px repeat(${dates.length},${cellW}px)`;

  grid.appendChild(Object.assign(document.createElement('div'), { className: 'grid-corner' }));
  dates.forEach(d => {
    const el = document.createElement('div');
    el.className = 'grid-col-label';
    el.innerHTML = `${d.getMonth() + 1}/${d.getDate()}<br>${DAY[d.getDay()]}`;
    grid.appendChild(el);
  });

  let drag = false, dragAdd = true;

  const apply = c => {
    const kk = c.dataset.k;
    if (kk === undefined) return;
    if (dragAdd && !S.cur.sel.has(kk)) {
      S.cur.sel.add(kk);
      c.className = 'grid-cell cell-ok';
    } else if (!dragAdd && S.cur.sel.has(kk)) {
      S.cur.sel.delete(kk);
      c.className = 'grid-cell cell-empty';
    }
  };

  slots.forEach((slot, ti) => {
    const rl = document.createElement('div');
    rl.className = 'grid-row-label';
    rl.textContent = S.mode === 'time' ? slot : '終日';
    grid.appendChild(rl);

    dates.forEach((_, di) => {
      const k = key(di, ti);
      const cell = document.createElement('div');
      cell.dataset.k = k;
      cell.className = 'grid-cell ' + (S.cur.sel.has(k) ? 'cell-ok' : 'cell-empty');

      cell.addEventListener('mousedown', e => {
        e.preventDefault();
        drag = true;
        dragAdd = !S.cur.sel.has(k);
        apply(cell);
      });
      cell.addEventListener('mouseenter', () => { if (drag) apply(cell); });

      grid.appendChild(cell);
    });
  });

  // ── タッチ操作: グリッド全体で一元管理 ──
  // 1本指 → ドラッグ選択 / 2本指 → 横スクロール
  const gridWrap = grid.closest('.grid-wrap');
  let twoFingerStartScrollX = 0, twoFingerStartMidX = 0;

  const cellFromPoint = (x, y) => {
    let el = document.elementFromPoint(x, y);
    let depth = 0;
    while (el && el.dataset.k === undefined && depth++ < 6) el = el.parentElement;
    return (el && el.dataset.k !== undefined) ? el : null;
  };

  grid.addEventListener('touchstart', e => {
    if (e.touches.length >= 2) {
      drag = false;
      if (gridWrap) {
        twoFingerStartScrollX = gridWrap.scrollLeft;
        twoFingerStartMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      }
      e.preventDefault();
      return;
    }
    // 1本指: セルの上なら選択開始
    const t = e.touches[0];
    const target = cellFromPoint(t.clientX, t.clientY);
    if (target) {
      e.preventDefault();
      drag = true;
      dragAdd = !S.cur.sel.has(target.dataset.k);
      apply(target);
    }
  }, { passive: false });

  grid.addEventListener('touchmove', e => {
    if (e.touches.length >= 2) {
      // 2本指: 横スクロール
      drag = false;
      e.preventDefault();
      if (gridWrap) {
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        gridWrap.scrollLeft = twoFingerStartScrollX + (twoFingerStartMidX - midX);
      }
      return;
    }
    if (!drag) return;
    e.preventDefault();
    const t = e.touches[0];
    const target = cellFromPoint(t.clientX, t.clientY);
    if (target) apply(target);
  }, { passive: false });

  grid.addEventListener('touchend', () => { drag = false; }, { passive: true });

  document.addEventListener('mouseup', () => { drag = false; });
  document.addEventListener('touchend', () => { drag = false; });
}

async function submitAnswer() {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = '送信中…';

  const sameNameOther = S.answers.some(a => a.name === S.cur.name && a.uid !== S.cur.uid);
  if (sameNameOther) {
    const proceed = confirm(
      `「${S.cur.name}」さんはすでに回答しています。\n` +
      `別の名前（例：田中A）を使う場合はキャンセルを選んでください。\n\n` +
      `OK: このまま送信　キャンセル: 名前を変える`
    );
    if (!proceed) {
      btn.disabled = false; btn.textContent = '回答を送信する';
      backToName();
      return;
    }
  }

  const color = COLORS[S.answers.filter(a => a.uid !== S.cur.uid).length % COLORS.length];
  const answer = {
    name: S.cur.name, uid: S.cur.uid, color, sel: S.cur.sel,
    comment: document.getElementById('answer-comment').value.trim()
  };
  await saveAnswer(S.id, answer);
  S.answers = S.answers.filter(a => a.uid !== S.cur.uid);
  S.answers.push(answer);
  trackEvent(S.id, S.name, isCreator(S.id) ? 'creator' : 'participant', S.startDate, S.endDate, S.createdAt);

  btn.disabled = false; btn.textContent = '回答を送信する';
  showToast('回答しました！');
  navigateTo('result', S.id);
}

// ============================================================
// Result
// ============================================================
function renderResult() {
  focusedName = null;
  document.getElementById('r-event-name').textContent = S.name;
  const urlEl = document.getElementById('result-share-url-text');
  if (urlEl) urlEl.textContent = buildShareUrlForView(S.id, S, 'answer');
  const hintEl = document.getElementById('result-copy-hint');
  if (hintEl) hintEl.textContent = 'タップでコピー';
  buildResult();
  switchTab('heatmap');
  showView('view-result');
  if (shouldShowShareModal(S.id)) {
    setTimeout(() => {
      openShareModal();
      markShareModalShown(S.id);
    }, 120);
  }
}

function copyResultUrl() {
  const el = document.getElementById('result-share-url-text');
  const text = el ? el.textContent : buildShareUrlForView(S.id, S, 'answer');
  navigator.clipboard.writeText(text).catch(() => {});
  const hint = document.getElementById('result-copy-hint');
  if (hint) { hint.textContent = 'コピーしました ✓'; setTimeout(() => { hint.textContent = 'タップでコピー'; }, 2000); }
}

function toggleFocus(name) {
  focusedName = (focusedName === name) ? null : name;
  buildResult();
}

function buildResult() {
  const dates = getDates(S.startDate, S.endDate);
  const slots = S.mode === 'time' ? getSlots(S.tStart, S.tEnd, S.step || 60) : ['終日'];
  const total = S.answers.length;
  const focused = focusedName ? S.answers.filter(a => a.name === focusedName) : S.answers;

  document.getElementById('r-count').textContent = focusedName ? `${focusedName}さんの回答` : `${total}人が回答`;

  const closedBadge = document.getElementById('closed-badge');
  if (closedBadge) closedBadge.style.display = S.closed ? 'inline-block' : 'none';

  const creatorActions = document.getElementById('creator-actions');
  if (creatorActions) {
    creatorActions.style.display = isCreator(S.id) ? 'block' : 'none';
    const closeBtn = document.getElementById('close-event-btn');
    if (closeBtn) {
      closeBtn.disabled = false;
      if (S.closed) {
        closeBtn.textContent = '締め切りを解除する';
        closeBtn.onclick = () => reopenEvent();
      } else {
        closeBtn.textContent = '回答を締め切る';
        closeBtn.onclick = () => closeEvent();
      }
    }
  }

  // Participants
  const pList = document.getElementById('p-list');
  pList.innerHTML = '';
  S.answers.forEach(a => {
    const t = document.createElement('div');
    t.className = 'p-tag' + (focusedName === a.name ? ' p-tag-active' : focusedName ? ' p-tag-dim' : '');
    t.style.cursor = 'pointer';
    t.innerHTML = `<span class="p-dot" style="background:${a.color}"></span>${a.name}`;
    t.addEventListener('click', () => toggleFocus(a.name));
    pList.appendChild(t);
  });
  if (focusedName) {
    const reset = document.createElement('div');
    reset.className = 'p-tag p-tag-reset'; reset.style.cursor = 'pointer';
    reset.textContent = '✕ 全員表示';
    reset.addEventListener('click', () => { focusedName = null; buildResult(); });
    pList.appendChild(reset);
  }

  // Best slot
  let bestCount = 0, bestLabel = '';
  dates.forEach((d, di) => slots.forEach((sl, ti) => {
    const c = focused.filter(a => a.sel.has(key(di, ti))).length;
    if (c > bestCount) { bestCount = c; bestLabel = fmtD(d) + (S.mode === 'time' ? ` ${sl}〜` : ''); }
  }));
  const banner = document.getElementById('best-banner');
  if (focused.length >= 2 && bestCount === focused.length) {
    banner.style.display = 'flex';
    document.getElementById('best-text').textContent = bestLabel;
  } else banner.style.display = 'none';

  // Grid
  const isMobile = window.innerWidth <= 600;
  const rCellW = isMobile ? 40 : 44;
  const rCellH = isMobile ? 34 : 28;
  const rLabelW = isMobile ? 46 : 52;
  const grid = document.getElementById('result-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `${rLabelW}px repeat(${dates.length},${rCellW}px)`;
  grid.appendChild(Object.assign(document.createElement('div'), { className: 'grid-corner' }));
  dates.forEach(d => {
    const el = document.createElement('div');
    el.className = 'grid-col-label';
    el.innerHTML = `${d.getMonth() + 1}/${d.getDate()}<br>${DAY[d.getDay()]}`;
    grid.appendChild(el);
  });
  slots.forEach((sl, ti) => {
    const rl = document.createElement('div');
    rl.className = 'grid-row-label';
    rl.textContent = S.mode === 'time' ? sl : '終日';
    grid.appendChild(rl);
    dates.forEach((d, di) => {
      const k = key(di, ti);
      const okAll = S.answers.filter(a => a.sel.has(k)).map(a => a.name);
      const okFocused = focused.filter(a => a.sel.has(k)).map(a => a.name);
      const n = okFocused.length, denom = focused.length;
      const wrap = document.createElement('div');
      wrap.className = 'cell-wrap'; wrap.style.cssText = `position:relative;width:${rCellW}px;height:${rCellH}px`;
      const cell = document.createElement('div');
      cell.style.cssText = 'width:100%;height:100%;cursor:pointer';
      let cls = 'grid-cell ';
      if (n === 0) cls += 'h0';
      else if (n === denom) cls += 'hfull';
      else if (n / denom <= 0.33) cls += 'h1';
      else if (n / denom <= 0.66) cls += 'h2';
      else cls += 'h3';
      cell.className = cls;
      cell.addEventListener('click', () => openGoogleCal(d, sl, S.name));
      const tip = document.createElement('div');
      tip.className = 'cell-tip';
      const names = focusedName ? okFocused.join('・') : okAll.join('・');
      tip.innerHTML = `<strong>${fmtD(d)}${S.mode === 'time' ? ' ' + sl : ''}</strong><br>${n}/${denom}人　${names || 'なし'}<br><span style="opacity:0.6;font-size:0.63rem">クリックでGoogleカレンダーへ</span>`;
      wrap.appendChild(cell); wrap.appendChild(tip); grid.appendChild(wrap);
    });
  });

  // Comment badge
  const badge = document.getElementById('comment-badge');
  if (badge) badge.style.display = S.answers.some(a => a.comment) ? 'inline-block' : 'none';

  // Comments
  const cList = document.getElementById('c-list');
  cList.innerHTML = '';
  const wc = focused.filter(a => a.comment);
  if (!wc.length) {
    cList.innerHTML = '<p style="font-size:0.82rem;color:var(--k60)">コメントはまだありません。</p>';
  } else {
    wc.forEach(a => {
      const el = document.createElement('div');
      el.className = 'comment-item';
      el.innerHTML = `<div class="c-author" style="color:${a.color}">${a.name}</div><div class="c-body">${a.comment}</div>`;
      cList.appendChild(el);
    });
  }
}

function openGoogleCal(date, slot, eventTitle) {
  const y = date.getFullYear(), mo = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  let startStr, endStr;
  if (S.mode === 'time') {
    const [h, m] = slot.split(':').map(Number);
    startStr = `${y}${mo}${d}T${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
    const endMin = h * 60 + m + (S.step || 60);
    endStr = `${y}${mo}${d}T${String(Math.floor(endMin / 60)).padStart(2, '0')}${String(endMin % 60).padStart(2, '0')}00`;
  } else {
    const nx = new Date(date); nx.setDate(nx.getDate() + 1);
    startStr = `${y}${mo}${d}`;
    endStr = `${nx.getFullYear()}${String(nx.getMonth() + 1).padStart(2, '0')}${String(nx.getDate()).padStart(2, '0')}`;
  }
  const params = new URLSearchParams({ action: 'TEMPLATE', text: eventTitle, dates: `${startStr}/${endStr}`, details: 'よていくんで調整した予定です\nhttps://yotei-kun.jp/' });
  const url = `https://calendar.google.com/calendar/render?${params}`;

  const modal = document.getElementById('gcal-modal');
  if (!modal) { window.open(url, '_blank'); return; }

  const label = S.mode === 'time' ? `${fmtD(date)} ${slot}〜` : `${fmtD(date)} 終日`;
  const eventEl = document.getElementById('gcal-event');
  const timeEl = document.getElementById('gcal-time');
  const goBtn = document.getElementById('gcal-go-btn');

  if (eventEl) eventEl.textContent = eventTitle || '予定';
  if (timeEl) timeEl.textContent = label;
  if (goBtn) {
    goBtn.onclick = () => {
      window.open(url, '_blank');
      closeGcalModal();
    };
  }
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

function closeGcalModal() {
  const modal = document.getElementById('gcal-modal');
  if (!modal) return;
  if (modal.contains(document.activeElement)) document.activeElement.blur();
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

function openShareModal() {
  const modal = document.getElementById('share-modal');
  if (!modal) return;
  const url = buildShareUrlForView(S.id, S, 'answer');
  const urlEl = document.getElementById('share-modal-url');
  const hintEl = document.getElementById('share-modal-hint');
  if (urlEl) urlEl.textContent = url;
  if (hintEl) hintEl.textContent = 'タップでコピー';
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

function closeShareModal() {
  const modal = document.getElementById('share-modal');
  if (!modal) return;
  if (modal.contains(document.activeElement)) document.activeElement.blur();
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

function copyShareModalUrl() {
  const el = document.getElementById('share-modal-url');
  const text = el ? el.textContent : buildShareUrlForView(S.id, S, 'answer');
  navigator.clipboard.writeText(text).catch(() => {});
  const hint = document.getElementById('share-modal-hint');
  if (hint) { hint.textContent = 'コピーしました ✓'; setTimeout(() => { hint.textContent = 'タップでコピー'; }, 2000); }
}

function openHeatmapPreview() {
  const dates = getDates(S.startDate, S.endDate);
  const slots = S.mode === 'time' ? getSlots(S.tStart, S.tEnd, S.step || 60) : ['終日'];
  const total = S.answers.length;
  const isMobile = window.innerWidth <= 600;
  const rCellW = isMobile ? 36 : 40;
  const rCellH = isMobile ? 28 : 26;
  const rLabelW = isMobile ? 42 : 46;

  const countEl = document.getElementById('heatmap-modal-count');
  if (countEl) countEl.textContent = total === 0 ? 'まだ回答がありません' : `${total}人が回答中`;

  const pList = document.getElementById('heatmap-modal-participants');
  if (pList) {
    pList.innerHTML = '';
    S.answers.forEach(a => {
      const t = document.createElement('div');
      t.className = 'p-tag';
      t.innerHTML = `<span class="p-dot" style="background:${a.color}"></span>${escapeHtml(a.name)}`;
      pList.appendChild(t);
    });
  }

  const grid = document.getElementById('heatmap-preview-grid');
  if (!grid) return;
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `${rLabelW}px repeat(${dates.length},${rCellW}px)`;

  grid.appendChild(Object.assign(document.createElement('div'), { className: 'grid-corner' }));
  dates.forEach(d => {
    const el = document.createElement('div');
    el.className = 'grid-col-label';
    el.innerHTML = `${d.getMonth() + 1}/${d.getDate()}<br>${DAY[d.getDay()]}`;
    grid.appendChild(el);
  });

  slots.forEach((sl, ti) => {
    const rl = document.createElement('div');
    rl.className = 'grid-row-label';
    rl.textContent = S.mode === 'time' ? sl : '終日';
    grid.appendChild(rl);
    dates.forEach((_, di) => {
      const k = key(di, ti);
      const n = S.answers.filter(a => a.sel.has(k)).length;
      const denom = total;
      const cell = document.createElement('div');
      let cls = 'grid-cell ';
      if (denom === 0 || n === 0) cls += 'h0';
      else if (n === denom) cls += 'hfull';
      else if (n / denom <= 0.33) cls += 'h1';
      else if (n / denom <= 0.66) cls += 'h2';
      else cls += 'h3';
      cell.className = cls;
      cell.style.cssText = `width:${rCellW}px;height:${rCellH}px`;
      grid.appendChild(cell);
    });
  });

  const modal = document.getElementById('heatmap-modal');
  if (!modal) return;
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
}

function closeHeatmapModal() {
  const modal = document.getElementById('heatmap-modal');
  if (!modal) return;
  if (modal.contains(document.activeElement)) document.activeElement.blur();
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
}

function switchTab(tab) {
  document.getElementById('tab-heatmap').style.display = tab === 'heatmap' ? 'block' : 'none';
  document.getElementById('tab-comments').style.display = tab === 'comments' ? 'block' : 'none';
  document.querySelectorAll('.nav-tab').forEach((t, i) => t.classList.toggle('active', (i === 0) === (tab === 'heatmap')));
}

// ============================================================
// グローバル公開 — Firebase 読み込み前でも即座に利用可能
// ============================================================
window.navigateTo   = navigateTo;
window.setMode      = setMode;
window.setSlotStep  = setSlotStep;
window.createYotei  = createYotei;
window.copyUrl      = copyUrl;
window.copyResultUrl = copyResultUrl;
window.startAnswering = startAnswering;
window.startEditingAnswer = startEditingAnswer;
window.backToName   = backToName;
window.submitAnswer = submitAnswer;
window.switchTab    = switchTab;
window.closeEvent   = closeEvent;
window.reopenEvent  = reopenEvent;
window.closeGcalModal = closeGcalModal;
window.toggleHiddenList = toggleHiddenList;
window.closeShareModal = closeShareModal;
window.copyShareModalUrl = copyShareModalUrl;

function shareToLine() {
  const el = document.getElementById('share-modal-url');
  const url = el ? el.textContent : buildShareUrlForView(S.id, S, 'answer');
  const text = encodeURIComponent('日程調整はこちらから回答してください（登録不要・名前だけでOK）');
  const encodedUrl = encodeURIComponent(url);
  window.open(`https://social-plugins.line.me/lineit/share?url=${encodedUrl}&text=${text}`, '_blank', 'noopener');
  gtag('event', 'share', { method: 'LINE', content_type: 'schedule_url' });
}

function shareToSlack() {
  const el = document.getElementById('share-modal-url');
  const url = el ? el.textContent : buildShareUrlForView(S.id, S, 'answer');
  window.open(`https://slack.com/share?url=${encodeURIComponent(url)}`, '_blank', 'noopener');
  gtag('event', 'share', { method: 'Slack', content_type: 'schedule_url' });
}

window.shareToLine = shareToLine;
window.shareToSlack = shareToSlack;
window.openHeatmapPreview = openHeatmapPreview;
window.closeHeatmapModal = closeHeatmapModal;

// ============================================================
// Firebase 動的読み込み（失敗してもアプリは動作する）
// ============================================================
async function initFirebase() {
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    _doc = fs.doc; _setDoc = fs.setDoc; _getDoc = fs.getDoc;
    _updateDoc = fs.updateDoc; _onSnapshot = fs.onSnapshot; _runTransaction = fs.runTransaction; _deleteDoc = fs.deleteDoc;
    if (FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY') {
      const app = initializeApp(FIREBASE_CONFIG);
      db = fs.getFirestore(app);
      isFirebaseReady = true;
      await syncPendingEvents();
      await syncPendingClose();
      await syncPendingDelete();
    }
  } catch(e) {
    console.warn('Firebase not available, offline mode:', e);
  }
}

// ============================================================
// 起動シーケンス
// ============================================================

// 日付の初期値をすぐにセット
const _today = new Date(), _next2w = new Date(_today);
_next2w.setDate(_today.getDate() + 13);
document.getElementById('start-date').value = isoD(_today);
document.getElementById('end-date').value = isoD(_next2w);

// ホーム・作成画面は Firebase 不要なので即座に表示
const _initHash = location.hash;
if (!_initHash || _initHash === '' || _initHash === '#home') {
  buildEventList();
  showView('view-home');
} else if (_initHash === '#create') {
  showView('view-create');
} else {
  showView('view-loading');
}

// Firebase 初期化を開始（Promise を保持しておき、handleRoute 内で await できるようにする）
firebaseInitialized = initFirebase();

// hashchange ハンドラを登録
window.addEventListener('hashchange', handleRoute);

// Firebase 初期化完了後に初回ルーティング実行
firebaseInitialized.then(() => handleRoute());

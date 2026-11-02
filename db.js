// db.js — IndexedDB `planner` с версионными миграциями и запасным режимом «в памяти».
// Миграции только добавляют хранилища и индексы; данные никогда не удаляются.

export const DB_NAME = 'planner';
export const DB_VERSION = 5;
export const STORES = ['tasks', 'purchases', 'notes', 'noteFolders', 'birthdays', 'vacations', 'meta'];
const OPEN_TIMEOUT = 10000;

const MIGRATIONS = {
  1(db) {
    db.createObjectStore('tasks', { keyPath: 'id' }).createIndex('by_date', 'date');
    db.createObjectStore('purchases', { keyPath: 'id' }).createIndex('by_date', 'date');
    db.createObjectStore('notes', { keyPath: 'id' });
  },
  2(db) { db.createObjectStore('vacations', { keyPath: 'id' }); },
  3(db) { db.createObjectStore('birthdays', { keyPath: 'id' }); },
  4(db) { db.createObjectStore('meta', { keyPath: 'key' }); },
  5(db) { db.createObjectStore('noteFolders', { keyPath: 'id' }); },
  // В эталоне в одной из версий было хранилище `cycle`. Здесь его не создаём,
  // а если оно есть в старой базе — не трогаем (данные не удаляются).
};

function ensureStores(db, tx) {
  // Подстраховка: если какое-то хранилище отсутствует (необычная старая база) — создаём.
  for (const s of STORES) {
    if (!db.objectStoreNames.contains(s)) {
      const os = db.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
      if (s === 'tasks' || s === 'purchases') os.createIndex('by_date', 'date');
    }
  }
  for (const s of ['tasks', 'purchases']) {
    const os = tx.objectStore(s);
    if (!os.indexNames.contains('by_date')) os.createIndex('by_date', 'date');
  }
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx2p = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); });

class IDBStore {
  constructor(db) { this.db = db; this.memory = false; }
  async all(store) { return req2p(this.db.transaction(store).objectStore(store).getAll()); }
  async get(store, key) { return req2p(this.db.transaction(store).objectStore(store).get(key)); }
  async put(store, rec) { const tx = this.db.transaction(store, 'readwrite'); tx.objectStore(store).put(rec); await tx2p(tx); return rec; }
  async del(store, key) { const tx = this.db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); await tx2p(tx); }
  /** Несколько изменений одной транзакцией: ops = [{store, put?:rec, del?:key}] */
  async batch(ops) {
    const names = [...new Set(ops.map((o) => o.store))];
    if (!names.length) return;
    const tx = this.db.transaction(names, 'readwrite');
    for (const o of ops) {
      const os = tx.objectStore(o.store);
      if (o.put) os.put(o.put); else if (o.del != null) os.delete(o.del);
    }
    await tx2p(tx);
  }
  /** Замена разделов целиком одной транзакцией (всё или ничего) */
  async replace(sections) {
    const names = Object.keys(sections);
    if (!names.length) return;
    const tx = this.db.transaction(names, 'readwrite');
    for (const s of names) {
      const os = tx.objectStore(s);
      os.clear();
      for (const r of sections[s]) os.put(r);
    }
    await tx2p(tx);
  }
  close() { try { this.db.close(); } catch { /* уже закрыта */ } }
}

class MemoryStore {
  constructor() { this.memory = true; this.data = Object.fromEntries(STORES.map((s) => [s, new Map()])); }
  key(store, r) { return store === 'meta' ? r.key : r.id; }
  async all(store) { return [...this.data[store].values()].map((r) => structuredClone(r)); }
  async get(store, key) { const r = this.data[store].get(key); return r ? structuredClone(r) : undefined; }
  async put(store, rec) { this.data[store].set(this.key(store, rec), structuredClone(rec)); return rec; }
  async del(store, key) { this.data[store].delete(key); }
  async batch(ops) { for (const o of ops) { if (o.put) await this.put(o.store, o.put); else await this.del(o.store, o.del); } }
  async replace(sections) { for (const [s, list] of Object.entries(sections)) { this.data[s].clear(); for (const r of list) await this.put(s, r); } }
  close() {}
}

/**
 * Открывает базу. onVersionChange вызывается, когда другая вкладка с новой версией
 * просит обновить схему: база закрывается, приложение перезагружается.
 */
export function openDB({ onVersionChange } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const fallback = (reason) => {
      if (settled) return;
      settled = true;
      console.warn('IndexedDB недоступна:', reason);
      resolve(new MemoryStore());
    };
    const timer = setTimeout(() => fallback('timeout'), OPEN_TIMEOUT);
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { clearTimeout(timer); fallback(e); return; }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      for (let v = (ev.oldVersion || 0) + 1; v <= DB_VERSION; v++) {
        try { MIGRATIONS[v] && MIGRATIONS[v](db); } catch (e) { console.warn('миграция', v, e); }
      }
      ensureStores(db, req.transaction);
    };
    req.onblocked = () => { /* ждём; через 10 с — режим «в памяти» */ };
    req.onerror = () => { clearTimeout(timer); fallback(req.error); };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => { db.close(); onVersionChange && onVersionChange(); };
      resolve(new IDBStore(db));
    };
  });
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* не поддерживается */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* нет данных */ }
  return null;
}

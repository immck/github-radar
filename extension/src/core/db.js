const DB_NAME = 'github-radar';
const DB_VERSION = 1;

export const STORES = {
  repos: 'repos',
  snapshots: 'snapshots',
  favorites: 'favorites',
  analyses: 'analyses',
  tasks: 'tasks',
  meta: 'meta',
};

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORES.repos)) {
          const repos = db.createObjectStore(STORES.repos, { keyPath: 'id' });
          repos.createIndex('fullName', 'fullName', { unique: true });
          repos.createIndex('stars', 'stars');
          repos.createIndex('language', 'language');
          repos.createIndex('category', 'category');
          repos.createIndex('updatedAtGithub', 'updatedAtGithub');
          repos.createIndex('lastFetchedAt', 'lastFetchedAt');
        }

        if (!db.objectStoreNames.contains(STORES.snapshots)) {
          const snapshots = db.createObjectStore(STORES.snapshots, { keyPath: 'key' });
          snapshots.createIndex('repoId', 'repoId');
          snapshots.createIndex('repoTime', ['repoId', 'capturedAt']);
          snapshots.createIndex('capturedAt', 'capturedAt');
        }

        if (!db.objectStoreNames.contains(STORES.favorites)) {
          const favorites = db.createObjectStore(STORES.favorites, { keyPath: 'repoId' });
          favorites.createIndex('createdAt', 'createdAt');
        }

        if (!db.objectStoreNames.contains(STORES.analyses)) {
          db.createObjectStore(STORES.analyses, { keyPath: 'repoId' });
        }

        if (!db.objectStoreNames.contains(STORES.tasks)) {
          const tasks = db.createObjectStore(STORES.tasks, { keyPath: 'id' });
          tasks.createIndex('startedAt', 'startedAt');
        }

        if (!db.objectStoreNames.contains(STORES.meta)) {
          db.createObjectStore(STORES.meta, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
    });
  }
  return dbPromise;
}

function toPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbGet(store, key) {
  const db = await openDB();
  return toPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function dbGetAll(store) {
  const db = await openDB();
  return toPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function dbGetAllByIndex(store, index, value) {
  const db = await openDB();
  return toPromise(db.transaction(store, 'readonly').objectStore(store).index(index).getAll(value));
}

export async function dbCount(store) {
  const db = await openDB();
  return toPromise(db.transaction(store, 'readonly').objectStore(store).count());
}

export async function dbPut(store, value) {
  const db = await openDB();
  return toPromise(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

export async function dbBulkPut(store, values) {
  if (values.length === 0) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const target = tx.objectStore(store);
  for (const value of values) target.put(value);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('写入被中止'));
  });
}

export async function dbDelete(store, key) {
  const db = await openDB();
  return toPromise(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function dbClear(store) {
  const db = await openDB();
  return toPromise(db.transaction(store, 'readwrite').objectStore(store).clear());
}

export async function getMeta(key) {
  const row = await dbGet(STORES.meta, key);
  return row?.value ?? null;
}

export async function setMeta(key, value) {
  await dbPut(STORES.meta, { key, value });
}

// IndexedDB storage on the device.
//   stacks  { id, label, created_at }
//   rugs    { id, stack_id, seq, status: 'draft'|'saved', barcode, note, flag, created_at, saved_at, updated_at }
//   photos  { id, rug_id, stack_id, type: 'rug'|'tag', blob, thumb, width, height, captured_at }

const DB_NAME = 'oak-capture';
const DB_VERSION = 1;
let dbPromise;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('stacks', { keyPath: 'id' });
      db.createObjectStore('rugs', { keyPath: 'id' }).createIndex('stack_id', 'stack_id');
      const photos = db.createObjectStore('photos', { keyPath: 'id' });
      photos.createIndex('rug_id', 'rug_id');
      photos.createIndex('stack_id', 'stack_id');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('App is open in another tab. Close it and reload.'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Save aborted'));
  });
}

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// "strict" asks the browser to flush to disk before reporting success.
async function tx(stores, mode = 'readonly') {
  const db = await openDB();
  return mode === 'readwrite'
    ? db.transaction(stores, mode, { durability: 'strict' })
    : db.transaction(stores, mode);
}

export async function get(store, id) {
  return result((await tx(store)).objectStore(store).get(id));
}

export async function all(store) {
  return result((await tx(store)).objectStore(store).getAll());
}

export async function byIndex(store, index, key) {
  return result((await tx(store)).objectStore(store).index(index).getAll(key));
}

export async function put(store, value) {
  const t = await tx(store, 'readwrite');
  t.objectStore(store).put(value);
  await done(t);
  return value;
}

export async function del(store, id) {
  const t = await tx(store, 'readwrite');
  t.objectStore(store).delete(id);
  await done(t);
}

// Read-modify-write in one transaction (callbacks, so it can't auto-commit mid-way).
export async function update(store, id, patch) {
  const t = await tx(store, 'readwrite');
  const os = t.objectStore(store);
  let merged;
  const getReq = os.get(id);
  getReq.onsuccess = () => {
    if (!getReq.result) return;
    merged = { ...getReq.result, ...patch };
    os.put(merged);
  };
  await done(t);
  return merged;
}

export async function deleteRug(rugId) {
  const t = await tx(['rugs', 'photos'], 'readwrite');
  const photos = t.objectStore('photos');
  const cur = photos.index('rug_id').openKeyCursor(IDBKeyRange.only(rugId));
  cur.onsuccess = () => {
    const c = cur.result;
    if (!c) return;
    photos.delete(c.primaryKey);
    c.continue();
  };
  t.objectStore('rugs').delete(rugId);
  await done(t);
}

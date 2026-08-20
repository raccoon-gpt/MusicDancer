/**
 * Хранилище плейлистов на IndexedDB — двухуровневая схема:
 *   tracks    — сам файл (blob) + метаданные, свой ID
 *   playlists — имя + упорядоченный список ID треков (НЕ копии файлов —
 *               один и тот же трек может быть в нескольких плейлистах
 *               одновременно, без дублирования самого аудио)
 *
 * Всё асинхронно (Promise-обёртки над колбэк-API IndexedDB) — так проще
 * использовать через await в остальном коде, не разводя вложенные
 * колбэки на каждый чих.
 */

const DB_NAME = "musicDancerDB";
const DB_VERSION = 1;
const TRACKS_STORE = "tracks";
const PLAYLISTS_STORE = "playlists";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(TRACKS_STORE)) {
        db.createObjectStore(TRACKS_STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
        db.createObjectStore(PLAYLISTS_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

/** Добавляет трек (blob + метаданные) в общее хранилище треков.
 * @returns {Promise<number>} новый ID трека */
export async function addTrack(blob, name, title, artist) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS_STORE, "readwrite");
    const req = tx.objectStore(TRACKS_STORE).add({ blob, name, title, artist });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @returns {Promise<{id,blob,name,title,artist}|undefined>} */
export async function getTrack(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS_STORE, "readonly");
    const req = tx.objectStore(TRACKS_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Создаёт плейлист — имя + список ID уже существующих треков (не сами файлы).
 * @returns {Promise<number>} новый ID плейлиста */
export async function createPlaylist(name, trackIds) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYLISTS_STORE, "readwrite");
    const req = tx.objectStore(PLAYLISTS_STORE).add({ name, trackIds });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @returns {Promise<{id,name,trackIds}|undefined>} */
export async function getPlaylist(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYLISTS_STORE, "readonly");
    const req = tx.objectStore(PLAYLISTS_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @returns {Promise<Array<{id,name,trackIds}>>} */
export async function getAllPlaylists() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYLISTS_STORE, "readonly");
    const req = tx.objectStore(PLAYLISTS_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Перезаписывает список ID треков в плейлисте целиком (используется и
 * при добавлении через "+Add" к активному плейлисту, и при удалении
 * трека крестиком — в обоих случаях проще перезаписать весь массив
 * заново, чем возиться с точечными insert/remove). */
export async function updatePlaylistTrackIds(id, trackIds) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYLISTS_STORE, "readwrite");
    const store = tx.objectStore(PLAYLISTS_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) {
        resolve(null);
        return;
      }
      record.trackIds = trackIds;
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Удаляет плейлист целиком (саму запись "имя + список ID"). Сами треки
 * в общем хранилище треков НЕ трогает — они могут быть использованы в
 * другом плейлисте, удалять их вместе с этим плейлистом было бы неверно. */
export async function deletePlaylist(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYLISTS_STORE, "readwrite");
    const req = tx.objectStore(PLAYLISTS_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Переименовывает плейлист — меняет только поле name, trackIds не трогает. */
export async function renamePlaylist(id, name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYLISTS_STORE, "readwrite");
    const store = tx.objectStore(PLAYLISTS_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) {
        resolve(null);
        return;
      }
      record.name = name;
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

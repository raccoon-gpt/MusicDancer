/**
 * Хранилище пользовательского персонажа (тот, что грузится через "+" в
 * пикере) — IndexedDB, тот же принцип, что уже работает для треков (см.
 * playlistStorage.js). Один слот на персонажа (фиксированный id) — раз
 * в самом приложении сейчас поддерживается только ОДИН кастомный
 * персонаж одновременно (новая загрузка через customCharacterFileInput
 * всегда перезаписывает предыдущего).
 */

const DB_NAME = "musicDancerCharacterDB";
const DB_VERSION = 1;
const STORE = "customCharacter";
const RECORD_ID = 1; // фиксированный — один слот на персонажа

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

/** Сохраняет/перезаписывает персонажа целиком — сам файл + пустой пока
 * список танцев. Вызывается при выборе файла через customCharacterFileInput. */
export async function saveCharacter(label, fbxBlob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put({ id: RECORD_ID, label, fbxBlob, dances: [] });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** @returns {Promise<{id,label,fbxBlob,dances:[{name,blob}]}|undefined>} */
export async function getCharacter() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(RECORD_ID);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Добавляет один или несколько танцев к уже сохранённому персонажу —
 * читает текущую запись, дописывает в массив dances, сохраняет обратно
 * целиком (тот же паттерн read-modify-write, что уже используется в
 * playlistStorage.updatePlaylistTrackIds). */
export async function addDances(newDances) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(RECORD_ID);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) {
        resolve(null);
        return;
      }
      record.dances = [...record.dances, ...newDances];
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Удаляет персонажа целиком из хранилища. */
export async function deleteCharacter() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(RECORD_ID);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

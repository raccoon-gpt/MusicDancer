/**
 * Переводы интерфейса — ENG / UKR / RU. Простой словарь ключ → {язык:
 * строка}, без внешних библиотек (не нужен весь i18next ради трёх языков
 * и десятка строк).
 *
 * ВАЖНО про границы: переводится только СТАТИЧНЫЙ "хром" интерфейса
 * (кнопки, заголовки, плейсхолдеры) — НЕ переводится пользовательский
 * контент: названия плейлистов, которые задал сам пользователь (даже
 * "Default Playlist" при создании — это просто затравочное имя,
 * хранится в IndexedDB как обычный текст, при смене языка не
 * переписывается задним числом), названия танцевальных стилей (те берутся
 * из имён файлов — "Hip-Hop 1" и т.п., это не UI-текст, а данные).
 */

export const translations = {
  addTrack: { ENG: "+ Add Track", UKR: "+ Додати трек", RU: "+ Добавить трек" },
  playlists: { ENG: "Playlists", UKR: "Плейлисти", RU: "Плейлисты" },
  close: { ENG: "Close", UKR: "Закрити", RU: "Закрыть" },
  newPlaylist: { ENG: "+ New Playlist", UKR: "+ Новий плейлист", RU: "+ Новый плейлист" },
  playlistNamePlaceholder: { ENG: "Playlist name", UKR: "Назва плейлиста", RU: "Название плейлиста" },
  next: { ENG: "Next", UKR: "Далі", RU: "Далее" },
  rename: { ENG: "Rename", UKR: "Перейменувати", RU: "Переименовать" },
  track: { ENG: "Track", UKR: "Трек", RU: "Трек" },
  author: { ENG: "Author", UKR: "Автор", RU: "Автор" },
  partners: { ENG: "Partners", UKR: "Партнери", RU: "Партнёры" },
  settings: { ENG: "Settings", UKR: "Налаштування", RU: "Настройки" },
  language: { ENG: "Language", UKR: "Мова", RU: "Язык" },
  renamePlaylistAria: { ENG: "Rename playlist", UKR: "Перейменувати плейлист", RU: "Переименовать плейлист" },
  deletePlaylistAria: { ENG: "Delete playlist", UKR: "Видалити плейлист", RU: "Удалить плейлист" },
  deleteTrackAria: { ENG: "Delete track from playlist", UKR: "Видалити трек зі списку", RU: "Удалить трек из плейлиста" },
};

const LANGUAGE_STORAGE_KEY = "uiLanguage";
let currentLang = localStorage.getItem(LANGUAGE_STORAGE_KEY) || "ENG";

/** Возвращает перевод по ключу для ТЕКУЩЕГО языка. Если ключа нет в
 * словаре или для текущего языка нет перевода — откатывается на ENG,
 * а если и того нет — возвращает сам ключ (чтобы явно было видно
 * "тут забыли перевод", а не пустая строка). */
export function t(key) {
  const entry = translations[key];
  if (!entry) return key;
  return entry[currentLang] || entry.ENG || key;
}

export function getLanguage() {
  return currentLang;
}

export function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

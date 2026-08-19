/**
 * Audio Player module — Phase 5.
 *
 * Отвечает ТОЛЬКО за воспроизведение: play/pause/seek/volume/время.
 * Никакого анализа звука здесь нет и не будет — это AudioAnalyzer (Phase 6-7).
 * Файл не покидает устройство (ТЗ п.17): используем локальный object URL,
 * ничего никуда не отправляем.
 */

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * @param {{
 *   onTimeUpdate?: (currentTime: number, duration: number) => void,
 *   onLoadedMetadata?: (duration: number) => void,
 *   onEnded?: () => void,
 *   onPlay?: () => void,
 *   onPause?: () => void,
 * }} callbacks
 */
export function createAudioPlayer(callbacks = {}) {
  const audio = new Audio();
  audio.preload = "metadata";

  let objectUrl = null;

  audio.addEventListener("timeupdate", () => {
    callbacks.onTimeUpdate?.(audio.currentTime, audio.duration);
  });
  audio.addEventListener("loadedmetadata", () => {
    callbacks.onLoadedMetadata?.(audio.duration);
  });
  audio.addEventListener("ended", () => callbacks.onEnded?.());
  audio.addEventListener("play", () => callbacks.onPlay?.());
  audio.addEventListener("pause", () => callbacks.onPause?.());

  /** @param {File} file */
  function loadFile(file) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;
  }

  function play() {
    // Автозапуск браузером блокируется — play() всегда вызывается по
    // пользовательскому действию (клик), поэтому promise должен резолвиться (ТЗ п.18)
    return audio.play();
  }

  function pause() {
    audio.pause();
  }

  function togglePlay() {
    return audio.paused ? play() : (pause(), undefined);
  }

  function seek(time) {
    if (Number.isFinite(time)) audio.currentTime = time;
  }

  function setVolume(v) {
    audio.volume = Math.min(1, Math.max(0, v));
  }

  function isPaused() {
    return audio.paused;
  }

  function destroy() {
    audio.pause();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }

  return {
    audio, // понадобится в Phase 6 для MediaElementAudioSourceNode
    loadFile,
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
    isPaused,
    destroy,
  };
}

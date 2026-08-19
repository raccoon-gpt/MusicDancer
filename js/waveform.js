/**
 * Waveform — своя, без библиотек, реализация визуализации волны трека.
 *
 * ПОЧЕМУ НЕ WAVESURFER.JS: проверено (реальные issue на их GitHub) — при
 * использовании его звукового backend'а ('MediaElementWebAudio') он тоже
 * вызывает createMediaElementSource() на переданном audio-элементе и падает
 * с ошибкой "HTMLMediaElement already connected previously to a different
 * MediaElementSourceNode" — у нас этот источник уже занят analyzer'ом
 * (audioAnalyzer.js, ТЗ п.18: MediaElementSource можно создать только один
 * раз на элемент). Обходить это специально ради внешней библиотеки не стоит.
 *
 * Вместо этого — декодируем файл в PCM САМИ, отдельным одноразовым
 * AudioContext, который никогда не подключается к <audio> и не участвует в
 * реальном воспроизведении/анализе — используется только для
 * decodeAudioData() и сразу закрывается. Реального конфликта с уже занятым
 * MediaElementSource в принципе быть не может.
 */

/**
 * Декодирует файл и возвращает "пики" — по одному числу (0..1, амплитуда)
 * на каждый из numBuckets отрезков трека, для рисования баров.
 * @param {File} file
 * @param {number} numBuckets
 * @returns {Promise<number[]>}
 */
export async function computeWaveformPeaks(file, numBuckets = 200) {
  const arrayBuffer = await file.arrayBuffer();

  // Одноразовый AudioContext только для decodeAudioData — не трогает
  // уже существующий у analyzer'а, закрывается сразу после использования.
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    decodeCtx.close();
  }

  // Берём первый канал (моно-упрощение для отрисовки — визуально достаточно)
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerBucket = Math.floor(channelData.length / numBuckets);
  const peaks = new Array(numBuckets);

  for (let i = 0; i < numBuckets; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  // Нормализуем к 0..1 по самому громкому месту трека — иначе тихие треки
  // рисовались бы едва заметными плоскими барами.
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map((p) => p / maxPeak);
}

/**
 * Рисует бары волны на canvas, с двухцветной заливкой по прогрессу
 * воспроизведения (played/unplayed) — вызывать на resize и на каждый
 * timeupdate (дёшево, canvas 2D, не WebGL).
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} peaks
 * @param {number} progress - 0..1, доля прослушанного
 * @param {{
 *   playedColor?: string, unplayedColor?: string, hoverColor?: string,
 *   hoverRatio?: number|null, gap?: number
 * }} opts
 */
export function drawWaveform(canvas, peaks, progress = 0, opts = {}) {
  const {
    playedColor = "#5a7fff",
    unplayedColor = "#3a3f4d",
    hoverColor = "#57616f",
    hoverRatio = null,
    gap = 1,
  } = opts;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (!peaks || peaks.length === 0) return;

  const barWidth = width / peaks.length;
  const playedBars = Math.floor(peaks.length * progress);
  // Наведение мышкой — "предпросмотр" того, куда перемотает клик, отдельно
  // от реального прогресса воспроизведения. Красим им только те бары,
  // что ЕЩЁ не проиграны (левее played — уже и так свои, отдельным цветом).
  const hoverBars = hoverRatio != null ? Math.floor(peaks.length * hoverRatio) : -1;

  peaks.forEach((peak, i) => {
    const barHeight = Math.max(2, peak * height);
    const x = i * barWidth;
    const y = (height - barHeight) / 2;
    let color;
    if (i < playedBars) color = playedColor;
    else if (i < hoverBars) color = hoverColor;
    else color = unplayedColor;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(1, barWidth - gap), barHeight);
  });
}

/** Пустая/плоская волна — пока трек не выбран или не удалось декодировать. */
export function drawFlatline(canvas, opts = {}) {
  const { color = "#3a3f4d" } = opts;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(0, height / 2 - 1, width, 2);
}

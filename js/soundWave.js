/**
 * Sound Wave — крупный цветной столбчатый эквалайзер на фоне, за
 * персонажами. Тот же принцип разделения слоёв, что и у остальных
 * аудио-модулей: ничего не знает про Three.js, только 2D canvas + числа
 * от AudioAnalyzer.
 *
 * Слой рисуется тем же способом, что и было у кольца: отдельный
 * `<canvas>`, лежит под WebGL-канвасом (см. z-index/alpha/clearAlpha в
 * scene.js — сцена специально сделана прозрачной ради этого слоя).
 *
 * Параметры ниже — ДЕФОЛТЫ. Большинство доступны как изменяемые "на
 * лету" через возвращаемые set*-функции (см. низ файла) — временная
 * панель управления в main.js дёргает их живьём для подбора вида.
 */

const DEFAULT_BAR_COUNT = 56;
const DEFAULT_BAR_GAP_FRACTION = 0.28; // доля ширины полосы, уходящая в промежуток между столбиками
const DEFAULT_MAX_BAR_HEIGHT_FRACTION = 0.38; // доля высоты канваса — макс. половина столбика (вверх ИЛИ вниз от центра)
const MIN_BAR_HEIGHT_PX = 4; // столбики не исчезают в ноль даже в полной тишине — маленькая "живая" черта
const BG_COLOR = "#0d0d0d"; // совпадает с прежним scene.background
const BAR_SMOOTHING_TAU = 0.09; // секунд — сглаживание каждого столбика отдельно
const BEAT_PUNCH_DECAY = 0.03; // множитель на секунду — как быстро гаснет всплеск на сильном бите

// Пик визуально чаще ближе к центру (не связано с реальной частотой —
// художественная подсветка поверх уже выровненного компенсацией спектра
// из audioAnalyzer.js). 0 — нет эффекта, 1 — сильный.
const CENTER_WEIGHT_STRENGTH = 0.45;

// "Рядом с высоким может стоять низкий" — фиксированный (не меняется
// каждый кадр) псевдослучайный множитель чувствительности НА КАЖДЫЙ
// столбик отдельно. 0 — нет разброса, 1 — сильный.
const JAGGEDNESS_STRENGTH = 0.55;

// Цветовой градиент слева направо: красный→оранжевый→жёлтый→розовый/
// маджента→фиолетовый→синий→голубой. Единый fillStyle на весь набор
// столбиков разом, не поштучно.
const GRADIENT_STOPS = [
  [0.0, "#ff3b3b"],
  [0.16, "#ff9d3b"],
  [0.3, "#ffd23b"],
  [0.46, "#ff3b8f"],
  [0.62, "#b83bff"],
  [0.8, "#3b6bff"],
  [1.0, "#3bdfff"],
];

export function createSoundWave(container) {
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "0"; // ниже WebGL-канваса (z-index:1, см. scene.js)
  canvas.style.pointerEvents = "none";
  container.insertBefore(canvas, container.firstChild);

  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let width = 0;
  let height = 0;
  let gradient = null;

  // --- Изменяемые "на лету" параметры (см. set*-функции внизу) ---
  let barCount = DEFAULT_BAR_COUNT;
  let barGapFraction = DEFAULT_BAR_GAP_FRACTION;
  let maxBarHeightFraction = DEFAULT_MAX_BAR_HEIGHT_FRACTION;
  let widthFraction = 1; // доля ширины канваса, которую занимает вся группа столбиков (сжатие/растяжение как единое целое, не через barCount)

  let smoothedBars = new Array(barCount).fill(0.04);
  let barCenterWeight = new Array(barCount);
  let barJitterGain = new Array(barCount);

  function rebuildPerBarArrays() {
    // Пересчитывается при смене barCount (и один раз при старте) — оба
    // массива фиксированы, чтобы "шумность"/центрирование были стабильной
    // картиной, а не мерцали случайно кадр от кадра.
    smoothedBars = new Array(barCount).fill(0.04);
    barCenterWeight = new Array(barCount);
    barJitterGain = new Array(barCount);
    for (let i = 0; i < barCount; i++) {
      const t = barCount > 1 ? (i / (barCount - 1)) * 2 - 1 : 0; // -1..1, 0 = центр
      const bell = Math.exp(-(t * t) / 0.5); // гауссиана, пик по центру
      barCenterWeight[i] = 1 - CENTER_WEIGHT_STRENGTH + CENTER_WEIGHT_STRENGTH * bell;

      const pseudoRandom = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      barJitterGain[i] = 1 - JAGGEDNESS_STRENGTH + JAGGEDNESS_STRENGTH * 2 * pseudoRandom;
    }
  }
  rebuildPerBarArrays();

  function buildGradient(fromX, toX) {
    gradient = ctx.createLinearGradient(fromX, 0, toX, 0);
    for (const [pos, color] of GRADIENT_STOPS) {
      gradient.addColorStop(pos, color);
    }
  }

  let blurPercent = 0; // % от ширины canvas — не фиксированные px (те не масштабируются под размер экрана, см. диагностику "почти не видно на мобильном")
  let isMobileWave = false; // обновляется в resize() — тот же порог 480px, что и везде в проекте

  function applyBlurFilter() {
    const px = (width * blurPercent) / 100;
    canvas.style.filter = px > 0.05 ? `blur(${px}px)` : "none";
  }

  function resize() {
    width = container.clientWidth;
    height = container.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyBlurFilter(); // пересчитать px под новую ширину при смене размера окна
    isMobileWave = window.matchMedia("(max-width: 480px)").matches;
  }
  resize();
  window.addEventListener("resize", resize);
  // См. подробный комментарий в scene.js про ResizeObserver — тот же
  // класс бага здесь тоже возможен (внутренний буфер canvas рассинхронится
  // с реальным размером контейнера при изменениях разметки, не только
  // при ресайзе окна), просто менее заметный — не "призрак" персонажа, а
  // лёгкая смазанность/неверный масштаб полос.
  if (typeof ResizeObserver !== "undefined") {
    // Debounce — та же причина, что и в scene.js: canvas.width = ...
    // внутри resize() МГНОВЕННО очищает содержимое канваса при каждом
    // присвоении. Во время плавной CSS-анимации (выезд/заезд шторки
    // списка) ResizeObserver стреляет десятки раз подряд — без debounce
    // волна заметно мигала/дёргалась в процессе анимации.
    let resizeDebounceTimer = null;
    const debouncedResize = () => {
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(resize, 80);
    };
    new ResizeObserver(debouncedResize).observe(container);
  }

  let time = 0;
  let beatPunch = 0;

  /**
   * @param {number} delta - секунды с прошлого кадра
   * @param {number[]|null} spectrumBars - barCount значений 0..1 (см.
   *   audioAnalyzer.getSpectrumBars(soundWave.getBarCount())), null если
   *   музыка не играет — тогда лёгкая "холостая" синусоидальная волна.
   * @param {boolean} strongBeat
   */
  function update(delta, spectrumBars, strongBeat) {
    time += delta;
    if (strongBeat) beatPunch = 1;
    beatPunch *= Math.pow(BEAT_PUNCH_DECAY, delta);

    const smoothing = 1 - Math.exp(-delta / BAR_SMOOTHING_TAU);
    for (let i = 0; i < barCount; i++) {
      let target;
      if (spectrumBars) {
        target = spectrumBars[i] * barJitterGain[i];
      } else if (isMobileWave) {
        // На мобильном "холостое дыхание" было слишком незаметным (то же
        // самое значение, что и на десктопе, при этом столбики там и так
        // тоньше/меньше — визуально терялось). Диапазон заметно шире.
        target = 0.09 + 0.09 * (0.5 + 0.5 * Math.sin(time * 0.6 + i * 0.35));
      } else {
        target = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(time * 0.6 + i * 0.35));
      }
      target *= barCenterWeight[i];
      target = Math.min(1.4, target);
      smoothedBars[i] += (target - smoothedBars[i]) * smoothing;
    }

    draw();
  }

  function draw() {
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    const cy = height / 2;
    // Вся группа столбиков сжимается/растягивается как единое целое в
    // пределах drawWidth (centered) — НЕ через изменение barCount, ровно
    // как просили: "сжимать все сразу", а не убирать столбики.
    const drawWidth = width * widthFraction;
    const drawOffsetX = (width - drawWidth) / 2;
    const barSlot = drawWidth / barCount;
    const barWidth = barSlot * (1 - barGapFraction);
    const maxHalfHeight = height * maxBarHeightFraction;

    buildGradient(drawOffsetX, drawOffsetX + drawWidth);
    ctx.fillStyle = gradient;
    ctx.shadowColor = "rgba(255, 255, 255, 0.35)";
    ctx.shadowBlur = 10;

    for (let i = 0; i < barCount; i++) {
      const value = smoothedBars[i] * (1 + beatPunch * 0.5);
      const halfHeight = Math.max(MIN_BAR_HEIGHT_PX, value * maxHalfHeight);
      const x = drawOffsetX + i * barSlot + (barSlot - barWidth) / 2;
      const radius = Math.min(barWidth / 2, 6);

      roundRect(ctx, x, cy - halfHeight, barWidth, halfHeight * 2, radius);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // --- Публичные сеттеры для временной панели управления ---

  function getBarCount() {
    return barCount;
  }

  function setBarCount(n) {
    barCount = Math.max(4, Math.round(n));
    rebuildPerBarArrays();
  }

  /** 0 (столбики впритык, почти без зазора) .. 0.9 (тонкие ниточки) */
  function setBarGapFraction(v) {
    barGapFraction = Math.min(0.9, Math.max(0, v));
  }

  /** Доля высоты канваса — насколько высоко может "взлететь" столбик */
  function setMaxBarHeightFraction(v) {
    maxBarHeightFraction = Math.min(1, Math.max(0.02, v));
  }

  /**
   * Сжимает/растягивает всю группу столбиков как единое целое по
   * ширине (центрировано) — НЕ через изменение количества столбиков.
   * 1 = во весь экран (как было изначально), меньше — уже, с фоном по
   * бокам.
   */
  function setWidthFraction(v) {
    widthFraction = Math.min(1, Math.max(0.05, v));
  }

  /**
   * Размытие всего слоя через CSS filter — задаётся в % от ширины
   * canvas, а не в фиксированных px (те не масштабируются под размер
   * экрана: одинаковые px-значения дают совершенно разный визуальный
   * эффект на широком десктопе и узком мобильном, где сами столбики
   * физически в разы тоньше — фиксированное размытие там "съедало"
   * контраст почти полностью). 0 = чёткие столбики, большие значения
   * сливают их в сплошной градиентный фон.
   */
  function setBlurPercent(pct) {
    blurPercent = Math.max(0, pct);
    applyBlurFilter();
  }

  /** Полностью скрывает/показывает слой — режим "волна выключена". */
  function setVisible(visible) {
    canvas.style.display = visible ? "block" : "none";
  }

  /**
   * Масштабирует ВЕСЬ canvas целиком через CSS transform (не через
   * внутреннюю геометрию отрисовки) — центр остаётся на месте, при
   * scale>1 края уходят за пределы видимой области. Это нормально:
   * #scene-container/body не создают скроллбар от переполнения (body
   * уже имеет overflow:hidden), лишнее просто визуально обрезается.
   */
  function setScale(factor) {
    canvas.style.transform = factor === 1 ? "none" : `scale(${factor})`;
  }

  return {
    update,
    resize,
    getBarCount,
    setBarCount,
    setBarGapFraction,
    setMaxBarHeightFraction,
    setWidthFraction,
    setBlurPercent,
    setVisible,
    setScale,
  };
}

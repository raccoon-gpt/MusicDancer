/**
 * Звёздный туннель — альтернативный фоновый визуализатор (наряду с
 * обычной волной, красным диагностическим фоном и видео-фонами, см.
 * main.js applyWaveMode). Классический эффект "полёт сквозь звёзды" —
 * точки разлетаются от центра наружу, имитируя движение вперёд сквозь
 * звёздное поле, с реакцией на музыку:
 *   - громкость (features.volume) — базовая скорость полёта
 *   - сильный удар (strongBeat) — резкий кратковременный "рывок" скорости,
 *     плавно затухающий (не мгновенно назад)
 *   - высокие частоты (features.treble) — размер звёзд
 *   - бас (features.bass) — яркость близких звёзд
 *
 * Технически устроен так же, как soundWave.js — отдельный canvas-слой,
 * тот же принцип resize (getBoundingClientRect + Math.ceil, rAF-throttle),
 * та же общая структура API (update/resize/setVisible), чтобы было
 * привычно поддерживать оба файла параллельно.
 *
 * ВАЖНО, чем отличается от обычной волны: этот визуализатор — САМ
 * полноценный непрозрачный фон (как красный слой раньше или видео), не
 * "прозрачная накладка поверх чего-то другого". Поэтому здесь, в отличие
 * от soundWave.js, заливка всего канваса сплошным тёмным цветом на
 * каждом кадре — это осознанное и нужное поведение, не оставшийся до
 * недавнего времени баг.
 */

export function createStarTunnel(container) {
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "0"; // тот же уровень, что и обычная волна — оба взаимоисключающие фоновые визуализаторы, никогда не показываются вместе
  canvas.style.pointerEvents = "none";
  canvas.style.display = "none"; // изначально скрыт — видим только в своём режиме цикла кнопки волны (см. main.js)
  container.insertBefore(canvas, container.firstChild);

  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;

  const STAR_COUNT = 260;
  const stars = [];

  /** Пересоздаёt одну звезду — новый случайный угол вылета из центра и
   * стартовое расстояние ("глубина", z) от зрителя. */
  function resetStar(star) {
    star.angle = Math.random() * Math.PI * 2;
    star.z = 1 + Math.random() * 60; // близко к центру — звезда "рождается" маленькой и далёкой
    star.speedJitter = 0.7 + Math.random() * 0.6; // индивидуальный разброс скорости — иначе все звёзды двигались бы строго синхронно, неестественно
    star.hueJitter = Math.random();
  }

  for (let i = 0; i < STAR_COUNT; i++) {
    const star = {};
    resetStar(star);
    // При самом первом запуске распределяем по всей глубине трубы сразу
    // (не все рождаются в одной точке центра) — иначе первые секунды
    // выглядели бы как "внезапный залп", а не устоявшийся звёздный поток.
    star.z = 1 + Math.random() * 500;
    stars.push(star);
  }

  function resize() {
    // getBoundingClientRect() + Math.ceil — та же защита от субпиксельного
    // зазора, что и в scene.js/soundWave.js (см. подробный комментарий
    // там): контейнер может получить дробную высоту в пикселях (кнопка
    // масштаба сцены), а обычные clientWidth/clientHeight округляют к
    // ближайшему целому, иногда вниз.
    const rect = container.getBoundingClientRect();
    width = Math.ceil(rect.width);
    height = Math.ceil(rect.height);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  if (typeof ResizeObserver !== "undefined") {
    // rAF-throttle — та же причина, что и в scene.js/soundWave.js (см.
    // подробный комментарий там): схлопывает частые срабатывания до
    // одного вызова на кадр, без задержки для одиночных мгновенных
    // ресайзов (кнопка масштаба сцены).
    let resizeRafPending = false;
    const throttledResize = () => {
      if (resizeRafPending) return;
      resizeRafPending = true;
      requestAnimationFrame(() => {
        resizeRafPending = false;
        resize();
      });
    };
    new ResizeObserver(throttledResize).observe(container);
  }

  let beatPulse = 0; // "рывок" скорости на сильный удар — резко вверх, плавно (экспоненциально) вниз, не мгновенно
  let beatFlicker = 0; // лёгкое мерцание яркости на ОБЫЧНЫЙ удар — гаснет намного быстрее beatPulse, мгновенная вспышка, не задержанный рывок

  /**
   * @param {number} delta - секунды с прошлого кадра
   * @param {{volume:number, bass:number, mid:number, treble:number}|null} features - аудио-фичи текущего кадра (см. audioAnalyzer.js), null — если музыка сейчас не играет
   * @param {boolean} strongBeat - был ли в этом кадре сильный удар (см. beatDetector.js) — даёт рывок скорости
   * @param {boolean} beat - был ли в этом кадре обычный удар — даёт лёгкое мерцание яркости, отдельно от рывка скорости
   * @param {number} riseRate - скорость нарастания громкости прямо сейчас (0, если громкость падает/стоит; положительное число, тем больше, чем резче нарастание) — см. createVolumeRiseTracker в main.js
   */
  function update(delta, features, strongBeat, beat = false, riseRate = 0) {
    if (canvas.style.display === "none") return; // не тратим ресурсы на кадры, которые всё равно не видны

    // Без музыки — тихий, спокойный "дрейф" (не полная остановка, чтобы
    // экран не выглядел замершим/сломанным), с теми же реакциями на
    // ноль. Тот же принцип, что и у обычной волны в состоянии тишины.
    const volume = features?.volume ?? 0;
    const bass = features?.bass ?? 0;
    const treble = features?.treble ?? 0;

    if (strongBeat) beatPulse = 1;
    beatPulse *= Math.pow(0.015, delta); // экспоненциальное затухание — быстро гаснет, но не мгновенно

    if (beat) beatFlicker = 1;
    beatFlicker *= Math.pow(0.0005, delta); // гаснет НАМНОГО быстрее beatPulse — почти мгновенная вспышка, не задержанный рывок

    // riseRate — реакция именно на "музыка разгоняется", отдельно от
    // мгновенной громкости самой по себе. Коэффициент 0.6 подобран так,
    // чтобы эффект был заметен, но не доминировал над обычной реакцией на
    // громкость — при необходимости легко подкрутить.
    const riseBoost = Math.min(1, riseRate * 0.6);

    const baseSpeed = 40 + volume * 220 + riseBoost * 140;
    const speed = baseSpeed * (1 + beatPulse * 2.2);

    ctx.fillStyle = "#04040a"; // тёмный, слегка синеватый космос — не абсолютно чёрный, чтобы не сливался с полностью чёрными областями сцены
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const maxZ = Math.max(width, height) * 0.75;

    for (const star of stars) {
      const prevZ = star.z;
      star.z += speed * star.speedJitter * delta;
      if (star.z > maxZ) {
        resetStar(star);
        continue;
      }

      // Простая перспективная проекция: чем больше z (дальше звезда
      // "улетела" от центра), тем сильнее её выносит к краю экрана —
      // имитация полёта вперёд сквозь поле точек.
      const perspective = star.z / maxZ;
      const radius = perspective * Math.max(width, height) * 0.62;
      const x = centerX + Math.cos(star.angle) * radius;
      const y = centerY + Math.sin(star.angle) * radius;

      if (x < -20 || x > width + 20 || y < -20 || y > height + 20) {
        resetStar(star);
        continue;
      }

      const size = Math.max(0.6, perspective * (2.2 + treble * 3));
      const brightness = Math.min(1, 0.25 + perspective * 0.9 + bass * 0.25 + beatFlicker * 0.5);
      const hue = 210 + star.hueJitter * 50; // холодная сине-фиолетовая гамма, характерная для звёздного неба
      ctx.fillStyle = `hsla(${hue}, 75%, ${55 + brightness * 30}%, ${brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // Лёгкий "хвост" — короткая линия от предыдущей позиции до текущей,
      // заметна только у звёзд уже близко к зрителю (perspective > 0.35) —
      // усиливает ощущение скорости движения именно там, где это заметнее.
      if (perspective > 0.35) {
        const prevPerspective = prevZ / maxZ;
        const prevRadius = prevPerspective * Math.max(width, height) * 0.62;
        const prevX = centerX + Math.cos(star.angle) * prevRadius;
        const prevY = centerY + Math.sin(star.angle) * prevRadius;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = size * 0.6;
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
  }

  function setVisible(visible) {
    canvas.style.display = visible ? "block" : "none";
  }

  return { update, resize, setVisible };
}

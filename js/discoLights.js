/**
 * Дискотечные прожекторы — НАСТОЯЩИЕ 3D-источники света Three.js (не
 * плоский рисунок на канвасе, как звёздный туннель/волна), крутятся
 * вокруг персонажа и подсвечивают его цветом по-настоящему — свет падает
 * на реальную геометрию/материал персонажа, так же, как обычный
 * key/rim-свет уже делает (см. scene.js). Именно поэтому это отдельный
 * модуль, работающий через саму 3D-сцену, а не canvas-слой.
 *
 * ИСТОРИЯ (важно для понимания текущей геометрии): первая версия вешала
 * ВСЕ прожекторы в ОДНОЙ точке строго над центром сцены — работало, но
 * менее удачно, чем нынешний вариант с двумя разнесёнными точками (см.
 * RIG_POSITIONS). Также пробовали точки подвеса по диагональным углам
 * сцены сбоку-сверху — тоже отклонили, вернулись к более простому
 * "сверху, просто не из одной точки, а из двух".
 *
 * Несколько THREE.SpotLight разных цветов, разбитых на группы по разным
 * точкам подвеса (см. RIG_POSITIONS), каждый вращает свою цель вокруг
 * персонажа со своей собственной скоростью (не синхронно — иначе
 * выглядело бы механически, не как настоящая дискотека), яркость
 * пульсирует от музыки. Плюс гранёный вращающийся дискошар позади
 * персонажа (см. createDiscoBall) — металлический материал, естественно
 * ловит блики от тех же самых прожекторов.
 *
 * ВТОРОЙ РАУНД ПРАВОК — дискошар менял вид: изначально это была просто
 * серая IcosahedronGeometry с низкой детализацией (flatShading, ~80
 * крупных треугольных граней) — это давало эффект "два больших слитных
 * светлых пятна сверху" вместо множества мелких точечных бликов, потому
 * что граней физически слишком мало, чтобы дробить блик на много
 * кусочков. Пользователь показал референсы классических дискошаров
 * (мелкие радужные зеркальные плитки, десятки бликов по всей
 * поверхности) — см. createDiscoBallTextures ниже, это и есть ответ на
 * тот референс. ПОДХОД: не поднимать полигонаж реальной геометрии
 * (сфера стала ГЛАДКОЙ, не гранёной), а рисовать "грани" через normal
 * map — так дешевле получить сотни мелких плиток, чем считать реальную
 * геометрию с тем же числом граней.
 *
 * ТРЕТИЙ РАУНД ПРАВОК — был ещё отдельный слой "расходящихся лучей"
 * вокруг шара (2D-canvas поверх/под сценой, см. createBallRays) — по
 * прямой просьбе пользователя УБРАН СОВСЕМ. Если понадобится вернуть —
 * ищи в истории версий файла (был проекцией позиции шара на экран через
 * camera.project() + градиентные "лепестки" веером, рисовался в
 * отдельном <canvas>).
 *
 * ЧЕТВЁРТЫЙ РАУНД ПРАВОК — звёздный "взрыв" из-за шара (см.
 * createBallStarBurst ниже). Пользователю понравился звёздный туннель
 * (starTunnel.js — полноэкранный фоновый визуализатор, разлетающиеся
 * точки от центра наружу) и он попросил ТОЧНО ТАКОЙ ЖЕ эффект, но
 * ОТДЕЛЬНЫЙ экземпляр: точка вылета — из-за шара (проекция его центра
 * на экран), цвета — радужные (тема самого шара), и ограниченный
 * радиусом (вдвое больше видимого размера шара) с фейдом на подлёте к
 * границе — вместо того чтобы лететь до краёв всего экрана, как
 * оригинальный туннель. Технически — тот же принцип 2D-canvas + проекция
 * 3D-позиции шара на экран, что был у убранных лучей (см. выше), только
 * ПОД сценой (z-index 1, не 3) — чтобы сам шар (непрозрачная 3D-
 * геометрия) перекрывал звёзды в точке их рождения, и они становились
 * видны только когда "вылетают" из-за его силуэта наружу.
 */

import * as THREE from "three";

const DISCO_COLORS = [0xff3b6b, 0x3b6bff, 0x3bff9e, 0xffd93b, 0xb83bff, 0x3bdfff];

// Несколько разных точек подвеса — не все прожекторы в одном месте.
// Две точки подвеса СВЕРХУ ВНИЗ — одна слегка левее центра, другая
// слегка правее (не по диагональным углам сцены — тот вариант тоже
// пробовали, вернулись к более простому "сверху, но не из одной точки").
// Персонаж стоит примерно в (0, ~0.9, 0) — см. scene.js/main.js
// groundAndCenterModel.
const RIG_POSITIONS = [
  new THREE.Vector3(-1.6, 3.2, 0), // немного левее центра
  new THREE.Vector3(1.6, 3.2, 0), // немного правее центра
];

// Угол конуса — РАЗНЫЙ для соло и дуэта (см. setDuetMode ниже), подобран
// и присвоен пользователем отдельно под каждый случай после тестов —
// делитель Math.PI/N: N=18 даёт 10° (соло), N=30 даёт 6° (дуэт, ýже —
// персонажи стоят дальше друг от друга, более узкий луч точнее ложится
// на каждого по отдельности).
const SOLO_CONE_ANGLE = Math.PI / 18;
const DUET_CONE_ANGLE = Math.PI / 30;

// Высота и масштаб дискошара — РАЗНЫЕ для соло и дуэта (см. setDuetMode
// ниже), по той же схеме, что и угол конуса прожекторов выше. В дуэте
// шар остаётся на прежней высоте/размере (это и есть исходные, уже
// подобранные раньше значения — 1.9 и ×1). В соло шар просят опустить
// чуть ниже и слегка уменьшить — вероятно, чтобы не перевешивал один
// маленький персонаж внизу кадра. Переход между режимами — плавный
// (см. BALL_TRANSITION_SPEED в update()), не мгновенный скачок, чтобы
// смена состава по ходу танца не дёргала шар резко.
const DUET_BALL_Y = 1.9;
const SOLO_BALL_Y = 1.6;
const DUET_BALL_SCALE = 1;
const SOLO_BALL_SCALE = 0.85;

// Соответствует SphereGeometry(1.1, ...) в createDiscoBall — нужен
// отдельной константой, чтобы createBallStarBurst (через
// computeBallScreenOrigin в createDiscoLights) мог посчитать реальный
// видимый на экране радиус шара, не заглядывая в геометрию напрямую.
const BALL_BASE_RADIUS = 1.1;
// "Вдвое больше шара" — прямая цифра из просьбы пользователя, вынесена
// отдельной константой, если понадобится подправить.
const BALL_STAR_RADIUS_MULTIPLIER = 2;


// --- Разбивка поверхности дискошара на плитки (см. createDiscoBallTextures) ---
// 30x16 — подобрано на глаз: заметно мельче, чем прежние ~80 граней
// икосаэдра, но не настолько мелко, чтобы плитки тонули в один общий
// шум на небольшом экране телефона.
const BALL_TILE_COLS = 30;
const BALL_TILE_ROWS = 16;

/**
 * Генерирует две текстуры для дискошара прямо в браузере (canvas), без
 * внешних файлов-картинок:
 *  - colorMap — радужная "решётка" плиток с тёмной разводкой между ними
 *    (см. референсы пользователя, картинки 1-2 — именно такой вид: не
 *    ровный металл, а мозаика из цветных квадратов).
 *  - normalMap — по одной пологой "пирамидке" НА КАЖДУЮ плитку: в
 *    центре плитки нормаль смотрит прямо на зрителя, к краям плавно
 *    отклоняется наружу. Это и есть настоящая причина, почему теперь
 *    появляется много отдельных точечных бликов вместо двух больших
 *    слитных пятен — у реального SpotLight-света возникает много
 *    маленьких "виртуальных граней", на каждой из которых блик может
 *    поймать нужный угол независимо от соседних, при этом сама
 *    геометрия сферы остаётся гладкой (дешевле, чем поднимать
 *    полигонаж меша до сотен настоящих граней).
 */
function createDiscoBallTextures() {
  const width = 512;
  const height = 256;
  const tileW = width / BALL_TILE_COLS;
  const tileH = height / BALL_TILE_ROWS;

  // --- Цветная карта плиток ---
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorCtx = colorCanvas.getContext("2d");

  for (let row = 0; row < BALL_TILE_ROWS; row++) {
    for (let col = 0; col < BALL_TILE_COLS; col++) {
      // Оттенок — РОВНО ОДИН полный оборот радуги (360°) на всю
      // окружность шара по col, поэтому col=0 и col=BALL_TILE_COLS
      // (та же точка, где текстура склеивается сама с собой на сфере)
      // дают одинаковый цвет — без этого на шве получался резкий скачок
      // оттенка (пользователь отметил его на скриншоте красной линией).
      // row добавляет диагональный сдвиг СВЕРХ этого — целые градусы,
      // не доля общего диапазона, поэтому не ломает саму периодичность
      // по col.
      const hue = ((col / BALL_TILE_COLS) * 360 + row * 10) % 360;
      // Небольшой псевдослучайный разброс яркости по плиткам — чтобы
      // мозаика не выглядела идеально гладким градиентом, а читалась
      // именно как отдельные плитки со своим случайным бликом.
      const lightness = 52 + Math.sin(col * 1.7 + row * 2.3) * 10;
      colorCtx.fillStyle = `hsl(${hue}, 78%, ${lightness}%)`;
      colorCtx.fillRect(col * tileW, row * tileH, tileW, tileH);
    }
  }
  // Тёмная разводка (grout) между плитками — одним проходом линий по
  // всей сетке сразу, быстрее, чем рисовать рамку на каждую плитку по
  // отдельности.
  colorCtx.strokeStyle = "rgba(10,10,14,0.6)";
  colorCtx.lineWidth = Math.max(1, tileW * 0.06);
  colorCtx.beginPath();
  for (let col = 0; col <= BALL_TILE_COLS; col++) {
    const x = col * tileW;
    colorCtx.moveTo(x, 0);
    colorCtx.lineTo(x, height);
  }
  for (let row = 0; row <= BALL_TILE_ROWS; row++) {
    const y = row * tileH;
    colorCtx.moveTo(0, y);
    colorCtx.lineTo(width, y);
  }
  colorCtx.stroke();

  // --- Карта нормалей ("пирамидка" на плитку) ---
  // Canvas 2D не умеет рисовать нормали напрямую (это не цвет) — пишем
  // значения по пикселям в ImageData сами.
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = width;
  normalCanvas.height = height;
  const normalCtx = normalCanvas.getContext("2d");
  const normalImage = normalCtx.createImageData(width, height);
  const data = normalImage.data;

  // Сила отклонения нормали к краю плитки — подобрана экспериментально:
  // заметно больше 0.6 "плавит" соседние плитки друг в друга (блики
  // сливаются обратно в одно пятно, та же проблема, что пытаемся
  // починить), заметно меньше 0.4 — блик почти не дробится, остаётся
  // близко к исходному гладкому виду.
  const strength = 0.55;

  for (let py = 0; py < height; py++) {
    const row = Math.min(BALL_TILE_ROWS - 1, Math.floor(py / tileH));
    const localV = (py - row * tileH) / tileH; // 0..1 внутри плитки по вертикали
    const ny = (localV - 0.5) * 2; // -1..1 от центра плитки к краю

    for (let px = 0; px < width; px++) {
      const col = Math.min(BALL_TILE_COLS - 1, Math.floor(px / tileW));
      const localU = (px - col * tileW) / tileW;
      const nx = (localU - 0.5) * 2;

      const vx = nx * strength;
      const vy = ny * strength;
      const vz = Math.sqrt(Math.max(0, 1 - vx * vx - vy * vy));

      const idx = (py * width + px) * 4;
      // Normal map кодирует -1..1 как 0..255 (0.5 = 0, т.е. "прямо").
      data[idx] = Math.round((vx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((vy * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((vz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;

  const normalMap = new THREE.CanvasTexture(normalCanvas);

  return { colorMap, normalMap };
}

// Дискошар — ТЕПЕРЬ гладкая сфера (не гранёный IcosahedronGeometry, как
// было раньше) — сами "грани" рисует normal map (см.
// createDiscoBallTextures выше), не реальная геометрия. Материал стал
// не чисто металлическим (раньше 0.95 — почти "чистый металл", без
// собственного цвета) — теперь ниже, чтобы радужная цветная карта
// плиток вообще было видно: у металла с metalness=1 диффузный цвет
// (albedo) почти не участвует в итоговом виде, читается только
// подсвеченный бликами оттенок. Это СОЗНАТЕЛЬНЫЙ отход от прежнего
// решения "чёрный вид без подсветки нравится больше" (см. историю
// выше) — пользователь явно попросил радужный вид, как на референсах,
// а не чистый хром.
//
// Стартовая высота/масштаб — СРАЗУ соло-значения (SOLO_BALL_Y/
// SOLO_BALL_SCALE), не дуэтные — по умолчанию сайт открывается с одной
// белкой (соло), поэтому именно это должно быть видно сразу, без
// "прыжка" из дуэтного положения в соло на первом кадре. Плавный
// переход в дуэт (если пользователь позовёт второго персонажа)
// по-прежнему считается в update() — см. targetBallY/targetBallScale в
// createDiscoLights.
function createDiscoBall(scene) {
  const geometry = new THREE.SphereGeometry(BALL_BASE_RADIUS, 64, 48);
  const { colorMap, normalMap } = createDiscoBallTextures();
  const material = new THREE.MeshStandardMaterial({
    map: colorMap,
    normalMap,
    normalScale: new THREE.Vector2(1.5, 1.5),
    metalness: 0.65,
    roughness: 0.25,
  });
  const ball = new THREE.Mesh(geometry, material);
  // X/Z — как раньше (0, -1.3, позади персонажа). Y — соло-высота по
  // умолчанию (см. комментарий выше), не прежняя дуэтная 1.9.
  ball.position.set(0, SOLO_BALL_Y, -1.3);
  ball.scale.setScalar(SOLO_BALL_SCALE);
  ball.visible = false; // изначально выключен — включается вместе с прожекторами через setEnabled
  scene.add(ball);
  return ball;
}

// Отдельные `4` белых прожектора ТОЛЬКО для дискошара — не для персонажа
// (те, разноцветные, см. RIG_POSITIONS выше). Все источники стоят ВЫШЕ
// максимального роста персонажа (тот не больше ~1.5) и СО СТОРОНЫ
// КАМЕРЫ (положительный Z) — луч от источника до шара (сам шар тоже
// выше персонажа, на высоте 1.9) идёт целиком поверх зоны, где стоят
// персонажи, не задевая их. Белый цвет — чтобы отражения на гранях шара
// читались чисто, не окрашивались ещё и отдельным цветом источника
// поверх того, что уже отражается от цветных прожекторов персонажа.
// Светят СПЕРЕДИ (со стороны камеры), не сзади — иначе видимые блики
// достались бы задней, невидимой зрителю стороне шара.
//
// БАЗОВЫЕ позиции (не меняются) хранятся отдельно от ТЕКУЩИХ — сверху
// добавляется лёгкое покачивание (см. update() в createDiscoLights),
// чтобы прожекторы не стояли абсолютно неподвижно, но при этом амплитуда
// покачивания заведомо маленькая и не опускает луч вниз настолько,
// чтобы он вообще мог задеть персонажей (те стоят ниже, на y примерно
// 0..1.5, а источники здесь — от 2.6 и выше).
function createBallLights(scene, ball) {
  const basePositions = [
    new THREE.Vector3(-1.0, 2.6, 0.4),
    new THREE.Vector3(1.0, 2.6, 0.4),
    new THREE.Vector3(-0.6, 3.0, 0.9),
    new THREE.Vector3(0.6, 3.0, 0.9),
  ];
  const lights = basePositions.map((basePos, i) => {
    const light = new THREE.SpotLight(0xffffff, 0, 6, Math.PI / 14, 0.4, 1.2);
    light.position.copy(basePos);
    light.target.position.copy(ball.position);
    light.visible = false; // изначально выключены — включаются вместе с остальным через setEnabled
    scene.add(light);
    scene.add(light.target);
    // Раньше тут не было хелпера вообще (в отличие от цветных ламп
    // персонажа выше) — из-за этого лучи для шара не показывались в
    // диагностическом режиме, хотя сам свет и работал.
    const helper = new THREE.SpotLightHelper(light);
    helper.visible = false;
    scene.add(helper);
    return {
      light,
      helper,
      basePos,
      // Свой случайный фазовый сдвиг у каждого источника — иначе все
      // четыре покачивались бы синхронно, как одна деталь, а не
      // независимо друг от друга.
      phase: Math.random() * Math.PI * 2,
    };
  });
  return lights;
}

// --- Звёздный "взрыв" из-за шара (2D-канвас ПОД сценой) ---
//
// Клон starTunnel.js (см. подробное объяснение в истории правок выше) —
// та же самая механика "точки разлетаются от центра наружу с реакцией
// на музыку", но:
//  - точка вылета НЕ центр экрана, а проекция ЦЕНТРА ШАРА (см.
//    computeBallScreenOrigin в createDiscoLights ниже);
//  - цвета — полная радуга (та же тема, что и у самого шара, см.
//    createDiscoBallTextures), а не холодная сине-фиолетовая гамма
//    оригинала;
//  - звёзды НЕ летят до краёв экрана — ограничены радиусом (передаётся
//    каждый кадр через origin.radiusPx, см. update ниже) и ПЛАВНО гаснут
//    (fade), не долетая до границы, вместо резкого
//    исчезновения/пересоздания у края экрана, как в оригинале;
//  - слой ПРОЗРАЧНЫЙ (clearRect, не solid fillRect каждый кадр, как у
//    полноэкранного туннеля) — это накладка поверх уже отрисованной
//    сцены, а не самостоятельный фон.
function createBallStarBurst(container) {
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  // z-index 1 — НИЖЕ WebGL-рендерера (2, см. scene.js), та же причина,
  // что была у убранных лучей (см. история выше): рендерер прозрачен
  // везде, кроме реально нарисованной 3D-геометрии, поэтому шар
  // физически перекрывает звёзды в точке их рождения — видны только
  // "вылетевшие" из-за его силуэта.
  canvas.style.zIndex = "1";
  canvas.style.pointerEvents = "none";
  canvas.style.display = "none"; // включается вместе с остальным диско-светом через setVisible
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;

  function resize() {
    // getBoundingClientRect() + Math.ceil — та же защита от
    // субпиксельного зазора, что и в остальных canvas-модулях (см.
    // подробный комментарий в scene.js/soundWave.js/starTunnel.js).
    const rect = container.getBoundingClientRect();
    width = Math.ceil(rect.width);
    height = Math.ceil(rect.height);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  if (typeof ResizeObserver !== "undefined") {
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

  // Меньше, чем у звёздного туннеля (260) — площадь на порядок меньше
  // (ограничена радиусом шара, не всем экраном), больше точек тут
  // выглядело бы избыточно тесно.
  const STAR_COUNT = 140;
  const stars = [];

  /** Пересоздаёт одну звезду — новый случайный угол и обнулённый радиус
   * (звезда "рождается" прямо у поверхности шара). */
  function resetStar(star) {
    star.angle = Math.random() * Math.PI * 2;
    star.radius = 0; // в ПИКСЕЛЯХ (не доля 0..1, как angle/hue) — растёт каждый кадр в update()
    star.speedJitter = 0.7 + Math.random() * 0.6;
    star.hue = Math.random() * 360; // полная радуга — та же тема, что и у самого шара (тот тоже честная радуга по всей поверхности)
  }
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = {};
    resetStar(star);
    stars.push(star);
  }
  // Распределяем по всей "трубе" при самом первом реальном кадре (не
  // все рождаются в одной точке разом) — иначе первые секунды выглядели
  // бы как "внезапный залп", а не устоявшийся поток. Делается ОТЛОЖЕННО
  // (не сразу при создании, как в starTunnel.js) — сейчас ещё не
  // известен реальный радиус шара на экране (origin.radiusPx появляется
  // только на первом вызове update(), когда камера/шар уже точно готовы).
  // ВРЕМЕННО (по просьбе пользователя — "хочу попробовать без
  // ограничительного радиуса") — переключатель поведения. true — звёзды
  // летят по всей сцене, как в оригинальном звёздном туннеле (граница —
  // край экрана, без фейда, прямая копия механики starTunnel.js). false
  // — прежнее поведение (ограничение BALL_STAR_RADIUS_MULTIPLIER×радиус
  // шара + плавный фейд у границы). Один флаг — просто верните false,
  // чтобы откатить обратно, ничего больше менять не нужно.
  const BALL_STAR_UNLIMITED_RADIUS = true;

  let initialized = false;

  let beatPulse = 0; // "рывок" скорости на сильный удар — та же механика, что и в starTunnel.js
  let beatFlicker = 0; // мерцание яркости на обычный удар — та же механика, что и в starTunnel.js

  /**
   * @param {number} delta - секунды с прошлого кадра
   * @param {{volume:number, bass:number, mid:number, treble:number}|null} features
   * @param {boolean} strongBeat
   * @param {boolean} beat
   * @param {number} riseRate
   * @param {{x:number, y:number, radiusPx:number}|null} origin - экранные координаты точки вылета (центр шара) и предельный радиус разлёта в пикселях (уже с учётом BALL_STAR_RADIUS_MULTIPLIER, см. createDiscoLights) — используется как есть только при BALL_STAR_UNLIMITED_RADIUS=false, иначе радиус пересчитывается тут же, по размеру экрана, как в starTunnel.js; null — шар сейчас за камерой/сцена не готова, в этом кадре просто ничего не рисуем
   */
  function update(delta, features, strongBeat, beat, riseRate, origin) {
    if (canvas.style.display === "none") return; // не тратим ресурсы на кадры, которые всё равно не видны

    ctx.clearRect(0, 0, width, height); // ПРОЗРАЧНЫЙ слой — накладка поверх сцены, не самостоятельный фон (в отличие от starTunnel.js)
    if (!origin) return;

    // При BALL_STAR_UNLIMITED_RADIUS — реальный видимый радиус, тот же,
    // что и в starTunnel.js (см. пояснение ниже про 0.62) — граница
    // экрана, а не радиус шара.
    // ИСПРАВЛЕНО: было по ошибке *0.75*0.62 (перемножил два РАЗНЫХ
    // коэффициента из starTunnel.js — там 0.75 это порог для maxZ,
    // условной "глубины" до пересоздания звезды, а 0.62 — отдельный,
    // реальный видимый радиус на экране; в моей модели своей "глубины"
    // нет, работаем сразу в пикселях радиуса, поэтому нужен только
    // множитель 0.62, а *0.75 — лишний, из-за него реальный радиус
    // получался почти вдвое меньше, чем должен быть).
    const maxRadiusPx = BALL_STAR_UNLIMITED_RADIUS ? Math.max(width, height) * 0.62 : origin.radiusPx;

    if (!initialized) {
      initialized = true;
      for (const star of stars) star.radius = Math.random() * maxRadiusPx;
    }

    const volume = features?.volume ?? 0;
    const bass = features?.bass ?? 0;
    const treble = features?.treble ?? 0;

    if (strongBeat) beatPulse = 1;
    beatPulse *= Math.pow(0.015, delta);
    if (beat) beatFlicker = 1;
    beatFlicker *= Math.pow(0.0005, delta);

    const riseBoost = Math.min(1, riseRate * 0.6);
    // Скорость выражена в ДОЛЯХ РАДИУСА в секунду, не в пикселях
    // напрямую — так поведение остаётся одинаковым независимо от
    // текущего видимого размера шара (соло/дуэт, пульсация от удара —
    // origin.radiusPx каждый кадр может быть разным).
    const baseSpeedFraction = 0.5 + volume * 2.4 + riseBoost * 1.5;
    const speedFraction = baseSpeedFraction * (1 + beatPulse * 2.2);
    const speed = speedFraction * maxRadiusPx; // px/сек

    const FADE_IN_END = 0.08; // доля радиуса, за которую звезда успевает появиться из полной прозрачности — без этого рождение прямо у поверхности шара выглядело бы резким "попом"
    const FADE_OUT_START = 0.72; // доля радиуса, с которой начинается угасание к границе — по просьбе пользователя "приглушать эти звёзды фейдом при достижении радиуса"

    for (const star of stars) {
      const prevRadius = star.radius; // ДО обновления — нужно для хвоста ниже, как prevZ в starTunnel.js
      star.radius += speed * star.speedJitter * delta;
      const progress = star.radius / maxRadiusPx;
      if (progress >= 1) {
        resetStar(star);
        continue;
      }

      const x = origin.x + Math.cos(star.angle) * star.radius;
      const y = origin.y + Math.sin(star.angle) * star.radius;

      // Дополнительная граница по краю ЭКРАНА (не только по радиусу) —
      // та же самая проверка, что и в starTunnel.js, актуальна только
      // при BALL_STAR_UNLIMITED_RADIUS: там maxRadiusPx — лишь ПРИМЕРНАЯ
      // оценка (тот же 0.62-коэффициент из оригинала), звезда может уйти
      // за пределы видимой области чуть раньше/позже по одной оси, чем
      // по другой (экран редко строго квадратный).
      if (BALL_STAR_UNLIMITED_RADIUS && (x < -20 || x > width + 20 || y < -20 || y > height + 20)) {
        resetStar(star);
        continue;
      }

      // Фейд у границы — ТОЛЬКО в ограниченном режиме (см. просьбу
      // пользователя изначально). В unlimited-режиме звёзды просто
      // резко пересоздаются за краем экрана, как в оригинале — там
      // фейд не нужен, потому что зритель и не видит момент "пересборки"
      // за пределами видимой области.
      const fadeIn = BALL_STAR_UNLIMITED_RADIUS ? 1 : Math.min(1, progress / FADE_IN_END);
      const fadeOut = BALL_STAR_UNLIMITED_RADIUS ? 1 : progress > FADE_OUT_START ? 1 - (progress - FADE_OUT_START) / (1 - FADE_OUT_START) : 1;
      const alpha = fadeIn * fadeOut;
      if (alpha <= 0.01) continue; // не тратим fillStyle/arc на практически невидимые звёзды

      const size = Math.max(0.6, progress * (2.2 + treble * 3));
      const brightness = Math.min(1, 0.25 + progress * 0.9 + bass * 0.25 + beatFlicker * 0.5) * alpha;
      ctx.fillStyle = `hsla(${star.hue}, 75%, ${55 + brightness * 30}%, ${brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // Хвост — та же самая деталь, что и в starTunnel.js (см. историю
      // правок: изначально была упущена при клонировании — короткая
      // линия от предыдущей позиции звезды до текущей, заметна только у
      // уже далеко улетевших звёзд (progress > 0.35), усиливает
      // ощущение скорости именно там, где это заметнее.
      if (progress > 0.35) {
        const prevX = origin.x + Math.cos(star.angle) * prevRadius;
        const prevY = origin.y + Math.sin(star.angle) * prevRadius;
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
    if (!visible) ctx.clearRect(0, 0, width, height); // не оставляем "замёрзший" кадр висеть под выключенной сценой
  }

  // Отдаёт уже закэшированный (обновляется через ResizeObserver, не
  // каждый кадр) размер контейнера — createDiscoLights использует это
  // для перевода 3D→2D проекции шара в координаты canvas, вместо того
  // чтобы самому ещё раз дёргать getBoundingClientRect() каждый кадр.
  function getSize() {
    return { width, height };
  }

  return { update, setVisible, getSize };
}

/**
 * @param {THREE.Scene} scene
 * @param {HTMLElement} container - нужен для canvas-слоя звёздного
 *   взрыва (см. createBallStarBurst).
 * @param {THREE.PerspectiveCamera} camera - нужна, чтобы посчитать, в
 *   какую точку ЭКРАНА (не 3D-сцены) сейчас проецируется дискошар, и
 *   какой у него видимый на экране радиус — звёзды рисуются в 2D,
 *   поверх/под готовым кадром, не как часть самой 3D-сцены.
 */
export function createDiscoLights(scene, container, camera) {
  const discoBall = createDiscoBall(scene);
  const ballLights = createBallLights(scene, discoBall);
  const ballStarBurst = createBallStarBurst(container);

  const fixtures = DISCO_COLORS.map((color, i) => {
    const light = new THREE.SpotLight(color, 0, 8, SOLO_CONE_ANGLE, 0.5, 1.2);
    // Разбиваем цвета по точкам подвеса поочерёдно (0,1,0,1,0,1) — у
    // каждой точки подвеса получается по 3 прожектора своего цвета.
    const rigPosition = RIG_POSITIONS[i % RIG_POSITIONS.length];
    light.position.copy(rigPosition);
    light.visible = false; // изначально выключены — включаются только через setEnabled(true)
    scene.add(light);
    scene.add(light.target);
    // ВРЕМЕННО (диагностика) — видимый проволочный конус прямо в
    // 3D-сцене, показывает РЕАЛЬНУЮ область, куда светит именно этот
    // прожектор. Готовый инструмент Three.js, не самописный —
    // SpotLightHelper. Нужно вручную обновлять на каждый кадр (update()
    // ниже) — сам он не отслеживает изменения target/position/angle
    // автоматически.
    const helper = new THREE.SpotLightHelper(light);
    helper.visible = false;
    scene.add(helper);
    return {
      light,
      helper,
      // Разный стартовый угол (равномерно по кругу) и разная скорость
      // вращения у каждого — специально НЕ одинаковая, иначе все лучи
      // крутились бы синхронно, как одна деталь, а не как хаотичная
      // дискотечная подсветка.
      baseAngle: (i / DISCO_COLORS.length) * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.6,
    };
  });

  let enabled = false;
  let helpersVisible = true; // при включении света хелперы по умолчанию видны — первый клик кнопки (см. main.js) должен показать и свет, и хелпер разом
  let time = 0;
  let beatPulse = 0; // короткая вспышка яркости на удар, гаснет плавно — тот же принцип, что и в starTunnel.js

  // Целевые высота/масштаб шара для текущего режима (соло/дуэт) — сама
  // позиция/масштаб плавно "догоняют" эти значения каждый кадр (см.
  // BALL_TRANSITION_SPEED ниже), не переключаются мгновенно. Стартуют
  // именно с соло-значений — см. комментарий в createDiscoBall выше,
  // почему шар и создаётся сразу в соло-положении: main.js вызовет
  // setDuetMode(true) сам, как только (и если) на сцене появится второй
  // персонаж, тогда эти цели поменяются и шар плавно перейдёт в дуэт.
  let targetBallY = SOLO_BALL_Y;
  let targetBallScale = SOLO_BALL_SCALE;
  const BALL_TRANSITION_SPEED = 3; // чем больше — тем быстрее шар "догоняет" целевые высоту/масштаб

  // "Базовый" масштаб (без пульсации, см. ниже) — храним ОТДЕЛЬНО от
  // discoBall.scale.x. Если бы пульсацию просто умножали и сразу
  // записывали обратно в discoBall.scale, то на следующем кадре
  // интерполяция к targetBallScale отталкивалась бы уже от
  // "запульсировавшего" значения, а не от чистого — пульсация подмешалась
  // бы в сам переход соло/дуэт и он полз бы неровно. Так база и
  // пульсация независимы: сначала база плавно идёт к targetBallScale,
  // потом поверх неё домножается текущая пульсация.
  let baseBallScale = SOLO_BALL_SCALE;

  // Пульсация шара — ЧЕТВЁРТАЯ попытка (см. историю правок): через mid
  // не получилось (гейн от абсолютного значения упирался в потолок);
  // через "всплеск относительно недавней базы" не попадало в такт;
  // через непрерывный beatStrength (с двумя ступенями по потолку) —
  // ближе, но всё ещё "дышало" произвольными промежуточными процентами
  // (98%, 96.5% и т.п.), потому что сама ГЛУБИНА провала зависела от
  // силы/громкости удара — по прямой просьбе пользователя это неверно:
  // "трек только должен диктовать КОГДА 97 или 100" — а не какое
  // конкретно промежуточное значение.
  //
  // БЫЛА ещё и третья ступень (85% на "супер-сильном" ударе, ×1.4 от
  // порога) — по просьбе пользователя УБРАНА совсем: выяснилось, что
  // BALL_PULSE_HOLD_SEC ниже (0.09с) короче, чем нужно, чтобы шар
  // реально долетал до заявленной цели за экспоненциальный переход
  // (1-e^(-hold/tau) ≈ 78% пути) — то есть разница между 85%/88%/91%
  // визуально была почти незаметна, реальную "силу" эффекта определяла
  // не глубина цели, а то, КАК ЧАСТО событие срабатывает. Раз глубина
  // всё равно не считывалась — решили не усложнять и оставить только
  // одну ступень.
  //
  // СЕЙЧАС — РОВНО ДВА фиксированных состояния масштаба: 100% (покой) и
  // 97% (обычный удар). Никаких других чисел, кроме этих двух, нигде не
  // участвует как ЦЕЛЬ. Трек (ballBeat — булево событие "случился удар
  // в этом кадре", не число) решает ТОЛЬКО, когда переключаться между
  // ними. Сам проезд между текущим значением и целью — отдельный, чисто
  // механический процесс с ФИКСИРОВАННОЙ скоростью (BALL_PULSE_EASE_TAU
  // ниже) — не имеет никакого отношения к силе/громкости удара, только
  // ко времени. Именно поэтому шар и проходит через промежуточные
  // проценты ВО ВРЕМЯ самого перехода (99%, 98% и т.д. по пути) — это
  // неизбежная механика плавной анимации между двумя точками, а не то,
  // что трек "диктует" эти числа.
  const BALL_PULSE_LEVEL_NORMAL = 0.97; // цель на ударе
  // Сколько секунд после удара держим цель внизу (97%), прежде чем
  // отпустить её обратно к 100% (если за это время не пришёл следующий
  // удар — тогда цель просто обновится заново на новый удар, см.
  // update() ниже). Короткое и ФИКСИРОВАННОЕ значение — не
  // подстраивается под темп трека специально: на быстрой музыке удары
  // идут чаще, чем успевает закончиться это окно, и цель просто
  // перезапускается заново на каждый следующий удар, ПОЧТИ не давая
  // шару выйти на плоские 100% между ними (та самая аналогия
  // пользователя — "1 2 3" против "1...2...3": на быстром ритме
  // видно почти непрерывное покачивание, на медленном — чёткое
  // "нырок-и-стоп-на-100%-до-следующего-счёта").
  const BALL_PULSE_HOLD_SEC = 0.09;
  // Скорость самого механического перехода (и вниз, и вверх) — короткая
  // постоянная времени, "как будто нога быстро топнула и вернулась", не
  // мягкое дыхание на секунду. НЕ зависит от силы удара — один и тот же
  // темп перехода что вниз к 97%, что обратно к 100%.
  const BALL_PULSE_EASE_TAU = 0.06;

  let ballPulseTarget = 1; // текущая ЦЕЛЬ — строго одно из двух: 1 / BALL_PULSE_LEVEL_NORMAL
  let ballPulseCurrent = 1; // фактический множитель масштаба ПРЯМО СЕЙЧАС — плавно "механически" догоняет ballPulseTarget
  let ballPulseHoldTimer = 0; // сколько ещё секунд держим цель внизу, прежде чем отпустить обратно к 1

  // Переиспользуемые объекты для computeBallScreenOrigin ниже — не
  // создаём новый Vector3 каждый кадр только чтобы посчитать проекцию
  // шара на экран для звёздного взрыва.
  const projectedCenter = new THREE.Vector3();
  const projectedEdge = new THREE.Vector3();
  const edgeWorldPoint = new THREE.Vector3();
  const cameraRightVector = new THREE.Vector3();

  /**
   * Считает экранные координаты центра шара и его видимый на экране
   * радиус (в пикселях) — нужно для звёздного взрыва (см.
   * createBallStarBurst), который рисуется в 2D поверх готового кадра,
   * не как часть самой 3D-сцены. Видимый радиус получаем не приближённо
   * (например, через расстояние до камеры), а честной проекцией ДВУХ
   * точек — центра шара и точки на его экваторе (сдвиг на
   * BALL_BASE_RADIUS×текущий масштаб вдоль "вправо" от камеры) — так
   * автоматически учитывается перспектива, а не только расстояние.
   * @returns {{x:number, y:number, radiusPx:number}|null} null — шар за
   *   задней плоскостью отсечения камеры (в норме не бывает, но
   *   проверка дешёвая)
   */
  function computeBallScreenOrigin() {
    projectedCenter.copy(discoBall.position).project(camera);
    if (projectedCenter.z >= 1) return null;

    cameraRightVector.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    edgeWorldPoint.copy(discoBall.position).addScaledVector(cameraRightVector, discoBall.scale.x * BALL_BASE_RADIUS);
    projectedEdge.copy(edgeWorldPoint).project(camera);

    const { width, height } = ballStarBurst.getSize();
    const centerX = ((projectedCenter.x + 1) / 2) * width;
    const centerY = ((1 - projectedCenter.y) / 2) * height;
    const edgeX = ((projectedEdge.x + 1) / 2) * width;
    const edgeY = ((1 - projectedEdge.y) / 2) * height;
    const ballScreenRadiusPx = Math.hypot(edgeX - centerX, edgeY - centerY);

    return { x: centerX, y: centerY, radiusPx: ballScreenRadiusPx * BALL_STAR_RADIUS_MULTIPLIER };
  }

  /**
   * @param {number} delta - секунды с прошлого кадра
   * @param {number} intensity - 0..1, "энергичность" текущего момента музыки (см. createIntensityTracker в audioAnalyzer.js) — управляет базовой яркостью
   * @param {boolean} strongBeat - был ли в этом кадре сильный удар (см. main.js — ВСЕГДА от баса, не зависит от A/B-переключателя источника пульсации шара) — короткая вспышка яркости прожекторов/ламп шара
   * @param {boolean} ballBeat - удар (см. main.js — источник выбирается кнопкой A/B-теста: bass или spectral flux) — переключает цель пульсации шара на 97%
   */
  function update(delta, intensity = 0, strongBeat = false, ballBeat = false) {
    if (!enabled) return;
    time += delta;

    // beatPulse — короткая вспышка на удар (плавно вверх, экспоненциально
    // вниз), используется ниже для яркости и ламп шара, и прожекторов
    // персонажа, и лучей вокруг шара. Вращение шара — НЕ использует это
    // (см. ниже, постоянная скорость по просьбе).
    if (strongBeat) beatPulse = 1;
    beatPulse *= Math.pow(0.02, delta); // плавное, но довольно быстрое затухание вспышки

    // Два строго фиксированных состояния — см. подробное объяснение
    // выше у BALL_PULSE_LEVEL_NORMAL.
    if (ballBeat) {
      ballPulseTarget = BALL_PULSE_LEVEL_NORMAL;
      ballPulseHoldTimer = BALL_PULSE_HOLD_SEC;
    } else {
      ballPulseHoldTimer -= delta;
      if (ballPulseHoldTimer <= 0) ballPulseTarget = 1;
    }
    // Сам проезд между текущим значением и целью — фиксированной
    // скорости, см. BALL_PULSE_EASE_TAU выше.
    const pulseEase = 1 - Math.exp(-delta / BALL_PULSE_EASE_TAU);
    ballPulseCurrent += (ballPulseTarget - ballPulseCurrent) * pulseEase;

    // Вращение дискошара — ПОСТОЯННАЯ скорость, без реакции на удар (по
    // просьбе — раньше ускорялось вместе с beatPulse, теперь всегда
    // одинаково).
    discoBall.rotation.y += 0.4 * delta;

    // Высота/масштаб шара плавно стремятся к целевым значениям текущего
    // режима (см. setDuetMode) — простая экспоненциальная интерполяция,
    // тот же принцип, что и smart-камера "плывёт домой" в main.js, а не
    // резкий скачок на новое значение. Пульсация (см. выше) накладывается
    // уже ПОСЛЕ этого, как отдельный множитель поверх базового масштаба —
    // см. комментарий у baseBallScale.
    const ballEase = 1 - Math.pow(0.02, delta * BALL_TRANSITION_SPEED);
    discoBall.position.y += (targetBallY - discoBall.position.y) * ballEase;
    baseBallScale += (targetBallScale - baseBallScale) * ballEase;
    discoBall.scale.setScalar(baseBallScale * ballPulseCurrent);

    // Яркость ламп шара — та же природа масштаба, что и у прожекторов
    // персонажа (физически корректное освещение, см. подробный
    // комментарий ниже про baseIntensity) — держим её более-менее
    // постоянной, слегка пульсирующей на удар, а не завязанной на
    // intensity музыки — шар должен ровно поблёскивать, не мигать
    // резко в такт энергичности момента.
    const ballLightIntensity = 18 * (1 + beatPulse * 0.8);
    ballLights.forEach(({ light, helper, basePos, phase }) => {
      light.intensity = ballLightIntensity;
      // Лёгкое покачивание — амплитуда специально маленькая (0.12/0.05)
      // и добавляется к УЖЕ высоко расположенной базовой позиции
      // (basePos.y от 2.6), поэтому даже в нижней точке качания источник
      // остаётся заметно выше персонажей (те стоят на y примерно
      // 0..1.5) — покачивание не может довести луч до того, чтобы он
      // случайно задел персонажа.
      light.position.set(
        basePos.x + Math.sin(time * 0.6 + phase) * 0.12,
        basePos.y + Math.sin(time * 0.9 + phase * 1.3) * 0.05,
        basePos.z + Math.cos(time * 0.5 + phase) * 0.12
      );
      // Цель прожектора следует за ТЕКУЩИМ положением шара (не
      // копируется один раз при создании) — раньше это было не важно,
      // потому что шар всегда стоял на одной и той же высоте, но теперь
      // (см. соло/дуэт выше) шар может смещаться и менять размер, а
      // прожектор должен продолжать целиться именно в него.
      light.target.position.copy(discoBall.position);
      helper.update(); // та же причина, что и у хелперов персонажа — сам не отслеживает изменения target/angle
    });


    // ВАЖНО: числа яркости здесь НАМНОГО больше, чем у key/rim-света в
    // scene.js (там 1.6/0.4) — это не опечатка. В Three.js 0.160.0 по
    // умолчанию включена "физически корректная" система освещения, где у
    // точечных/прожекторных источников (SpotLight/PointLight) совершенно
    // другой масштаб яркости, чем у направленного света (DirectionalLight,
    // не имеющего физического затухания по расстоянию) — тот остаётся в
    // прежнем, привычном диапазоне 0..2, а SpotLight с тем же диапазоном
    // на таком расстоянии был бы практически невидим.
    const baseIntensity = 25 + intensity * 70;
    const flashBoost = 1 + beatPulse * 1.4;

    fixtures.forEach(({ light, helper, baseAngle, speed }) => {
      const angle = baseAngle + time * speed;
      // Радиус сужен с 2.4 — мишени одной точки подвеса (разнесённые
      // друг от друга на 120° по кругу, см. baseAngle выше) теперь
      // ближе друг к другу, не расходятся так широко веером.
      const radius = 1.2;
      light.target.position.set(Math.cos(angle) * radius, 0.9, Math.sin(angle) * radius);
      light.intensity = baseIntensity * flashBoost;
      helper.update(); // SpotLightHelper сам не отслеживает изменения target — без этого вызова проволочный конус остался бы неподвижным
    });
  }

  /** Включает/выключает разом все прожекторы (и диагностические конусы вместе с ними). */
  function setEnabled(value) {
    enabled = value;
    discoBall.visible = value;
    ballStarBurst.setVisible(value);
    ballLights.forEach(({ light, helper }) => {
      light.visible = value;
      if (!value) helper.visible = false;
      else helper.visible = helpersVisible;
    });
    fixtures.forEach(({ light, helper }) => {
      light.visible = value;
      // Хелпер подчиняется ОБЩЕМУ выключению света (если свет выключен —
      // хелпер тоже гаснет, ему нечего показывать), но НЕ включается
      // здесь автоматически — сам показ хелпера при включённом свете
      // управляется отдельно, через setHelpersVisible ниже.
      if (!value) helper.visible = false;
      else helper.visible = helpersVisible;
    });
    if (!value) beatPulse = 0; // не копим вспышку, пока выключено — иначе при следующем включении был бы неожиданный резкий скачок яркости
  }

  /** Показывает/прячет диагностические конусы ОТДЕЛЬНО от самого света —
   * свет при этом продолжает гореть в любом случае, меняется только
   * видимость самих проволочных конусов. */
  function setHelpersVisible(value) {
    helpersVisible = value;
    if (!enabled) return; // при выключенном свете хелперы и так скрыты — нечего обновлять
    ballLights.forEach(({ helper }) => {
      helper.visible = value;
    });
    fixtures.forEach(({ helper }) => {
      helper.visible = value;
    });
  }

  /** Переключает угол конуса всех прожекторов между соло/дуэт-значениями
   * (см. SOLO_CONE_ANGLE/DUET_CONE_ANGLE выше), а также целевые
   * высоту/масштаб дискошара (см. DUET_BALL_Y/SOLO_BALL_Y и парные им
   * SCALE-константы) — вызывается из main.js при каждой смене состава
   * активных персонажей. Сам шар не прыгает мгновенно на новые
   * значения — просто плавно "догоняет" их каждый кадр в update().
   */
  function setDuetMode(isDuet) {
    const angle = isDuet ? DUET_CONE_ANGLE : SOLO_CONE_ANGLE;
    fixtures.forEach(({ light }) => {
      light.angle = angle;
    });
    targetBallY = isDuet ? DUET_BALL_Y : SOLO_BALL_Y;
    targetBallScale = isDuet ? DUET_BALL_SCALE : SOLO_BALL_SCALE;
  }

  /**
   * Обновляет и рисует звёздный взрыв из-за шара (см. createBallStarBurst
   * выше) — ОТДЕЛЬНЫЙ вызов от основного update(), не слит внутрь него:
   * у этого эффекта свой набор реактивных входов (те же самые features/
   * strongBeat/beat/riseRate, что уже собраны в main.js для
   * starTunnel.update() — просто передаются сюда вторым вызовом), не
   * пересекающийся с тем, что уже принимает update() для света/масштаба
   * шара.
   * @param {number} delta - секунды с прошлого кадра
   * @param {{volume:number, bass:number, mid:number, treble:number}|null} features
   * @param {boolean} strongBeat
   * @param {boolean} beat
   * @param {number} riseRate
   */
  function updateBallStars(delta, features, strongBeat, beat, riseRate) {
    if (!enabled) return;
    const origin = computeBallScreenOrigin();
    ballStarBurst.update(delta, features, strongBeat, beat, riseRate, origin);
  }

  return { update, updateBallStars, setEnabled, setHelpersVisible, setDuetMode };
}

/**
 * Дискотечные прожекторы — НАСТОЯЩИЕ 3D-источники света Three.js (не
 * плоский рисунок на канвасе, как звёздный туннель/волна), крутятся
 * вокруг персонажа и подсвечивают его цветом по-настоящему — свет падает
 * на реальную геометрию/материал персонажа, так же, как обычный
 * key/rim-свет уже делает (см. scene.js). Именно поэтому это отдельный
 * модуль, работающий через саму 3D-сцену, а не ещё один canvas-слой —
 * ЗА ИСКЛЮЧЕНИЕМ лучей света вокруг дискошара (см. createBallRays ниже),
 * это единственная часть модуля, которая всё-таки рисуется на
 * отдельном 2D-канвасе поверх сцены, потому что "расходящиеся лучи"
 * из референсов пользователя — не то, что настоящий SpotLight умеет
 * делать сам по себе (это стилизация, не физический эффект).
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
 * ВТОРОЙ РАУНД ПРАВОК (текущий) — дискошар менял вид: изначально это
 * была просто серая IcosahedronGeometry с низкой детализацией
 * (flatShading, ~80 крупных треугольных граней) — это давало эффект
 * "два больших слитных светлых пятна сверху" вместо множества мелких
 * точечных бликов, потому что граней физически слишком мало, чтобы
 * дробить блик на много кусочков. Пользователь показал референсы
 * классических дискошаров (мелкие радужные зеркальные плитки, десятки
 * бликов по всей поверхности, расходящиеся лучи света) — см.
 * createDiscoBallTextures/createBallRays ниже, это и есть ответ на тот
 * референс. ПОДХОД: не поднимать полигонаж реальной геометрии (сфера
 * стала ГЛАДКОЙ, не гранёной), а рисовать "грани" через normal map —
 * так дешевле получить сотни мелких плиток, чем считать реальную
 * геометрию с тем же числом граней.
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
  const geometry = new THREE.SphereGeometry(1.1, 64, 48);
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


// --- Лучи света вокруг дискошара (2D-канвас поверх сцены) ---
//
// Это НЕ настоящий 3D-объект и не физический эффект реального
// SpotLight — на референсах пользователя (картинки 1, 3, 4) лучи,
// расходящиеся из шара, это чисто стилизация/пост-эффект, так обычно и
// делают даже в честном 3D (в реальном рендере это был бы дорогой
// volumetric-god-rays проход). Технически устроено так же, как
// soundWave.js/starTunnel.js — отдельный canvas-слой поверх контейнера
// сцены, тот же принцип resize (getBoundingClientRect + Math.ceil,
// rAF-throttle). В отличие от них — этот слой ПРОЗРАЧНЫЙ (не красит
// весь canvas сплошным фоном каждый кадр), потому что он должен просто
// НАКЛАДЫВАТЬСЯ поверх уже отрисованной 3D-сцены, а не быть отдельным
// фоном.
//
// z-index — 3, то есть ВЫШЕ WebGL-рендерера (2, см. scene.js) — иначе
// лучи оказались бы под сценой и их не было бы видно вообще.
function createBallRays(container) {
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "3";
  canvas.style.pointerEvents = "none";
  canvas.style.display = "none"; // включается вместе с остальным диско-светом через setVisible
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;

  function resize() {
    // getBoundingClientRect() + Math.ceil — та же защита от
    // субпиксельного зазора, что и в scene.js/soundWave.js/
    // starTunnel.js (см. подробный комментарий там): обычные
    // clientWidth/clientHeight округляют к целому, иногда теряя доли
    // пикселя, которые здесь были бы особенно заметны как щель по краю.
    const rect = container.getBoundingClientRect();
    width = Math.ceil(rect.width);
    height = Math.ceil(rect.height);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();

  let resizeQueued = false;
  if (typeof ResizeObserver !== "undefined") {
    // rAF-throttle — та же причина, что и в остальных canvas-модулях:
    // ResizeObserver может стрелять чаще, чем реально нужно
    // перестраивать canvas.
    const observer = new ResizeObserver(() => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        resize();
      });
    });
    observer.observe(container);
  } else {
    window.addEventListener("resize", resize);
  }

  const RAY_COUNT = 14;
  let angleOffset = 0;

  /**
   * @param {number} delta - секунды с прошлого кадра
   * @param {{x: number, y: number} | null} screenPos - проекция позиции
   *   дискошара на экран в CSS-пикселях контейнера (null, если шар сейчас
   *   за спиной камеры/вне экрана — тогда просто ничего не рисуем в этом
   *   кадре)
   * @param {number} brightness - 0..1, общая яркость лучей (завязана на
   *   ту же beatPulse-вспышку, что и блики самого шара — лучи должны
   *   "дышать" в такт тому же самому ритму, не отдельно от шара)
   * @param {{r:number,g:number,b:number}[]} colors - палитра RAY_COLORS,
   *   лучи по кругу берут цвет оттуда же, откуда и цветные прожекторы
   *   персонажа — визуально читается как единая дискотечная подсветка,
   *   не два независимых набора цветов
   * @param {number} colorPhase - целое число, медленно растущее со
   *   временем (см. вызов ниже) — сдвигает, с какого именно цвета
   *   палитры начинается веер лучей в этом кадре, так весь веер
   *   постепенно "перекрашивается" по кругу, а не стоит на одном
   *   статичном наборе цветов всё время, пока играет музыка
   */
  function draw(delta, screenPos, brightness, colors, colorPhase) {
    ctx.clearRect(0, 0, width, height);
    if (!screenPos) return;

    angleOffset += delta * 0.15; // медленное общее вращение всего веера лучей

    const maxLen = Math.max(width, height) * 0.9;

    // "lighter" — аддитивное смешение (как настоящий свет, а не
    // непрозрачная краска поверх сцены) — там, где лучи пересекаются
    // друг с другом или с ярким участком самой 3D-сцены, получается
    // светлее, а не просто "закрашено сверху".
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // Лёгкое размытие — раньше лучи были тонкими чёткими линиями, по
    // просьбе пользователя сделаны мягче. ctx.filter применяется к
    // каждой фигуре, которую рисуем ПОСЛЕ его установки — то есть и к
    // самим лучам, и к финальному размытому краю. Радиус небольшой (не
    // 10+px) — иначе на маленьком экране телефона веер превратился бы
    // в сплошное цветное пятно без читаемых отдельных лучей.
    ctx.filter = "blur(3px)";

    for (let i = 0; i < RAY_COUNT; i++) {
      const angle = angleOffset + (i / RAY_COUNT) * Math.PI * 2;
      const color = colors[(i + colorPhase) % colors.length];
      const len = maxLen * (0.55 + 0.45 * Math.sin(i * 2.1 + angleOffset * 3));
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const endX = screenPos.x + dirX * len;
      const endY = screenPos.y + dirY * len;

      // Раньше луч был просто ОДНОЙ линией постоянной толщины (обычный
      // stroke) — теперь вместо линии рисуем ЗАЛИТУЮ трапецию: узкую у
      // "дыры" в центре и расширяющуюся к концу луча (см. просьбу
      // пользователя — "расширяющиеся на пути в конец"), это просто
      // четырёхугольник вдоль направления луча со сторонами
      // startWidth/endWidth.
      const perpX = -dirY;
      const perpY = dirX;
      const startWidth = 2 + brightness * 2;
      const endWidth = 16 + brightness * 14;

      // Раньше лучи начинались ПРЯМО от screenPos с полной силой, плюс
      // отдельным кругом рисовалась белая "точка" в центре (см. историю
      // ниже) — по просьбе пользователя вместо яркой сходящейся точки
      // теперь наоборот: у самого центра лучи почти невидимы (alpha≈0),
      // яркость нарастает только начиная примерно с 12% длины луча и
      // достигает пика к ~35% — визуально веер как будто выходит не из
      // точки, а из тёмного провала ("чёрная дыра"), затем как обычно
      // гаснет к своему концу.
      const alpha = 0.34 * brightness;
      const gradient = ctx.createLinearGradient(screenPos.x, screenPos.y, endX, endY);
      gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
      gradient.addColorStop(0.12, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
      gradient.addColorStop(0.35, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`);
      gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(screenPos.x + perpX * startWidth * 0.5, screenPos.y + perpY * startWidth * 0.5);
      ctx.lineTo(screenPos.x - perpX * startWidth * 0.5, screenPos.y - perpY * startWidth * 0.5);
      ctx.lineTo(endX - perpX * endWidth * 0.5, endY - perpY * endWidth * 0.5);
      ctx.lineTo(endX + perpX * endWidth * 0.5, endY + perpY * endWidth * 0.5);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function setVisible(value) {
    canvas.style.display = value ? "block" : "none";
    if (!value) ctx.clearRect(0, 0, width, height); // не оставляем "замёрзший" кадр лучей висеть под выключенной сценой
  }

  // Отдаёт уже закэшированный (обновляется через ResizeObserver, не
  // каждый кадр) размер контейнера в CSS-пикселях — discoLights.js
  // использует это для перевода 3D→2D проекции шара в координаты
  // canvas, вместо того чтобы самому ещё раз дёргать
  // getBoundingClientRect() на каждый кадр рендера.
  function getSize() {
    return { width, height };
  }

  return { draw, setVisible, getSize };
}

// Палитра лучей в готовом для canvas виде ({r,g,b}) — считаем один раз
// при создании модуля, не каждый кадр, из тех же DISCO_COLORS, которыми
// уже подсвечен персонаж.
const RAY_COLORS = DISCO_COLORS.map((hex) => ({
  r: (hex >> 16) & 0xff,
  g: (hex >> 8) & 0xff,
  b: hex & 0xff,
}));

/**
 * @param {THREE.Scene} scene
 * @param {HTMLElement} container - тот же #scene-container, куда
 *   scene.js/soundWave.js/starTunnel.js уже кладут свои канвасы —
 *   нужен здесь для canvas-слоя лучей (см. createBallRays).
 * @param {THREE.PerspectiveCamera} camera - нужна, чтобы посчитать, в
 *   какую точку ЭКРАНА (не 3D-сцены) сейчас проецируется дискошар —
 *   лучи рисуются в 2D, поверх готового кадра, не как часть самой
 *   3D-сцены.
 */
export function createDiscoLights(scene, container, camera) {
  const discoBall = createDiscoBall(scene);
  const ballLights = createBallLights(scene, discoBall);
  const ballRays = createBallRays(container);

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

  // Переиспользуемые объекты — не создаём новый Vector3/объект каждый
  // кадр только чтобы посчитать экранную проекцию шара для лучей.
  const projectedPosition = new THREE.Vector3();
  const screenPos = { x: 0, y: 0 };

  /**
   * @param {number} delta - секунды с прошлого кадра
   * @param {number} intensity - 0..1, "энергичность" текущего момента музыки (см. createIntensityTracker в audioAnalyzer.js) — управляет базовой яркостью
   * @param {boolean} strongBeat - был ли в этом кадре сильный удар — короткая вспышка яркости
   */
  function update(delta, intensity = 0, strongBeat = false) {
    if (!enabled) return;
    time += delta;

    // beatPulse — короткая вспышка на удар (плавно вверх, экспоненциально
    // вниз), используется ниже для яркости и ламп шара, и прожекторов
    // персонажа, и (теперь) лучей вокруг шара. Вращение шара — НЕ
    // использует это (см. ниже, постоянная скорость по просьбе).
    if (strongBeat) beatPulse = 1;
    beatPulse *= Math.pow(0.02, delta); // плавное, но довольно быстрое затухание вспышки

    // Вращение дискошара — ПОСТОЯННАЯ скорость, без реакции на удар (по
    // просьбе — раньше ускорялось вместе с beatPulse, теперь всегда
    // одинаково).
    discoBall.rotation.y += 0.4 * delta;

    // Высота/масштаб шара плавно стремятся к целевым значениям текущего
    // режима (см. setDuetMode) — простая экспоненциальная интерполяция,
    // тот же принцип, что и smart-камера "плывёт домой" в main.js, а не
    // резкий скачок на новое значение.
    const ballEase = 1 - Math.pow(0.02, delta * BALL_TRANSITION_SPEED);
    discoBall.position.y += (targetBallY - discoBall.position.y) * ballEase;
    const currentScale = discoBall.scale.x + (targetBallScale - discoBall.scale.x) * ballEase;
    discoBall.scale.setScalar(currentScale);

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

    // --- Лучи вокруг шара (2D-слой поверх сцены, см. createBallRays) ---
    // Проецируем 3D-позицию шара в экранные (CSS-пиксельные) координаты
    // контейнера — project() возвращает NDC (-1..1 по обеим осям, где
    // Y растёт ВВЕРХ), переводим в обычные экранные пиксели (Y растёт
    // ВНИЗ, как в canvas 2D).
    projectedPosition.copy(discoBall.position).project(camera);
    if (projectedPosition.z < 1) {
      // z >= 1 означает "за задней плоскостью отсечения камеры" — в
      // норме тут такого не бывает (шар всегда перед камерой), но
      // проверка дешёвая, а без неё при странных углах камеры лучи
      // могли бы на мгновение выстрелить в случайную точку экрана.
      const { width: rayWidth, height: rayHeight } = ballRays.getSize();
      screenPos.x = ((projectedPosition.x + 1) / 2) * rayWidth;
      screenPos.y = ((1 - projectedPosition.y) / 2) * rayHeight;
      // Индекс медленно растёт со временем — веер лучей плавно
      // "перекрашивается" по кругу палитры, а не стоит на одном
      // статичном наборе цветов, пока играет музыка.
      const colorPhase = Math.floor(time * 0.6) % RAY_COLORS.length;
      ballRays.draw(delta, screenPos, 0.55 + beatPulse * 0.45, RAY_COLORS, colorPhase);
    } else {
      ballRays.draw(delta, null, 0, RAY_COLORS, 0);
    }
  }

  /** Включает/выключает разом все прожекторы (и диагностические конусы вместе с ними). */
  function setEnabled(value) {
    enabled = value;
    discoBall.visible = value;
    ballRays.setVisible(value);
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

  return { update, setEnabled, setHelpersVisible, setDuetMode };
}

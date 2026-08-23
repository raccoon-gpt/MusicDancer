import * as THREE from "three";
import { createScene, loadCharacterFBX, loadAnimationClipsFBX, measureAndApplyAutoScale, groundAndCenterModel, faceCameraCompensated, disposeObject3D } from "./scene.js";
import { createSoundWave } from "./soundWave.js";
import { createAnimationController } from "./animationController.js";
import { createAudioPlayer, formatTime } from "./audioPlayer.js";
import { createAudioAnalyzer, createIntensityTracker } from "./audioAnalyzer.js";
import { createBeatDetector } from "./beatDetector.js";
import { computeWaveformPeaks, drawWaveform, drawFlatline } from "./waveform.js";
import * as playlistStorage from "./playlistStorage.js";
import * as characterStorage from "./characterStorage.js";
import { t, getLanguage, setLanguage } from "./i18n.js";

const container = document.getElementById("scene-container");
const { scene, camera, renderer, placeholder, controls, resize, setResizeSuspended: setSceneResizeSuspended } = createScene(container);
const soundWave = createSoundWave(container);

// ВРЕМЕННО: панель live-настройки Sound Wave — попросите убрать, когда
// определитесь с финальным видом. Четыре ползунка дёргают set*-функции
// soundWave напрямую, без перезагрузки.
(function setupSoundWaveControls() {
  const panel = document.createElement("div");
  panel.style.position = "fixed";
  panel.style.right = "12px";
  panel.style.top = "70px"; // ниже кнопки умной камеры 🎥 (top:12px, высота 44px)
  panel.style.zIndex = "9999";
  panel.style.background = "rgba(0,0,0,0.55)";
  panel.style.border = "2px solid rgba(255,255,255,0.6)";
  panel.style.borderRadius = "10px";
  panel.style.padding = "10px 12px";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.gap = "8px";
  panel.style.color = "#fff";
  panel.style.fontFamily = "sans-serif";
  panel.style.fontSize = "12px";
  panel.style.minWidth = "180px";

  function addSlider(label, min, max, step, defaultValue, onInput) {
    const row = document.createElement("div");
    const labelRow = document.createElement("div");
    labelRow.style.display = "flex";
    labelRow.style.justifyContent = "space-between";
    labelRow.style.marginBottom = "2px";
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.textContent = String(defaultValue);
    valueEl.style.opacity = "0.75";
    labelRow.appendChild(labelEl);
    labelRow.appendChild(valueEl);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(defaultValue);
    input.style.width = "100%";
    input.addEventListener("input", () => {
      valueEl.textContent = input.value;
      onInput(Number(input.value));
    });
    row.appendChild(labelRow);
    row.appendChild(input);
    panel.appendChild(row);
  }

  // "Масштаб" / "высота" — насколько высоко взлетают столбики
  addSlider("Высота (масштаб)", 5, 90, 1, 38, (v) => soundWave.setMaxBarHeightFraction(v / 100));

  // "Размер" — трактуем как количество столбиков (плотность рисунка)
  addSlider("Количество столбиков", 8, 160, 2, 56, (v) => soundWave.setBarCount(v));

  // "Ширина" — толщина каждого отдельного столбика: выше значение
  // ползунка = толще столбик (меньше зазор). Дефолт 72 соответствует
  // исходному зазору 0.28 (гуще, но не впритык).
  addSlider("Толщина столбиков", 5, 100, 1, 72, (v) => soundWave.setBarGapFraction((100 - v) / 100));

  // Длина всей волны целиком (сжатие/растяжение группы столбиков как
  // единого целого, НЕ через количество столбиков) — 100% во весь экран,
  // меньше — уже, с фоном по бокам.
  addSlider("Длина волны", 10, 100, 1, 100, (v) => soundWave.setWidthFraction(v / 100));

  // Размытие — от 0 (чёткие столбики) до полного слияния в градиент
  addSlider("Размытие %", 0, 15, 0.1, 0, (v) => soundWave.setBlurPercent(v));

  document.body.appendChild(panel);
  // Спрятана по запросу (режимы волны настроены, панель прежней подгонки
  // больше не нужна на экране) — но НЕ удалена, код рабочий, может
  // понадобиться для дальнейшей подгонки. Чтобы вернуть: убрать эту
  // строку или временно поставить panel.style.display = "flex" в консоли.
  panel.style.display = "none";
})();

// ВРЕМЕННО: панель live-настройки контраста/насыщенности персонажей —
// попросите убрать, когда определитесь с финальными значениями. Проще
// всего через CSS filter прямо на WebGL-канвасе (contrast/saturate) —
// не трогает материалы/освещение/рендер-пайплайн Three.js вообще,
// просто цветокоррекция уже готовой картинки, как Instagram-фильтр.
(function setupCharacterColorControls() {
  const panel = document.createElement("div");
  panel.style.position = "fixed";
  panel.style.right = "12px";
  panel.style.top = "70px"; // тот же угол, что и спрятанная панель волны — не конфликтует, та скрыта
  panel.style.zIndex = "9999";
  panel.style.background = "rgba(0,0,0,0.55)";
  panel.style.border = "2px solid rgba(255,255,255,0.6)";
  panel.style.borderRadius = "10px";
  panel.style.padding = "10px 12px";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.gap = "8px";
  panel.style.color = "#fff";
  panel.style.fontFamily = "sans-serif";
  panel.style.fontSize = "12px";
  panel.style.minWidth = "180px";

  let contrastPct = 109; // финальное значение, зафиксировано пользователем
  let saturatePct = 109; // — то же самое, действует даже когда панель скрыта

  function applyFilter() {
    renderer.domElement.style.filter = `contrast(${contrastPct}%) saturate(${saturatePct}%)`;
  }
  applyFilter(); // применяем дефолт сразу при загрузке, не дожидаясь движения ползунка

  // Размытие КОНТУРА персонажей (не виньетка по экрану). Идея: сцена
  // рендерится с прозрачным фоном (alpha:true) — на резком WebGL-канвасе
  // внутри силуэта персонажа непрозрачно, снаружи пусто. Кладём
  // РАЗМЫТУЮ копию того же кадра ПОД резким оригиналом (ниже по
  // z-index, не поверх с маской, как в первой неудачной версии): резкий
  // слой сверху полностью перекрывает размытие внутри себя (он
  // непрозрачный), а по самому краю силуэта размытая копия чуть
  // "просвечивает" наружу за пределы чёткой границы — получается мягкое
  // свечение/растушёвка контура. Никакой маски не нужно вообще, всё
  // делает естественная alpha-прозрачность резкого слоя сверху.
  const edgeBlurCanvas = document.createElement("canvas");
  edgeBlurCanvas.style.position = "absolute";
  edgeBlurCanvas.style.inset = "0";
  edgeBlurCanvas.style.width = "100%";
  edgeBlurCanvas.style.height = "100%";
  edgeBlurCanvas.style.zIndex = "1"; // МЕЖДУ звуковой волной (0) и резким WebGL-канвасом (2, см. scene.js)
  edgeBlurCanvas.style.pointerEvents = "none";
  edgeBlurCanvas.style.display = "none"; // скрыт, пока ползунок на 0 — не тратим время на копирование зря
  container.appendChild(edgeBlurCanvas);
  const edgeBlurCtx = edgeBlurCanvas.getContext("2d");

  let edgeBlurPx = 0;

  function applyEdgeBlur(px) {
    edgeBlurPx = px;
    if (px <= 0) {
      edgeBlurCanvas.style.display = "none";
      return;
    }
    edgeBlurCanvas.style.display = "block";
    edgeBlurCanvas.style.filter = `blur(${px}px)`;
  }
  applyEdgeBlur(1); // финальное значение по умолчанию, применяется сразу при загрузке

  // Флаг "сейчас идёт активный ресайз контейнера сцены" — на это время
  // просто ПРЯЧЕМ слой размытия целиком (см. isResizingScene ниже),
  // вместо попытки синхронизировать его размер на каждом кадре. Само
  // размытие — декоративный эффект поверх основного персонажа, не
  // критично на долю секунды его не показывать во время самого
  // изменения размера — а вот рассинхрон буфера/видимого размера именно
  // в этом слое (см. историю чуть ниже) был реальным источником
  // заметной деформации.
  let isResizingScene = false;
  let resizingSettleTimer = null;
  function markSceneResizing() {
    isResizingScene = true;
    clearTimeout(resizingSettleTimer);
    resizingSettleTimer = setTimeout(() => {
      isResizingScene = false;
    }, 200);
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(markSceneResizing).observe(container);
  }

  // Копирование кадра — вызывается из renderLoop в main.js (см. вызов
  // window.__updateEdgeBlurCanvas ниже), а не изнутри этого модуля,
  // потому что происходит ПОСЛЕ renderer.render() каждый кадр — иначе
  // скопируется кадр ДО отрисовки персонажей этого тика, с задержкой на
  // один кадр. Размер синхронизируется КАЖДЫЙ раз, а не по событию
  // window resize — тот не срабатывает на внутренние программные вызовы
  // resize() самого проекта.
  window.__updateEdgeBlurCanvas = function updateEdgeBlurCanvas() {
    if (edgeBlurPx <= 0) return;
    if (isResizingScene) {
      // Прячем на время самого ресайза — не пытаемся угнаться за
      // постоянно меняющимся размером контейнера, просто временно не
      // показываем этот декоративный слой, пока всё не устаканится.
      edgeBlurCanvas.style.display = "none";
      return;
    }
    edgeBlurCanvas.style.display = "block";
    // Защита от падения всего кадра: если у WebGL-канваса на этот
    // конкретный момент 0 по ширине/высоте (сцена ещё не успела получить
    // реальный размер после layout-изменения — например, во время
    // анимации открытия/закрытия шторки списка) — drawImage() кидает
    // InvalidStateError, и это НЕ отлавливалось, обрывая остаток кадра
    // (обновление волны шло следом по коду и просто не успевало
    // выполниться — отсюда "волна не двигается"). Просто пропускаем этот
    // кадр целиком, а не падаем.
    if (renderer.domElement.width === 0 || renderer.domElement.height === 0) return;
    if (edgeBlurCanvas.width !== renderer.domElement.width || edgeBlurCanvas.height !== renderer.domElement.height) {
      edgeBlurCanvas.width = renderer.domElement.width;
      edgeBlurCanvas.height = renderer.domElement.height;
      // Видимый CSS-размер держали через width:100%/height:100% (см.
      // style.css) — тот тянется за контейнером НЕМЕДЛЕННО, на каждом
      // кадре, независимо от debounce в scene.js. Буфер же (строки выше)
      // обновляется только вместе с debounced renderer.setSize() — то
      // есть буфер и видимый размер этого канваса временно расходились
      // во время анимации шторки списка, давая деформацию именно в этом
      // слое (edge-blur), даже после фикса пропорций камеры в основном
      // WebGL-канвасе. Теперь видимый размер держим синхронно С САМИМ
      // БУФЕРОМ, инлайн-стилем — оба значения всегда меняются вместе,
      // расхождению просто неоткуда взяться.
      edgeBlurCanvas.style.width = `${renderer.domElement.width / renderer.getPixelRatio()}px`;
      edgeBlurCanvas.style.height = `${renderer.domElement.height / renderer.getPixelRatio()}px`;
    }
    edgeBlurCtx.clearRect(0, 0, edgeBlurCanvas.width, edgeBlurCanvas.height);
    edgeBlurCtx.drawImage(renderer.domElement, 0, 0);
  };

  function addSlider(label, min, max, step, defaultValue, onInput) {
    const row = document.createElement("div");
    const labelRow = document.createElement("div");
    labelRow.style.display = "flex";
    labelRow.style.justifyContent = "space-between";
    labelRow.style.marginBottom = "2px";
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.textContent = String(defaultValue);
    valueEl.style.opacity = "0.75";
    labelRow.appendChild(labelEl);
    labelRow.appendChild(valueEl);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(defaultValue);
    input.style.width = "100%";
    input.addEventListener("input", () => {
      valueEl.textContent = input.value;
      onInput(Number(input.value));
    });
    row.appendChild(labelRow);
    row.appendChild(input);
    panel.appendChild(row);
  }

  addSlider("Контрастность %", 30, 200, 1, 109, (v) => {
    contrastPct = v;
    applyFilter();
  });
  addSlider("Насыщенность %", 0, 250, 1, 109, (v) => {
    saturatePct = v;
    applyFilter();
  });
  addSlider("Размытие краёв", 0, 40, 1, 1, (v) => applyEdgeBlur(v));

  document.body.appendChild(panel);
  // Спрятана по запросу (финальные значения подобраны — контраст/
  // насыщенность 109%, размытие контура 2) — но НЕ удалена, код рабочий,
  // может понадобиться для дальнейшей подгонки.
  panel.style.display = "none";
})();

// Исходный ракурс камеры "по умолчанию при загрузке" — запоминаем один
// раз, сразу после создания сцены, пока ничего ещё не покрутили. Нужен
// и кнопке "вернуть камеру домой", и умной камере (она качается вокруг
// именно этой точки, а не текущей позиции).
const HOME_CAMERA_POSITION = camera.position.clone();
const HOME_CAMERA_TARGET = controls.target.clone();
const HOME_SPHERICAL = new THREE.Spherical().setFromVector3(
  HOME_CAMERA_POSITION.clone().sub(HOME_CAMERA_TARGET)
);

// ВРЕМЕННО: "умная камера" — плавные "качели" вокруг исходного ракурса,
// а не полный оборот вокруг персонажей:
//  - по горизонтали: от центра до −60°, обратно к центру, до +60°,
//    обратно к центру, и так по кругу (не полный оборот 360°, а именно
//    туда-обратно в пределах 120°)
//  - одновременно по вертикали: волна от уровня глаз (0°) вверх до
//    +UP° и вниз до −DOWN° (ниже глаз) и обратно, SMART_CAMERA_
//    VERTICAL_WAVES волн за один горизонтальный проход
// Оба движения — чистые синусоиды от одной и той же фазы, поэтому
// движение само по себе плавное без доп. сглаживания. Скорость (как
// быстро проходит один цикл) слегка ускоряется на пиках intensity —
// та же величина, на которую уже реагируют персонажи.
// Плюс лёгкий "пульс" приближения (через camera.fov, не через позицию —
// так не конфликтует с внутренней математикой OrbitControls) на сильных
// битах, как и раньше.
let smartCameraEnabled = false;
let smartCameraMode = "sweep"; // "sweep" — качели влево-вправо, "spin" — полный оборот
let smartCameraPhase = 0;
let smartCameraSweepPassCount = 0; // сколько проходов качелей отыграно с последнего оборота
let smartCameraSpinElapsed = 0;
let smartCameraSpinDirection = -1; // −1 = первый оборот влево, чередуется после каждого оборота
let smartCameraFovPulse = 0;
let smartCameraReturningHome = false; // true сразу после выключения — едем домой, пока не долетим
const SMART_CAMERA_AZIMUTH_DEG = 70; // качели по горизонтали: ±70° от центра (итого 140°)
const SMART_CAMERA_VERTICAL_UP_DEG = 13; // волна вверх: до 13° выше уровня глаз
const SMART_CAMERA_VERTICAL_DOWN_DEG = 7; // и до 7° ниже уровня глаз
const SMART_CAMERA_VERTICAL_WAVES = 2; // столько волн вверх-вниз за один проход качелей
// midline/amplitude общие для обеих волн (качели и один оборот) — чтобы
// диапазон синусоиды был ровно [−DOWN, +UP] от уровня глаз.
const SMART_VERTICAL_MIDLINE_DEG = (SMART_CAMERA_VERTICAL_UP_DEG - SMART_CAMERA_VERTICAL_DOWN_DEG) / 2;
const SMART_VERTICAL_AMPLITUDE_DEG = (SMART_CAMERA_VERTICAL_UP_DEG + SMART_CAMERA_VERTICAL_DOWN_DEG) / 2;
const SMART_CAMERA_BASE_OMEGA = ((2 * Math.PI) / 16) * 0.8; // качели медленнее на 20%: было ~16с на проход, стало ~20с
const SMART_CAMERA_OMEGA_INTENSITY_BOOST = 1.5; // на пике intensity цикл ускоряется примерно в 2.5 раза
const SMART_CAMERA_SWEEPS_BEFORE_SPIN = 2; // столько проходов качелей — потом один полный оборот
const SMART_CAMERA_SPIN_DURATION = 4; // секунд на полный оборот 360° — фиксировано, не зависит от темпа
const SMART_CAMERA_IDLE_HOME_EASE_TIME = 1.2; // секунд "постоянной времени" возврата домой на Idle
const SMART_CAMERA_HOME_SNAP_DISTANCE = 0.01; // метров — ближе этого считаем "долетели", отдаём управление ручному вращению

/**
 * Плавно тянет камеру к исходному ракурсу и сбрасывает фазу качелей/
 * оборота — используется и когда музыка не играет вообще (пауза/конец
 * трека), и когда музыка играет, но персонаж(и) прямо сейчас в Idle
 * (например, музыка на секунду стихла посреди трека) — в обоих случаях
 * поведение камеры должно быть одинаковым: непрерывный плавный возврат,
 * непрерывно, а не одним рывком.
 */
function driveCameraHome(delta) {
  const homeEase = 1 - Math.exp(-delta / SMART_CAMERA_IDLE_HOME_EASE_TIME);
  camera.position.lerp(HOME_CAMERA_POSITION, homeEase);
  controls.target.lerp(HOME_CAMERA_TARGET, homeEase);
  camera.lookAt(controls.target);

  smartCameraMode = "sweep";
  smartCameraPhase = 0;
  smartCameraSweepPassCount = 0;

  if (camera.fov !== SMART_CAMERA_BASE_FOV) {
    camera.fov += (SMART_CAMERA_BASE_FOV - camera.fov) * homeEase;
    camera.updateProjectionMatrix();
  }
  smartCameraFovPulse = 0;
}
const SMART_CAMERA_BASE_FOV = 35; // должно совпадать с camera.fov из scene.js
const SMART_CAMERA_FOV_PUNCH = 4; // на сколько градусов "поджимается" fov на сильном бите
const SMART_CAMERA_FOV_DECAY = 0.9; // скорость плавного возврата после пульса

// Ручное вращение мышью/тачем (OrbitControls, см. scene.js) по умолчанию
// не пускало ниже горизонта (maxPolarAngle=90°) — теперь разрешаем и
// ручному вращению заходить настолько же ниже уровня глаз, насколько
// заходит умная камера (SMART_CAMERA_VERTICAL_DOWN_DEG), а не только ей.
controls.maxPolarAngle = HOME_SPHERICAL.phi + THREE.MathUtils.degToRad(SMART_CAMERA_VERTICAL_DOWN_DEG);

/**
 * Меняет "домашнюю" дистанцию камеры (используется дуэтом на мобильном —
 * см. applyActiveCharacters ниже) и синхронно пересчитывает всё, что от
 * неё зависит: HOME_SPHERICAL (качели/оборот умной камеры и автовозврат
 * домой опираются именно на неё, не на текущую camera.position — без
 * этого пересчёта они бы на следующем же кадре утянули камеру обратно
 * на старую дистанцию, перебив только что выставленную) и
 * controls.maxPolarAngle (тоже завязан на HOME_SPHERICAL.phi).
 */
function setHomeCameraDistance(z) {
  HOME_CAMERA_POSITION.set(0, 1.4, z);
  HOME_SPHERICAL.setFromVector3(HOME_CAMERA_POSITION.clone().sub(HOME_CAMERA_TARGET));
  controls.maxPolarAngle = HOME_SPHERICAL.phi + THREE.MathUtils.degToRad(SMART_CAMERA_VERTICAL_DOWN_DEG);
}

let smartCameraBtnRef = null;
const mobileFadeButtons = []; // кнопки, которые на мобильном скрыты по умолчанию (см. setupMobileFadeButtons ниже)
function setSmartCameraEnabled(value) {
  smartCameraEnabled = value;
  if (value) {
    // Каждое включение стартует чисто — с качелей от центра, а не с
    // того места, на котором остановились в прошлый раз (направление
    // чередования оборотов НЕ сбрасываем — пусть продолжает чередоваться
    // естественно между сессиями включения/выключения).
    smartCameraMode = "sweep";
    smartCameraPhase = 0;
    smartCameraSweepPassCount = 0;
    smartCameraReturningHome = false; // включили заново — отменяем недоделанный возврат
  } else {
    // Выключили (неважно, во время паузы или во время танца) — не
    // замираем на месте, а плавно едем домой тем же механизмом, что и
    // на паузе (driveCameraHome), пока не долетим достаточно близко —
    // см. проверку расстояния в renderLoop.
    smartCameraReturningHome = true;
  }
  if (smartCameraBtnRef) {
    smartCameraBtnRef.style.background = value ? "rgba(120,170,255,0.6)" : "rgba(0,0,0,0.4)";
  }
}

(function setupSmartCameraToggle() {
  const btn = document.createElement("button");
  btn.className = "mobile-fade-btn"; // на мобильном скрыта по умолчанию, см. style.css
  // Иконка "video" в стиле Lucide (24x24, stroke=currentColor) — раньше
  // был эмодзи 🎥, разный вид на разных платформах/шрифтах.
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>';
  btn.title = "Умная камера (покачивается в такт музыке) вкл/выкл";
  btn.style.position = "fixed";
  btn.style.top = "12px";
  btn.style.right = "116px"; // сдвинута левее — освобождает место для новой кнопки (масштаб сцены) между камерой и волной
  btn.style.zIndex = "9999";
  btn.style.width = "44px";
  btn.style.height = "44px";
  btn.style.border = "2px solid rgba(255,255,255,0.6)";
  btn.style.borderRadius = "8px";
  btn.style.cursor = "pointer";
  btn.style.background = "rgba(0,0,0,0.4)";
  btn.style.color = "#fff";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.addEventListener("click", () => setSmartCameraEnabled(!smartCameraEnabled));
  document.body.appendChild(btn);
  smartCameraBtnRef = btn;
  mobileFadeButtons.push(btn);
})();

// Кнопка масштаба сцены по высоте — циклически 80% → 70% → 60% → 100%
// (квадрат целиком) → снова 80%... Иконка "maximize-2" в стиле Lucide.
// Отдельно от шторки списка (та сжимает через #mobile-top-area целиком,
// эта — напрямую высоту #scene-container через инлайн-стиль).
const SCENE_HEIGHT_SCALE_STEPS = [0.8, 0.7, 0.6, 1];
let sceneHeightScaleIndex = -1; // -1 = ещё не нажимали, 100% по умолчанию
let sceneHeightBtnRef = null; // нужна снаружи — отключается при открытой шторке списка

function applySceneHeightScale() {
  const scale = sceneHeightScaleIndex === -1 ? 1 : SCENE_HEIGHT_SCALE_STEPS[sceneHeightScaleIndex];
  if (scale >= 1) {
    // 100% — просто убираем инлайн-высоту, дальше снова решает CSS
    // (aspect-ratio/flex-shrink), как было изначально.
    container.style.height = "";
    return;
  }
  // "Естественная" высота квадрата равна его текущей ширине (aspect-
  // ratio:1/1) — считаем от неё, не от текущей (уже, возможно, urezanной)
  // высоты, иначе повторные клики будут схлопывать сцену лавинообразно.
  const naturalSize = container.clientWidth;
  container.style.height = `${naturalSize * scale}px`;
}

(function setupSceneHeightToggle() {
  const btn = document.createElement("button");
  btn.className = "mobile-fade-btn";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
  btn.title = "Высота сцены: 80% / 70% / 60% / 100% по кругу";
  btn.style.position = "fixed";
  btn.style.top = "12px";
  btn.style.right = "64px"; // между камерой (116px) и волной (12px)
  btn.style.zIndex = "9999";
  btn.style.width = "44px";
  btn.style.height = "44px";
  btn.style.border = "2px solid rgba(255,255,255,0.6)";
  btn.style.borderRadius = "8px";
  btn.style.cursor = "pointer";
  btn.style.background = "rgba(0,0,0,0.4)";
  btn.style.color = "#fff";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.addEventListener("click", () => {
    sceneHeightScaleIndex = (sceneHeightScaleIndex + 1) % SCENE_HEIGHT_SCALE_STEPS.length;
    applySceneHeightScale();
  });
  document.body.appendChild(btn);
  mobileFadeButtons.push(btn);
  sceneHeightBtnRef = btn;
})();

// Пересчитываем текущий масштаб при ресайзе окна — "естественный размер"
// (ширина контейнера) мог измениться, а инлайн-высота, выставленная от
// СТАРОЙ ширины, иначе осталась бы неверной.
window.addEventListener("resize", () => {
  if (sceneHeightScaleIndex !== -1) applySceneHeightScale();
});

// Кнопка-шестерёнка (Settings) — та же строка, что камера/масштаб/волна,
// но с ЛЕВОЙ стороны (те три — справа), тот же mobileFadeButtons — тоже
// появляется по касанию сцены, не отдельная логика показа.
(function setupSettingsToggle() {
  const btn = document.createElement("button");
  btn.className = "mobile-fade-btn";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
  btn.title = "Settings";
  btn.style.position = "fixed";
  btn.style.top = "12px";
  btn.style.left = "12px"; // зеркально волне (right:12px) — противоположная сторона того же ряда
  btn.style.zIndex = "9999";
  btn.style.width = "44px";
  btn.style.height = "44px";
  btn.style.border = "2px solid rgba(255,255,255,0.6)";
  btn.style.borderRadius = "8px";
  btn.style.cursor = "pointer";
  btn.style.background = "rgba(0,0,0,0.4)";
  btn.style.color = "#fff";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.addEventListener("click", openSettingsPopup);
  document.body.appendChild(btn);
  mobileFadeButtons.push(btn);
})();

// --- Кнопка смены режимов Sound Wave (справа от кнопки камеры) ---
// Три режима по кругу: "blur" (размытие, по умолчанию) → "normal"
// (чёткие столбики) → "off" (волна выключена совсем, обычный экран) →
// снова "blur"... Значения ниже — финальные, подобраны и присланы
// пользователем через временную панель настройки (см. её код чуть
// выше, сейчас спрятана display:none, не удалена).
const WAVE_MODE_ORDER = ["blur", "normal", "off"];
const MODE_SETTINGS = {
  blur: { maxBarHeightFraction: 0.2, barCount: 50, barGapFraction: 0.8, widthFraction: 0.7, blurPct: 3.68 },
  normal: { maxBarHeightFraction: 0.2, barCount: 50, barGapFraction: 0.5, widthFraction: 0.7, blurPct: 0 },
  // "off" ничего из этого не использует — просто прячет слой целиком.
};
let waveModeIndex = 0; // 0="blur" — размытие включено по умолчанию

// Масштаб (transform:scale) — ТОЛЬКО для режима blur, и ТОЛЬКО на
// мобильном (тот же порог 480px, что и в @media в style.css — держим
// в одном месте, чтобы не разъезжались). На десктопе всегда 1
// (без масштабирования, как было изначально) — раньше применялось
// одинаково и там, и там, что было ошибкой.
const BLUR_MODE_MOBILE_SCALE = 1.5;
function isMobileViewport() {
  return window.matchMedia("(max-width: 480px)").matches;
}
function updateWaveScaleForViewport() {
  const mode = WAVE_MODE_ORDER[waveModeIndex];
  const scale = mode === "blur" && isMobileViewport() ? BLUR_MODE_MOBILE_SCALE : 1;
  soundWave.setScale(scale);
}
window.addEventListener("resize", updateWaveScaleForViewport);

function applyWaveMode(mode) {
  if (mode === "off") {
    soundWave.setVisible(false);
    return;
  }
  const s = MODE_SETTINGS[mode];
  soundWave.setVisible(true);
  soundWave.setMaxBarHeightFraction(s.maxBarHeightFraction);
  soundWave.setBarCount(s.barCount);
  soundWave.setBarGapFraction(s.barGapFraction);
  soundWave.setWidthFraction(s.widthFraction);
  soundWave.setBlurPercent(s.blurPct);
  updateWaveScaleForViewport();
}
applyWaveMode(WAVE_MODE_ORDER[waveModeIndex]);

(function setupWaveModeToggle() {
  const btn = document.createElement("button");
  btn.className = "mobile-fade-btn"; // на мобильном скрыта по умолчанию, см. style.css
  // Иконка "audio-lines" в стиле Lucide (24x24, stroke=currentColor) —
  // раньше была картинка-скриншот (assets/ui/wave-mode-icon.jpg).
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>';
  btn.title = "Режим фоновой волны: размытие / чёткая / выключена";
  btn.style.position = "fixed";
  btn.style.top = "12px";
  btn.style.right = "12px"; // теперь правее кнопки камеры (поменяли местами)
  btn.style.zIndex = "9999";
  btn.style.width = "44px";
  btn.style.height = "44px";
  btn.style.border = "2px solid rgba(255,255,255,0.6)";
  btn.style.borderRadius = "8px";
  btn.style.cursor = "pointer";
  btn.style.background = "rgba(0,0,0,0.4)";
  btn.style.color = "#fff";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.addEventListener("click", () => {
    waveModeIndex = (waveModeIndex + 1) % WAVE_MODE_ORDER.length;
    applyWaveMode(WAVE_MODE_ORDER[waveModeIndex]);
  });
  document.body.appendChild(btn);
  mobileFadeButtons.push(btn);
})();

// Мобильное: 🎥 и режим волны скрыты по умолчанию на узких экранах (см.
// @media (max-width: 480px) в style.css) — появляются по касанию
// области сцены или клику мышью, автоматически прячутся через 3с. Если
// пользователь коснулся именно самой кнопки (взаимодействовал с ней) —
// держится дольше, 5с от ПОСЛЕДНЕГО такого касания, а не от первого. На
// десктопе (широкий экран) эта логика тоже технически выполняется, но
// визуально ничего не меняет — .mobile-visible работает только внутри
// того же @media, без него кнопки и так всегда видимы.
(function setupMobileFadeButtons() {
  let hideTimer = null;

  function reveal(durationMs) {
    mobileFadeButtons.forEach((b) => b.classList.add("mobile-visible"));
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      mobileFadeButtons.forEach((b) => b.classList.remove("mobile-visible"));
    }, durationMs);
  }

  // Касание/клик по самой сцене (не по кнопкам — они не внутри
  // container в DOM, отдельные элементы поверх, так что событие не
  // задвоится) — короткий показ.
  container.addEventListener("pointerdown", () => reveal(3000));

  // Касание/клик именно по кнопке — держится дольше, от последнего раза.
  mobileFadeButtons.forEach((b) => {
    b.addEventListener("pointerdown", () => reveal(5000));
  });
})();


const clock = new THREE.Clock();

// --- Phase 5: UI elements ---
const playBtn = document.getElementById("play-btn");
const progress = document.getElementById("progress");
const timeCurrentEl = document.getElementById("time-current");
const timeDurationEl = document.getElementById("time-duration");
const volumeInput = document.getElementById("volume");
const chooseBtn = document.getElementById("choose-audio-btn");
const fileInput = document.getElementById("audio-file-input");
const trackNameEl = document.getElementById("track-name");
const trackTitleTextEl = document.getElementById("track-title-text");
const trackArtistEl = document.getElementById("track-artist-mobile");
// Плейсхолдеры, пока трек ещё не выбран — блок теперь виден всегда
// (см. style.css), не только после первого выбранного трека.
// Плейсхолдеры, пока трек ещё не выбран — блок теперь виден всегда
// (см. style.css), не только после первого выбранного трека.
// trackTitleIsPlaceholder/trackArtistIsPlaceholder — раздельно (не один
// общий флаг): у трека может быть, например, название без исполнителя
// — тогда именно поле исполнителя должно оставаться плейсхолдером и
// переводиться при смене языка, а название (реальные данные) — нет.
let trackTitleIsPlaceholder = true;
let trackArtistIsPlaceholder = true;
trackTitleTextEl.textContent = t("track");
trackArtistEl.textContent = t("author");
const shuffleBtn = document.getElementById("shuffle-btn");
const prevTrackBtn = document.getElementById("prev-track-btn");
const nextTrackBtn = document.getElementById("next-track-btn");
const repeatBtn = document.getElementById("repeat-btn");
const mobileTopArea = document.getElementById("mobile-top-area");
const playlistSheet = document.getElementById("playlist-sheet");
const playlistDragHandle = document.getElementById("playlist-drag-handle");
const playlistItemsEl = document.getElementById("playlist-items");
const playlistAddBtn = document.getElementById("playlist-add-btn");
const playlistsBtn = document.getElementById("playlists-btn");
const playlistsPopupOverlay = document.getElementById("playlists-popup-overlay");
const playlistsPopupClose = document.getElementById("playlists-popup-close");
const playlistsPopupList = document.getElementById("playlists-popup-list");
const playlistsPopupCreateBtn = document.getElementById("playlists-popup-create-btn");
const playlistsPopupNameRow = document.getElementById("playlists-popup-name-row");
const playlistsPopupNameInput = document.getElementById("playlists-popup-name-input");
const playlistsPopupNameConfirm = document.getElementById("playlists-popup-name-confirm");
const settingsPopupOverlay = document.getElementById("settings-popup-overlay");
const settingsPopupClose = document.getElementById("settings-popup-close");
const settingsLanguageBtn = document.getElementById("settings-language-btn");
const waveformCanvas = document.getElementById("waveform-canvas");
const waveformToggleBtn = document.getElementById("waveform-toggle");

const debugEnabled = new URLSearchParams(window.location.search).has("debug");
const audioDebugEl = document.getElementById("audio-debug");
const dbgVolume = document.getElementById("dbg-volume");
const dbgBass = document.getElementById("dbg-bass");
const dbgMid = document.getElementById("dbg-mid");
const dbgTreble = document.getElementById("dbg-treble");
const dbgIntensity = document.getElementById("dbg-intensity");
const dbgBeatDot = document.getElementById("dbg-beat-dot");
if (debugEnabled) audioDebugEl.hidden = false;

let analyzer = null; // создаётся один раз, при первом Play (нужен user gesture)
const beatDetector = createBeatDetector(); // не зависит от analyzer — можно создать сразу
const intensityTracker = createIntensityTracker();
window.jerryBeat = beatDetector; // debug: jerryBeat.setSensitivity(1.1)
let lastBeatFlashAt = -Infinity;
let lastStrongBeatFlashAt = -Infinity;

const playIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
const pauseIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;

// progress slider — не дёргаем значение программно, пока пользователь его тащит
let isScrubbing = false;

// Waveform: два визуальных режима прогресс-бара, переключаются кнопкой 〜.
// waveformPeaks — null, пока трек не декодирован (или декодирование не
// удалось, например для потокового/защищённого источника — тогда просто
// остаёмся с плоским видом, ничего не ломается).
let waveformMode = false;
let waveformPeaks = null;
let waveformHoverRatio = null; // 0..1, позиция мыши над прогресс-баром — null, если мышь не наведена

function redrawProgressVisual() {
  const duration = Number(progress.max) || 0;
  const current = Number(progress.value) || 0;
  const ratio = duration > 0 ? current / duration : 0;

  // Заливка обычного (не-waveform) трека — градиент до текущей позиции,
  // современный вид прогресс-бара вместо однотонной полоски (ТЗ на
  // "современный аудиоплеер"). Работает независимо от waveformMode.
  progress.style.setProperty("--progress", `${(ratio * 100).toFixed(2)}%`);

  if (!waveformMode) return; // обычный <input type="range"> дальше сам справляется
  if (waveformPeaks) {
    drawWaveform(waveformCanvas, waveformPeaks, ratio, { hoverRatio: waveformHoverRatio });
  } else {
    drawFlatline(waveformCanvas);
  }
}

/** Применяет функцию ко всем активным (загруженным) animController — их
 * может быть один (соло) или два (Duet). */
function forEachActiveController(fn) {
  Object.values(slots).forEach((slot) => {
    if (slot.animController) fn(slot.animController, slot);
  });
}

function clearNowPlayingHighlights() {
  Object.entries(slots).forEach(([id, slot]) => {
    if (slot.lastNowPlayingName) {
      danceButtonsByKey.get(`${id}::${slot.lastNowPlayingName}`)?.classList.remove("now-playing");
      slot.lastNowPlayingName = null;
    }
  });
}

// Свой явный флаг "музыка реально играет" — см. комментарий в onEnded
// ниже про то, почему нельзя полагаться только на player.isPaused().
let musicIsPlaying = false;

const player = createAudioPlayer({
  onLoadedMetadata(duration) {
    progress.max = String(duration || 0);
    progress.disabled = false;
    playBtn.disabled = false;
    timeDurationEl.textContent = formatTime(duration);
    redrawProgressVisual();
  },
  onTimeUpdate(currentTime) {
    if (!isScrubbing) progress.value = String(currentTime);
    timeCurrentEl.textContent = formatTime(currentTime);
    redrawProgressVisual();
  },
  onPlay() {
    playBtn.innerHTML = pauseIcon;
    playBtn.setAttribute("aria-label", "Pause");
    musicIsPlaying = true;
    renderPlaylistList(); // индикатор в списке треков возвращается к цветному (был серым на паузе)
  },
  onPause() {
    playBtn.innerHTML = playIcon;
    playBtn.setAttribute("aria-label", "Play");
    musicIsPlaying = false;
    renderPlaylistList(); // индикатор в списке треков становится серым
    // Без этого история SMA продолжает "стареть" мимо времени паузы и на
    // resume какое-то время работает на стухших данных — сбрасываем сразу.
    beatDetector.reset();
    intensityTracker.reset();
    forEachActiveController((ctrl) => {
      ctrl.resetPose();
      ctrl.play("idle", { timeScale: 1 }); // Breathing Idle на паузе,
      // не заморозка на середине танца и не продолжение анимации в никуда
    });
    clearNowPlayingHighlights();
    dbgBeatDot.classList.remove("active");
  },
  onEnded() {
    // ВАЖНО: раньше камера (умная камера, возврат домой на Idle) считала
    // "музыка играет" по player.isPaused() = !audio.paused, а браузер не
    // всегда надёжно выставляет audio.paused=true при естественном
    // окончании трека (в отличие от ручной паузы) — из-за этого умная
    // камера продолжала крутиться и после конца трека, хотя персонажи
    // уже перешли в Idle. musicIsPlaying — свой явный флаг, не зависящий
    // от этой особенности браузера.
    musicIsPlaying = false;

    // Плейлист: если решили автоматически перейти на следующий трек
    // (repeat включён, или это не последний трек, или включён shuffle) —
    // handlePlaylistTrackEnded() уже сама всё переключила и запустила
    // воспроизведение, дальше сбрасывать UI в "стоп" не нужно.
    if (handlePlaylistTrackEnded()) return;

    playBtn.innerHTML = playIcon;
    playBtn.setAttribute("aria-label", "Play");
    progress.value = "0";
    timeCurrentEl.textContent = "00:00";
    beatDetector.reset();
    intensityTracker.reset();
    forEachActiveController((ctrl) => {
      ctrl.resetPose();
      ctrl.play("idle", { timeScale: 1 });
    });
    clearNowPlayingHighlights();
    dbgBeatDot.classList.remove("active");
  },
});

player.setVolume(Number(volumeInput.value));

// Создание/резюм AudioContext строго по пользовательскому клику (ТЗ п.18) —
// но НЕ только по клику именно на playBtn: клик по треку в списке
// плейлиста и авто-переход на следующий трек (после окончания текущего,
// или кнопкой next) тоже реально запускают воспроизведение через
// player.play() — без этой же самой проверки там танец/волна не
// включались (реальный баг: analyzer оставался null, блок
// audio-reactive в renderLoop молча пропускался целиком, персонаж
// оставался в Idle, волна не двигалась — работало только "случайно",
// если до этого где-то УЖЕ нажимали playBtn напрямую).
async function ensureAnalyzerReady() {
  if (!analyzer) {
    analyzer = createAudioAnalyzer(player.audio);
  }
  await analyzer.resume();
}

playBtn.addEventListener("click", async () => {
  await ensureAnalyzerReady();
  player.togglePlay();
});

progress.addEventListener("input", () => {
  isScrubbing = true;
  timeCurrentEl.textContent = formatTime(Number(progress.value));
  redrawProgressVisual();
});
progress.addEventListener("change", () => {
  player.seek(Number(progress.value));
  isScrubbing = false;
});

// Наведение мышкой в waveform-режиме — подсвечивает полоски до курсора
// (предпросмотр, куда перемотает клик), не завязано на реальный прогресс.
const progressWrap = document.getElementById("progress-wrap");
progressWrap.addEventListener("mousemove", (e) => {
  if (!waveformMode) return;
  const rect = progressWrap.getBoundingClientRect();
  waveformHoverRatio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  redrawProgressVisual();
});
progressWrap.addEventListener("mouseleave", () => {
  waveformHoverRatio = null;
  redrawProgressVisual();
});

volumeInput.addEventListener("input", () => {
  player.setVolume(Number(volumeInput.value));
});

chooseBtn.addEventListener("click", () => fileInput.click());

waveformToggleBtn.addEventListener("click", () => {
  waveformMode = !waveformMode;
  waveformToggleBtn.setAttribute("aria-pressed", String(waveformMode));
  progress.classList.toggle("progress-transparent", waveformMode);
  waveformCanvas.style.display = waveformMode ? "block" : "none";
  redrawProgressVisual();
});

// --- Панель live-контроля пула танцев ---
// Общий словарь подписей на ВСЕХ персонажей — разные персонажи могут иметь
// разные имена клипов (у белки "samba", у енота "samba_1"/"samba_2"),
// поэтому словарь с запасом, а не привязан к одному пулу.
const DANCE_LABELS = {
  hiphop_1: { ENG: "Hip-Hop 1", UKR: "Хіп-хоп 1", RU: "Хип-хоп 1" },
  hiphop_2: { ENG: "Hip-Hop 2", UKR: "Хіп-хоп 2", RU: "Хип-хоп 2" },
  hiphop_3: { ENG: "Hip-Hop 3", UKR: "Хіп-хоп 3", RU: "Хип-хоп 3" },
  hiphop_4: { ENG: "Hip-Hop 4", UKR: "Хіп-хоп 4", RU: "Хип-хоп 4" },
  hiphop_7: { ENG: "Hip-Hop 7", UKR: "Хіп-хоп 7", RU: "Хип-хоп 7" },
  // Единственный "хипхоп"-клип у енота — без цифры и в имени файла
  // (hiphop.fbx), и в id, и на кнопке.
  hiphop: { ENG: "Hip-Hop", UKR: "Хіп-хоп", RU: "Хип-хоп" },
  samba: { ENG: "Samba", UKR: "Самба", RU: "Самба" },
  samba_1: { ENG: "Samba 1", UKR: "Самба 1", RU: "Самба 1" },
  samba_2: { ENG: "Samba 2", UKR: "Самба 2", RU: "Самба 2" },
  silly: { ENG: "Silly", UKR: "Сіллі", RU: "Силли" },
  silly_1: { ENG: "Silly 1", UKR: "Сіллі 1", RU: "Силли 1" },
  silly_2: { ENG: "Silly 2", UKR: "Сіллі 2", RU: "Силли 2" },
  shuffle: { ENG: "Shuffle", UKR: "Шаффл", RU: "Шаффл" },
  uprock_brooklyn: { ENG: "Uprock BK", UKR: "Апрок БК", RU: "Апрок БК" },
  uprock_breakdance: { ENG: "Uprock BD", UKR: "Апрок БД", RU: "Апрок БД" },
  twerk: { ENG: "Twerk", UKR: "Тверк", RU: "Тверк" },
  // Не настоящие названия стилей танца (это просто имена Mixamo-клипов,
  // "Maraschino"/"Flair" — прихоть авторов анимаций) — переведены
  // фонетической транслитерацией, не смысловым переводом.
  maraschino: { ENG: "Maraschino", UKR: "Мараскіно", RU: "Мараскино" },
  flair: { ENG: "Flair", UKR: "Флер", RU: "Флэр" },
  wave_hiphop: { ENG: "Wave Hip-Hop", UKR: "Хвиля Хіп-хоп", RU: "Волна Хип-хоп" },
  chicken_dance: { ENG: "Chicken Dance", UKR: "Танець Курчати", RU: "Танец Цыплёнка" },
  gangnam_style: { ENG: "Gangnam Style", UKR: "Гангнам Стайл", RU: "Гангнам Стайл" },
};

/** Достаёт подпись танца на текущем языке (см. i18n.js getLanguage()) —
 * с откатом на ENG, если для какого-то ключа вдруг не окажется перевода
 * на конкретный язык, и на сам id клипа, если ключа нет в словаре вовсе. */
function getDanceLabel(name) {
  const entry = DANCE_LABELS[name];
  if (!entry) return name;
  return entry[getLanguage()] || entry.ENG || name;
}

const danceButtonsByKey = new Map(); // ключ "characterId::clipName"

// Персонаж-специфичная поправка размера: в жизни енот крупнее белки, но
// оба нормируются к одному и тому же росту (BASE_CHARACTER_HEIGHT) — рядом
// в Duet это выглядит неестественно, белка кажется гигантской. Только в
// Duet (не в соло) уменьшаем белку на 10% относительно базового роста —
// чисто визуальная поправка "на глаз", не связана с реальными пропорциями
// модели/скелета.
const BASE_CHARACTER_HEIGHT = 1.5;
const SQUIRREL_DUET_HEIGHT_FACTOR = 0.9;
/**
 * ВАЖНО: раньше "дуэт ли это" угадывалось по offsetX !== 0 — работало,
 * пока соло было ГАРАНТИРОВАННО ровно 0. Теперь соло на мобильном тоже
 * ненулевое (см. computeOffsets: +0.10 вправо), так что этот признак
 * больше не годится — белка ошибочно получала уменьшенный рост дуэта
 * даже в соло. isDuet теперь передаётся явно, не выводится из числа.
 */
function getTargetHeightFor(id, isDuet) {
  if (id === "squirrel" && isDuet) {
    return BASE_CHARACTER_HEIGHT * SQUIRREL_DUET_HEIGHT_FACTOR;
  }
  return BASE_CHARACTER_HEIGHT;
}

// --- Мультиперсонажность: конфиг персонажей ---
// Добавить нового персонажа в будущем = добавить одну запись сюда, весь
// остальной UI (пикер, стек панелей, позиционирование в дуэте) подхватит
// его автоматически, без переделки логики.
const CHARACTERS = {
  squirrel: {
    label: "Squirrel",
    avatarSrc: "assets/ui/squirrel-avatar.png",
    characterUrl: "assets/character-fbx/Breathing_Idle.fbx",
    animationFiles: [
      ["assets/animations-fbx/hiphop_1.fbx", "hiphop_1"],
      ["assets/animations-fbx/hiphop_2.fbx", "hiphop_2"],
      ["assets/animations-fbx/hiphop_3.fbx", "hiphop_3"],
      ["assets/animations-fbx/hiphop_4.fbx", "hiphop_4"],
      ["assets/animations-fbx/samba.fbx", "samba"],
      ["assets/animations-fbx/silly.fbx", "silly"],
      ["assets/animations-fbx/shuffle.fbx", "shuffle"],
      ["assets/animations-fbx/uprock_breakdance.fbx", "uprock_breakdance"],
      ["assets/animations-fbx/twerk.fbx", "twerk"],
      ["assets/animations-fbx/wave_hiphop.fbx", "wave_hiphop"],
      ["assets/animations-fbx/chicken_dance.fbx", "chicken_dance"],
      ["assets/animations-fbx/gangnam_style.fbx", "gangnam_style"],
    ],
  },
  raccoon: {
    label: "Raccoon",
    avatarSrc: "assets/ui/raccoon-avatar.png",
    characterUrl: "assets/character-fbx-raccoon/Breathing_Idle.fbx",
    // Хвост енота теперь исправлен на уровне самого FBX-файла (Blender,
    // укорочен + перенесён по проверенной схеме из README) — рантайм-патч
    // rigidifyContaminatedSkinWeights() для него больше не нужен, как и
    // для белки раньше. Оставлен пустой массив, а не удалён совсем — на
    // случай если понадобится откатиться к старому файлу.
    tailFixRules: [],
    animationFiles: [
      ["assets/animations-fbx-raccoon/hiphop.fbx", "hiphop"],
      ["assets/animations-fbx-raccoon/samba_1.fbx", "samba_1"],
      ["assets/animations-fbx-raccoon/samba_2.fbx", "samba_2"],
      ["assets/animations-fbx-raccoon/silly_2.fbx", "silly_2"],
      ["assets/animations-fbx-raccoon/uprock_brooklyn.fbx", "uprock_brooklyn"],
      ["assets/animations-fbx-raccoon/uprock_breakdance.fbx", "uprock_breakdance"],
      ["assets/animations-fbx-raccoon/maraschino.fbx", "maraschino"],
      ["assets/animations-fbx-raccoon/flair.fbx", "flair"],
      ["assets/animations-fbx-raccoon/wave_hiphop.fbx", "wave_hiphop"],
      ["assets/animations-fbx-raccoon/chicken_dance.fbx", "chicken_dance"],
      ["assets/animations-fbx-raccoon/gangnam_style.fbx", "gangnam_style"],
    ],
  },
};

// --- ПРОТОТИП: загрузка собственного персонажа пользователем ---
// Стандартный человекоподобный Mixamo-риг (без хвоста и подобной
// специфики — упростили осознанно, см. обсуждение) должен иметь ТЕ ЖЕ
// имена костей (mixamorig:...), что и у уже загруженных белки/енота —
// именно по именам костей Three.js AnimationMixer сопоставляет клипы с
// моделью. Если совпадают — уже существующие клипы (idle + весь пул
// танцев) должны "сесть" на чужой скелет без какой-либо отдельной
// анимационной интеграции. Ничего не сохраняется между визитами (ни в
// localStorage, ни в IndexedDB) — файл живёт только в памяти вкладки,
// это проверка самой концепции, не готовая функция.
const customCharacterFileInput = document.createElement("input");
customCharacterFileInput.type = "file";
customCharacterFileInput.accept = ".fbx";
customCharacterFileInput.hidden = true;
document.body.appendChild(customCharacterFileInput);

customCharacterFileInput.addEventListener("change", () => {
  const file = customCharacterFileInput.files?.[0];
  if (!file) return;

  const objectUrl = URL.createObjectURL(file);
  CHARACTERS.custom = {
    label: file.name.replace(/\.fbx$/i, ""),
    avatarEmoji: "🧍",
    characterUrl: objectUrl,
    // БЕЗ клипов белки — выяснили, что натягивание чужих клипов через
    // простое сопоставление имён костей в браузере даёт искажения
    // (голова/бёдра поворачиваются не туда), потому что у белки/енота
    // танцы изначально retarget'ились Mixamo НА ИХ СОБСТВЕННЫЙ скелет
    // при скачивании — а не натягивались в браузере на чужой. Правильный
    // путь — то же самое для любого персонажа: свои танцы, каждый
    // отдельно retarget'нутый Mixamo под ИМЕННО ЭТОГО персонажа,
    // добавляются потом через "+" в самой панели танцев (см. ниже,
    // customDanceFileInput) — пустой пул поначалу, не подмена чужим.
    animationFiles: [],
    allowCustomDances: true, // показывает "+" в панели танцев именно у этого персонажа — см. renderCharacterStack
  };

  activeCharacterIds = ["custom"];
  closePicker();
  applyActiveCharacters();
  customCharacterFileInput.value = ""; // сброс — иначе повторный выбор ТОГО ЖЕ файла не даст 'change'

  // Сохраняем в IndexedDB — переживёт перезагрузку страницы (см.
  // characterStorage.js, restoreCustomCharacter ниже поднимает это же
  // при следующем визите).
  characterStorage.saveCharacter(CHARACTERS.custom.label, file).catch((err) => {
    console.warn("[main] Не удалось сохранить кастомного персонажа:", err);
  });
});

// Отдельный инпут — добавление ДОПОЛНИТЕЛЬНЫХ танцев уже загруженному
// кастомному персонажу (не подменяет чужими клипами, а добавляет СВОИ,
// каждый — отдельный retarget именно под него на самом Mixamo при
// скачивании, тот же принцип, что уже работает для белки/енота).
// multiple — можно выбрать сразу несколько файлов танцев за один раз.
const customDanceFileInput = document.createElement("input");
customDanceFileInput.type = "file";
customDanceFileInput.accept = ".fbx";
customDanceFileInput.multiple = true;
customDanceFileInput.hidden = true;
document.body.appendChild(customDanceFileInput);

let pendingCustomDanceCharacterId = null; // на случай если в будущем таких персонажей станет больше одного

customDanceFileInput.addEventListener("change", async () => {
  const files = Array.from(customDanceFileInput.files || []);
  const targetId = pendingCustomDanceCharacterId;
  customDanceFileInput.value = "";
  if (files.length === 0 || !targetId) return;

  const slot = slots[targetId];
  if (!slot) return;

  beginLoadingTracking();
  const clipArrays = await Promise.all(
    files.map((file) => {
      const objectUrl = URL.createObjectURL(file);
      // Имя клипа — по имени файла (без расширения), как он есть — это
      // и есть подпись на самой синей кнопке (через getDanceLabel: раз
      // такого ключа нет в DANCE_LABELS, откатится на сам этот id).
      const clipName = file.name.replace(/\.fbx$/i, "");
      return loadAnimationClipsFBX(objectUrl, { clipName });
    })
  );
  slot.animController.addClips(clipArrays.flat());
  renderCharacterStack();
  endLoadingTracking();

  // Сохраняем в IndexedDB — те же файлы (blob), что и грузили, плюс имя
  // клипа рядом, чтобы при восстановлении (restoreCustomCharacter)
  // получить точно такие же подписи на кнопках, что и сейчас.
  if (targetId === "custom") {
    const danceRecords = files.map((file) => ({
      name: file.name.replace(/\.fbx$/i, ""),
      blob: file,
    }));
    characterStorage.addDances(danceRecords).catch((err) => {
      console.warn("[main] Не удалось сохранить танцы кастомного персонажа:", err);
    });
  }
});

/** Удаляет пользовательского персонажа целиком — из сцены (unloadSlot,
 * та же функция, что уже используется при обычном переключении), из
 * CHARACTERS (больше не появится в пикере) и из activeCharacterIds. Если
 * удаляемый был сейчас показан — откатываемся на белку соло, а не
 * оставляем пустую сцену. */
function deleteCustomCharacter(id) {
  unloadSlot(id);
  delete CHARACTERS[id];

  if (id === "custom") {
    characterStorage.deleteCharacter().catch((err) => {
      console.warn("[main] Не удалось удалить кастомного персонажа из хранилища:", err);
    });
  }

  if (activeCharacterIds.includes(id)) {
    const remaining = activeCharacterIds.filter((activeId) => activeId !== id);
    activeCharacterIds = remaining.length > 0 ? remaining : ["squirrel"];
    applyActiveCharacters();
  } else {
    renderCharacterStack();
  }
}

// id -> { model, mixer, animController, disabledDances, lastNowPlayingName, offsetX }
const slots = {};
window.jerrySlots = slots; // debug: jerrySlots.squirrel.animController.play("samba")

// --- Состояние выбора персонажа(ей) ---
// activeCharacterIds — порядок важен: первый элемент = "верхняя" панель,
// её аватарка кликабельна и открывает пикер заново (в том числе в дуэте).
let activeCharacterIds = ["squirrel"];
let pickerOpen = false;
let pickerMode = "switch"; // "switch" — переключить соло; "select" — множественный выбор
let pendingSelection = new Set();

const characterStackEl = document.getElementById("character-stack");
const avatarPickerEl = document.getElementById("avatar-picker");

/** Равномерно расставляет N персонажей по X, симметрично вокруг центра —
 * работает для любого количества (1, 2, 3...), не только двух.
 * Дуэт (n=2) на МОБИЛЬНОМ — отдельный, не симметричный случай: сцена
 * там честный узкий квадрат (не широкий десктопный кадр), сдвиг влево
 * оказался ближе к краю кадра, чем на десктопе. Енот (первый в
 * CHARACTER_POSITION_ORDER, левая/отрицательная позиция) подвинут
 * ближе к центру (0.55), белка (вторая, правая/положительная) дальше
 * от центра (0.75) — суммарное расстояние между ними то же (1.3), что
 * и при симметричном ±0.65, просто по-другому распределено. Десктоп НЕ
 * трогаем — там симметричный ±0.65 остаётся как было. */
/** Равномерно расставляет N персонажей по X, симметрично вокруг центра —
 * работает для любого количества (1, 2, 3...), не только двух.
 * Дуэт (n=2) на МОБИЛЬНОМ — отдельный, не симметричный случай: сцена
 * там честный узкий квадрат (не широкий десктопный кадр), сдвиг влево
 * оказался ближе к краю кадра, чем на десктопе. Енот (первый в
 * CHARACTER_POSITION_ORDER, левая/отрицательная позиция) подвинут
 * ближе к центру (0.55), белка (вторая, правая/положительная) дальше
 * от центра (0.75) — суммарное расстояние между ними то же (1.3), что
 * и при симметричном ±0.65, просто по-другому распределено. Десктоп НЕ
 * трогаем — там симметричный ±0.65 остаётся как было.
 *
 * ids — реальные id активных персонажей (не просто число) — нужно,
 * чтобы отличить белку/енота (уже подобранное смещение +0.10) от
 * нового/кастомного персонажа (0, без смещения) в соло на мобильном. */
function computeOffsets(ids, spacing = 1.3) {
  const n = ids.length;
  if (n === 2 && isMobileViewport()) return [-0.55, 0.75];
  if (n === 1 && isMobileViewport()) {
    // Белка/енот — уже подобранное смещение +0.10 вправо (см. историю).
    // Любой другой (новый/кастомный) персонаж в соло — без смещения,
    // ровно по центру, отдельная договорённость.
    return CHARACTER_POSITION_ORDER.includes(ids[0]) ? [0.1] : [0];
  }
  const total = (n - 1) * spacing;
  return Array.from({ length: n }, (_, i) => -total / 2 + i * spacing);
}

// Порядок слева направо в сцене — ФИКСИРОВАННЫЙ, не зависит от того, в
// каком порядке персонажей выбрали в пикере. Раньше позиция определялась
// порядком в activeCharacterIds (порядком клика), из-за чего один и тот
// же дуэт мог оказаться то так, то зеркально — в зависимости от того,
// кого кликнули первым. Новых персонажей без явного места в списке
// ставим в конец (после всех перечисленных).
const CHARACTER_POSITION_ORDER = ["raccoon", "squirrel"];

function getPositionOrder(ids) {
  const known = CHARACTER_POSITION_ORDER.filter((id) => ids.includes(id));
  const unknown = ids.filter((id) => !CHARACTER_POSITION_ORDER.includes(id));
  return [...known, ...unknown];
}

/** Раньше аватарка рисовалась через дочерний <img> — но на Android Chrome
 * долгое нажатие на <img> ВСЕГДА показывает системное меню картинки
 * ("Открыть в новой вкладке", поиск через Google Lens и т.д.), и это
 * НЕ подавляется через CSS (-webkit-touch-callout — свойство только для
 * iOS/Safari, на Android никак не действует). Надёжный способ — не
 * создавать <img> вообще: рисуем аватарку как CSS background-image прямо
 * на кнопке. У фонового изображения нет собственного контекстного меню —
 * браузеру физически нечего показывать по долгому нажатию.
 */
function applyAvatarVisual(el, config) {
  if (config.avatarSrc) {
    el.style.backgroundImage = `url(${config.avatarSrc})`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center 15%";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "none";
    el.textContent = config.avatarEmoji || "?";
  }
}

/** Перестраивает вертикальный стек панелей [аватарка][кнопки танцев] —
 * по одной панели на каждого активного персонажа, в порядке activeCharacterIds.
 * Только у ПЕРВОЙ (верхней) панели аватарка кликабельна — открывает пикер. */
/** Вешает на кнопку удаления паттерн "нажми ещё раз для подтверждения" —
 * вместо модалки/нативного confirm(). Первый клик переводит кнопку в
 * "вооружённое" состояние (визуально — пульсирующая красная подсветка,
 * см. .confirm-armed в style.css) и ничего не удаляет. Второй клик
 * ПОДТВЕРЖДАЕТ и вызывает onConfirm(). Если в течение timeoutMs не
 * кликнули повторно — кнопка сама возвращается в обычный вид, как будто
 * ничего не произошло. Используется и для удаления плейлиста, и для
 * удаления кастомного персонажа — одна и та же функция, не дублируем
 * логику под каждую кнопку отдельно. */
function makeConfirmableDelete(button, onConfirm, { armedTitle = "Tap again to confirm", timeoutMs = 2500 } = {}) {
  let armed = false;
  let timer = null;
  const originalTitle = button.title;

  button.addEventListener("click", (e) => {
    e.stopPropagation(); // не должно всплывать на родительский клик (например, выбор плейлиста)
    if (!armed) {
      armed = true;
      button.classList.add("confirm-armed");
      button.title = armedTitle;
      timer = setTimeout(() => {
        armed = false;
        button.classList.remove("confirm-armed");
        button.title = originalTitle;
      }, timeoutMs);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
}

function renderCharacterStack() {
  characterStackEl.innerHTML = "";
  danceButtonsByKey.clear();

  activeCharacterIds.forEach((id, index) => {
    const config = CHARACTERS[id];
    const slot = slots[id];

    const row = document.createElement("div");
    row.className = "character-row";

    const avatarBtn = document.createElement("button");
    avatarBtn.type = "button";
    avatarBtn.className = "character-avatar-btn " + (index === 0 ? "is-trigger" : "is-static");
    avatarBtn.title = config.label;
    applyAvatarVisual(avatarBtn, config);
    if (index === 0) {
      avatarBtn.setAttribute("aria-expanded", String(pickerOpen));
      avatarBtn.addEventListener("click", () => {
        if (pickerOpen) {
          closePicker();
        } else {
          // Всегда открываем "как будто впервые" — список персонажей для
          // переключения соло + иконка Duet. Раньше в дуэте клик сразу
          // прыгал в режим выбора с уже проставленными галочками — теперь
          // единообразно для соло и дуэта: клик по любому персонажу здесь
          // = "танцует только он", клик по 👯 = собрать новую комбинацию.
          openPicker("switch");
        }
      });
    }
    row.appendChild(avatarBtn);

    const buttonsRow = document.createElement("div");
    buttonsRow.className = "dance-buttons-row";
    if (slot?.animController) {
      slot.animController.getDancePool().forEach((name) => {
        const key = `${id}::${name}`;
        const btn = document.createElement("button");
        btn.className = "dance-toggle-btn";
        btn.type = "button";
        btn.textContent = getDanceLabel(name);
        btn.setAttribute("aria-pressed", String(!slot.disabledDances.has(name)));
        btn.addEventListener("click", () => {
          const willBeEnabled = btn.getAttribute("aria-pressed") !== "true";
          btn.setAttribute("aria-pressed", String(willBeEnabled));
          if (willBeEnabled) slot.disabledDances.delete(name);
          else slot.disabledDances.add(name);
          slot.animController?.setDanceEnabled(name, willBeEnabled);
        });
        danceButtonsByKey.set(key, btn);
        buttonsRow.appendChild(btn);
      });
    }

    // "+" — добавить ещё танцев именно этому персонажу (только для тех,
    // у кого allowCustomDances: true — см. customCharacterFileInput
    // выше; у белки/енота фиксированный, заранее подобранный набор,
    // добавлять туда произвольные файлы не нужно).
    if (config.allowCustomDances) {
      const addDanceBtn = document.createElement("button");
      addDanceBtn.type = "button";
      addDanceBtn.className = "dance-icon-btn is-add";
      addDanceBtn.textContent = "+";
      addDanceBtn.title = "Add dance (FBX, retargeted specifically for this character on Mixamo)";
      addDanceBtn.addEventListener("click", () => {
        pendingCustomDanceCharacterId = id;
        customDanceFileInput.click();
      });
      buttonsRow.appendChild(addDanceBtn);

      // Крестик в самом конце — удаляет ЦЕЛИКОМ этого персонажа (не
      // отдельный танец), включая из пикера. Только у персонажей с
      // allowCustomDances — у белки/енота такой возможности нет и не
      // должно быть, они не "загружаемые пользователем" сущности.
      const deleteCharBtn = document.createElement("button");
      deleteCharBtn.type = "button";
      deleteCharBtn.className = "dance-icon-btn is-delete";
      deleteCharBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      deleteCharBtn.title = "Remove this character";
      makeConfirmableDelete(deleteCharBtn, () => deleteCustomCharacter(id), {
        armedTitle: "Tap again to remove this character",
      });
      buttonsRow.appendChild(deleteCharBtn);
    }

    row.appendChild(buttonsRow);

    characterStackEl.appendChild(row);
  });

  resize();
}

/** Перестраивает содержимое всплывающего пикера под текущий pickerMode. */
function renderPicker() {
  avatarPickerEl.innerHTML = "";

  if (pickerMode === "switch") {
    // Показываем ВСЕХ персонажей (включая уже активных — в дуэте клик по
    // одному из двух танцующих означает "теперь танцует только он") — клик
    // сразу переключает на соло с этим персонажем.
    Object.entries(CHARACTERS).forEach(([id, config]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "picker-avatar-btn";
      btn.title = config.label;
      applyAvatarVisual(btn, config);
      btn.addEventListener("click", () => {
        activeCharacterIds = [id];
        closePicker();
        applyActiveCharacters();
      });
      avatarPickerEl.appendChild(btn);
    });

    // ПРОТОТИП: загрузка собственного персонажа (стандартный
    // человекоподобный Mixamo-риг — без хвоста и т.п. специфики,
    // договорились упростить). Ничего не сохраняется между визитами —
    // файл живёт только в памяти этой вкладки, пропадает при перезагрузке
    // страницы. Проверяем сам факт, что существующие клипы (idle + пул
    // танцев) корректно "садятся" на чужой скелет через совпадение имён
    // костей (mixamorig:...), без всякой отдельной интеграции.
    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "picker-avatar-btn";
    uploadBtn.title = "Upload your own Mixamo character (FBX, standard humanoid rig)";
    uploadBtn.textContent = "+";
    uploadBtn.style.fontSize = "22px";
    uploadBtn.style.color = "#8a8f98";
    uploadBtn.addEventListener("click", () => customCharacterFileInput.click());
    avatarPickerEl.appendChild(uploadBtn);
  } else {
    // "select" — показываем ВСЕХ персонажей, каждый togglable по
    // pendingSelection, плюс иконка Duet для подтверждения.
    Object.entries(CHARACTERS).forEach(([id, config]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "picker-avatar-btn";
      btn.title = config.label;
      btn.setAttribute("aria-pressed", String(pendingSelection.has(id)));
      applyAvatarVisual(btn, config);
      btn.addEventListener("click", () => {
        if (pendingSelection.has(id)) pendingSelection.delete(id);
        else pendingSelection.add(id);
        // Сняли ВСЕХ персонажей (0 выбрано) — кнопка "Partners" иначе
        // осталась бы неактивной без возможности ни подтвердить (нечего
        // подтверждать), ни выйти из режима выбора обратно. Пользователь
        // мог просто передумать делать дуэт и захотеть заменить одного
        // персонажа на другого напрямую — возвращаем в обычный режим
        // соло-переключения, а не оставляем в тупиковом состоянии.
        if (pendingSelection.size === 0) {
          pickerMode = "switch";
        }
        renderPicker();
      });
      avatarPickerEl.appendChild(btn);
    });
  }

  const duetBtn = document.createElement("button");
  duetBtn.type = "button";
  duetBtn.className = "picker-duet-btn";

  if (pickerMode === "switch") {
    duetBtn.title = "Duet — выбрать нескольких";
    duetBtn.textContent = t("partners");
    duetBtn.setAttribute("aria-pressed", "false");
    duetBtn.disabled = false;
    duetBtn.addEventListener("click", () => {
      pickerMode = "select";
      pendingSelection = new Set(activeCharacterIds);
      renderPicker();
    });
  } else {
    // В режиме выбора кнопка — это подтверждение, а не переключатель.
    // Если заходили СВЕЖИМ из соло (activeCharacterIds.length===1) —
    // нужно выбрать хотя бы ещё одного, иначе это не дуэт, а холостой клик.
    // Но если заходили УЖЕ ИЗ дуэта (2+) — разрешаем уменьшить состав даже
    // до 1: это и есть единственный способ выйти из дуэта обратно в соло.
    // Раньше требование "минимум 2" действовало всегда без исключений —
    // из дуэта нельзя было вернуться к одному персонажу вообще никак.
    const cameFromDuet = activeCharacterIds.length >= 2;
    const ready = pendingSelection.size >= (cameFromDuet ? 1 : 2);
    duetBtn.title = ready ? "Подтвердить выбор" : "Выберите ещё персонажа";
    if (ready) {
      duetBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      duetBtn.classList.add("is-icon-only"); // без этого те же боковые padding, что нужны под слово "Partners", растягивали маленькую 18px-иконку в "таблетку" 46×36 вместо круга 36×36
    } else {
      duetBtn.textContent = t("partners");
      duetBtn.classList.remove("is-icon-only");
    }
    duetBtn.setAttribute("aria-pressed", String(ready));
    duetBtn.disabled = !ready;
    if (ready) {
      duetBtn.addEventListener("click", () => confirmSelection());
    }
  }
  avatarPickerEl.appendChild(duetBtn);
}

function openPicker(mode) {
  pickerMode = mode;
  if (mode === "select") pendingSelection = new Set(activeCharacterIds);
  pickerOpen = true;
  avatarPickerEl.hidden = false;
  renderPicker();
  renderCharacterStack(); // обновить aria-expanded на верхней аватарке
}

function closePicker() {
  pickerOpen = false;
  avatarPickerEl.hidden = true;
  renderCharacterStack();
}

/** Подтверждает набранный в pendingSelection список персонажей и применяет
 * его. Если ничего не выбрано — не даём остаться без единого персонажа. */
function confirmSelection() {
  const chosen = [...pendingSelection];
  activeCharacterIds = chosen.length > 0 ? chosen : activeCharacterIds;
  closePicker();
  applyActiveCharacters();
}

// Клики ВНУТРИ пикера не должны доходить до document — иначе кнопка Duet
// ловит баг: её клик вызывает renderPicker(), которая пересоздаёт саму
// кнопку (innerHTML="" + новые элементы) прямо во время всплытия этого же
// события. К моменту, когда клик доходит до document, e.target — уже
// удалённый старый узел, который physически больше не внутри
// avatarPickerEl — проверка "клик мимо" ложно считает это кликом снаружи и
// закрывает меню. Слушатель повешен на сам avatarPickerEl (стабильный
// контейнер, не пересоздаётся — меняются только его дети), поэтому
// переживает любой ре-рендер содержимого.
avatarPickerEl.addEventListener("click", (e) => e.stopPropagation());

// Клик мимо пикера — закрыть без применения (обычное поведение выпадающих меню).
document.addEventListener("click", (e) => {
  if (!pickerOpen) return;
  if (avatarPickerEl.contains(e.target)) return;
  if (e.target.closest?.(".character-avatar-btn.is-trigger")) return;
  closePicker();
});

const sceneLoadingEl = document.getElementById("scene-loading");

// Несколько персонажей могут грузиться одновременно (Duet) — просто
// считаем, сколько сейчас идёт одновременных загрузок, и прячем спиннер,
// когда счётчик дойдёт до нуля (а не по первому завершившемуся).
let activeLoadCount = 0;

function beginLoadingTracking() {
  activeLoadCount++;
  sceneLoadingEl.classList.remove("is-hidden");
}

function endLoadingTracking() {
  activeLoadCount = Math.max(0, activeLoadCount - 1);
  if (activeLoadCount === 0) {
    sceneLoadingEl.classList.add("is-hidden");
  }
}

// Эксперимент с позой вместо спиннера — не понравилось, откачено.
// LOADING_POSE_URL = null возвращает обычный спиннер без изменений где-либо
// ещё (весь остальной код ниже безопасно пропускает блок при null).
const LOADING_POSE_URL = null;

async function loadCharacterIntoSlot(id, offsetX, isDuet) {
  const config = CHARACTERS[id];
  beginLoadingTracking();

  const character = await loadCharacterFBX(scene, config.characterUrl, {
    clipName: "idle",
    tailFixRules: config.tailFixRules || [],
  });
  if (!character) {
    endLoadingTracking();
    return null;
  }

  // Пользовательские загруженные персонажи (см. customCharacterFileInput)
  // часто не содержат СВОЕЙ анимации внутри файла (обычное дело для
  // Mixamo-экспорта в T-позе/без анимации) — без idle-клипа персонаж
  // навсегда оставался бы в T-позе, и это же ломало и масштаб, и
  // постановку на пол: оба измеряются по ТЕКУЩЕЙ позе меша в момент
  // вызова ниже, а без анимации это буквально T-поза, а не настоящий
  // Idle (T-поза выше и по-другому расположена по вертикали — отсюда и
  // "мельче"/"проседает"). Фоллбэк — тянем idle-клип отдельно из файла
  // белки, тот же retargeting по именам костей mixamorig:..., что уже
  // работает для танцев.
  if (character.animations.length === 0) {
    try {
      const fallbackIdle = await loadAnimationClipsFBX(CHARACTERS.squirrel.characterUrl, { clipName: "idle" });
      character.animations.push(...fallbackIdle);
    } catch (err) {
      console.warn("[main] Не удалось подгрузить резервный idle-клип для", id, err);
    }
  }

  scene.remove(placeholder); // не мешает, если уже убран раньше

  // ВРЕМЕННО: диагностика "даже резервный idle не подействовал" —
  // выводим реальные имена костей скелета этого персонажа, чтобы
  // сравнить с ожидаемым стандартом Mixamo (mixamorig:Hips,
  // mixamorig:Spine и т.д.) — если имена другие (например, без
  // префикса "mixamorig:", или с другим регистром/структурой), клипы,
  // загруженные из ДРУГИХ файлов (белки/енота), просто не найдут, к
  // чему привязаться, и retargeting не сработает вообще, независимо от
  // того, какой именно клип пытаемся проиграть. Убрать после того, как
  // разберёмся.
  if (id === "custom") {
    const boneNames = [];
    character.model.traverse((node) => {
      if (node.isBone) boneNames.push(node.name);
    });
    console.log(`[customCharacterDiag] Найдено костей: ${boneNames.length}`);
    console.log("[customCharacterDiag] Первые 15 имён:", boneNames.slice(0, 15));
    console.log("[customCharacterDiag] Есть ли хоть одна кость с префиксом 'mixamorig:':", boneNames.some((n) => n.startsWith("mixamorig")));
  }

  const slot = {
    model: character.model,
    mixer: character.mixer,
    animController: null,
    disabledDances: new Set(),
    lastNowPlayingName: null,
    offsetX,
  };
  slots[id] = slot;

  // ВАЖНО: персонаж встаёт на место (пол/центр/Idle) СРАЗУ, используя
  // только свой собственный клип — не дожидаясь остальных файлов с
  // танцами.
  slot.animController = createAnimationController(slot.mixer, character.animations, slot.model);
  slot.animController.play("idle");
  slot.mixer.update(0);
  // Масштаб считается ИМЕННО здесь — после первого кадра Idle, той же
  // позы, что уже использует groundAndCenterModel ниже (см. комментарий в
  // scene.js про баг "белка стала крупнее" после Blender-фикса хвоста).
  measureAndApplyAutoScale(slot.model, getTargetHeightFor(id, isDuet));
  groundAndCenterModel(slot.model, offsetX);
  faceCameraCompensated(slot.model, offsetX, camera.position.z);
  slot.animController.captureBasePose();
  renderCharacterStack();

  // Грузим позу отдельно и в приоритете (маленький файл, быстро) — как
  // только готова, замораживаем персонажа на её финальном кадре и прячем
  // спиннер раньше обычного, пока остальные танцы ещё качаются в фоне.
  // ПРИМЕЧАНИЕ: упрощённая версия — при Duet (несколько персонажей разом)
  // спиннер может спрятаться чуть раньше, чем готовы ВСЕ персонажи, если
  // один из них ещё не дошёл до позы — эксперимент, не финальная логика.
  if (LOADING_POSE_URL) {
    const poseClips = await loadAnimationClipsFBX(LOADING_POSE_URL, { clipName: "loading_pose" });
    if (slots[id] === slot && poseClips.length > 0) {
      slot.animController.addClips(poseClips);
      slot.animController.play("loading_pose", { loop: false, fadeSeconds: 0 });
      slot.mixer.update(poseClips[0].duration || 0); // сразу на финальный кадр позы
      // Поза может сильно отличаться от Idle по стойке (нога поднята,
      // наклон и т.д.) — грунтовка/центрирование были посчитаны ПОД Idle
      // чуть выше, пересчитываем заново именно под эту конкретную позу,
      // иначе персонаж может "парить" или "проваливаться" на превью.
      groundAndCenterModel(slot.model, offsetX);
      sceneLoadingEl.classList.add("is-hidden");
    }
  }

  // Остальные файлы — каждый со своим (лишним, но безвредным) мешем
  // внутри, который мы просто не добавляем в сцену — нужен только clip.
  const clipArrays = await Promise.all(
    config.animationFiles.map(([url, clipName]) => loadAnimationClipsFBX(url, { clipName }))
  );
  if (slots[id] !== slot) {
    endLoadingTracking();
    return slot; // слот успели выгрузить/заменить, пока грузилось
  }
  slot.animController.addClips(clipArrays.flat());
  renderCharacterStack();
  slot.animController.play("idle"); // с позы обратно на настоящий Idle — всё готово
  endLoadingTracking();
  return slot;
}

function unloadSlot(id) {
  const slot = slots[id];
  if (!slot) return;
  scene.remove(slot.model);
  disposeObject3D(slot.model);
  delete slots[id];
}

/** Приводит набор загруженных слотов в соответствие с activeCharacterIds
 * (1 персонаж — соло, 2+ — вместе) и перестраивает зависимый UI. Работает
 * для любого количества персонажей, не только двух. */
async function applyActiveCharacters() {
  const desired = activeCharacterIds;
  const positionOrder = getPositionOrder(desired); // слева направо — фиксировано, не порядок выбора
  const offsetList = computeOffsets(positionOrder);
  const offsets = Object.fromEntries(positionOrder.map((id, i) => [id, offsetList[i]]));

  Object.keys(slots).forEach((id) => {
    if (!desired.includes(id)) unloadSlot(id);
  });

  // Камера — та же дистанция всегда на десктопе (не отдаляем при
  // нескольких персонажах, по прошлой просьбе). На мобильном в дуэте —
  // отдельно, чуть отдаляем: сцена там честный узкий квадрат, персонажам
  // тесно у краёв кадра. Соло НЕ белка/енот (новый/кастомный персонаж) —
  // наоборот, приближаем ("ближе к экрану", отдельная договорённость,
  // не путать с дуэтом выше). setHomeCameraDistance синхронно обновляет
  // и "домашнюю" точку умной камеры/автовозврата — без этого они бы
  // утянули камеру обратно на 5.0 на следующем же кадре.
  const isMobileSoloNewCharacter =
    isMobileViewport() && positionOrder.length === 1 && !CHARACTER_POSITION_ORDER.includes(positionOrder[0]);
  const cameraZ = isMobileViewport() && positionOrder.length === 2 ? 6.0 : isMobileSoloNewCharacter ? 4.0 : 5.0;
  camera.position.set(0, 1.4, cameraZ);
  camera.lookAt(0, 0.95, 0);
  setHomeCameraDistance(cameraZ);

  // Персонаж мог уже быть загружен с другим offsetX (например, был один
  // в соло по центру, теперь их несколько) — переставляем на разницу,
  // не полагаясь только на факт "загружен/не загружен".
  const isDuet = positionOrder.length === 2; // явный флаг — offsetX больше не годится как признак, см. getTargetHeightFor
  desired.forEach((id) => {
    const slot = slots[id];
    if (slot && slot.offsetX !== offsets[id]) {
      slot.offsetX = offsets[id];
      // Пересчитываем масштаб заново (не просто сдвигаем X) — переход
      // соло↔Duet может поменять целевой рост персонажа (см.
      // SQUIRREL_DUET_HEIGHT_FACTOR), а не только позицию. Обе функции
      // безопасно вызывать повторно на уже загруженной модели.
      measureAndApplyAutoScale(slot.model, getTargetHeightFor(id, isDuet));
      groundAndCenterModel(slot.model, offsets[id]);
      faceCameraCompensated(slot.model, offsets[id], camera.position.z);
      // ВАЖНО: без этого baseRotY внутри animController остаётся старым
      // (зафиксированным при самой первой загрузке слота, часто в соло с
      // offsetX=0) — resetPose() на паузе откатывал бы персонажа обратно
      // к тому старому углу, игнорируя новую компенсацию разворота (баг:
      // "белка на паузе снова поворачивается", енота не затрагивало,
      // потому что он обычно грузится сразу в Duet, а не переключается
      // туда из уже загруженного соло).
      slot.animController?.captureBasePose();
    }
  });

  renderCharacterStack();

  await Promise.all(
    desired.filter((id) => !slots[id]).map((id) => loadCharacterIntoSlot(id, offsets[id], isDuet))
  );
  renderCharacterStack();
}

// --- Плейлист (несколько файлов через "Choose Audio", мобильные кнопки
// shuffle/prev/next/repeat) ---
// Shuffle — тот же принцип "мешок без повторов", что уже используется
// для выбора танцев (createShuffleBag в animationController.js) —
// переиспользовать оттуда нельзя (не экспортирован, там про клипы
// анимации, тут про треки), но сама идея та же: тасуем один раз,
// раздаём по порядку без повторов, пока не кончится, потом тасуем
// заново, гарантированно избегая случайного повтора того же трека
// подряд.
let playlist = []; // [{ file, name, title, artist }]
let currentTrackIndex = -1;
let shuffleEnabled = false;
let repeatEnabled = false;
let shuffleBag = [];
let shuffleHistory = []; // индексы треков в порядке реального проигрывания (для "предыдущий" в shuffle-режиме)

/**
 * У файлов нет метаданных исполнителя (не парсим ID3 — усложнение ради
 * малой пользы) — вместо этого простая, широко распространённая
 * договорённость об именовании: "Исполнитель - Название.mp3". Если тире
 * нет — весь файл целиком считается названием, исполнитель пустой.
 */
function parseTrackName(filename) {
  const nameNoExt = filename.replace(/\.[^/.]+$/, "");
  const dashIdx = nameNoExt.indexOf(" - ");
  if (dashIdx > -1) {
    return { artist: nameNoExt.slice(0, dashIdx).trim(), title: nameNoExt.slice(dashIdx + 3).trim() };
  }
  return { artist: "", title: nameNoExt };
}

function reshuffleBag() {
  shuffleBag = playlist.map((_, i) => i);
  for (let i = shuffleBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffleBag[i], shuffleBag[j]] = [shuffleBag[j], shuffleBag[i]];
  }
  // Не даём мешку выдать тот же трек, что играет прямо сейчас, первым же номером.
  if (shuffleBag.length > 1 && shuffleBag[shuffleBag.length - 1] === currentTrackIndex) {
    const swapIdx = Math.floor(Math.random() * (shuffleBag.length - 1));
    [shuffleBag[shuffleBag.length - 1], shuffleBag[swapIdx]] = [shuffleBag[swapIdx], shuffleBag[shuffleBag.length - 1]];
  }
}

function nextShuffledIndex() {
  if (shuffleBag.length === 0) reshuffleBag();
  if (shuffleBag.length === 0) return currentTrackIndex; // плейлист из одного трека
  return shuffleBag.pop();
}

/** Перерисовывает список треков в выезжающей шторке — вызывается после
 * любого изменения плейлиста (добавили файлы) или смены текущего трека
 * (чтобы подсветка "играет сейчас" переехала на нужную строку). */
function renderPlaylistList() {
  playlistItemsEl.innerHTML = "";
  playlist.forEach((track, i) => {
    // Раньше вся строка была ОДНОЙ <button> — теперь внутри неё появляется
    // ещё и кнопка-крестик удаления, а вложенные <button> внутри <button>
    // — невалидный HTML (браузер сам "разворачивает" такую вложенность
    // непредсказуемо). Строка стала <div>-контейнером с двумя ОТДЕЛЬНЫМИ
    // кнопками-соседями внутри: клик по названию/исполнителю играет трек,
    // клик по крестику удаляет — независимо друг от друга.
    const item = document.createElement("div");
    item.className = "playlist-item";
    if (i === currentTrackIndex) {
      item.classList.add("now-playing");
      if (!musicIsPlaying) item.classList.add("is-paused"); // индикатор становится серым, не цветным, пока трек на паузе
    }

    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "playlist-item-info";

    const titleEl = document.createElement("div");
    titleEl.className = "playlist-item-title";
    titleEl.textContent = track.title;
    infoBtn.appendChild(titleEl);

    if (track.artist) {
      const artistEl = document.createElement("div");
      artistEl.className = "playlist-item-artist";
      artistEl.textContent = track.artist;
      infoBtn.appendChild(artistEl);
    }

    infoBtn.addEventListener("click", async () => {
      // Клик по УЖЕ играющему треку — не перезагружаем его заново, а
      // просто переключаем play/pause (иначе перезапуск сбивал позицию
      // воспроизведения на 0). Клик по ДРУГОМУ треку — как раньше,
      // загружаем и запускаем.
      if (i === currentTrackIndex) {
        if (musicIsPlaying) {
          player.pause();
        } else {
          await ensureAnalyzerReady();
          player.play();
        }
        return;
      }
      loadTrackAtIndex(i);
      await ensureAnalyzerReady();
      player.play();
      // closePlaylistSheet() убран — просили не схлопывать шторку при
      // клике по треку, только запускать выбранный трек, оставаясь в
      // списке (удобно листать несколько треков подряд, не открывая
      // шторку заново каждый раз).
    });

    // Мини-эквалайзер вместо фиолетовой подсветки фона — виден только у
    // текущего трека (CSS показывает его через .now-playing), покачивается
    // непрерывно чистой CSS-анимацией (@keyframes), без реального аудио-
    // анализа — это просто индикатор "вот этот трек сейчас загружен", не
    // полноценная волна (для такой маленькой иконки тащить сюда весь
    // soundWave.js было бы overkill).
    const eqEl = document.createElement("div");
    eqEl.className = "playlist-item-eq";
    eqEl.setAttribute("aria-hidden", "true");
    eqEl.innerHTML = "<span></span><span></span><span></span>";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "playlist-item-delete";
    deleteBtn.setAttribute("aria-label", t("deleteTrackAria"));
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    deleteBtn.addEventListener("click", () => deleteTrackAtIndex(i));

    item.appendChild(infoBtn);
    item.appendChild(eqEl);
    item.appendChild(deleteBtn);
    playlistItemsEl.appendChild(item);
  });
}

/** Удаляет трек из плейлиста по индексу. Если удаляем ТЕКУЩИЙ играющий
 * трек — переключаемся на следующий по списку (или на последний, если
 * удалили последний трек списка), либо сбрасываем плеер в пустое
 * состояние, если плейлист опустел совсем. Если удаляем трек ДО
 * текущего — сдвигаем currentTrackIndex на −1, чтобы он продолжал
 * указывать на тот же самый реальный трек (массив сжался под ним). */
function deleteTrackAtIndex(i) {
  const isCurrentTrack = i === currentTrackIndex;
  playlist.splice(i, 1);
  persistActivePlaylist(); // убираем ID из активного плейлиста в IndexedDB — сам трек в общем хранилище треков не трогаем (может использоваться в другом плейлисте)

  if (playlist.length === 0) {
    currentTrackIndex = -1;
    player.pause();
    trackTitleIsPlaceholder = true;
    trackArtistIsPlaceholder = true;
    trackTitleTextEl.textContent = t("track");
    trackArtistEl.textContent = t("author");
    trackNameEl.textContent = "";
    playBtn.disabled = true;
    progress.disabled = true;
    progress.value = "0";
    timeCurrentEl.textContent = "00:00";
    timeDurationEl.textContent = "00:00";
    renderPlaylistList();
    return;
  }

  if (isCurrentTrack) {
    const nextIndex = Math.min(i, playlist.length - 1);
    loadTrackAtIndex(nextIndex);
  } else if (i < currentTrackIndex) {
    currentTrackIndex -= 1;
  }

  renderPlaylistList();
}

/** Грузит трек по индексу плейлиста и запускает его состояние в UI — общая
 * точка входа для первого выбора файлов, ручного prev/next и авто-перехода
 * по окончании трека. NE запускает воспроизведение сама — это решает вызывающий код. */
function loadTrackAtIndex(index) {
  if (index < 0 || index >= playlist.length) return;
  currentTrackIndex = index;
  shuffleHistory.push(index);
  const { file, name, title, artist } = playlist[index];

  player.loadFile(file); // локально, файл никуда не отправляется (ТЗ п.17)
  trackNameEl.textContent = name;
  trackTitleIsPlaceholder = !title;
  trackArtistIsPlaceholder = !artist;
  trackTitleTextEl.textContent = title || t("track");
  trackArtistEl.textContent = artist || t("author");
  renderPlaylistList(); // подсветка "играет сейчас" на новую строку
  beatDetector.reset(); // новый трек — старый baseline не имеет смысла
  intensityTracker.reset();
  forEachActiveController((ctrl) => ctrl.resetPose());

  // Смена audio.src на новый трек не всегда триггерит нативное событие
  // 'pause' (даже если реально было на паузе) — иконка Play/Pause держится
  // на последнем полученном событии и могла остаться "II" от предыдущего
  // трека. Сбрасываем явно — новый трек в любом случае стартует с паузы.
  playBtn.innerHTML = playIcon;
  playBtn.setAttribute("aria-label", "Play");

  playBtn.disabled = false;
  progress.value = "0";
  progress.disabled = false;

  // Декодируем в фоне для waveform — не блокирует ни воспроизведение, ни
  // остальной UI. Свой одноразовый AudioContext (см. waveform.js), никак
  // не связан с уже занятым player.audio/analyzer'ом.
  waveformPeaks = null;
  redrawProgressVisual();
  computeWaveformPeaks(file)
    .then((peaks) => {
      waveformPeaks = peaks;
      redrawProgressVisual();
    })
    .catch((err) => {
      console.warn("[main] Не удалось декодировать файл для waveform:", err);
      // Не критично — просто остаёмся с плоской линией/обычным ползунком.
    });
}

/** Ручной клик "следующий" — ВСЕГДА идёт по кругу (wrap), независимо от
 * repeat: repeat влияет только на АВТО-переход по окончании трека, не на
 * ручную навигацию — так ведут себя большинство плееров. */
async function goToNextTrack({ autoplay = false } = {}) {
  if (playlist.length === 0) return;
  const nextIndex = shuffleEnabled ? nextShuffledIndex() : (currentTrackIndex + 1) % playlist.length;
  loadTrackAtIndex(nextIndex);
  if (autoplay) {
    await ensureAnalyzerReady();
    player.play();
  }
}

/** Ручной клик "предыдущий" — в режиме shuffle идёт назад по РЕАЛЬНОЙ
 * истории проигрывания (не случайный трек), иначе просто индекс−1 по кругу.
 * autoplay — как и у "следующего": продолжает играть, если играло до
 * этого (раньше этой логики тут не было вообще — несогласованность:
 * next продолжал играть, prev всегда останавливался на паузе). */
async function goToPrevTrack({ autoplay = false } = {}) {
  if (playlist.length === 0) return;
  if (shuffleEnabled && shuffleHistory.length > 1) {
    shuffleHistory.pop(); // текущий трек
    const prevIndex = shuffleHistory.pop(); // трек перед ним — loadTrackAtIndex сам вернёт его в историю
    loadTrackAtIndex(prevIndex);
  } else {
    const prevIndex = (currentTrackIndex - 1 + playlist.length) % playlist.length;
    loadTrackAtIndex(prevIndex);
  }
  if (autoplay) {
    await ensureAnalyzerReady();
    player.play();
  }
}

/** Вызывается из onEnded() — решает, что делать по окончании трека:
 * repeat включён → на следующий трек автоматически (или тот же самый,
 * если плейлист из одного трека — просто зациклится); repeat выключен и
 * это последний трек — ничего не делаем, обычное завершение (текущий
 * onEnded уже сбрасывает UI в состояние паузы). */
function handlePlaylistTrackEnded() {
  if (playlist.length === 0) return false; // не плейлист-режим — старое поведение onEnded как было
  const isLastTrack = !shuffleEnabled && currentTrackIndex === playlist.length - 1;
  if (repeatEnabled || !isLastTrack || shuffleEnabled) {
    goToNextTrack({ autoplay: true });
    return true; // сигнал onEnded — не сбрасывать UI в состояние "стоп", мы уже переключились
  }
  return false;
}

shuffleBtn.addEventListener("click", () => {
  shuffleEnabled = !shuffleEnabled;
  shuffleBtn.setAttribute("aria-pressed", String(shuffleEnabled));
  shuffleBag = []; // пересдаём заново под текущий currentTrackIndex при следующем next()
});

repeatBtn.addEventListener("click", () => {
  repeatEnabled = !repeatEnabled;
  repeatBtn.setAttribute("aria-pressed", String(repeatEnabled));
});

prevTrackBtn.addEventListener("click", () => goToPrevTrack({ autoplay: musicIsPlaying }));
nextTrackBtn.addEventListener("click", () => goToNextTrack({ autoplay: musicIsPlaying }));

// Переиспользуется в двух сценариях: обычное "+Add" (добавляет к
// текущему активному плейлисту) и создание НОВОГО плейлиста из попапа
// "Плейлисты" (тогда pendingNewPlaylistName выставлен заранее — см.
// setupPlaylistsPopup ниже).
let pendingNewPlaylistName = null;

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (files.length === 0) return;

  // Сохраняем каждый файл в общее хранилище треков — id понадобится и
  // для отображения (playlist[].id), и для персиста в IndexedDB.
  const newTracks = [];
  for (const file of files) {
    const { title, artist } = parseTrackName(file.name);
    const trackId = await playlistStorage.addTrack(file, file.name, title, artist);
    newTracks.push({ id: trackId, file, name: file.name, title, artist });
  }

  if (pendingNewPlaylistName !== null) {
    // Создание НОВОГО плейлиста — заменяет видимый список целиком, а не
    // дописывает к текущему.
    const name = pendingNewPlaylistName;
    pendingNewPlaylistName = null;
    const plId = await playlistStorage.createPlaylist(name, newTracks.map((t) => t.id));
    const plRecord = await playlistStorage.getPlaylist(plId);
    await loadPlaylistIntoUI(plRecord);
    renderPlaylistsPopupList(); // новый плейлист должен появиться в самом попапе тоже
    fileInput.value = "";
    return;
  }

  // ВАЖНО (изменение поведения, касается и десктопа тоже, не только
  // мобильного вида): раньше выбор файлов ЗАМЕНЯЛ весь плейлист. Теперь,
  // когда появился настоящий видимый список треков (шторка на мобильном),
  // логичнее ДОБАВЛЯТЬ выбранные файлы к уже существующему плейлисту, как
  // и ведут себя реальные плеерные приложения с кнопкой "+Add" — иначе
  // смысла в видимом списке было бы немного (он бы всё равно всегда
  // состоял из одного набора, выбранного последним). Плюс теперь ещё и
  // персистится в АКТИВНЫЙ плейлист в IndexedDB, не теряется при
  // перезагрузке страницы.
  const wasEmpty = playlist.length === 0;
  playlist = playlist.concat(newTracks);
  renderPlaylistList();
  await persistActivePlaylist();

  if (wasEmpty) {
    loadTrackAtIndex(0);
  }
  fileInput.value = ""; // сброс — иначе повторный выбор ТЕХ ЖЕ файлов не даст 'change'
});

playlistAddBtn.addEventListener("click", () => fileInput.click());

// --- Попап "Плейлисты" ---
function updatePlaylistsButtonLabel(name) {
  playlistsBtn.textContent = name;
}

async function renderPlaylistsPopupList() {
  const playlists = await playlistStorage.getAllPlaylists();
  playlistsPopupList.innerHTML = "";
  playlists.forEach((pl) => {
    // Раньше вся строка была ОДНОЙ <button> — теперь внутри неё ещё
    // карандашик (переименовать) и крестик (удалить), а вложенные
    // <button> внутри <button> — невалидный HTML (та же история, что и
    // с крестиком удаления трека в списке).
    const row = document.createElement("div");
    row.className = "playlists-popup-item";
    if (pl.id === activePlaylistId) row.classList.add("active");

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "playlists-popup-item-select";
    selectBtn.textContent = `${pl.name} (${pl.trackIds.length})`;
    selectBtn.addEventListener("click", async () => {
      await loadPlaylistIntoUI(pl);
      closePlaylistsPopup();
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "playlists-popup-item-edit";
    editBtn.setAttribute("aria-label", t("renamePlaylistAria"));
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    editBtn.addEventListener("click", () => startRenamePlaylist(pl));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "playlists-popup-item-delete";
    deleteBtn.setAttribute("aria-label", t("deletePlaylistAria"));
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    makeConfirmableDelete(deleteBtn, () => deletePlaylistById(pl.id), {
      armedTitle: "Tap again to delete this playlist",
    });

    row.appendChild(selectBtn);
    row.appendChild(editBtn);
    row.appendChild(deleteBtn);
    playlistsPopupList.appendChild(row);
  });
}

/** Удаляет плейлист целиком. Если удалили АКТИВНЫЙ — переключаемся на
 * первый оставшийся; если не осталось ни одного — создаём пустой новый
 * "Default Playlist" (тот же принцип, что и раньше: активный плейлист
 * есть ВСЕГДА, без этого +Add/крестик сломались бы, не зная, куда
 * персистить). */
async function deletePlaylistById(id) {
  await playlistStorage.deletePlaylist(id);
  if (id === activePlaylistId) {
    const remaining = await playlistStorage.getAllPlaylists();
    if (remaining.length > 0) {
      await loadPlaylistIntoUI(remaining[0]);
    } else {
      const newId = await playlistStorage.createPlaylist("Default Playlist", []);
      const newPl = await playlistStorage.getPlaylist(newId);
      await loadPlaylistIntoUI(newPl);
    }
  }
  renderPlaylistsPopupList();
}

let pendingRenamePlaylistId = null;

/** Открывает ту же самую строку ввода имени, что и для создания нового
 * плейлиста (см. playlistsPopupNameRow ниже) — переиспользуем UI, не
 * плодим отдельный второй попап под то же самое поле ввода. */
function startRenamePlaylist(pl) {
  pendingRenamePlaylistId = pl.id;
  playlistsPopupNameRow.hidden = false;
  playlistsPopupNameInput.value = pl.name;
  playlistsPopupNameInput.focus();
  // Курсор в конце названия, без выделения всего текста — раньше
  // .select() выделял всё, из-за чего первое же нажатие любой клавиши
  // стирало название целиком, а не дописывало к нему.
  playlistsPopupNameInput.setSelectionRange(playlistsPopupNameInput.value.length, playlistsPopupNameInput.value.length);
  playlistsPopupNameConfirm.textContent = t("rename");
}

function openPlaylistsPopup() {
  playlistsPopupOverlay.hidden = false;
  playlistsPopupNameRow.hidden = true;
  playlistsPopupNameInput.value = "";
  pendingRenamePlaylistId = null; // сбрасываем на случай незавершённого переименования из прошлого открытия
  playlistsPopupNameConfirm.textContent = t("next");
  renderPlaylistsPopupList();
}

function closePlaylistsPopup() {
  playlistsPopupOverlay.hidden = true;
}

playlistsBtn.addEventListener("click", openPlaylistsPopup);
playlistsPopupClose.addEventListener("click", closePlaylistsPopup);
// Клик по тёмному фону вокруг попапа — тоже закрывает (не по самой карточке).
playlistsPopupOverlay.addEventListener("click", (e) => {
  if (e.target === playlistsPopupOverlay) closePlaylistsPopup();
});

// "+ Новый плейлист" — сначала просим имя (свой инпут, не нативный
// prompt() — не вписывается по стилю в остальной интерфейс), потом
// открываем стандартный выбор файлов (тот же fileInput, что и "+Add") —
// pendingNewPlaylistName сигнализирует обработчику fileInput, что это
// СОЗДАНИЕ нового плейлиста, а не добавление к текущему.
playlistsPopupCreateBtn.addEventListener("click", () => {
  pendingRenamePlaylistId = null; // на случай если до этого начинали переименование, но не завершили
  playlistsPopupNameRow.hidden = false;
  playlistsPopupNameInput.value = "";
  playlistsPopupNameConfirm.textContent = t("next");
  playlistsPopupNameInput.focus();
});

playlistsPopupNameConfirm.addEventListener("click", async () => {
  const name = playlistsPopupNameInput.value.trim();
  if (!name) {
    playlistsPopupNameInput.focus();
    return;
  }

  if (pendingRenamePlaylistId !== null) {
    const id = pendingRenamePlaylistId;
    pendingRenamePlaylistId = null;
    await playlistStorage.renamePlaylist(id, name);
    playlistsPopupNameConfirm.textContent = t("next");
    playlistsPopupNameRow.hidden = true;
    if (id === activePlaylistId) updatePlaylistsButtonLabel(name); // если переименовали именно АКТИВНЫЙ плейлист — подпись самой кнопки тоже должна обновиться
    renderPlaylistsPopupList();
    return;
  }

  pendingNewPlaylistName = name;
  closePlaylistsPopup();
  fileInput.click();
});

// --- Попап "Settings" ---
function openSettingsPopup() {
  settingsPopupOverlay.hidden = false;
}

function closeSettingsPopup() {
  settingsPopupOverlay.hidden = true;
}

settingsPopupClose.addEventListener("click", closeSettingsPopup);
// Клик по тёмному фону вокруг попапа — тоже закрывает (не по самой карточке), тот же принцип, что и у попапа плейлистов.
settingsPopupOverlay.addEventListener("click", (e) => {
  if (e.target === settingsPopupOverlay) closeSettingsPopup();
});

// Переключатель языка — циклическая кнопка, та же природа, что и
// масштаб сцены (см. SCENE_HEIGHT_SCALE_STEPS выше): ENG → UKR → RU →
// снова ENG. ВАЖНО: это пока только сама кнопка/UI-состояние, реального
// перевода интерфейса за этим не стоит — подключение языков (i18n,
// перевод всех надписей) будет отдельной следующей правкой.
const LANGUAGE_STEPS = ["ENG", "UKR", "RU"];
let languageIndex = Math.max(0, LANGUAGE_STEPS.indexOf(getLanguage())); // подхватываем сохранённый язык (localStorage, см. i18n.js), а не всегда стартуем с ENG
settingsLanguageBtn.textContent = LANGUAGE_STEPS[languageIndex];

settingsLanguageBtn.addEventListener("click", () => {
  languageIndex = (languageIndex + 1) % LANGUAGE_STEPS.length;
  settingsLanguageBtn.textContent = LANGUAGE_STEPS[languageIndex];
  setLanguage(LANGUAGE_STEPS[languageIndex]);
  applyTranslations();
});

/** Применяет текущий язык (см. i18n.js) ко всем переводимым элементам
 * статичного "хрома" интерфейса. НЕ трогает пользовательский контент
 * (названия плейлистов, названия/исполнителей реальных треков) — только
 * плейсхолдеры и подписи кнопок/попапов. Вызывается один раз при
 * старте страницы и при каждой смене языка. */
function applyTranslations() {
  playlistAddBtn.textContent = t("addTrack");
  document.getElementById("playlists-popup-title").textContent = t("playlists");
  playlistsPopupClose.setAttribute("aria-label", t("close"));
  playlistsPopupCreateBtn.textContent = t("newPlaylist");
  playlistsPopupNameInput.placeholder = t("playlistNamePlaceholder");
  playlistsPopupNameConfirm.textContent = pendingRenamePlaylistId !== null ? t("rename") : t("next");
  document.getElementById("settings-popup-title").textContent = t("settings");
  settingsPopupClose.setAttribute("aria-label", t("close"));
  document.querySelector(".settings-row-label").textContent = t("language");

  if (trackTitleIsPlaceholder) trackTitleTextEl.textContent = t("track");
  if (trackArtistIsPlaceholder) trackArtistEl.textContent = t("author");

  // Список плейлистов в попапе — там же и aria-label крестика/карандаша
  // (deleteTrackAria и т.п.) у каждой строки, проще перерисовать заново
  // целиком, чем точечно менять атрибуты у уже существующих элементов.
  renderPlaylistsPopupList();
  // Синие кнопки танцев (Hip-Hop/Samba/...) — тоже нужно перерисовать,
  // иначе смена языка обновит остальной интерфейс сразу, а эти кнопки —
  // только при следующем переключении персонажа/дуэта.
  renderCharacterStack();
}
applyTranslations();

// --- Активный плейлист (сохраняется в IndexedDB, переживает перезагрузку
// страницы) ---
const ACTIVE_PLAYLIST_STORAGE_KEY = "activePlaylistId";
let activePlaylistId = null;

/** Загружает плейлист (уже полученную запись из IndexedDB) в видимый
 * список: тянет каждый трек из хранилища треков, восстанавливает File-
 * объекты из blob'ов, заполняет playlist[], перерисовывает список,
 * запускает загрузку первого трека. */
async function loadPlaylistIntoUI(plRecord) {
  activePlaylistId = plRecord.id;
  localStorage.setItem(ACTIVE_PLAYLIST_STORAGE_KEY, String(plRecord.id));
  updatePlaylistsButtonLabel(plRecord.name);

  const tracks = [];
  for (const trackId of plRecord.trackIds) {
    const rec = await playlistStorage.getTrack(trackId);
    if (!rec) continue; // трек мог быть удалён из общего хранилища отдельно — пропускаем молча
    const file = new File([rec.blob], rec.name, { type: rec.blob.type || "audio/mpeg" });
    tracks.push({ id: rec.id, file, name: rec.name, title: rec.title, artist: rec.artist });
  }
  playlist = tracks;
  currentTrackIndex = -1;
  shuffleHistory = [];
  shuffleBag = [];
  renderPlaylistList();
  if (playlist.length > 0) loadTrackAtIndex(0);
}

/** Персистит ТЕКУЩИЙ playlist[] (массив в памяти) в активный плейлист в
 * IndexedDB — вызывается после любого изменения состава (добавили через
 * +Add, удалили крестиком). Если активного плейлиста ещё почему-то нет
 * (не должно происходить после bootstrapPlaylist, но на всякий случай) —
 * просто ничего не сохраняет, не роняет остальную логику. */
async function persistActivePlaylist() {
  if (activePlaylistId == null) return;
  const ids = playlist.map((t) => t.id);
  await playlistStorage.updatePlaylistTrackIds(activePlaylistId, ids);
}

/** Запускается один раз при загрузке страницы: поднимает ранее активный
 * плейлист из IndexedDB (если есть — переживает перезагрузку страницы,
 * ради этого всё и затевалось), либо, при самом первом визите вообще
 * (или если сохранённый плейлист не нашёлся — например, очистили данные
 * сайта), создаёт "Дефолт плейлист" с вшитым тестовым треком. С этого
 * момента ВСЁ, включая этот тестовый трек, живёт в общем хранилище
 * одинаково — не нужно отдельно поддерживать "особый" случай без
 * активного плейлиста вообще, он есть всегда.
 */
async function bootstrapPlaylist() {
  const savedId = localStorage.getItem(ACTIVE_PLAYLIST_STORAGE_KEY);
  if (savedId) {
    try {
      const pl = await playlistStorage.getPlaylist(Number(savedId));
      if (pl) {
        await loadPlaylistIntoUI(pl);
        return;
      }
    } catch (err) {
      console.warn("[main] Не удалось поднять сохранённый плейлист:", err);
    }
  }

  try {
    const response = await fetch("assets/default-track.mp3");
    const blob = await response.blob();
    const name = "Dorofeeva - Додайте світла (minus).mp3";
    const { title, artist } = parseTrackName(name);
    const trackId = await playlistStorage.addTrack(blob, name, title, artist);
    const plId = await playlistStorage.createPlaylist("Default Playlist", [trackId]);
    const plRecord = await playlistStorage.getPlaylist(plId);
    await loadPlaylistIntoUI(plRecord);
  } catch (err) {
    console.warn("[main] Не удалось создать дефолтный плейлист:", err);
  }
}
bootstrapPlaylist();

// --- Шторка списка треков (мобильная, свайп полоски-хендла вверх/вниз) ---
// Порог "хендл нужно перетащить на N px, чтобы шторка открылась/закрылась
// при отпускании" — не пытаемся 1-в-1 привязать px перетаскивания к
// реальным пикселям высоты (40%/60% экрана; это разные величины на
// разных телефонах) — упрощение: тянешь ощутимо (>60px) в сторону — на
// отпускании докручивается анимацией до открытого/закрытого состояния,
// не залипая на промежуточных положениях.
const SHEET_DRAG_TOGGLE_THRESHOLD_PX = 60;
// "В какой-то момент список сам вытягивается полностью" — не ждём
// отпускания пальца вообще: если во время самого перетаскивания дошли
// досюда (65% пути до полного открытия/закрытия) — довершаем анимацией
// сразу, прямо под пальцем, как на iOS. Раньше решение принималось
// только на pointerup — шторка следовала за пальцем, но "сама" никогда
// не доезжала, пока палец не отпущен.
const SHEET_AUTO_COMPLETE_FRACTION = 0.65;
let playlistSheetOpen = false;
let sheetDragActive = false;
let sheetDragStartY = 0;
let sheetDragStartFraction = 0;

function setSheetFraction(fraction, { animate = false } = {}) {
  const clamped = Math.min(1, Math.max(0, fraction));
  mobileTopArea.style.transition = animate ? "flex-basis 0.25s ease" : "none";
  container.style.transition = animate ? "margin-bottom 0.25s ease" : "none"; // container = #scene-container (объявлен в самом начале файла)
  playlistSheet.style.transition = animate ? "flex-basis 0.25s ease" : "none";
  // 100% (естественная высота) при fraction=0 → 40% при fraction=1; то же
  // зеркально для шторки (0 → 60%). Работает как единая интерполяция —
  // ResizeObserver (см. scene.js/soundWave.js) сам подхватывает изменение
  // размера #scene-container на каждом шаге, включая во время активного
  // перетаскивания пальцем.
  mobileTopArea.style.flexBasis = `${100 - clamped * 60}%`;
  playlistSheet.style.flexBasis = `${clamped * 60}%`;
  // Отступ — ИМЕННО под самой сценой (margin-bottom на #scene-container),
  // не после всего блока #mobile-top-area целиком (та версия ставила
  // отступ ПОСЛЕ хендла, между хендлом и кнопками — не то место, просили
  // между сценой и всем остальным, включая сам хендл). Растёт вместе с
  // fraction (0px закрыто → 20px открыто), не статичный CSS margin: тот
  // всегда резервировал бы место, даже когда шторка схлопнута до нуля.
  container.style.marginBottom = `${clamped * 20}px`;
}

let sheetCloseCleanupTimer = null; // см. closePlaylistSheet — таймер отложенного снятия .sheet-open
let sheetOpenCleanupTimer = null; // см. openPlaylistSheet — таймер отложенного добавления .sheet-open

function openPlaylistSheet() {
  // Если только что закрывали и не успел сработать отложенный таймер
  // снятия .sheet-open (см. closePlaylistSheet) — отменяем: иначе он
  // сработает ПОЗЖЕ и ошибочно снимет класс уже у заново открытой
  // шторки, спрятав панель танцев/название, хотя шторка сейчас открыта.
  clearTimeout(sheetCloseCleanupTimer);
  playlistSheetOpen = true;
  playlistDragHandle.setAttribute("aria-expanded", "true");
  playlistSheet.setAttribute("aria-hidden", "false");
  setSheetFraction(1, { animate: true });
  if (sceneHeightBtnRef) sceneHeightBtnRef.disabled = true; // высота сцены при открытой шторке и так управляется шторкой, ручной масштаб не имеет смысла
  // Зеркально closePlaylistSheet ниже, та же причина: откладываем
  // ДОБАВЛЕНИЕ класса .sheet-open (мгновенно прячет панель танцев/
  // название) до конца самой анимации flex-basis (0.25s), а не делаем
  // это сразу в начале. При МЕДЛЕННОМ дотягивании пальцем до порога
  // авто-завершения (см. pointermove) сцена на долю секунды становилась
  // даже МЕНЬШЕ целевых 40% — заметно только на самом медленном
  // перетаскивании, не на быстром клике.
  clearTimeout(sheetOpenCleanupTimer);
  sheetOpenCleanupTimer = setTimeout(() => {
    mobileTopArea.classList.add("sheet-open");
  }, 250);
}

function closePlaylistSheet() {
  playlistSheetOpen = false;
  playlistDragHandle.setAttribute("aria-expanded", "false");
  playlistSheet.setAttribute("aria-hidden", "true");
  setSheetFraction(0, { animate: true });
  if (sceneHeightBtnRef) sceneHeightBtnRef.disabled = false;
  // Если только что открывали и не успел сработать отложенный таймер
  // ДОБАВЛЕНИЯ .sheet-open (см. openPlaylistSheet выше) — отменяем: та
  // же гонка состояний, что и в openPlaylistSheet, только зеркально.
  clearTimeout(sheetOpenCleanupTimer);
  // Панель танцев/название трека/строка транспорта — их видимость
  // завязана на класс .sheet-open (см. style.css: .sheet-open
  // #dance-controls{display:none} и т.п.). Раньше класс снимался
  // МГНОВЕННО, прямо здесь — контент появлялся обратно сразу, ЕЩЁ ДО
  // того, как #mobile-top-area успевал плавно дорасти с 40% до 100% (та
  // же анимация 0.25s, что и у setSheetFraction чуть выше). На эту долю
  // секунды сцене приходилось тесниться с уже вернувшимся, но ещё не
  // поместившимся контентом — то самое "проседание" перед разворотом в
  // квадрат. Откладываем снятие класса до конца самой анимации —
  // контент появляется обратно, только когда для него уже точно есть
  // место.
  clearTimeout(sheetCloseCleanupTimer); // на случай повторного быстрого закрытия — не плодим несколько таймеров подряд
  sheetCloseCleanupTimer = setTimeout(() => {
    mobileTopArea.classList.remove("sheet-open");
  }, 250);
}

// Приостанавливает/возобновляет дорогой ресайз буферов сцены/волны на
// время активного перетаскивания хендла — см. подробные комментарии в
// scene.js/soundWave.js (setResizeSuspended). Общие функции, а не
// дублирование вызовов в трёх местах, где перетаскивание может
// закончиться (авто-доезд в pointermove в обе стороны + обычный
// endSheetDrag).
function suspendResizeTracking() {
  setSceneResizeSuspended(true);
  soundWave.setResizeSuspended(true);
}
function resumeResizeTracking() {
  setSceneResizeSuspended(false);
  soundWave.setResizeSuspended(false);
}

playlistDragHandle.addEventListener("pointerdown", (e) => {
  sheetDragActive = true;
  suspendResizeTracking();
  sheetDragStartY = e.clientY;
  sheetDragStartFraction = playlistSheetOpen ? 1 : 0;
  playlistDragHandle.setPointerCapture(e.pointerId);
});

playlistDragHandle.addEventListener("pointermove", (e) => {
  if (!sheetDragActive) return;
  // Плеер/танцы НЕ останавливаются во время перетаскивания — тут нет
  // ничего, что трогало бы player.pause()/play() или anim-контроллеры,
  // только визуальные flex-basis двух блоков.
  const deltaY = sheetDragStartY - e.clientY; // тянем вверх — положительное значение
  const deltaFraction = deltaY / (SHEET_DRAG_TOGGLE_THRESHOLD_PX * 2); // ~половина порога = уже заметно двигается
  const fraction = sheetDragStartFraction + deltaFraction;
  setSheetFraction(fraction, { animate: false });

  // Авто-завершение прямо во время перетаскивания, без ожидания
  // pointerup — довели палец достаточно далеко в нужную сторону, шторка
  // сама доезжает до конца, "убегая" из-под пальца, как на iOS.
  if (!playlistSheetOpen && fraction >= SHEET_AUTO_COMPLETE_FRACTION) {
    sheetDragActive = false;
    resumeResizeTracking();
    playlistDragHandle.releasePointerCapture(e.pointerId);
    openPlaylistSheet();
  } else if (playlistSheetOpen && fraction <= 1 - SHEET_AUTO_COMPLETE_FRACTION) {
    sheetDragActive = false;
    resumeResizeTracking();
    playlistDragHandle.releasePointerCapture(e.pointerId);
    closePlaylistSheet();
  }
});

function endSheetDrag(e) {
  if (!sheetDragActive) return;
  sheetDragActive = false;
  resumeResizeTracking();
  const deltaY = sheetDragStartY - e.clientY;
  if (Math.abs(deltaY) > SHEET_DRAG_TOGGLE_THRESHOLD_PX) {
    if (deltaY > 0) openPlaylistSheet();
    else closePlaylistSheet();
  } else {
    // Недостаточно далеко утянули — откатываемся к тому состоянию, с
    // которого начали (не залипаем на полпути).
    if (playlistSheetOpen) openPlaylistSheet();
    else closePlaylistSheet();
  }
}
playlistDragHandle.addEventListener("pointerup", endSheetDrag);
playlistDragHandle.addEventListener("pointercancel", endSheetDrag);

// Обычный клик/тап без протягивания (без сработавшего drag) — просто
// переключает состояние, как обычная кнопка-раскрывашка.
playlistDragHandle.addEventListener("click", () => {
  if (playlistSheetOpen) closePlaylistSheet();
  else openPlaylistSheet();
});




/** Восстанавливает сохранённого кастомного персонажа (если есть) из
 * IndexedDB при загрузке страницы — та же схема, что и активный
 * плейлист: без этого персонаж и его танцы "пропадали" бы при каждом
 * обновлении вкладки. Сами blob'ы (файл персонажа + каждый танец)
 * превращаются обратно в object URL — дальше работает АБСОЛЮТНО так
 * же, как при обычной ручной загрузке через customCharacterFileInput. */
async function restoreCustomCharacter() {
  try {
    const record = await characterStorage.getCharacter();
    if (!record) return false;

    const characterUrl = URL.createObjectURL(record.fbxBlob);
    const animationFiles = record.dances.map((d) => [URL.createObjectURL(d.blob), d.name]);

    CHARACTERS.custom = {
      label: record.label,
      avatarEmoji: "🧍",
      characterUrl,
      animationFiles,
      allowCustomDances: true,
    };
    return true;
  } catch (err) {
    console.warn("[main] Не удалось восстановить кастомного персонажа:", err);
    return false;
  }
}

// Белка соло — состояние по умолчанию, пока пользователь не переключит.
// Если есть сохранённый кастомный персонаж — показываем СРАЗУ его
// вместо белки (то и просили — "не пропадал" после обновления страницы,
// значит должен быть виден сразу, а не просто лежать доступным в пикере).
// Белка соло — состояние по умолчанию ВСЕГДА, как и договорились. Если
// есть сохранённый кастомный персонаж — просто подтягиваем его в
// CHARACTERS (появится в пикере, доступен по клику), но НЕ переключаем
// на него автоматически — раньше делали именно так, но по факту
// оказалось не тем, что нужно (см. обсуждение).
(async function initCharacters() {
  await restoreCustomCharacter();
  applyActiveCharacters();
})();

window.addEventListener("resize", () => redrawProgressVisual());

function renderLoop() {
  requestAnimationFrame(renderLoop);

  const delta = clock.getDelta();
  let smartCameraDrivingThisFrame = false;
  let spectrumBarsThisFrame = null;
  let strongBeatThisFrame = false;

  // Phase 7-9: читаем фичи, гоняем bass через beat detector, считаем intensity,
  // и наконец передаём всё это в AnimationController(ы) — персонаж(и) реагируют на музыку.
  if (analyzer && musicIsPlaying) {
    const features = analyzer.getFeatures();
    const { beat, strong: strongBeat } = beatDetector.update(features.bass);
    const intensity = intensityTracker.update(features, delta);
    if (beat) lastBeatFlashAt = performance.now();
    if (strongBeat) lastStrongBeatFlashAt = performance.now();
    // Спектр для эквалайзера (см. soundWave.js) — ПЕРЕИСПОЛЬЗУЕТ freqData,
    // уже считанный этим же кадром внутри getFeatures() выше, поэтому
    // вызывается сразу после него, не раньше.
    spectrumBarsThisFrame = analyzer.getSpectrumBars(soundWave.getBarCount());
    strongBeatThisFrame = strongBeat;

    const activeEntries = Object.entries(slots);

    // Персонаж(и) могут уйти в Idle ПОСРЕДИ играющего трека (музыка
    // ненадолго стихла, danceBag выбрал паузу и т.п.) — камера должна
    // вести себя точно так же, как на настоящей паузе/по завершении
    // трека, а не только когда audio буквально не играет. Проверяем
    // реальное состояние анимации, а не факт воспроизведения звука.
    const anyCharacterDancing = activeEntries.some(
      ([, slot]) => slot.animController && slot.animController.getCurrent() !== "idle"
    );

    if (smartCameraEnabled) {
      smartCameraDrivingThisFrame = true;

      if (!anyCharacterDancing) {
        driveCameraHome(delta);
      } else {
      let theta, phi;

      if (smartCameraMode === "spin") {
        // Полный оборот — фиксированные 4 секунды, НЕ зависит от
        // intensity (в отличие от качелей): пользователь просил именно
        // фиксированную длительность.
        smartCameraSpinElapsed += delta;
        const spinT = Math.min(1, smartCameraSpinElapsed / SMART_CAMERA_SPIN_DURATION);
        const spinAngle = smartCameraSpinDirection * spinT * 2 * Math.PI;
        theta = HOME_SPHERICAL.theta + spinAngle;

        // Та же волна 15°/−5°, но ровно один раз за весь оборот
        // (spinT идёт 0→1 один раз, а не в темпе музыки).
        const verticalPhase = spinT * 2 * Math.PI - Math.PI / 6;
        const verticalDeg = SMART_VERTICAL_MIDLINE_DEG + SMART_VERTICAL_AMPLITUDE_DEG * Math.sin(verticalPhase);
        phi = THREE.MathUtils.clamp(
          HOME_SPHERICAL.phi - THREE.MathUtils.degToRad(verticalDeg),
          0.01,
          HOME_SPHERICAL.phi + THREE.MathUtils.degToRad(SMART_CAMERA_VERTICAL_DOWN_DEG)
        );

        if (spinT >= 1) {
          // Оборот закончен — возвращаемся к качелям, и чередуем
          // направление: следующий полный круг пойдёт в другую сторону.
          smartCameraMode = "sweep";
          smartCameraPhase = 0;
          smartCameraSpinDirection *= -1;
        }
      } else {
        // Обычные качели по горизонтали — чистая синусоида => центр→
        // +70°→центр→−70°→центр→повтор. Фаза копится в темпе, слегка
        // ускоряясь на пиках intensity — та же величина, на которую уже
        // реагируют персонажи.
        const omega = SMART_CAMERA_BASE_OMEGA * (1 + intensity * SMART_CAMERA_OMEGA_INTENSITY_BOOST);
        smartCameraPhase += omega * delta;

        // Один проход = phase от 0 до 2π (после этого синус снова 0 —
        // камера ровно по центру, идеальная точка для передачи
        // управления полному обороту без видимого скачка).
        if (smartCameraPhase >= 2 * Math.PI) {
          smartCameraPhase -= 2 * Math.PI;
          smartCameraSweepPassCount += 1;
          if (smartCameraSweepPassCount >= SMART_CAMERA_SWEEPS_BEFORE_SPIN) {
            smartCameraSweepPassCount = 0;
            smartCameraMode = "spin";
            smartCameraSpinElapsed = 0;
          }
        }

        const azimuthOffset = THREE.MathUtils.degToRad(SMART_CAMERA_AZIMUTH_DEG) * Math.sin(smartCameraPhase);

        // Несимметричная волна: старт с 0 (уровень глаз), сперва вверх до
        // +UP°, потом вниз до −DOWN° (ниже глаз), и по кругу.
        const verticalPhase = SMART_CAMERA_VERTICAL_WAVES * smartCameraPhase - Math.PI / 6;
        const verticalDeg = SMART_VERTICAL_MIDLINE_DEG + SMART_VERTICAL_AMPLITUDE_DEG * Math.sin(verticalPhase);

        theta = HOME_SPHERICAL.theta + azimuthOffset;
        phi = THREE.MathUtils.clamp(
          HOME_SPHERICAL.phi - THREE.MathUtils.degToRad(verticalDeg),
          0.01,
          HOME_SPHERICAL.phi + THREE.MathUtils.degToRad(SMART_CAMERA_VERTICAL_DOWN_DEG)
        );
      }

      const offset = new THREE.Vector3().setFromSphericalCoords(HOME_SPHERICAL.radius, phi, theta);
      camera.position.copy(HOME_CAMERA_TARGET).add(offset);
      camera.lookAt(HOME_CAMERA_TARGET);

      // "Пульс" приближения на сильном бите — через fov (короткий провал
      // и плавный возврат), не через позицию камеры.
      if (strongBeat) {
        smartCameraFovPulse = SMART_CAMERA_FOV_PUNCH;
      }
      if (smartCameraFovPulse > 0.001) {
        smartCameraFovPulse *= SMART_CAMERA_FOV_DECAY;
        camera.fov = SMART_CAMERA_BASE_FOV - smartCameraFovPulse;
        camera.updateProjectionMatrix();
      } else if (camera.fov !== SMART_CAMERA_BASE_FOV) {
        camera.fov = SMART_CAMERA_BASE_FOV;
        camera.updateProjectionMatrix();
      }
      }
    } else if (smartCameraReturningHome) {
      // Умную камеру выключили прямо во время играющего трека — едем
      // домой тем же плавным механизмом, что и на паузе, пока не
      // подлетим достаточно близко (дальше — обычное ручное вращение).
      smartCameraDrivingThisFrame = true;
      driveCameraHome(delta);
      if (camera.position.distanceTo(HOME_CAMERA_POSITION) < SMART_CAMERA_HOME_SNAP_DISTANCE) {
        smartCameraReturningHome = false;
      }
    }

    activeEntries.forEach(([id, slot]) => {
      if (!slot.animController) return;
      slot.animController.reactToAudio({
        intensity,
        delta,
      });

      // Фиолетовая подсветка кнопки того танца, который играет ПРЯМО
      // СЕЙЧАС — обновляем только при смене, не каждый кадр.
      const current = slot.animController.getCurrent();
      if (current !== slot.lastNowPlayingName) {
        if (slot.lastNowPlayingName) {
          danceButtonsByKey.get(`${id}::${slot.lastNowPlayingName}`)?.classList.remove("now-playing");
        }
        danceButtonsByKey.get(`${id}::${current}`)?.classList.add("now-playing");
        slot.lastNowPlayingName = current;
      }
    });

    if (debugEnabled) {
      dbgVolume.textContent = features.volume.toFixed(2);
      dbgBass.textContent = features.bass.toFixed(2);
      dbgMid.textContent = features.mid.toFixed(2);
      dbgTreble.textContent = features.treble.toFixed(2);
      dbgIntensity.textContent = intensity.toFixed(2);
      dbgBeatDot.classList.toggle("active", performance.now() - lastBeatFlashAt < 120);
      dbgBeatDot.classList.toggle("strong", performance.now() - lastStrongBeatFlashAt < 200);
    }
  } else if (smartCameraEnabled) {
    // Музыка вообще не играет (пауза/ещё не запущена/трек закончился).
    smartCameraDrivingThisFrame = true;
    driveCameraHome(delta);
  } else if (smartCameraReturningHome) {
    // Умную камеру выключили во время паузы/до старта — тот же плавный
    // возврат, тоже отпускаем управление, как только подлетели близко.
    smartCameraDrivingThisFrame = true;
    driveCameraHome(delta);
    if (camera.position.distanceTo(HOME_CAMERA_POSITION) < SMART_CAMERA_HOME_SNAP_DISTANCE) {
      smartCameraReturningHome = false;
    }
  }

  const activeSlots = Object.values(slots);
  if (activeSlots.length > 0) {
    // Раньше здесь была заморозка mixer на паузе — но по факту нужно не
    // "замереть на середине танца", а честно проигрывать Breathing Idle.
    // Переключение на idle происходит один раз в onPause(); mixer тикает
    // всегда, чтобы эта же idle-анимация могла дышать во время паузы.
    activeSlots.forEach((slot) => slot.mixer?.update(delta));
  } else {
    placeholder.rotation.y += delta * 0.6;
  }

  // controls.update() пересчитывает камеру из своего внутреннего
  // состояния (сферические координаты) — если в этом кадре умная камера
  // (включая плавный возврат домой) уже сама выставила camera.position
  // напрямую, вызывать его не нужно (он бы тут же перезаписал нашу
  // позицию своей). В остальное время (ручное вращение мышью/тачем,
  // демпфирование) он должен работать как обычно.
  if (!smartCameraDrivingThisFrame) {
    controls.update();
  }

  soundWave.update(delta, spectrumBarsThisFrame, strongBeatThisFrame);

  renderer.render(scene, camera);
  window.__updateEdgeBlurCanvas?.();
}

renderLoop();

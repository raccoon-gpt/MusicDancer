import * as THREE from "three";

/**
 * Animation Controller — Phase 4 (play/stop) + Phase 9 (реакция на музыку)
 * + Mixamo/FBX-пайплайн с ротацией по пулу танцев.
 *
 * ВАЖНО (мультиперсонажность): пул танцев больше НЕ зашит константой здесь
 * — у разных персонажей разный набор клипов (у белки 12, у енота 17).
 * Пул — это просто "все загруженные клипы, кроме idle", вычисляется из
 * clipsByName. main.js строит UI-кнопки, вызывая getDancePool() уже ПОСЛЕ
 * того, как загрузятся все клипы конкретного персонажа.
 *
 * Упрощено до ДВУХ состояний: спокойно (idle) / иначе (ротация по пулу).
 *
 * Процедурных реакций на музыку поверх скелета (ТЗ п.7 — присед, покачивание)
 * больше нет — убраны по итогам долгой истории багов с проваливанием в пол
 * (см. README). У Mixamo mocap-клипов вся "музыкальность" движения уже
 * заложена внутри самого клипа; накладывать сверху синтетику избыточно.
 * intensity теперь используется только для выбора состояния (tier) и
 * скорости воспроизведения (timeScale) — вращение/позиция персонажа
 * целиком определяются играющим клипом.
 */

// Порог интенсивности — С ГИСТЕРЕЗИСОМ: разные значения на вход/выход, а не
// одна точка. Без этого, если у трека средняя intensity близка к границе,
// обычный шум/дрожание сигнала туда-сюда пересекает порог много раз в секунду.
const INTENSITY_ACTIVE_UP = 0.35; // calm → active, когда энергия растёт
const INTENSITY_ACTIVE_DOWN = 0.12; // active → calm, когда энергия падает —
// сильно ниже, чем раньше (было 0.25): чтобы уйти в idle посреди
// энергичного трека, нужен по-настоящему тихий момент, а не обычный
// локальный спад громкости внутри активной части.

function computeTier(intensity, prevTier) {
  if (prevTier === "active") {
    return intensity < INTENSITY_ACTIVE_DOWN ? "calm" : "active";
  }
  // calm (или самый первый вызов, prevTier === null)
  return intensity > INTENSITY_ACTIVE_UP ? "active" : "calm";
}

const DEFAULT_TUNING = {
  minTimeScale: 0.85,
  maxTimeScaleBonus: 0.4,
  timeScaleSmoothingTau: 1.8,
  danceRotateSeconds: 9,
  danceSwitchLeadTime: 0.35, // за сколько секунд ДО конца цикла можно
  // начинать crossFade на следующий танец — не режем жест на середине
  tierDownFadeSeconds: 0.7, // переход active → calm — чуть плавнее
  // мгновенного (0.35с), но не ждём конца лупа целиком (быстрый отклик на
  // затихание музыки важнее).
  activeConfirmSeconds: 0.18, // вход в "active" должен продержаться хотя бы
  // столько — иначе быстрый шумовой проскок мгновенно дёргано переключал бы
  // в танец.
  calmConfirmSeconds: 0.8, // раньше 0.4 — вход в "calm" должен продержаться
  // ещё дольше: пользователь заметил, что белка иногда уходила в idle даже
  // во время энергичной музыки. Вместе со сниженным INTENSITY_ACTIVE_DOWN
  // idle теперь срабатывает заметно реже — только на реально устойчивых
  // тихих участках.
};

/**
 * Shuffle bag — перемешивает пул один раз и раздаёт по порядку без
 * повторов, пока не кончится; тогда тасует заново. Гарантирует, что все
 * ВКЛЮЧЁННЫЕ элементы будут показаны, прежде чем что-то повторится.
 *
 * getItems — функция, а не статический массив: список включённых танцев
 * может меняться на лету (пользователь кликает кнопки в UI-панели), и
 * мешок должен всегда тасовать АКТУАЛЬНый набор при каждой пересдаче.
 */
function createShuffleBag(getItems) {
  let bag = [];
  let lastPlayed = null;

  function reshuffle() {
    bag = [...getItems()];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    if (bag.length > 1 && bag[bag.length - 1] === lastPlayed) {
      const swapIdx = Math.floor(Math.random() * (bag.length - 1));
      [bag[bag.length - 1], bag[swapIdx]] = [bag[swapIdx], bag[bag.length - 1]];
    }
  }

  function next() {
    // Список включённых мог поменяться ПОСЛЕ того, как мешок был
    // перемешан (пользователь выключил кнопку уже после тасовки) — чистим
    // "протухшие" элементы перед раздачей, а не только при полной пересдаче.
    // Без этого next() мог вытянуть уже отключённое имя, а страховка в
    // reactToAudio увидев "отключён" — откатывалась в idle вместо того,
    // чтобы вытянуть из мешка следующий валидный танец.
    const allowed = new Set(getItems());
    bag = bag.filter((item) => allowed.has(item));

    if (bag.length === 0) reshuffle();
    if (bag.length === 0) return null; // всё выключено пользователем
    lastPlayed = bag.pop();
    return lastPlayed;
  }

  function reset() {
    bag = [];
    lastPlayed = null;
  }

  return { next, reset };
}

/**
 * @param {THREE.AnimationMixer} mixer
 * @param {THREE.AnimationClip[]} clips - уже переименованные при загрузке
 * @param {THREE.Object3D} model
 */
export function createAnimationController(mixer, clips, model) {
  const clipsByName = new Map(clips.map((clip) => [clip.name, clip]));
  let currentAction = null;
  let currentLogicalName = null;

  const tuning = { ...DEFAULT_TUNING };

  let baseY = model.position.y;
  let baseRotY = model.rotation.y;
  let smoothedTimeScale = 1;

  // Live-контроль из UI-панели: какие танцы сейчас включены. По умолчанию
  // все включены — набор ИСКЛЮЧЁННЫХ, а не включённых, чтобы новые клипы
  // (если появятся) были включены по умолчанию без доп. кода.
  const disabledDances = new Set();

  // Служебные клипы — не настоящие танцы: "idle" (простой) и "loading_pose"
  // (превью на экране загрузки, main.js) — не должны попадать ни в мешок
  // ротации, ни в список кнопок панели.
  const NON_DANCE_CLIPS = new Set(["idle", "loading_pose"]);

  let currentMainDance = null;
  let pendingMainDance = null;
  const danceBag = createShuffleBag(() =>
    [...clipsByName.keys()].filter((name) => !NON_DANCE_CLIPS.has(name) && !disabledDances.has(name))
  );
  let mainDanceTimer = 0;
  let lastTier = null;
  let activeCandidateTimer = 0;
  let calmCandidateTimer = 0;

  function hasClip(name) {
    return clipsByName.has(name);
  }

  /** Все загруженные клипы, кроме служебных — источник правды для UI-кнопок
   * в main.js. Разный набор у разных персонажей, поэтому не константа. */
  function getDancePool() {
    return [...clipsByName.keys()].filter((name) => !NON_DANCE_CLIPS.has(name));
  }

  /** Добавляет клипы уже после создания controller'а — см. main.js: танцы
   * догружаются в фоне, пока персонаж уже стоит на месте и дышит на Idle. */
  function addClips(newClips) {
    newClips.forEach((clip) => clipsByName.set(clip.name, clip));
  }

  /**
   * Включает/выключает танец в живой ротации — для кнопок в UI-панели.
   * ВАЖНО: переключаем НЕМЕДЛЕННО, а не через pendingMainDance (как обычная
   * ротация) — это осознанное действие пользователя, а не фоновый таймер.
   * Раньше ждали конца лупа, из-за чего казалось, что "выключение не
   * работает" — белка донашивала текущий танец, а если пользователь успевал
   * выключить ещё несколько кнопок подряд, currentMainDance вообще мог
   * застрять на уже отключённом танце навсегда (pendingMainDance так и не
   * находил момент, чтобы примениться).
   */
  function setDanceEnabled(name, enabled) {
    if (enabled) disabledDances.delete(name);
    else disabledDances.add(name);

    if (!enabled && currentMainDance === name) {
      currentMainDance = danceBag.next(); // null, если вообще всё выключено
      pendingMainDance = null;
      mainDanceTimer = 0;
    }
  }

  function play(clipName, { fadeSeconds = 0.35, loop = true, timeScale = 1 } = {}) {
    const clip = clipsByName.get(clipName);
    if (!clip) {
      console.warn(`[animationController] Клип не найден: "${clipName}"`);
      return null;
    }

    if (currentLogicalName === clipName && currentAction?.isRunning()) {
      currentAction.timeScale = timeScale;
      return currentAction;
    }

    const nextAction = mixer.clipAction(clip);
    nextAction.reset();
    nextAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    nextAction.clampWhenFinished = !loop;
    nextAction.timeScale = timeScale;
    nextAction.enabled = true;
    nextAction.play();

    if (currentAction && currentAction !== nextAction) {
      currentAction.crossFadeTo(nextAction, fadeSeconds, true);
    }

    currentAction = nextAction;
    currentLogicalName = clipName;
    return nextAction;
  }

  function stop({ fadeSeconds = 0.35 } = {}) {
    if (currentAction) {
      currentAction.fadeOut(fadeSeconds);
      currentAction = null;
      currentLogicalName = null;
    }
  }

  function getCurrent() {
    return currentLogicalName;
  }

  /**
   * Главная точка входа — вызывается каждый кадр, пока трек играет.
   */
  function reactToAudio({ intensity, delta }) {
    const rawTier = computeTier(intensity, lastTier);

    let tier = lastTier;
    let enteredNewTier = false;
    const previousTier = lastTier;

    if (lastTier === null) {
      tier = rawTier;
      lastTier = tier;
      enteredNewTier = true;
    } else if (rawTier === "active" && lastTier !== "active") {
      activeCandidateTimer += delta;
      calmCandidateTimer = 0;
      if (activeCandidateTimer >= tuning.activeConfirmSeconds) {
        tier = rawTier;
        lastTier = tier;
        enteredNewTier = true;
        activeCandidateTimer = 0;
      }
    } else if (rawTier === "calm" && lastTier !== "calm") {
      calmCandidateTimer += delta;
      activeCandidateTimer = 0;
      if (calmCandidateTimer >= tuning.calmConfirmSeconds) {
        tier = rawTier;
        lastTier = tier;
        enteredNewTier = true;
        calmCandidateTimer = 0;
      }
    } else {
      activeCandidateTimer = 0;
      calmCandidateTimer = 0;
      if (rawTier !== lastTier) {
        tier = rawTier;
        lastTier = tier;
        enteredNewTier = true;
      }
    }

    const targetTimeScale = tuning.minTimeScale + intensity * tuning.maxTimeScaleBonus;
    smoothedTimeScale +=
      (targetTimeScale - smoothedTimeScale) *
      (1 - Math.exp(-delta / tuning.timeScaleSmoothingTau));
    const timeScale = smoothedTimeScale;

    const downshiftFade =
      enteredNewTier && previousTier === "active" ? tuning.tierDownFadeSeconds : 0.35;

    if (tier === "calm") {
      play("idle", { timeScale: 1, fadeSeconds: downshiftFade });
    } else {
      // active — ротация по общему пулу из 12 танцев (shuffle теперь
      // рядовой участник, не отдельное состояние)
      mainDanceTimer += delta;

      if (enteredNewTier || currentMainDance === null) {
        currentMainDance = danceBag.next();
        mainDanceTimer = 0;
        pendingMainDance = null;
      } else if (mainDanceTimer >= tuning.danceRotateSeconds && !pendingMainDance) {
        pendingMainDance = danceBag.next();
      }

      if (pendingMainDance && currentAction) {
        const clipDuration = currentAction.getClip().duration;
        const loopPosition = currentAction.time % clipDuration;
        const timeUntilLoopEnd = clipDuration - loopPosition;
        if (timeUntilLoopEnd <= tuning.danceSwitchLeadTime) {
          currentMainDance = pendingMainDance;
          pendingMainDance = null;
          mainDanceTimer = 0;
        }
      }

      if (currentMainDance && !disabledDances.has(currentMainDance) && hasClip(currentMainDance)) {
        play(currentMainDance, { timeScale });
      } else {
        // currentMainDance пуст, отключён или клип ещё не догружен — не
        // ломаемся, откатываемся на idle, чтобы персонаж не завис молча
        // и уж точно не продолжал играть отключённый танец.
        play("idle", { timeScale: 1 });
      }
    }

    // Процедурные реакции поверх скелетной анимации (ТЗ п.7) убраны целиком
    // — и присед от баса, и покачивание корпусом. Тот ТЗ писался под
    // персонажа с чисто утилитарными анимациями (Idle/Dance_Loop), где
    // ничего "музыкального" в самом движении не было — процедурика была
    // единственным способом дать связь с музыкой. С переходом на настоящие
    // Mixamo mocap-клипы эта работа уже сделана внутри самого клипа
    // профессиональным аниматором; накладывать сверху синтетику избыточно
    // и конфликтует с уже заложенным в данные движением (это и вызывало
    // серию багов с полом). model.rotation.y больше не трогаем — вращение
    // персонажа теперь целиком определяется играющим клипом.
    //
    // Динамическая коррекция пола (замер реального нижнего края через
    // precise Box3, попытка компенсировать расхождения между клипами)
    // тоже убрана — несмотря на несколько попыток разной сложности, не
    // удалось до конца избежать либо проваливания, либо парения на
    // некоторых клипах. Раз видимого пола в сцене больше нет (см.
    // createScene в scene.js) — расхождение в несколько мм/см между
    // клипами просто не видно на экране, гоняться за ним дальше смысла
    // не было. model.position.y теперь не трогается процедурно вообще —
    // персонаж стоит там, где его один раз поставил groundAndCenterModel.
  }

  function resetPose() {
    model.position.y = baseY;
    model.rotation.y = baseRotY;
    smoothedTimeScale = 1;
    mainDanceTimer = 0;
    lastTier = null;
    activeCandidateTimer = 0;
    calmCandidateTimer = 0;
    pendingMainDance = null;
    danceBag.reset();
  }

  function captureBasePose() {
    baseY = model.position.y;
    baseRotY = model.rotation.y;
  }

  return {
    play,
    stop,
    hasClip,
    addClips,
    setDanceEnabled,
    getCurrent,
    getDancePool,
    reactToAudio,
    resetPose,
    captureBasePose,
    tuning,
  };
}

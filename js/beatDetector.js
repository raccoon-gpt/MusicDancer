/**
 * Beat Detector — Phase 8.
 *
 * НЕ полноценная MIR-задача (ТЗ п.9) — простой realtime детект пиков баса:
 * сглаживание входного сигнала + adaptive threshold + cooldown.
 *
 * ВАЖНО (пофикшено после багрепорта): baseline считается через настоящую
 * Simple Moving Average по временному окну (буфер последних N сэмплов), а
 * НЕ через экспоненциальное скользящее среднее (EMA).
 *
 * Почему это важно: у EMA с окном ~500мс каждый бит сам себя "проглатывает"
 * в среднее значение за 1-2 секунды — average быстро подтягивается к уровню
 * пиков, threshold = average * sensitivity тоже растёт, и детектор перестаёт
 * видеть последующие биты (ровно тот симптом из багрепорта). SMA с широким
 * окном (1.5с) устойчивее: один сэмпл — это 1/N веса в среднем, а не
 * change-per-frame, поэтому пики не утаскивают baseline за собой.
 *
 * ВАЖНО (после второго багрепорта): помимо fix'а baseline, снижено встроенное
 * сглаживание AnalyserNode (см. audioAnalyzer.js) — оно съедало контраст между
 * ударом и фоном настолько сильно, что детектор видел только самый первый
 * переход "тишина → звук" (реальный большой перепад), а все последующие удары
 * внутри уже играющего трека были неотличимы от фона. Это была отдельная
 * причина от adaptive threshold, маскировавшаяся под тот же симптом.
 *
 * Phase 10 (ТЗ п.21): помимо { beat }, теперь отдаёт { strong, strength } —
 * различие слабых и сильных ударов. AnimationController использует strong
 * для запуска акцентной анимации (не только позиционного "хлопа").
 *
 * Ничего не знает про Three.js/AnimationController — просто отдаёт { beat }
 * на каждый update(), дальше с этим работает AnimationController (Phase 9+).
 */

export function createBeatDetector({
  sensitivity = 1.2, // порог = runningAverage * sensitivity — см. audioAnalyzer.js:
  // после фикса minDecibels/maxDecibels пики баса ~1.1-1.5x от фона (не 2-3x),
  // поэтому 1.2 ловит большинство реальных ударов, не давя их слишком строгим порогом
  cooldownMs = 200, // минимальный промежуток между двумя beat-событиями
  smoothingFactor = 0.4, // легче, чем раньше — теперь analyser сам почти не сглаживает,
  // и нам нужно сохранить контраст удара, а не только погасить дребезг между кадрами
  averageWindowMs = 1500, // окно SMA для baseline — специально широкое (см. комментарий выше)
  minBass = 0.05, // порог тишины — ниже него beat не считается
  strongBeatRatio = 1.35, // Phase 10 (ТЗ п.21): strength = smoothedBass/threshold;
  // beat считается "сильным", если signal превышает threshold больше чем в
  // strongBeatRatio раз — это то, что запускает акцентную анимацию, а не
  // только позиционный "хлоп" (см. animationController.reactToAudio)
} = {}) {
  let smoothedBass = 0;
  let lastBeatTime = -Infinity;

  // История { time, value } за последние averageWindowMs — основа SMA
  const history = [];

  /**
   * @param {number} bass - 0..1, из AudioAnalyzer.getFeatures().bass
   * @param {number} [nowMs] - performance.now(), по умолчанию берётся само
   * @returns {{ beat: boolean, smoothedBass: number, threshold: number, runningAverage: number }}
   */
  function update(bass, nowMs = performance.now()) {
    // После reset() (pause/новый трек) не "разгоняем" EMA от нуля —
    // это создавало ложный переходный процесс, из-за которого первый
    // реальный удар после resume либо терялся, либо давал фантомный beat.
    // Первый сэмпл после сброса — это и есть стартовое значение smoothedBass.
    smoothedBass =
      history.length === 0
        ? bass
        : smoothedBass * smoothingFactor + bass * (1 - smoothingFactor);

    history.push({ time: nowMs, value: smoothedBass });
    while (history.length > 1 && nowMs - history[0].time > averageWindowMs) {
      history.shift();
    }

    let sum = 0;
    for (let i = 0; i < history.length; i++) sum += history[i].value;
    const runningAverage = sum / history.length;

    const threshold = runningAverage * sensitivity;
    const cooledDown = nowMs - lastBeatTime >= cooldownMs;

    let beat = false;
    let strong = false;
    // strength — во сколько раз сигнал превышает threshold. Считаем его
    // всегда (не только на самом beat), пригодится для debug/тюнинга.
    const strength = threshold > 0 ? smoothedBass / threshold : 0;

    if (cooledDown && smoothedBass > threshold && smoothedBass > minBass) {
      beat = true;
      strong = strength >= strongBeatRatio;
      lastBeatTime = nowMs;
    }

    return { beat, strong, strength, smoothedBass, threshold, runningAverage };
  }

  function setSensitivity(value) {
    sensitivity = value;
  }

  function setCooldown(ms) {
    cooldownMs = ms;
  }

  function setStrongBeatRatio(value) {
    strongBeatRatio = value;
  }

  /**
   * Сбрасывает всё состояние — обязательно вызывать на pause/новом треке.
   * Без этого история за время паузы (где bass≈0, т.к. звук не идёт) тянет
   * baseline вниз, и на resume детектор ведёт себя непредсказуемо ещё
   * несколько кадров, пока стухшие сэмплы не вымоются из окна.
   */
  function reset() {
    smoothedBass = 0;
    lastBeatTime = -Infinity;
    history.length = 0;
  }

  return { update, setSensitivity, setCooldown, setStrongBeatRatio, reset };
}

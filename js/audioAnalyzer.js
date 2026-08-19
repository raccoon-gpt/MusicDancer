/**
 * Audio Analyzer — Phase 6 + 7.
 *
 * Единственная задача этого модуля — считать сырые данные из Web Audio API
 * и отдать нормализованные аудио-фичи (0..1). НИЧЕГО не знает про Three.js
 * или персонажа — это принципиальное разделение слоёв (ТЗ п.20):
 *
 *   Audio → AudioAnalyzer → AudioFeatures → AnimationController → Mixer
 *
 * AnimationController (Phase 9+) сам решает, что делать с этими цифрами.
 */

const BASS_MAX_HZ = 250;
const MID_MAX_HZ = 2000;
const TREBLE_MAX_HZ = 12000;

/**
 * @param {HTMLAudioElement} audioElement - тот же элемент, что использует audioPlayer.js
 */
export function createAudioAnalyzer(audioElement) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();

  // ВАЖНО: createMediaElementSource можно вызвать только ОДИН раз на элемент —
  // поэтому createAudioAnalyzer тоже должен вызываться один раз за всё приложение.
  const source = audioCtx.createMediaElementSource(audioElement);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.2; // намеренно низкое — почти "сырые" данные
  // каждый кадр. При 0.6-0.8 экспоненциальное сглаживание Web Audio API blend-ит
  // текущий кадр с предыдущими настолько сильно, что оно съедает контраст между
  // ударом баса и фоном уже на входе — детектор потом видит почти ровную линию
  // и ловит только самый первый переход "тишина → звук" (когда есть настоящий
  // большой перепад), а все последующие удары внутри уже играющего трека
  // становятся неотличимы от фона. Своё лёгкое сглаживание делаем в beatDetector.

  // ВАЖНО: дефолты minDecibels=-100/maxDecibels=-30 рассчитаны на довольно тихий
  // сигнал. Смастерённая музыка обычно сидит в районе -50..-20dB на большинстве
  // частот — с дефолтным maxDecibels=-30 бас почти всегда упирается в потолок
  // (нормализованное значение стабильно 0.75-0.95, что и видно как "почти не
  // меняется"). Раздвигаем окно вниз, чтобы получить реальный динамический
  // диапазон 0.3-0.85+ вместо 0.75-0.85.
  analyser.minDecibels = -70;
  analyser.maxDecibels = -20;

  source.connect(analyser);
  analyser.connect(audioCtx.destination); // без этого звук замолчит — граф оборвётся

  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const timeData = new Uint8Array(analyser.fftSize);

  const hzPerBin = audioCtx.sampleRate / analyser.fftSize;

  function averageInRange(fromHz, toHz) {
    const fromBin = Math.max(0, Math.floor(fromHz / hzPerBin));
    const toBin = Math.min(freqData.length - 1, Math.ceil(toHz / hzPerBin));
    let sum = 0;
    for (let i = fromBin; i <= toBin; i++) sum += freqData[i];
    const count = toBin - fromBin + 1;
    return count > 0 ? sum / count / 255 : 0;
  }

  /**
   * AudioContext стартует в состоянии "suspended" пока не будет resume()
   * по пользовательскому жесту — это требование браузеров (ТЗ п.18).
   */
  function resume() {
    if (audioCtx.state === "suspended") return audioCtx.resume();
    return Promise.resolve();
  }

  /**
   * @returns {{ volume: number, bass: number, mid: number, treble: number }}
   * Все значения нормализованы в диапазон 0..1.
   */
  function getFeatures() {
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);

    // Volume — RMS по time-domain сигналу, честнее чем просто среднее по спектру
    let sumSquares = 0;
    for (let i = 0; i < timeData.length; i++) {
      const normalized = (timeData[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const volume = Math.sqrt(sumSquares / timeData.length);

    return {
      volume,
      bass: averageInRange(20, BASS_MAX_HZ),
      mid: averageInRange(BASS_MAX_HZ, MID_MAX_HZ),
      treble: averageInRange(MID_MAX_HZ, TREBLE_MAX_HZ),
    };
  }

  /**
   * Для визуализаций-эквалайзеров (см. soundWave.js) — N усреднённых
   * полос по спектру, а не 3 широких диапазона, как в getFeatures().
   * Логарифмическая шкала по частоте (20Hz..maxHz) — на слух и на глаз
   * так выглядит естественнее: линейная шкала отдаёт почти весь бас в
   * первые несколько полос, а все "интересные" средние/высокие частоты
   * сжимаются в последние пиксели. ВАЖНО: переиспользует уже считанный
   * этим же кадром freqData — вызывать ПОСЛЕ getFeatures() в том же
   * кадре, отдельного analyser.getByteFrequencyData() здесь нет.
   *
   * @param {number} barCount
   * @param {number} maxHz
   * @returns {number[]} длины barCount, значения 0..1
   */
  function getSpectrumBars(barCount, maxHz = TREBLE_MAX_HZ) {
    const minHz = 20;
    const bars = new Array(barCount);
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);
    for (let i = 0; i < barCount; i++) {
      const fromHz = Math.exp(logMin + ((logMax - logMin) * i) / barCount);
      const toHz = Math.exp(logMin + ((logMax - logMin) * (i + 1)) / barCount);
      const raw = averageInRange(fromHz, toHz);

      // Компенсация естественного спада энергии с частотой — у обычной
      // музыки бас почти всегда громче верхов, поэтому без компенсации
      // левые (низкочастотные) столбики ВСЕГДА выше правых, независимо
      // от трека. Не баг, а физика спектра — но выглядит предсказуемо и
      // скучно, а не "живо". Компенсация примерно выравнивает средний
      // уровень по всей ширине (на слух примерно соответствует тому, как
      // ухо воспринимает громкость на разных частотах), чтобы то, какие
      // столбики выше именно СЕЙЧАС — решала реальная динамика момента.
      const centerHz = Math.sqrt(fromHz * toHz);
      const gain = Math.pow(centerHz / 200, 0.55);
      bars[i] = Math.min(1, raw * gain);
    }
    return bars;
  }

  return { audioCtx, resume, getFeatures, getSpectrumBars };
}

/**
 * Intensity — Phase 9 (ТЗ п.10).
 * Одно число 0..1: спокойствие/энергичность момента музыки, чтобы
 * AnimationController мог одним параметром управлять и выбором анимации,
 * и скоростью/амплитудой реакции, не завися от четырёх сырых чисел отдельно.
 *
 * ВАЖНО (после репорта "на некоторых треках только shuffle+idle"): раньше
 * это было фиксированной формулой (`volume*2.6*0.35 + bass*0.65`),
 * откалиброванной на ОДНОМ тестовом треке — у других треков громкость/бас
 * в среднем другие, и они физически не дотягивали до порога "active" даже
 * в самых энергичных местах. Теперь intensity АДАПТИВНАЯ: сигнал
 * нормализуется относительно диапазона громкости, который сам трек
 * показал за последние ~секунды — тихое место всегда около 0, а самое
 * громкое место ЭТОГО трека всегда около 1, независимо от абсолютного
 * мастеринга. Работает как автоматическая регулировка усиления (AGC).
 */
export function createIntensityTracker({
  volumeWeight = 0.35,
  bassWeight = 0.65,
  volumeScale = 2.6, // растягиваем typical RMS (~0.1-0.35) к диапазону ~0-1
  smoothingTau = 0.35, // секунды — сглаживание сырого сигнала
  envelopeAttackTau = 2.5, // секунды — как быстро max/min "огибающие"
  envelopeReleaseTau = 20, // подстраиваются к новым пикам/затишьям (attack)
  // и как медленно отпускают старые значения, если давно не повторялись (release)
} = {}) {
  let smoothedRaw = 0;
  // Стартуем не с нуля, а с разумных дефолтов — чтобы первые секунды
  // трека (пока огибающие ещё не "увидели" реальный диапазон) не давали
  // случайных экстремальных значений intensity.
  let maxEnvelope = 0.3;
  let minEnvelope = 0.05;

  /**
   * @param {{ volume: number, bass: number }} features
   * @param {number} delta - время с прошлого кадра, секунды
   * @returns {number} 0..1, нормализовано относительно диапазона ЭТОГО трека
   */
  function update({ volume, bass }, delta = 1 / 60) {
    const raw = Math.min(1, Math.max(0, volume * volumeScale * volumeWeight + bass * bassWeight));
    smoothedRaw += (raw - smoothedRaw) * (1 - Math.exp(-delta / smoothingTau));

    // max-огибающая: быстро тянется вверх к новым пикам, медленно опускается
    const maxTau = smoothedRaw > maxEnvelope ? envelopeAttackTau : envelopeReleaseTau;
    maxEnvelope += (smoothedRaw - maxEnvelope) * (1 - Math.exp(-delta / maxTau));

    // min-огибающая: быстро опускается к затишьям, медленно поднимается обратно
    const minTau = smoothedRaw < minEnvelope ? envelopeAttackTau : envelopeReleaseTau;
    minEnvelope += (smoothedRaw - minEnvelope) * (1 - Math.exp(-delta / minTau));

    const range = Math.max(maxEnvelope - minEnvelope, 0.05); // защита от деления на ~0
    return Math.min(1, Math.max(0, (smoothedRaw - minEnvelope) / range));
  }

  function reset() {
    smoothedRaw = 0;
    maxEnvelope = 0.3;
    minEnvelope = 0.05;
  }

  return { update, reset };
}

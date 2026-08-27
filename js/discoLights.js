/**
 * Дискотечные прожекторы — НАСТОЯЩИЕ 3D-источники света Three.js (не
 * плоский рисунок на канвасе, как звёздный туннель/волна), крутятся
 * вокруг персонажа и подсвечивают его цветом по-настоящему — свет падает
 * на реальную геометрию/материал персонажа, так же, как обычный
 * key/rim-свет уже делает (см. scene.js). Именно поэтому это отдельный
 * модуль, работающий через саму 3D-сцену, а не ещё один canvas-слой.
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
 * пульсирует от музыки.
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

export function createDiscoLights(scene) {
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

  /**
   * @param {number} delta - секунды с прошлого кадра
   * @param {number} intensity - 0..1, "энергичность" текущего момента музыки (см. createIntensityTracker в audioAnalyzer.js) — управляет базовой яркостью
   * @param {boolean} strongBeat - был ли в этом кадре сильный удар — короткая вспышка яркости
   */
  function update(delta, intensity = 0, strongBeat = false) {
    if (!enabled) return;
    time += delta;

    if (strongBeat) beatPulse = 1;
    beatPulse *= Math.pow(0.02, delta); // плавное, но довольно быстрое затухание вспышки

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
    fixtures.forEach(({ helper }) => {
      helper.visible = value;
    });
  }

  /** Переключает угол конуса всех прожекторов между соло/дуэт-значениями
   * (см. SOLO_CONE_ANGLE/DUET_CONE_ANGLE выше) — вызывается из main.js
   * при каждой смене состава активных персонажей. */
  function setDuetMode(isDuet) {
    const angle = isDuet ? DUET_CONE_ANGLE : SOLO_CONE_ANGLE;
    fixtures.forEach(({ light }) => {
      light.angle = angle;
    });
  }

  return { update, setEnabled, setHelpersVisible, setDuetMode };
}

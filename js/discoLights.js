/**
 * Дискотечные прожекторы — НАСТОЯЩИЕ 3D-источники света Three.js (не
 * плоский рисунок на канвасе, как звёздный туннель/волна), крутятся
 * вокруг персонажа и подсвечивают его цветом по-настоящему — свет падает
 * на реальную геометрию/материал персонажа, так же, как обычный
 * key/rim-свет уже делает (см. scene.js). Именно поэтому это отдельный
 * модуль, работающий через саму 3D-сцену, а не ещё один canvas-слой.
 *
 * Несколько THREE.SpotLight разных цветов, каждый вращается вокруг
 * персонажа со своей собственной скоростью (не синхронно — иначе
 * выглядело бы механически, не как настоящая дискотека), яркость
 * пульсирует от музыки.
 */

import * as THREE from "three";

const DISCO_COLORS = [0xff3b6b, 0x3b6bff, 0x3bff9e, 0xffd93b, 0xb83bff, 0x3bdfff];

export function createDiscoLights(scene) {
  const fixtures = DISCO_COLORS.map((color, i) => {
    const light = new THREE.SpotLight(color, 0, 8, Math.PI / 7, 0.5, 1.2);
    light.position.set(0, 3.2, 0); // все прожекторы физически висят в одной точке "над сценой" — крутится именно ЦЕЛЬ (target), не сам источник, как в реальном прожекторе на штативе
    light.visible = false; // изначально выключены — включаются только через setEnabled(true)
    scene.add(light);
    scene.add(light.target);
    return {
      light,
      // Разный стартовый угол (равномерно по кругу) и разная скорость
      // вращения у каждого — специально НЕ одинаковая, иначе все лучи
      // крутились бы синхронно, как одна деталь, а не как хаотичная
      // дискотечная подсветка.
      baseAngle: (i / DISCO_COLORS.length) * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.6,
    };
  });

  let enabled = false;
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
    // scene.js (там 1.6/0.4) — это не опечатка. В Three.js 0.160.0по
    // умолчанию включена "физически корректная" система освещения, где у
    // точечных/прожекторных источников (SpotLight/PointLight) совершенно
    // другой масштаб яркости, чем у направленного света (DirectionalLight,
    // не имеющего физического затухания по расстоянию) — тот остаётся в
    // прежнем, привычном диапазоне 0..2, а SpotLight с тем же диапазоном
    // на таком расстоянии был бы практически невидим. Числа ниже подобраны
    // так, чтобы прожектор реально был заметен на персонаже — при
    // необходимости их несложно подкрутить дальше.
    const baseIntensity = 25 + intensity * 70;
    const flashBoost = 1 + beatPulse * 1.4;

    fixtures.forEach(({ light, baseAngle, speed }) => {
      const angle = baseAngle + time * speed;
      const radius = 2.4;
      // Цель прожектора описывает круг вокруг персонажа на уровне груди —
      // сам персонаж стоит примерно в (0, ~0.9, 0), см. scene.js/main.js
      // groundAndCenterModel.
      light.target.position.set(Math.cos(angle) * radius, 0.9, Math.sin(angle) * radius);
      light.intensity = baseIntensity * flashBoost;
    });
  }

  /** Включает/выключает разом все прожекторы. */
  function setEnabled(value) {
    enabled = value;
    fixtures.forEach(({ light }) => {
      light.visible = value;
    });
    if (!value) beatPulse = 0; // не копим вспышку, пока выключено — иначе при следующем включении был бы неожиданный резкий скачок яркости
  }

  return { update, setEnabled };
}

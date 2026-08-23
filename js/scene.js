import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";

/**
 * 3D Scene module.
 * Отвечает ТОЛЬКО за Three.js: camera, lighting, renderer, resize, render loop.
 * Ничего не знает про аудио — это принципиально (см. ТЗ п.20).
 *
 * Персонаж (GLB) сюда подключится на Phase 2 через loadCharacter().
 * Пока — placeholder-меш, чтобы визуально подтвердить, что сцена живая.
 */

export function createScene(container) {
  const scene = new THREE.Scene();
  // Фон убран (был scene.background = new THREE.Color(0x0d0d0d)) — теперь
  // за сценой рисуется Sound Circle Wave (см. soundCircleWave.js, тот же
  // цвет #0d0d0d как базовый фон + анимированное кольцо поверх), а сама
  // сцена/рендерер стали прозрачными, чтобы это было видно сквозь неё.
  scene.background = null;

  // Статичная камера, персонаж помещается в кадр с запасом сверху/снизу (ТЗ п.15)
  const camera = new THREE.PerspectiveCamera(
    35,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  // Персонаж Quaternius ~1.8м, ступни на y=0 — кадрируем с запасом сверху/снизу
  camera.position.set(0, 1.4, 5.0);
  camera.lookAt(0, 0.95, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  // ВАЖНО: alpha:true включает только поддержку прозрачности у контекста
  // канваса — сам рендерер по умолчанию всё равно очищает кадр
  // непрозрачным (clearAlpha=1), пока не скажешь иначе явно. Без этой
  // строки Sound Circle Wave (см. soundCircleWave.js) не будет видно,
  // несмотря на alpha:true и scene.background=null.
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // ТЗ п.16
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Явно, не полагаясь на дефолт конкретной версии Three.js (см. комментарий
  // про colorSpace текстур в loadCharacterFBX — тот же класс проблемы).
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Явный position+z-index (не просто "добавлен позже в DOM") — чтобы
  // WebGL-канвас гарантированно был выше Sound Circle Wave (см.
  // soundCircleWave.js), независимо от того, создаёт ли #scene-container
  // собственный stacking context. Два элемента с явным неотрицательным
  // z-index сравниваются друг с другом напрямую и предсказуемо — в
  // отличие от отрицательного z-index, который может "провалиться" ниже
  // вообще всей страницы, если ближайший позиционированный родитель не
  // создаёт свой stacking context (именно так и оказалось на практике).
  renderer.domElement.style.position = "relative";
  renderer.domElement.style.zIndex = "2"; // выше звуковой волны (0) и слоя размытия контура персонажей (1, см. main.js)
  container.appendChild(renderer.domElement);

  // --- Освещение: простое, нейтральное (фон/эффекты — не в MVP, ТЗ п.14) ---
  const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 1.1);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x88aaff, 0.4);
  rim.position.set(-3, 2, -2);
  scene.add(rim);

  // Пол убран (по просьбе, после серии багов с проваливанием/парением на
  // разных танцевальных клипах — без видимой опорной поверхности эти
  // расхождения в несколько мм/см между клипами просто не видны на экране,
  // а гоняться за идеальной синхронизацией дальше не имеет смысла).

  // Раньше здесь была placeholder-капсула (синий "leo" из CapsuleGeometry),
  // видимая, пока грузился персонаж — давала эффект "заморозки": капсула,
  // потом T-поза персонажа на секунду, и только через ~2с реальный Idle.
  // Заменена на HTML/CSS-оверлей загрузки поверх сцены (см. index.html
  // #scene-loading, скрывается в main.js ровно в момент, когда персонаж
  // реально готов — со всеми танцами, не только своим первым клипом).
  const placeholder = new THREE.Object3D(); // пустышка для обратной совместимости API ниже

  // OrbitControls — включены всегда (раньше были только за ?debug).
  // Ограничение по вертикали: camera может уходить сверху (над
  // персонажами) вплоть до вида точно сверху вниз (minPolarAngle=0), но
  // никогда не опускается ниже уровня их глаз (maxPolarAngle=90°) — то
  // есть "вокруг и сверху, но не снизу", как просили. Панорамирование
  // выключено (enablePan=false), чтобы нельзя было случайно "укатить"
  // камеру и потерять персонажей из виду вообще — крутить и
  // приближать/отдалять можно, двигать центр вращения нельзя.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI / 2;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.6; // помедленнее дефолтных 2 — плавнее

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    // Защита от 0×0 (например, во время layout-переходов, пока
    // #scene-container временно не получил реальный размер) — w/0 даёт
    // Infinity, портит матрицу проекции; renderer.setSize(w, 0) даёт
    // канвас нулевого размера, на котором дальше падает drawImage в
    // main.js (edge-blur слой). Просто ничего не делаем в этом кадре —
    // подождём следующего resize() с нормальными числами.
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  window.addEventListener("resize", resize);
  // ВАЖНО: renderer.setSize() прописывает style.width/height канваса
  // ИНЛАЙН-СТИЛЕМ в пикселях (не через %) — побеждает любой CSS. window
  // 'resize' срабатывает только на реальное изменение размера окна, а не
  // на изменение layout из-за соседних элементов (например, у #app —
  // flex-колонка, где #scene-container делит высоту с остальными
  // блоками; когда в #track-name-mobile появляется текст, контейнер
  // сцены становится ниже, а WebGL-канвас — нет, инлайн-стиль остаётся
  // старым размером). Раньше это давало рассинхрон: canvas размытия
  // контура (см. main.js) и canvas волны стилизованы через CSS % и
  // честно сжимались вместе с контейнером, а WebGL-канвас — нет,
  // получалась разная итоговая масштабировка одного и того же кадра
  // персонажа между слоями ("второй персонаж чуть выше", баг с
  // появлением названия трека на мобильном). ResizeObserver реагирует
  // на ЛЮБое изменение размера самого контейнера, независимо от
  // причины — универсальный фикс, не только для этого конкретного
  // триггера.
  //
  // ВАЖНО (история): пробовал сначала debounce (откладывать resize() на
  // фиксированные 80мс после последнего срабатывания) — не сработало
  // как задумано ПО ДВУМ причинам: 1) отдельно пробовал обновлять
  // camera.aspect немедленно, а renderer.setSize() — отложенно, но
  // camera.aspect — это ПРЕДПОЛОЖЕНИЕ О ФОРМЕ БУФЕРА, в который сейчас
  // рисуется кадр; обновлять одно без другого само по себе давало
  // рассинхрон (просто в новом месте, не убирало его). 2) сама фиксированная
  // задержка в 80мс была ЗАМЕТНА там, где никакой частой стрельбы
  // событий и не было изначально (например, кнопка масштаба сцены —
  // размер меняется одним мгновенным прыжком, не плавной CSS-анимацией)
  // — debounce добавлял искусственную задержку туда, где её вообще не
  // должно было быть. requestAnimationFrame-throttle ниже устраняет обе
  // проблемы: aspect и setSize всегда обновляются ВМЕСТЕ (не по
  // отдельности), а "схлопывание" частых срабатываний ограничено ОДНИМ
  // рендер-кадром (~16мс, незаметно), а не произвольной фиксированной
  // задержкой — для одиночного мгновенного ресайза это неотличимо от
  // немедленного вызова, а для потока частых событий (плавная
  // CSS-анимация шторки) всё равно схлопывает лишние вызовы до одного
  // на кадр.
  // resizeSuspended — для случая, когда throttle (раз в кадр) всё ещё
  // недостаточно: МЕДЛЕННОЕ, растянутое на секунды непрерывное
  // перетаскивание хендла шторки списка (не быстрый клик/переключение
  // кнопкой — там throttle справляется хорошо). При медленном движении
  // события изменения размера и так идут примерно раз за кадр — throttle
  // почти ничего не убирает, дорогая renderer.setSize() продолжает
  // вызываться на каждом кадре ВСЁ ВРЕМЯ перетаскивания (может быть
  // несколько секунд, не 0.25s разовой анимации) — заметное мигание.
  // Пока resizeSuspended=true — буфер вообще не трогаем, персонаж
  // остаётся при тех пропорциях, что были на момент начала
  // перетаскивания (лёгкое, но плавное несоответствие форме — не
  // мигание). Один точный финальный resize() — сразу по окончании
  // перетаскивания (см. setResizeSuspended, вызывается из main.js на
  // pointerup хендла).
  let resizeSuspended = false;
  function setResizeSuspended(suspended) {
    resizeSuspended = suspended;
    if (!suspended) resize();
  }

  if (typeof ResizeObserver !== "undefined") {
    let resizeRafPending = false;
    const throttledResize = () => {
      if (resizeSuspended) return;
      if (resizeRafPending) return;
      resizeRafPending = true;
      requestAnimationFrame(() => {
        resizeRafPending = false;
        resize();
      });
    };
    new ResizeObserver(throttledResize).observe(container);
  }

  return { scene, camera, renderer, placeholder, controls, resize, setResizeSuspended };
}

/**
 * Phase 4: загрузка отдельного файла с анимациями (Universal Animation Library).
 * Персонаж и анимации — РАЗНЫЕ GLB, но используют один и тот же Universal rig,
 * поэтому клипы можно проигрывать на mixer'е персонажа напрямую (bone names совпадают).
 * Меш из этого файла нам не нужен — в сцену ничего не добавляем, только клипы.
 *
 * @param {string} url
 * @returns {Promise<THREE.AnimationClip[]>}
 */
export function loadAnimationClips(url = "assets/animations/UAL1_Standard.glb") {
  const loader = new GLTFLoader();

  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        const clips = gltf.animations || [];
        console.log(`Available animations (${clips.length}):`);
        clips.forEach((clip) => console.log(`  - ${clip.name}`));
        resolve(clips);
      },
      undefined,
      (error) => {
        console.warn(`[scene] Не удалось загрузить анимации из "${url}".`, error);
        resolve([]);
      }
    );
  });
}

/**
 * Phase 2 + 3: загрузка GLB-персонажа и вывод списка реальных animation clips.
 *
 * ВАЖНО (ТЗ п.4, п.11): архитектура не привязана к имени персонажа/анимаций.
 * Путь — единственное, что "знает" код. Имена клипов узнаём только
 * из console.log после первой загрузки — дальше их пропишем в animationMap.
 *
 * @param {THREE.Scene} scene
 * @param {string} url - путь к GLB, по умолчанию assets/character/character.glb
 * @returns {Promise<{ model: THREE.Object3D, animations: THREE.AnimationClip[], mixer: THREE.AnimationMixer } | null>}
 *          null, если GLB не найден/не загрузился — вызывающий код остаётся на placeholder.
 */
export function loadCharacter(
  scene,
  url = "assets/character/Superhero_Male_FullBody.gltf"
) {
  const loader = new GLTFLoader();

  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });

        scene.add(model);

        const animations = gltf.animations || [];
        const mixer = new THREE.AnimationMixer(model);

        // Требование ТЗ п.11 — вывести реальные имена клипов
        console.log("Available animations:");
        if (animations.length === 0) {
          console.log("  (none found in this GLB)");
        } else {
          animations.forEach((clip) => console.log(`  - ${clip.name}`));
        }

        resolve({ model, animations, mixer });
      },
      undefined,
      (error) => {
        console.warn(
          `[scene] Не удалось загрузить персонажа из "${url}" — остаёмся на placeholder.`,
          error
        );
        resolve(null);
      }
    );
  });
}

/**
 * Чинит "текущие" хвосты/довески без своей кости в скелете.
 *
 * Диагностика (сделана вручную разбором бинарных FBX обоих персонажей):
 * у Mixamo-риггинга нет отдельной кости для хвоста — веса вершин хвоста
 * автоматически размазываются по ближайшим костям скелета, и у разных
 * персонажей это РАЗНЫЕ кости в зависимости от того, как хвост уложен в
 * T-позе:
 *   - у енота хвост лежит у основания спины → мешает нога (Hips/UpLeg)
 *   - у белки хвост загнут вверх через спину, к плечу → мешают рука,
 *     плечо и шея (Spine2/LeftArm/LeftShoulder/Neck) — куда более
 *     подвижные кости в танце, поэтому и "плавало" сильнее
 *
 * Поэтому функция принимает НАБОР правил, а не одно — каждое правило
 * применяется независимо, ничего не ломая, если у персонажа такого
 * сочетания костей просто нет (fixedCount будет 0 для нерелевантных правил).
 *
 * Правило: если у вершины есть значимый вес и на dominantHint-кости
 * (обычно ближайшая стабильная кость туловища), и на любой из
 * contaminantHints-костей одновременно — жёстко разрешаем спор в пользу
 * dominantHint, независимо от того, что там сейчас перевешивает.
 */
function rigidifyContaminatedSkinWeights(root, rules) {
  root.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const boneNames = node.skeleton.bones.map((b) => b.name);
    const skinIndexAttr = node.geometry.attributes.skinIndex;
    const skinWeightAttr = node.geometry.attributes.skinWeight;
    if (!skinIndexAttr || !skinWeightAttr) return;

    for (const rule of rules) {
      const { dominantHint, contaminantHints, minWeight = 0.02 } = rule;
      const dominantIndex = boneNames.findIndex((n) => n.includes(dominantHint));
      if (dominantIndex === -1) continue;

      const contaminantIndexSet = new Set(
        boneNames
          .map((n, i) => (contaminantHints.some((hint) => n.includes(hint)) ? i : -1))
          .filter((i) => i !== -1)
      );
      if (contaminantIndexSet.size === 0) continue;

      let fixedCount = 0;
      for (let i = 0; i < skinIndexAttr.count; i++) {
        const idx = [
          skinIndexAttr.getX(i),
          skinIndexAttr.getY(i),
          skinIndexAttr.getZ(i),
          skinIndexAttr.getW(i),
        ];
        const w = [
          skinWeightAttr.getX(i),
          skinWeightAttr.getY(i),
          skinWeightAttr.getZ(i),
          skinWeightAttr.getW(i),
        ];

        let hasDominant = false;
        let hasContaminant = false;
        for (let k = 0; k < 4; k++) {
          if (idx[k] === dominantIndex && w[k] > minWeight) hasDominant = true;
          if (contaminantIndexSet.has(idx[k]) && w[k] > minWeight) hasContaminant = true;
        }

        if (hasDominant && hasContaminant) {
          skinIndexAttr.setXYZW(i, dominantIndex, 0, 0, 0);
          skinWeightAttr.setXYZW(i, 1, 0, 0, 0);
          fixedCount++;
        }
      }

      if (fixedCount > 0) {
        console.log(
          `[scene] rigidifyContaminatedSkinWeights: зафиксировано ${fixedCount} вершин ` +
            `на "${boneNames[dominantIndex]}" (мешавшие кости: ${contaminantHints.join("/")})`
        );
      }
    }

    skinIndexAttr.needsUpdate = true;
    skinWeightAttr.needsUpdate = true;
  });
}

// Набор правил "с запасом" — каждое применяется независимо и безвредно для
// персонажей, у которых такого сочетания костей нет. Новых персонажей с
// другими вариантами укладки хвоста можно добавлять сюда же новым правилом.
//
// ВАЖНО (найдено сравнением скриншотов из старых сборок с идентичным FBX-
// файлом, но разным кодом): правило "Spine2 vs LeftArm/LeftShoulder/Neck"
// раньше рвало и НАСТОЯЩУЮ анатомию шеи — если у реальной шеи есть
// небольшая законная примесь Spine2 (обычное дело для гладкого сгиба на
// стыке шея-корпус), это правило принудительно переключало такую вершину
// на 100% Spine2, создавая видимое растяжение/тёмное пятно на шее. У белки
// хвост теперь чинится на уровне самого FBX-файла (аккуратный перенос
// весов, см. README) — этот рантайм-патч для неё больше не нужен и только
// вредит. Оставлено только правило для енота (Hips/UpLeg), которое не
// вызывало подобных жалоб.
// Правило-заплатка для контаминации хвоста у ОСНОВАНИЯ (Hips/UpLeg) —
// изначально применялось глобально ко всем персонажам через
// rigidifyContaminatedSkinWeights(), из-за чего молча выполнялось и на
// белке тоже, хотя было задумано только для енота (у него хвост никогда
// не чинился на уровне файла — только этим рантайм-патчем). У белки хвост
// теперь полностью пересчитан на уровне самого FBX-файла (см. README) —
// давать вдобавок ещё и этому правилу трогать её веса при каждой загрузке
// было явной ошибкой: оно могло переписывать корректные веса на уже
// исправленных вершинах прямо в браузере, сводя на нет файловый перенос.
// Теперь правило передаётся ЯВНО, per-character, через tailFixRules в
// main.js — только для енота, не глобально.
export const RACCOON_TAIL_FIX_RULES = [
  { dominantHint: "Hips", contaminantHints: ["UpLeg"] },
];

/**
 * FBX-версии loadCharacter/loadAnimationClips — для персонажей и анимаций с
 * Mixamo (у них свой скелет, не Quaternius Universal, поэтому смешивать
 * FBX-клипы с UAL1_Standard.glb напрямую нельзя — либо то, либо другое для
 * ОДНОГО персонажа, всё остальное в архитектуре не меняется: тот же
 * animationMap-слой конфигурации, тот же AnimationMixer, тот же reactToAudio).
 *
 * Mixamo экспортирует "With Skin" (меш+скелет, аналог loadCharacter) и
 * "Without Skin" (только клип, аналог loadAnimationClips) — ровно то же
 * разделение, что у нас уже было для Quaternius.
 */
export function loadCharacterFBX(
  scene,
  url,
  { scale = "auto", targetHeight = 1.5, clipName = null, tailFixRules = [] } = {}
) {
  // ВАЖНО (баг с "белка стала крупнее" после Blender-фикса хвоста):
  // масштаб больше НЕ считается здесь, сразу после загрузки. Раньше scale
  // мерился по bounding box модели в её статичной default-позе — но эта
  // default-поза зависит от того, ЧТО именно записано в Model-узлах FBX как
  // базовые Lcl Rotation костей, а это отличается между экспортёрами:
  // оригинальный файл хранил чистую T-позу (руки в стороны, все Lcl
  // Rotation = 0, только PreRotation), а Blender-экспорт вместо T-позы
  // впекает в те же поля уже позу Idle (руки вдоль тела) как "статику".
  // У T-позы и Idle-позы РАЗНЫЙ силуэт и разная высота bounding box — не
  // потому что тело физически другого роста, а потому что руки/спина стоят
  // иначе. Мерить рост персонажа по этой позе — угадывать наугад, какая
  // именно поза досталась от конкретного экспортёра.
  //
  // Поэтому: если scale === "auto", сюда приходит null (масштаб ещё не
  // выбран) — вызывающий код (main.js) обязан сам вызвать
  // measureAndApplyAutoScale() ПОСЛЕ того, как mixer хотя бы раз обновится
  // с уже играющей анимацией idle (та же поза, что использует
  // groundAndCenterModel — единый источник истины для "какая поза
  // считается настоящим ростом персонажа").
  const loader = new FBXLoader();

  return new Promise((resolve) => {
    loader.load(
      url,
      (fbx) => {
        // Защита на будущее — ПЕРВЫМ делом, до расчёта габаритов для
        // масштаба ниже: если исходный FBX содержит встроенные Light/Camera
        // (например, кто-то экспортировал персонажа из Blender с включёнными
        // этими типами объектов в диалоге экспорта — ровно так и было с
        // этим самым файлом, конкретно с интенсивностью 100000 на точечном
        // источнике) — FBXLoader создаёт из них настоящие THREE.Light/
        // THREE.Camera и добавляет в граф объекта. У нас уже есть своё
        // освещение и своя камера (см. выше в этом файле) — чужие лишние
        // источники света складывались бы с нашими, забивая сцену и давая
        // непредсказуемые тени. Убираем до всех остальных вычислений, а не
        // после — на случай если что-то ниже (например, расчёт bounding
        // box) окажется чувствительно к их присутствию в графе.
        const stray = [];
        fbx.traverse((node) => {
          if (node.isLight || node.isCamera) stray.push(node);
        });
        stray.forEach((node) => {
          console.warn(`[scene] Убран встроенный ${node.type} из FBX-файла ("${node.name}") — используем только своё освещение/камеру.`);
          node.parent?.remove(node);
        });

        fbx.updateMatrixWorld(true);

        // Если scale передан явно числом (не "auto") — применяем сразу,
        // как и раньше, без всякой зависимости от позы. "auto" оставляем
        // как есть (scale=1 по умолчанию у THREE.Object3D) — реальный
        // расчёт произойдёт позже, в measureAndApplyAutoScale(), после
        // первого кадра Idle (см. комментарий выше и в main.js).
        if (scale !== "auto") {
          fbx.scale.setScalar(scale);
          fbx.updateMatrixWorld(true);
        }

        // ВАЖНО: постановку на пол/центрирование здесь НЕ делаем — на этом
        // этапе меш ещё в статичной default-позе экспортёра (не обязательно
        // T-поза, см. комментарий выше про Blender), а не в первом кадре
        // реальной анимации (Idle). Если посчитать позицию сейчас,
        // а анимация потом сдвинет корневую кость (Hips) на кадре 1 —
        // получится видимый "телепорт" в первую же секунду. Постановка на
        // пол происходит в groundAndCenterModel() ПОСЛЕ того, как mixer
        // хотя бы раз обновится с уже играющей анимацией (см. main.js).

        fbx.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
            // Явно проставляем colorSpace на цветовых текстурах — известный
            // частый подвох Three.js: если diffuse-текстура (обычный JPEG/PNG
            // фотоснимок) не помечена как SRGBColorSpace, рендерер трактует
            // уже гамма-кодированные цвета как линейные — картинка выглядит
            // тусклой/смытой, а тёмные пиксели (например, чёрные зрачки)
            // сдвигаются к серому вместо чёрного. FBXLoader не всегда
            // проставляет это автоматически — не полагаемся на угадывание.
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach((mat) => {
              if (mat?.map) {
                mat.map.colorSpace = THREE.SRGBColorSpace;
                // FBX хранит старый Phong-стиль DiffuseColor (у этого файла —
                // (0.8, 0.8, 0.8), не чистый белый), и FBXLoader переносит его
                // в material.color. Three.js перемножает color × map — если
                // color не белый (1,1,1), вся текстура тонируется в серый и
                // теряет насыщенность/контраст (проверено — сама текстура при
                // прямом просмотре яркая, с чёрными глазами, проблема именно
                // в этом умножении). Раз есть полноценная цветная текстура,
                // она должна быть единственным источником цвета.
                mat.color.setRGB(1, 1, 1);
              }
            });
          }
        });

        rigidifyContaminatedSkinWeights(fbx, tailFixRules);

        scene.add(fbx);

        // Лог финального scale теперь печатает measureAndApplyAutoScale()
        // (если scale==="auto") или остаётся немым при явном числовом scale
        // (некому и незачем логировать константу).
        if (scale !== "auto") {
          console.log(`[scene] FBX персонаж: применён явный scale=${scale}`);
        }

        const animations = fbx.animations || [];
        // ВАЖНО: Mixamo называет анимацию внутри файла буквально "mixamo.com"
        // — одинаково для ЛЮБОГО скачанного клипа, независимо от того, что
        // выбрано в интерфейсе. Если не переименовать, все клипы из разных
        // файлов схлопнутся в одно имя и будут перезаписывать друг друга
        // в animationMap. Переименовываем по имени файла/явно переданному clipName.
        if (clipName && animations[0]) animations[0].name = clipName;

        const mixer = new THREE.AnimationMixer(fbx);

        console.log("Available animations (FBX):");
        if (animations.length === 0) {
          console.log("  (none found in this FBX)");
        } else {
          animations.forEach((clip) => console.log(`  - ${clip.name}`));
        }

        resolve({ model: fbx, animations, mixer });
      },
      undefined,
      (error) => {
        console.warn(`[scene] Не удалось загрузить FBX-персонажа из "${url}".`, error);
        resolve(null);
      }
    );
  });
}

/**
 * Меряет реальный рост персонажа и применяет масштаб — ВЫЗЫВАТЬ ПОСЛЕ того,
 * как mixer хотя бы раз обновился с уже играющей анимацией idle (mixer.
 * update(0) после animController.play("idle")), ДО groundAndCenterModel().
 *
 * Почему не сразу после загрузки (как было раньше, см. историю бага
 * "белка стала крупнее" после Blender-фикса хвоста): рост, посчитанный по
 * статичной default-позе экспортёра, зависит от того, ЧТО в этой позе —
 * T-поза (руки в стороны) или уже поза Idle (руки вдоль тела), а это
 * отличается между экспортёрами (родной Mixamo-экспорт vs Blender). У
 * T-позы и Idle-позы физически разный силуэт bounding box, хотя реальный
 * рост тела один и тот же — мерить по default-позе значит зависеть от
 * случайности того, какую именно позу записал конкретный экспортёр.
 * Измерение после первого кадра idle убирает эту зависимость раз и
 * навсегда — всегда меряем ту самую позу, что реально видит пользователь.
 *
 * Если scale не "auto" (передан явно числом в loadCharacterFBX) — эта
 * функция вызывать не нужна, scale уже применён внутри loadCharacterFBX.
 *
 * @param {THREE.Object3D} model
 * @param {number} targetHeight - целевой рост в метрах
 * @returns {number} применённый scale
 */
export function measureAndApplyAutoScale(model, targetHeight = 1.5) {
  // Сбрасываем scale перед измерением — иначе повторный вызов (например,
  // при пересчёте масштаба в Duet для уже загруженного персонажа) мерил
  // бы box уже отмасштабированной модели и задвоил бы эффект. С этим
  // сбросом функция безопасно вызывается сколько угодно раз подряд.
  model.scale.setScalar(1);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);

  const scale = targetHeight / (size.y || 1);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  console.log(
    `[scene] Масштаб по позе Idle (не default-позе экспортёра): рост ${size.y.toFixed(3)} ед. → scale=${scale.toFixed(5)}`
  );

  return scale;
}

/**
 * Компенсирует перспективный "разворот" персонажа, который смещён от
 * центра сцены (Duet — камера всегда смотрит в общий центр (0, 0.95, 0),
 * а не персонально в каждого персонажа, из-за чего при смещении в сторону
 * персонаж физически виден под углом, а не анфас — простая тригонометрия
 * фиксированной камеры, глядящей в одну точку на двух разнесённых людей).
 *
 * Довора­чивает модель вокруг Y так, чтобы её "перёд" снова смотрел точно
 * на камеру, как в соло (offsetX=0, угол компенсации = 0, ничего не
 * меняется). Знак и величина посчитаны из реальной геометрии камеры —
 * если камера когда-нибудь передвинется, cameraZ нужно передать актуальный.
 *
 * @param {THREE.Object3D} model
 * @param {number} offsetX - тот же сдвиг, что уже передан в groundAndCenterModel
 * @param {number} cameraZ - позиция камеры по Z (см. camera.position.set в main.js)
 */
export function faceCameraCompensated(model, offsetX, cameraZ = 5.0) {
  model.rotation.y = Math.atan2(-offsetX, cameraZ);
}

/**
 * Ставит персонажа на пол и центрирует по X/Z — вызывать ПОСЛЕ того как
 * mixer хотя бы раз обновился с уже играющей анимацией (иначе меряем
 * bind-позу, а не то, что реально будет на экране — см. комментарий в
 * loadCharacterFBX про "телепорт" в первую секунду).
 *
 * ПРИМЕЧАНИЕ: пол убран из сцены (см. createScene) после серии багов с
 * проваливанием/парением персонажа на разных танцевальных клипах — без
 * видимой опорной поверхности расхождение в несколько мм/см между клипами
 * просто не видно на экране, поэтому вернули простую версию без запаса
 * по высоте и без динамической коррекции.
 *
 * @param {number} offsetX - сдвиг после центрирования, для режима Duet
 * (два персонажа рядом, не друг в друге). 0 — обычное сольное центрирование.
 */
export function groundAndCenterModel(model, offsetX = 0) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  box.getCenter(center);

  model.position.x -= center.x - offsetX;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  console.log(
    `[scene] Персонаж поставлен на место: y-offset=${(-box.min.y).toFixed(3)}, ` +
      `центрирован по X/Z (было смещение ${center.x.toFixed(2)}, ${center.z.toFixed(2)}), offsetX=${offsetX}`
  );
}

/**
 * Освобождает GPU-ресурсы (геометрия/материалы/текстуры) объекта перед его
 * удалением со сцены — нужно при переключении персонажей, иначе память
 * будет копиться с каждым переключением (Three.js сам не освобождает GPU
 * буферы по сборщику мусора JS, только по explicit dispose()).
 */
export function disposeObject3D(root) {
  root.traverse((node) => {
    if (node.isMesh) {
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (!material) return;
        Object.values(material).forEach((value) => {
          if (value && value.isTexture) value.dispose();
        });
        material.dispose();
      });
    }
  });
}

export function loadAnimationClipsFBX(url, { clipName = null } = {}) {
  const loader = new FBXLoader();

  return new Promise((resolve) => {
    loader.load(
      url,
      (fbx) => {
        const clips = fbx.animations || [];
        // См. комментарий в loadCharacterFBX — та же причина переименования.
        if (clipName && clips[0]) clips[0].name = clipName;
        console.log(`Available animations (FBX, ${clips.length}):`);
        clips.forEach((clip) => console.log(`  - ${clip.name}`));
        resolve(clips);
      },
      undefined,
      (error) => {
        console.warn(`[scene] Не удалось загрузить FBX-анимации из "${url}".`, error);
        resolve([]);
      }
    );
  });
}

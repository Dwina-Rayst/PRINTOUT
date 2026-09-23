import * as THREE from "three";
import { CONFIG } from "./config.js";
import { PrintoutUser, offlineSaveBestFloor, API_BASE } from "./auth.js";

/* ============================================================
   전역 상태
============================================================ */
const state = {
  floor: 1,
  running: false,
  paused: false,
  bossActive: null,      // 'mid' | 'final' | null
  clock: new THREE.Clock(),
  keys: {},
  yaw: 0,
  pitch: -0.15,
  pointerLocked: false,
  lastAttackTime: -999,
  inventoryOpen: false,
  phoneUnlocked: false,
  phoneFirstOpen: true,
  firstItemFound: false,
  centipedeGraceUntil: 0, // 이 시간까지는 3D펜 지네가 움직이지 않음
  graceEndedNotified: false,
};

const player = {
  hp: CONFIG.PLAYER.startHp,
  maxHp: CONFIG.PLAYER.maxHp,
  def: CONFIG.PLAYER.baseDefense,
  atk: CONFIG.PLAYER.baseAttack,
  weaponName: "맨손",
  armorPickups: 0,
  poisonStacks: [], // {dmg, remaining, nextTick}
};

/* ============================================================
   THREE 기본 셋업
============================================================ */
const canvas = document.getElementById("game-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
// 전체 밝기 마스터 스위치 -----------------------------------------
// useLegacyLights=true 이면 아래 조명들의 intensity 숫자가 물리단위(칸델라) 대신
// 예전 방식(작은 숫자=충분히 밝음)으로 계산되어 다루기 쉬워집니다.
renderer.useLegacyLights = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4; // ★가장 간단한 전체 밝기 조절: 이 숫자를 0.5~3 사이로 바꿔보세요

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0a10, 0.028); // 밝기 조절: 두번째 값(밀도)을 낮출수록 멀리까지 보임

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200);

function resize(){
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

/* 플레이어 아바타 (3인칭이므로 직접 보임) */
const playerGroup = new THREE.Group();
function buildAvatar(gender){
  const g = new THREE.Group();
  const skinColor = gender === "female" ? 0xd9a688 : 0xc79a7a;
  const outfitColor = gender === "female" ? 0x7a3b5e : 0x2e3a52;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.9, 4, 8),
    new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.8 })
  );
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 12),
    new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 })
  );
  head.position.y = 1.65;
  head.castShadow = true;
  g.add(body, head);
  return g;
}
scene.add(playerGroup);

/* 손전등(플레이어 부착 조명) - 어둠 속 공포 분위기 */
const flashlight = new THREE.SpotLight(0xffe8c0, 5.5, 32, Math.PI / 5, 0.5, 1.4); // 밝기 조절: 2번째 값(강도), 3번째 값(사거리)
flashlight.castShadow = false;
playerGroup.add(flashlight);
const flashTarget = new THREE.Object3D();
playerGroup.add(flashTarget);
flashlight.target = flashTarget;

scene.add(new THREE.AmbientLight(0x3a3a45, 1.1)); // 밝기 조절: 2번째 값(강도) 0~2 사이로 조절
scene.add(new THREE.HemisphereLight(0x40404f, 0x0a0a08, 0.6)); // 위(하늘색)/아래(바닥색) 은은한 보조광

/* ============================================================
   입력 처리
============================================================ */
addEventListener("keydown", (e) => {
  state.keys[e.code] = true;
  if (e.code === "KeyI") toggleInventory();
  if (e.code === "KeyF") tryInteract();
});
addEventListener("keyup", (e) => { state.keys[e.code] = false; });

canvas.addEventListener("click", () => {
  if (state.running && !state.inventoryOpen) canvas.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
  state.pointerLocked = document.pointerLockElement === canvas;
});
addEventListener("mousemove", (e) => {
  if (!state.pointerLocked) return;
  state.yaw -= e.movementX * 0.0022;
  state.pitch -= e.movementY * 0.0018;
  state.pitch = Math.max(-0.9, Math.min(0.6, state.pitch));
});
addEventListener("mousedown", (e) => {
  if (e.button === 0 && state.running && state.pointerLocked) meleeAttack();
});

/* ============================================================
   층 관리 (월드 오브젝트)
============================================================ */
let floorGroup = new THREE.Group();
scene.add(floorGroup);
let enemies = [];       // {mesh, type, hp, def, atk, speed, behavior, lastHit, ...}
let projectiles = [];   // 잉크 프린터 종이 투사체
let itemSpawns = [];    // {mesh, pos, collected, def}
let stairsMesh = null;
let bossEntity = null;

const ROOM_SIZE = 34;

function clearFloor(){
  while (floorGroup.children.length) floorGroup.remove(floorGroup.children[0]);
  enemies = [];
  projectiles = [];
  itemSpawns = [];
  stairsMesh = null;
  bossEntity = null;
}

function wallMat(seed){
  // 밝기 조절: 마지막 숫자(lightness, 0~1)를 높일수록 벽이 밝아짐
  const c = new THREE.Color().setHSL(0.06 + (seed % 5) * 0.005, 0.15, 0.16 + (seed % 3) * 0.015);
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0.05 });
}

function buildRoom(floorNum){
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x22201c, roughness: 1 }); // 밝기 조절: 색상 hex를 더 밝게(예: 0x33302a)
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x151412, roughness: 1 });
  const wMat = wallMat(floorNum);

  const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  floorGroup.add(floorMesh);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 5.5;
  floorGroup.add(ceil);

  const wallH = 5.5;
  const positions = [
    [0, wallH / 2, -ROOM_SIZE / 2, 0],
    [0, wallH / 2, ROOM_SIZE / 2, Math.PI],
    [-ROOM_SIZE / 2, wallH / 2, 0, Math.PI / 2],
    [ROOM_SIZE / 2, wallH / 2, 0, -Math.PI / 2],
  ];
  positions.forEach(([x, y, z, ry]) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_SIZE, wallH), wMat);
    wall.position.set(x, y, z);
    wall.rotation.y = ry;
    wall.receiveShadow = true;
    floorGroup.add(wall);
  });

  // 잡동사니(고물) 더미 - 아이템이 그 사이 숨겨져 있음
  const clutterCount = 10 + Math.floor(Math.random() * 6);
  const clutterMat = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 1 });
  const clutterSpots = [];
  for (let i = 0; i < clutterCount; i++) {
    const cx = (Math.random() - 0.5) * (ROOM_SIZE - 6);
    const cz = (Math.random() - 0.5) * (ROOM_SIZE - 6);
    if (Math.hypot(cx, cz) < 3) continue;
    const size = 0.6 + Math.random() * 0.9;
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.8, size), clutterMat);
    box.position.set(cx, size * 0.4, cz);
    box.rotation.y = Math.random() * Math.PI;
    box.castShadow = true;
    box.receiveShadow = true;
    floorGroup.add(box);
    clutterSpots.push(new THREE.Vector3(cx, 0.4, cz));
  }

  // 계단 (다음 층으로)
  const stairsGroup = new THREE.Group();
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9, emissive: 0x110800, emissiveIntensity: 0.15 });
  for (let i = 0; i < 8; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 0.9), stepMat);
    step.position.set(0, i * 0.3, -i * 0.9);
    stairsGroup.add(step);
  }
  const corner = ROOM_SIZE / 2 - 3;
  stairsGroup.position.set(corner, 0, corner);
  stairsGroup.rotation.y = Math.PI * 0.8;
  floorGroup.add(stairsGroup);
  stairsMesh = stairsGroup;

  return clutterSpots;
}

function spawnItem(pos, forcedFirst){
  let category, def;
  if (forcedFirst) {
    category = "weapon";
    def = CONFIG.WEAPONS.find(w => w.fixed);
  } else {
    const r = Math.random();
    if (r < CONFIG.ITEM_SPAWN.weapon) category = "weapon";
    else if (r < CONFIG.ITEM_SPAWN.weapon + CONFIG.ITEM_SPAWN.armor) category = "armor";
    else category = "food";
    const pool = category === "weapon" ? CONFIG.WEAPONS.filter(w => !w.fixed)
               : category === "armor" ? CONFIG.ARMORS : CONFIG.FOODS;
    def = weightedPick(pool);
  }
  const colorMap = { weapon: 0xcc4444, armor: 0x4477cc, food: 0x55aa55 };
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28, 0),
    new THREE.MeshStandardMaterial({ color: colorMap[category], emissive: colorMap[category], emissiveIntensity: 0.25, roughness: 0.6 })
  );
  mesh.position.copy(pos);
  mesh.position.y = 0.5;
  floorGroup.add(mesh);
  itemSpawns.push({ mesh, category, def, collected: false });
}

function weightedPick(pool){
  const total = pool.reduce((s, p) => s + p.rarity, 0);
  let r = Math.random() * total;
  for (const p of pool) { r -= p.rarity; if (r <= 0) return p; }
  return pool[0];
}

/* ---- 3D펜 지네 생성 ---- */
function buildCentipede(){
  const g = new THREE.Group();
  const segMat = new THREE.MeshStandardMaterial({ color: 0x2e6b3e, roughness: 0.5, metalness: 0.3 });
  const segCount = 6;
  for (let i = 0; i < segCount; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.35, 8), segMat);
    seg.rotation.z = Math.PI / 2;
    seg.position.x = -i * 0.32;
    g.add(seg);
    // 다리 15쌍(30개) 표현 - 세그먼트마다 다리 스텁 배치
    const legPairsPerSeg = Math.ceil(CONFIG.CENTIPEDE.legPairs / segCount);
    for (let s = 0; s < legPairsPerSeg; s++) {
      [-1, 1].forEach((side) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), segMat);
        leg.position.set(-i * 0.32, -0.1, side * 0.18);
        leg.rotation.x = side * 0.6;
        g.add(leg);
      });
    }
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 0.25;
  g.add(tip);
  g.position.y = 0.3;
  g.scale.setScalar(1.1);
  return g;
}

function buildGenericMonster(def){
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color || 0x333333, roughness: 0.6, metalness: 0.4, emissive: def.color || 0x000000, emissiveIntensity: 0.08 });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), mat);
  body.position.y = 0.6;
  g.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  eye.position.set(0, 0.7, 0.45);
  g.add(eye);
  return g;
}

function spawnEnemiesForFloor(floorNum, clutterSpots){
  if (floorNum === CONFIG.MID_BOSS_FLOOR || floorNum === CONFIG.FINAL_BOSS_FLOOR) return; // 보스 층은 별도 처리

  const count = floorNum === 1 ? CONFIG.CENTIPEDE.spawnCountFirstFloor
              : Math.min(15, 5 + Math.floor(floorNum / 150));
  for (let i = 0; i < count; i++) {
    const mesh = buildCentipede();
    placeAwayFromCenter(mesh);
    floorGroup.add(mesh);
    enemies.push({
      mesh, type: "pen_centipede",
      hp: CONFIG.CENTIPEDE.hp, def: CONFIG.CENTIPEDE.defense, atk: CONFIG.CENTIPEDE.attack,
      speed: CONFIG.CENTIPEDE.speed, poison: true, lastHit: -999, mult: 1,
    });
  }

  // 층 구간별 추가 몬스터
  CONFIG.MONSTERS.forEach((m) => {
    if (floorNum >= m.minFloor && Math.random() < 0.55) {
      const num = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < num; i++) {
        const mesh = buildGenericMonster(m);
        placeAwayFromCenter(mesh);
        floorGroup.add(mesh);
        enemies.push({ mesh, type: m.id, hp: m.hp, def: m.defense, atk: m.attack, speed: m.speed, poison: false, lastHit: -999, mult: 1, behavior: m.behavior });
      }
    }
  });

  // 아이템 스폰
  if (floorNum === 1) {
    spawnItem(clutterSpots[0] || new THREE.Vector3(3, 0, 3), true);
  } else if (clutterSpots.length) {
    const spot = clutterSpots[Math.floor(Math.random() * clutterSpots.length)];
    spawnItem(spot, false);
  }
}

function placeAwayFromCenter(mesh){
  let x, z;
  do {
    x = (Math.random() - 0.5) * (ROOM_SIZE - 6);
    z = (Math.random() - 0.5) * (ROOM_SIZE - 6);
  } while (Math.hypot(x, z) < 6);
  mesh.position.set(x, mesh.position.y, z);
}

/* ============================================================
   보스: 잉크 프린터 (2222층)
============================================================ */
function setupMidBoss(){
  clearFloor();
  buildRoom(CONFIG.MID_BOSS_FLOOR);
  stairsMesh.visible = false;

  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4, emissive: 0x220000, emissiveIntensity: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2, 1.6), mat);
  body.position.y = 1.2;
  g.add(body);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  slot.position.set(0, 2.25, 0);
  g.add(slot);
  g.position.set(0, 0, -10);
  floorGroup.add(g);

  bossEntity = {
    mesh: g, name: CONFIG.MID_BOSS.name,
    hp: CONFIG.MID_BOSS.hp, maxHp: CONFIG.MID_BOSS.hp, def: CONFIG.MID_BOSS.defense, atk: CONFIG.MID_BOSS.attack,
    nextFire: state.clock.getElapsedTime() + 2, kind: "mid",
  };
  playerGroup.position.set(0, 0, 10);
  showBossHud(bossEntity.name);
  state.bossActive = "mid";
}

function makePaperTexture(nameText, percent){
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f2f2f2"; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = "#b30000"; ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(nameText, 128, 50);
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(`${percent}%`, 128, 95);
  return new THREE.CanvasTexture(c);
}

function fireInkPaper(boss, mult = 1){
  const percent = CONFIG.MID_BOSS.paperMinPercent + Math.random() * (CONFIG.MID_BOSS.paperMaxPercent - CONFIG.MID_BOSS.paperMinPercent);
  const tex = makePaperTexture(PrintoutUser.id || "PLAYER", Math.round(percent));
  const geo = new THREE.PlaneGeometry(0.6, 0.35);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(boss.mesh.position).add(new THREE.Vector3(0, 1.6, 0));
  floorGroup.add(mesh);
  const dir = new THREE.Vector3().subVectors(playerGroup.position, mesh.position).normalize();
  projectiles.push({ mesh, dir, speed: CONFIG.MID_BOSS.paperSpeed, dmgPercent: percent * mult, life: 5 });
}

/* ============================================================
   최종 보스: PRINTER (4444층)
============================================================ */
function setupFinalBoss(){
  clearFloor();
  buildRoom(CONFIG.FINAL_BOSS_FLOOR);
  stairsMesh.visible = false;

  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x111114, metalness: 0.8, roughness: 0.3, emissive: 0x550000, emissiveIntensity: 0.4 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 4.5, 8), mat);
  tower.position.y = 2.25;
  g.add(tower);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  eye.position.set(0, 3.2, 1.6);
  g.add(eye);
  g.position.set(0, 0, -12);
  floorGroup.add(g);

  bossEntity = {
    mesh: g, name: CONFIG.FINAL_BOSS.name,
    hp: CONFIG.FINAL_BOSS.hp, maxHp: CONFIG.FINAL_BOSS.hp, def: CONFIG.FINAL_BOSS.defense, atk: CONFIG.FINAL_BOSS.attack,
    nextSummon: 0, kind: "final",
  };
  playerGroup.position.set(0, 0, 10);
  state.bossActive = "final-dialogue";
  runFinalBossDialogue();
}

function runFinalBossDialogue(){
  const box = document.getElementById("toast-container");
  const lines = CONFIG.FINAL_BOSS.dialogue;
  let i = 0;
  const dialogueEl = document.createElement("div");
  dialogueEl.className = "phone-msg";
  dialogueEl.style.position = "fixed";
  dialogueEl.style.bottom = "80px";
  dialogueEl.style.left = "50%";
  dialogueEl.style.transform = "translateX(-50%)";
  dialogueEl.style.width = "min(600px,80vw)";
  dialogueEl.style.fontSize = "15px";
  dialogueEl.style.pointerEvents = "none";
  document.body.appendChild(dialogueEl);

  function showNext(){
    if (i >= lines.length) {
      dialogueEl.remove();
      state.bossActive = "final";
      bossEntity.nextSummon = state.clock.getElapsedTime() + 1;
      showBossHud(bossEntity.name);
      return;
    }
    dialogueEl.textContent = lines[i++];
    setTimeout(showNext, 2600);
  }
  showNext();
}

function summonFromBoss(){
  const pool = [
    { id: CONFIG.CENTIPEDE.id, hp: CONFIG.CENTIPEDE.hp, def: CONFIG.CENTIPEDE.defense, atk: CONFIG.CENTIPEDE.attack, speed: CONFIG.CENTIPEDE.speed, poison: true, isCentipede: true },
    ...CONFIG.MONSTERS.map(m => ({ id: m.id, hp: m.hp, def: m.defense, atk: m.attack, speed: m.speed, poison: false, monsterDef: m })),
    { id: "ink_printer_summon", hp: CONFIG.MID_BOSS.hp * 0.15, def: CONFIG.MID_BOSS.defense, atk: CONFIG.MID_BOSS.attack, speed: 0, poison: false, isInkPrinter: true },
  ];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const mult = CONFIG.FINAL_BOSS.summonStatMultiplier;

  if (pick.isInkPrinter) {
    // 잉크 프린터 소환 - 체력바 없음, 종이 투사체만 주기적으로 발사
    const mesh = buildGenericMonster({ color: 0x881111 });
    placeAwayFromCenter(mesh);
    floorGroup.add(mesh);
    enemies.push({ mesh, type: "ink_printer_summon", hp: pick.hp * mult, def: pick.def, atk: pick.atk * mult, speed: 0, poison: false, lastHit: -999, mult, isInkPrinter: true, nextFire: state.clock.getElapsedTime() + 2 });
    return;
  }
  const mesh = pick.isCentipede ? buildCentipede() : buildGenericMonster(pick.monsterDef);
  placeAwayFromCenter(mesh);
  floorGroup.add(mesh);
  enemies.push({
    mesh, type: pick.id, hp: pick.hp * mult, def: pick.def, atk: pick.atk * mult,
    speed: pick.speed, poison: pick.poison, lastHit: -999, mult,
  });
}

function showBossHud(name){
  document.getElementById("boss-hud").classList.remove("hidden");
  document.getElementById("boss-name").textContent = name;
}
function hideBossHud(){
  document.getElementById("boss-hud").classList.add("hidden");
}

/* ============================================================
   층 전환
============================================================ */
function goToFloor(n){
  state.floor = n;
  state.bossActive = null;
  hideBossHud();
  clearFloor();

  if (n === CONFIG.MID_BOSS_FLOOR) { setupMidBoss(); updateHud(); return; }
  if (n === CONFIG.FINAL_BOSS_FLOOR) { setupFinalBoss(); updateHud(); return; }

  const clutterSpots = buildRoom(n);
  spawnEnemiesForFloor(n, clutterSpots);
  playerGroup.position.set(0, 0, 12);
  updateHud();
}

function ascendStairs(){
  if (state.floor >= CONFIG.TOTAL_FLOORS) return;
  player.hp -= CONFIG.PLAYER.stairsHpCost;
  if (checkDeath()) return;
  goToFloor(state.floor + 1);
  toast(`${state.floor} 층`);
}

/* ============================================================
   전투 / 상호작용
============================================================ */
function meleeAttack(){
  const now = state.clock.getElapsedTime();
  if (now - state.lastAttackTime < CONFIG.PLAYER.attackCooldown) return;
  state.lastAttackTime = now;

  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  let hitSomething = false;

  for (const en of enemies) {
    const toEnemy = new THREE.Vector3().subVectors(en.mesh.position, playerGroup.position);
    const dist = toEnemy.length();
    if (dist > CONFIG.PLAYER.attackRange) continue;
    toEnemy.normalize();
    if (toEnemy.dot(forward) < 0.4) continue;
    const dmg = Math.max(1, player.atk - en.def);
    en.hp -= dmg;
    hitSomething = true;
    flashEnemy(en.mesh);
  }
  if (bossEntity && !hitSomething) {
    const toBoss = new THREE.Vector3().subVectors(bossEntity.mesh.position, playerGroup.position);
    const dist = toBoss.length();
    if (dist <= CONFIG.PLAYER.attackRange + 1.5) {
      toBoss.normalize();
      if (toBoss.dot(forward) > 0.3) {
        const dmg = Math.max(1, player.atk - bossEntity.def);
        bossEntity.hp -= dmg;
        flashEnemy(bossEntity.mesh);
      }
    }
  }
  enemies = enemies.filter((en) => {
    if (en.hp <= 0) { floorGroup.remove(en.mesh); return false; }
    return true;
  });
  if (bossEntity && bossEntity.hp <= 0) onBossDefeated();
  updateHud();
}

function flashEnemy(mesh){
  mesh.traverse((c) => { if (c.material && c.material.emissive) { c.material.emissiveIntensity = 1; setTimeout(() => { if (c.material) c.material.emissiveIntensity = 0.2; }, 120); } });
}

function onBossDefeated(){
  if (bossEntity.kind === "mid") {
    toast("잉크 프린터를 물리쳤습니다!");
    floorGroup.remove(bossEntity.mesh);
    bossEntity = null;
    hideBossHud();
    stairsMesh.visible = true;
    state.bossActive = null;
  } else if (bossEntity.kind === "final") {
    victory();
  }
}

let nearItem = null;
function tryInteract(){
  if (nearItem && !nearItem.collected) {
    nearItem.collected = true;
    floorGroup.remove(nearItem.mesh);
    applyItem(nearItem);
    if (!state.firstItemFound) {
      state.firstItemFound = true;
      state.phoneUnlocked = true;
      toast("휴대폰에 새 메시지가 도착했습니다.");
    }
  }
}

function applyItem(item){
  if (item.category === "weapon") {
    if (item.def.atk > (player._weaponAtk || 0)) {
      player.atk = item.def.atk;
      player._weaponAtk = item.def.atk;
      player.weaponName = item.def.name;
      toast(`무기 획득: ${item.def.name} (공격력 ${item.def.atk})`);
    } else {
      toast(`${item.def.name}을(를) 획득했지만 기존 무기가 더 강합니다.`);
    }
  } else if (item.category === "armor") {
    player.def += item.def.def;
    player.armorPickups++;
    toast(`방어구 획득: ${item.def.name} (방어력 +${item.def.def})`);
  } else if (item.category === "food") {
    const heal = Math.round((item.def.calorie * 0.2) / 5) * 5;
    player.hp = Math.min(player.maxHp, player.hp + heal);
    toast(`${item.def.name} 섭취 (+${heal} 체력)`);
  }
  updateHud();
}

function updateGraceTimer(now){
  const el = document.getElementById("grace-timer");
  if (state.centipedeGraceUntil <= 0) { el.classList.add("hidden"); return; }
  const remaining = state.centipedeGraceUntil - now;
  if (remaining > 0) {
    el.classList.remove("hidden");
    el.textContent = `⚠ 지네 대기 중... ${Math.ceil(remaining)}초`;
  } else {
    el.classList.add("hidden");
    if (!state.graceEndedNotified) {
      state.graceEndedNotified = true;
      toast("3D펜 지네들이 움직이기 시작합니다!");
    }
  }
}

/* ============================================================
   UI 헬퍼
============================================================ */
function toast(msg){
  const c = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function updateHud(){
  document.getElementById("hud-floor").textContent = state.floor;
  document.getElementById("hud-hp-fill").style.width = `${Math.max(0, player.hp / player.maxHp) * 100}%`;
  document.getElementById("hud-hp-text").textContent = `${Math.max(0, Math.round(player.hp))} / ${player.maxHp}`;
  document.getElementById("hud-atk").textContent = player.atk;
  document.getElementById("hud-def").textContent = player.def;
  document.getElementById("inv-weapon").textContent = player.weaponName;
  document.getElementById("inv-armor-count").textContent = player.armorPickups;
  if (bossEntity) {
    document.getElementById("boss-hp-fill").style.width = `${Math.max(0, bossEntity.hp / bossEntity.maxHp) * 100}%`;
  }
}

function toggleInventory(){
  if (!state.running) return;
  state.inventoryOpen = !state.inventoryOpen;
  document.getElementById("screen-inventory").classList.toggle("hidden", !state.inventoryOpen);
  if (state.inventoryOpen && document.pointerLockElement) document.exitPointerLock();

  if (state.inventoryOpen && document.getElementById("inv-tab-phone").classList.contains("active")) {
    renderPhone();
  }
}
document.getElementById("btn-inventory").addEventListener("click", toggleInventory);
document.getElementById("inv-close").addEventListener("click", toggleInventory);
document.getElementById("inv-tab-items").addEventListener("click", () => switchInvTab("items"));
document.getElementById("inv-tab-phone").addEventListener("click", () => switchInvTab("phone"));

function switchInvTab(tab){
  document.getElementById("inv-tab-items").classList.toggle("active", tab === "items");
  document.getElementById("inv-tab-phone").classList.toggle("active", tab === "phone");
  document.getElementById("inv-panel-items").classList.toggle("hidden", tab !== "items");
  document.getElementById("inv-panel-phone").classList.toggle("hidden", tab !== "phone");
  if (tab === "phone") renderPhone();
}

function renderPhone(){
  const wrap = document.getElementById("phone-messages");
  wrap.innerHTML = "";
  if (!state.phoneUnlocked) {
    wrap.innerHTML = `<p class="hint">아직 받은 메시지가 없습니다.</p>`;
    return;
  }
  const msg = CONFIG.FIRST_MESSAGE;
  const div = document.createElement("div");
  div.className = "phone-msg";
  const senderEl = document.createElement("div");
  senderEl.className = "sender";
  senderEl.textContent = state.phoneFirstOpen ? msg.sender : "알 수 없음";
  senderEl.oncopy = (e) => e.preventDefault();
  senderEl.ondragstart = (e) => e.preventDefault();
  const bodyEl = document.createElement("div");
  bodyEl.className = "body";
  bodyEl.textContent = msg.body;
  div.appendChild(senderEl);
  div.appendChild(bodyEl);
  wrap.appendChild(div);
  state.phoneFirstOpen = false;
}

/* ============================================================
   최고 층 기록 저장 (온라인이면 Turso로, 오프라인이면 localStorage로)
============================================================ */
function saveBestFloor(floor){
  if (!PrintoutUser.id) return;
  if (PrintoutUser.offline) {
    offlineSaveBestFloor(PrintoutUser.id, floor);
    return;
  }
  fetch(`${API_BASE}/api/best-floor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: PrintoutUser.id, floor }),
  }).catch(() => { /* 저장 실패해도 게임 진행에는 지장 없음 */ });
}

/* ============================================================
   사망 / 승리
============================================================ */
function checkDeath(){
  if (player.hp <= 0) {
    player.hp = 0;
    updateHud();
    state.running = false;
    document.exitPointerLock();
    document.getElementById("gameover-floor").textContent = `도달 층: ${state.floor}`;
    document.getElementById("screen-gameover").classList.remove("hidden");
    document.getElementById("hud").classList.add("hidden");
    saveBestFloor(state.floor);
    return true;
  }
  return false;
}

function victory(){
  state.running = false;
  document.exitPointerLock();
  document.getElementById("screen-victory").classList.remove("hidden");
  document.getElementById("hud").classList.add("hidden");
  saveBestFloor(state.floor);
}

document.getElementById("btn-restart").addEventListener("click", () => location.reload());
document.getElementById("btn-restart2").addEventListener("click", () => location.reload());

/* ============================================================
   메인 루프
============================================================ */
function updatePlayerMovement(dt){
  playerGroup.rotation.y = state.yaw;
  const speed = CONFIG.PLAYER.moveSpeed * (state.keys["ShiftLeft"] ? CONFIG.PLAYER.sprintMultiplier : 1);
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.sin(state.yaw + Math.PI / 2), 0, Math.cos(state.yaw + Math.PI / 2));
  const move = new THREE.Vector3();
  if (state.keys["KeyW"]) move.add(forward);
  if (state.keys["KeyS"]) move.sub(forward);
  if (state.keys["KeyD"]) move.add(right);
  if (state.keys["KeyA"]) move.sub(right);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed * dt);
    const next = playerGroup.position.clone().add(move);
    const lim = ROOM_SIZE / 2 - 1;
    next.x = Math.max(-lim, Math.min(lim, next.x));
    next.z = Math.max(-lim, Math.min(lim, next.z));
    playerGroup.position.copy(next);
  }

  // 카메라: 3인칭 추적
  const camDist = 5.2, camHeight = 2.4 + state.pitch * 3;
  const camOffset = new THREE.Vector3(
    -Math.sin(state.yaw) * camDist,
    camHeight,
    -Math.cos(state.yaw) * camDist
  );
  const desiredCamPos = playerGroup.position.clone().add(camOffset);
  camera.position.lerp(desiredCamPos, 1 - Math.pow(0.001, dt));
  const lookTarget = playerGroup.position.clone().add(new THREE.Vector3(0, 1.4, 0));
  camera.lookAt(lookTarget);

  flashlight.position.set(0, 2, 0);
  flashTarget.position.set(Math.sin(state.yaw) * 5, 0.5, Math.cos(state.yaw) * 5);
}

function updateEnemies(dt, now){
  let nearestItem = null, nearestItemDist = 2.0;
  for (const item of itemSpawns) {
    if (item.collected) continue;
    item.mesh.rotation.y += dt * 1.5;
    const d = item.mesh.position.distanceTo(playerGroup.position);
    if (d < nearestItemDist) { nearestItem = item; nearestItemDist = d; }
  }
  nearItem = nearestItem;
  document.getElementById("interact-prompt").classList.toggle("hidden", !nearItem);

  for (const en of enemies) {
    // 게임 시작 후 일정 시간 동안 3D펜 지네는 움직이지도, 공격하지도 않음
    if (en.type === "pen_centipede" && now < state.centipedeGraceUntil) continue;

    const toPlayer = new THREE.Vector3().subVectors(playerGroup.position, en.mesh.position);
    const dist = toPlayer.length();
    if (dist > 0.01) {
      toPlayer.normalize();
      const stepSpeed = en.speed * dt;
      en.mesh.position.addScaledVector(toPlayer, Math.min(stepSpeed, Math.max(0, dist - 0.9)));
      en.mesh.lookAt(playerGroup.position.x, en.mesh.position.y, playerGroup.position.z);
    }
    // 잉크 프린터 소환체: 정지 후 원거리 공격
    if (en.isInkPrinter) {
      if (now >= (en.nextFire || 0)) {
        en.nextFire = now + 1.5 + Math.random() * 2;
        fireInkPaper({ mesh: en.mesh }, en.mult || 1);
      }
      continue;
    }
    if (dist < 1.0 && now - en.lastHit > 0.9) {
      en.lastHit = now;
      const dmg = Math.max(1, en.atk - player.def);
      player.hp -= dmg;
      flashDamage();
      if (en.poison) {
        player.poisonStacks.push({
          dmg: Math.round(CONFIG.CENTIPEDE.poisonPercent * en.atk),
          remaining: CONFIG.CENTIPEDE.poisonDuration,
          nextTick: now + CONFIG.CENTIPEDE.poisonTick,
        });
      }
      if (checkDeath()) return;
    }
  }

  // 포이즌 틱
  player.poisonStacks = player.poisonStacks.filter((p) => {
    p.remaining -= dt;
    if (now >= p.nextTick) {
      p.nextTick = now + CONFIG.CENTIPEDE.poisonTick;
      player.hp -= p.dmg;
      flashDamage();
    }
    return p.remaining > 0;
  });
  if (player.poisonStacks.length && checkDeath()) return;

  // 계단 도달 체크
  if (stairsMesh && stairsMesh.visible !== false) {
    const d = playerGroup.position.distanceTo(stairsMesh.position);
    if (d < 3.2) ascendStairs();
  }

  updateHud();
}

function updateProjectiles(dt, now){
  projectiles = projectiles.filter((p) => {
    p.life -= dt;
    p.mesh.position.addScaledVector(p.dir, p.speed * dt);
    p.mesh.lookAt(camera.position);
    const d = p.mesh.position.distanceTo(playerGroup.position);
    if (d < 1.0) {
      const dmg = Math.round((p.dmgPercent / 100) * player.maxHp);
      player.hp -= dmg;
      flashDamage();
      floorGroup.remove(p.mesh);
      checkDeath();
      return false;
    }
    if (p.life <= 0) { floorGroup.remove(p.mesh); return false; }
    return true;
  });
}

function updateBoss(dt, now){
  if (!bossEntity) return;
  if (bossEntity.kind === "mid" && state.bossActive === "mid") {
    if (now >= bossEntity.nextFire) {
      const [a, b] = CONFIG.MID_BOSS.paperFireInterval;
      bossEntity.nextFire = now + a + Math.random() * (b - a);
      fireInkPaper(bossEntity);
    }
    bossEntity.mesh.rotation.y = Math.sin(now * 0.5) * 0.3;
  }
  if (bossEntity.kind === "final" && state.bossActive === "final") {
    if (now >= bossEntity.nextSummon) {
      const [a, b] = CONFIG.FINAL_BOSS.summonIntervalRange;
      bossEntity.nextSummon = now + a + Math.random() * (b - a);
      summonFromBoss();
    }
    bossEntity.mesh.rotation.y += dt * 0.2;
  }
}

let flashTimeout = null;
function flashDamage(){
  const el = document.getElementById("damage-flash");
  el.style.background = "rgba(139,0,0,0.35)";
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => { el.style.background = "rgba(139,0,0,0)"; }, 150);
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, state.clock.getDelta());
  const now = state.clock.getElapsedTime();
  if (state.running && !state.inventoryOpen) {
    updatePlayerMovement(dt);
    updateEnemies(dt, now);
    updateProjectiles(dt, now);
    updateBoss(dt, now);
    updateGraceTimer(now);
  }
  renderer.render(scene, camera);
}
animate();

/* ============================================================
   디버그: 층 점프 (테스트/시연용 - 배포 시 제거 가능)
   숫자 키패드 없이도 사용 가능하도록 브라우저 prompt 사용
============================================================ */
addEventListener("keydown", (e) => {
  if (e.code === "Backquote" && state.running) {
    const n = parseInt(prompt(`이동할 층 입력 (1~${CONFIG.TOTAL_FLOORS})`, state.floor), 10);
    if (n && n >= 1 && n <= CONFIG.TOTAL_FLOORS) goToFloor(n);
  }
});

/* ============================================================
   게임 시작 시퀀스: 인증 완료 -> 컷씬 -> 게임
============================================================ */
document.addEventListener("printout:authComplete", () => {
  playerGroup.add(buildAvatar(PrintoutUser.gender));
  startCutscene();
});

function startCutscene(){
  const cutsceneEl = document.getElementById("screen-cutscene");
  cutsceneEl.classList.remove("hidden");
  const lineEl = document.getElementById("cutscene-line");
  const skipBtn = document.getElementById("cutscene-skip");

  const lines = [
    "...뭐야, 저게.",
    "3D 프린터 헤드를 몸통 삼은 거대한 지네가 당신을 쫓아옵니다.",
    "정신없이 도망치다, 낡은 공장 건물 안으로 뛰어듭니다.",
    "쾅! — 뒤에서 철문이 저절로 닫힙니다.",
    "숨을 곳을 찾았다고 생각한 순간, 당신은 깨닫습니다.",
    "이곳은... 갇힌 것입니다.",
  ];
  let i = 0;
  let finished = false;

  function nextLine(){
    if (finished) return;
    if (i >= lines.length) { endCutscene(); return; }
    lineEl.textContent = lines[i++];
    cutsceneTimer = setTimeout(nextLine, 2300);
  }
  let cutsceneTimer = setTimeout(nextLine, 300);

  function endCutscene(){
    if (finished) return;
    finished = true;
    clearTimeout(cutsceneTimer);
    cutsceneEl.classList.add("hidden");
    beginGame();
  }
  skipBtn.onclick = endCutscene;
}

function beginGame(){
  document.getElementById("hud").classList.remove("hidden");
  state.running = true;
  goToFloor(1);
  state.centipedeGraceUntil = state.clock.getElapsedTime() + CONFIG.CENTIPEDE_GRACE_SECONDS;
  toast(`${CONFIG.CENTIPEDE_GRACE_SECONDS}초 후, 3D펜 지네들이 당신을 향해 움직이기 시작합니다...`);
  canvas.requestPointerLock();
}

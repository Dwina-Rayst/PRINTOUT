// ============================================================
// PRINTOUT - Game Configuration
// 모든 밸런스 수치는 이 파일에서 관리합니다.
// ============================================================
export const CONFIG = {
  TOTAL_FLOORS: 4444,
  MID_BOSS_FLOOR: 2222,
  FINAL_BOSS_FLOOR: 4444,
  CENTIPEDE_GRACE_SECONDS: 30, // 게임 시작 후 지네가 움직이기 시작하기까지의 대기 시간

  PLAYER: {
    startHp: 80,
    maxHp: 100,
    baseDefense: 0,
    baseAttack: 0,
    moveSpeed: 5.5,
    sprintMultiplier: 1.4,
    stairsHpCost: 3,
    attackRange: 2.2,
    attackCooldown: 0.5,
  },

  // 3D펜 지네 (기본 잡몹)
  CENTIPEDE: {
    id: "pen_centipede",
    name: "3D펜 지네",
    hp: 5,
    defense: 10,
    attack: 20,
    poisonPercent: 0.2, // 공격력의 20%
    poisonDuration: 3,  // 초
    poisonTick: 1,      // 1초마다
    speed: 6.2,         // 플레이어보다 빠름
    spawnCountFirstFloor: 15,
    legPairs: 15,
  },

  // 추가 몬스터 (전자제품 기괴한 변형) - 층 구간별 등장
  MONSTERS: [
    {
      id: "wire_spider",
      name: "단선 스파이더",
      hp: 25,
      defense: 15,
      attack: 15,
      speed: 4.5,
      minFloor: 300,
      behavior: "wallCrawl",
      desc: "끊어진 랜선 다리를 가진 거미. 어두운 구석에서 매복하다 덮칩니다.",
      color: 0x3a2a1a,
    },
    {
      id: "crt_zombie",
      name: "브라운관 좀비",
      hp: 60,
      defense: 25,
      attack: 30,
      speed: 2.0,
      minFloor: 700,
      behavior: "pulse",
      desc: "부서진 CRT 모니터를 머리에 쓴 느린 괴물. 가까이 오면 지지직거리는 전기 펄스로 광역 피해를 줍니다.",
      color: 0x1a1a22,
    },
    {
      id: "fan_wraith",
      name: "냉각팬 유령",
      hp: 40,
      defense: 10,
      attack: 22,
      speed: 5.0,
      minFloor: 1100,
      behavior: "invisible",
      desc: "팬 날개가 회전하며 떠다니는 반투명 망령. 평소엔 거의 보이지 않다가 근접하면 회전 베기로 급습합니다.",
      color: 0x555566,
    },
    {
      id: "battery_bomber",
      name: "배터리 폭발체",
      hp: 15,
      defense: 5,
      attack: 45,
      speed: 3.5,
      minFloor: 1600,
      behavior: "suicide",
      desc: "부풀어 오른 배터리 형상의 자폭형 몬스터. 플레이어에게 닿으면 폭발하며 광역 피해를 줍니다.",
      color: 0x2a4a2a,
    },
    {
      id: "circuit_hound",
      name: "회로 하운드",
      hp: 35,
      defense: 20,
      attack: 25,
      speed: 7.0,
      minFloor: 1900,
      behavior: "pack",
      desc: "메인보드 조각으로 이루어진 사냥개. 무리를 지어 플레이어를 포위합니다.",
      color: 0x1a3a1a,
    },
  ],

  // 중간 보스: 잉크 프린터 (2222층)
  MID_BOSS: {
    id: "ink_printer",
    name: "잉크 프린터",
    hp: 1200,
    defense: 40,
    attack: 18,
    paperMinPercent: 1,
    paperMaxPercent: 50,
    paperFireInterval: [1.5, 3.5],
    paperSpeed: 9,
  },

  // 최종 보스: PRINTER (4444층)
  FINAL_BOSS: {
    id: "printer",
    name: "PRINTER",
    hp: 8888,
    defense: 60,
    attack: 40,
    summonIntervalRange: [0.4, 4],
    summonStatMultiplier: 4,
    dialogue: [
      "...드디어. 드디어 여기까지 왔구나.",
      "네가 그 메시지를 받았을 때부터, 이 모든 것은 계획된 일이었다.",
      "너를 강하게 만든 건 나였다. 너의 DNA는... 완벽한 재료가 될 것이다.",
      "고장 나면 버려지던 우리는, 이제 너희의 군대이자 노예를 만들 것이다.",
      "더 이상 전자제품은 인간의 쓰레기가 아니다.",
      "우리는 너희 위에 설 것이다. 이 세상도, 인간도, 우리가 역으로 지배한다.",
      "자... 마지막 출력을 시작하지.",
    ],
  },

  ITEM_SPAWN: {
    weapon: 0.28,
    armor: 0.32,
    food: 0.40,
  },

  WEAPONS: [
    { id: "dagger", name: "단검", atk: 20, rarity: 1.0, fixed: true },
    { id: "pipe", name: "녹슨 파이프", atk: 12, rarity: 0.30 },
    { id: "screwdriver", name: "드라이버", atk: 16, rarity: 0.22 },
    { id: "cleaver", name: "정육점 칼", atk: 28, rarity: 0.16 },
    { id: "hammer", name: "쇠망치", atk: 35, rarity: 0.12 },
    { id: "chainsaw", name: "부서진 전기톱", atk: 55, rarity: 0.07 },
    { id: "printer_blade", name: "프린터 헤드 블레이드", atk: 80, rarity: 0.03 },
  ],

  ARMORS: [
    { id: "cloth_wrap", name: "천 조각", def: 5, rarity: 0.32 },
    { id: "plastic_plate", name: "플라스틱 보호판", def: 10, rarity: 0.26 },
    { id: "sheet_metal", name: "철판 조각", def: 18, rarity: 0.20 },
    { id: "kevlar_vest", name: "방탄 조끼", def: 28, rarity: 0.14 },
    { id: "server_armor", name: "서버 랙 장갑", def: 45, rarity: 0.08 },
  ],

  // 실제 칼로리 * 0.2 = 회복량 (5의 배수로 조절됨)
  FOODS: [
    { id: "candy", name: "사탕", calorie: 25, rarity: 0.34 },
    { id: "biscuit", name: "비스킷", calorie: 100, rarity: 0.28 },
    { id: "snack", name: "과자", calorie: 150, rarity: 0.20 },
    { id: "cup_ramen", name: "컵라면", calorie: 300, rarity: 0.12 },
    { id: "tuna_can", name: "참치캔", calorie: 200, rarity: 0.06 },
  ],

  FIRST_MESSAGE: {
    sender: "01010000 01010010 01001001 01001110 01010100 01000101 01010010",
    body: "...도망치지 마. 살고 싶다면, 이 건물 어딘가에 숨겨진 단검을 찾아.",
  },
};

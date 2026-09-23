// ============================================================
// PRINTOUT - Auth (회원가입/로그인)
// server/ 가 배포되어 있으면 API를 사용하고,
// 연결이 안 되면 localStorage 기반 오프라인 모드로 자동 전환합니다.
// ============================================================

// 배포한 백엔드 주소로 바꿔주세요 (예: Render 배포 URL)
export const API_BASE = window.PRINTOUT_API_BASE || "http://localhost:3000";

const els = {
  screenAuth: document.getElementById("screen-auth"),
  screenGender: document.getElementById("screen-gender"),
  tabLogin: document.getElementById("tab-login"),
  tabSignup: document.getElementById("tab-signup"),
  id: document.getElementById("auth-id"),
  pw: document.getElementById("auth-pw"),
  submit: document.getElementById("auth-submit"),
  error: document.getElementById("auth-error"),
};

let mode = "login"; // or "signup"
let offline = false;

export const PrintoutUser = {
  id: null,
  gender: null,
  bestFloor: 1,
};

function setMode(m){
  mode = m;
  els.tabLogin.classList.toggle("active", m === "login");
  els.tabSignup.classList.toggle("active", m === "signup");
  els.submit.textContent = m === "login" ? "로그인" : "회원가입";
  els.error.textContent = "";
}

els.tabLogin.addEventListener("click", () => setMode("login"));
els.tabSignup.addEventListener("click", () => setMode("signup"));

async function apiCall(path, body){
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "요청 실패");
  }
  return res.json();
}

// ----- 오프라인(로컬) 모드 -----
// localStorage는 브라우저 devtools로 누구나 열람/수정 가능한 저장소이므로 완벽한 보안은
// 불가능합니다. 대신 아래 두 가지로 "캐주얼한 열람/조작"은 확실히 막습니다:
//   1) 비밀번호는 평문이 아니라 SHA-256(salt + 비밀번호) 해시로만 저장
//   2) 저장 데이터 전체를 base64로 감싸고, 무결성 체크섬을 같이 저장해서
//      값이 조작되면 체크섬이 어긋나 그 저장 데이터를 폐기(무효 처리)
const STORAGE_KEY = "printout_save_v2";
const SIGN_SALT = "printout-9f2c-static-pepper"; // 코드에 포함되는 값이라 완전한 비밀은 아니지만, 무단 편집을 자동 감지하는 용도로는 충분합니다.

async function sha256Hex(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function toB64(str){ return btoa(unescape(encodeURIComponent(str))); }
function fromB64(str){ return decodeURIComponent(escape(atob(str))); }

async function loadDB(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const { data, checksum } = JSON.parse(raw);
    const expected = await sha256Hex(data + SIGN_SALT);
    if (expected !== checksum) {
      console.warn("[PRINTOUT] 저장 데이터의 무결성 검증에 실패했습니다 (변조되었거나 손상됨). 무시합니다.");
      return {};
    }
    return JSON.parse(fromB64(data));
  } catch {
    return {};
  }
}
async function saveDB(db){
  const data = toB64(JSON.stringify(db));
  const checksum = await sha256Hex(data + SIGN_SALT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ data, checksum }));
}
function randomSaltHex(){
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function offlineAuth(id, pw, isSignup){
  const db = await loadDB();
  if (isSignup) {
    if (db[id]) throw new Error("이미 존재하는 아이디입니다.");
    if (id.length < 2 || pw.length < 4) throw new Error("아이디는 2자 이상, 비밀번호는 4자 이상이어야 합니다.");
    const salt = randomSaltHex();
    const hash = await sha256Hex(salt + pw);
    db[id] = { salt, hash, gender: null, bestFloor: 1 };
    await saveDB(db);
    return { id, gender: null, bestFloor: 1 };
  } else {
    const u = db[id];
    if (!u) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    const hash = await sha256Hex(u.salt + pw);
    if (hash !== u.hash) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    return { id, gender: u.gender, bestFloor: u.bestFloor };
  }
}
async function offlineSaveGender(id, gender){
  const db = await loadDB();
  if (db[id]) { db[id].gender = gender; await saveDB(db); }
}
export async function offlineSaveBestFloor(id, floor){
  const db = await loadDB();
  if (db[id] && floor > (db[id].bestFloor || 1)) {
    db[id].bestFloor = floor;
    await saveDB(db);
  }
}

async function handleSubmit(){
  const id = els.id.value.trim();
  const pw = els.pw.value;
  els.error.textContent = "";
  if (!id || !pw) { els.error.textContent = "아이디와 비밀번호를 입력하세요."; return; }
  els.submit.disabled = true;

  try {
    let userData;
    try {
      // 서버 우선 시도 (2.5초 타임아웃)
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const path = mode === "login" ? "/api/login" : "/api/signup";
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, pw }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "요청 실패");
      }
      userData = await res.json();
      offline = false;
    } catch (netErr) {
      // 서버 실패 -> 오프라인 폴백
      offline = true;
      userData = await offlineAuth(id, pw, mode === "signup");
    }

    PrintoutUser.id = userData.id;
    PrintoutUser.gender = userData.gender || null;
    PrintoutUser.bestFloor = userData.bestFloor || 1;
    PrintoutUser.offline = offline;

    els.screenAuth.classList.add("hidden");
    if (PrintoutUser.gender) {
      document.dispatchEvent(new CustomEvent("printout:authComplete"));
    } else {
      els.screenGender.classList.remove("hidden");
    }
  } catch (err) {
    els.error.textContent = err.message;
  } finally {
    els.submit.disabled = false;
  }
}

els.submit.addEventListener("click", handleSubmit);
els.pw.addEventListener("keydown", (e) => { if (e.key === "Enter") handleSubmit(); });

document.querySelectorAll(".gender-card").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const gender = btn.dataset.gender;
    PrintoutUser.gender = gender;
    els.screenGender.classList.add("hidden");

    if (PrintoutUser.offline) {
      await offlineSaveGender(PrintoutUser.id, gender);
    } else {
      try {
        await apiCall("/api/set-gender", { id: PrintoutUser.id, gender });
      } catch { /* 저장 실패해도 게임은 계속 진행 */ }
    }
    document.dispatchEvent(new CustomEvent("printout:authComplete"));
  });
});

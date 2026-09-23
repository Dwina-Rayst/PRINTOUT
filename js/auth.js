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
function localUsersDB(){
  try { return JSON.parse(localStorage.getItem("printout_users") || "{}"); }
  catch { return {}; }
}
function saveLocalUsersDB(db){
  localStorage.setItem("printout_users", JSON.stringify(db));
}
function offlineAuth(id, pw, isSignup){
  const db = localUsersDB();
  if (isSignup) {
    if (db[id]) throw new Error("이미 존재하는 아이디입니다.");
    if (id.length < 2 || pw.length < 4) throw new Error("아이디는 2자 이상, 비밀번호는 4자 이상이어야 합니다.");
    db[id] = { pw, gender: null, bestFloor: 1 };
    saveLocalUsersDB(db);
    return { id, gender: null, bestFloor: 1 };
  } else {
    const u = db[id];
    if (!u || u.pw !== pw) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    return { id, gender: u.gender, bestFloor: u.bestFloor };
  }
}
function offlineSaveGender(id, gender){
  const db = localUsersDB();
  if (db[id]) { db[id].gender = gender; saveLocalUsersDB(db); }
}
export function offlineSaveBestFloor(id, floor){
  const db = localUsersDB();
  if (db[id] && floor > (db[id].bestFloor || 1)) {
    db[id].bestFloor = floor;
    saveLocalUsersDB(db);
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
      userData = offlineAuth(id, pw, mode === "signup");
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
      offlineSaveGender(PrintoutUser.id, gender);
    } else {
      try {
        await apiCall("/api/set-gender", { id: PrintoutUser.id, gender });
      } catch { /* 저장 실패해도 게임은 계속 진행 */ }
    }
    document.dispatchEvent(new CustomEvent("printout:authComplete"));
  });
});

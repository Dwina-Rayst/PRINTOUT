// ============================================================
// PRINTOUT - Auth (회원가입/로그인)
// server/ (Express + Turso) API를 통해서만 인증/저장합니다.
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

async function handleSubmit(){
  const id = els.id.value.trim();
  const pw = els.pw.value;
  els.error.textContent = "";
  if (!id || !pw) { els.error.textContent = "아이디와 비밀번호를 입력하세요."; return; }
  els.submit.disabled = true;

  try {
    const path = mode === "login" ? "/api/login" : "/api/signup";
    const userData = await apiCall(path, { id, pw });

    PrintoutUser.id = userData.id;
    PrintoutUser.gender = userData.gender || null;
    PrintoutUser.bestFloor = userData.bestFloor || 1;

    els.screenAuth.classList.add("hidden");
    if (PrintoutUser.gender) {
      document.dispatchEvent(new CustomEvent("printout:authComplete"));
    } else {
      els.screenGender.classList.remove("hidden");
    }
  } catch (err) {
    els.error.textContent = err.message || "서버에 연결할 수 없습니다. Render 서버가 켜져 있는지 확인하세요.";
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
    try {
      await apiCall("/api/set-gender", { id: PrintoutUser.id, gender });
    } catch { /* 저장 실패해도 게임은 계속 진행 */ }
    document.dispatchEvent(new CustomEvent("printout:authComplete"));
  });
});

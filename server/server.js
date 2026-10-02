// ============================================================
// PRINTOUT - Backend Server
// @libsql/client SDK 없이, Turso의 순정 HTTP API(/v2/pipeline)를 직접 호출합니다.
// (SDK의 migration-jobs 폴링 버그를 완전히 우회)
// ============================================================
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

function httpUrl(){
  return process.env.TURSO_DATABASE_URL.replace(/^libsql:\/\//, "https://");
}

function toTursoArg(v){
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "float", value: String(v) };
  return { type: "text", value: String(v) };
}

async function tursoExec(sql, args = []){
  const res = await fetch(`${httpUrl()}/v2/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.TURSO_AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: args.map(toTursoArg) } },
        { type: "close" },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${JSON.stringify(data)}`);
  const first = data.results?.[0];
  if (!first || first.type === "error") throw new Error(first?.error?.message || "Turso 쿼리 실패");
  const result = first.response.result;
  const cols = result.cols.map((c) => c.name);
  const rows = result.rows.map((row) => {
    const obj = {};
    row.forEach((cell, i) => { obj[cols[i]] = cell.type === "integer" ? Number(cell.value) : cell.value; });
    return obj;
  });
  return { rows };
}

function validId(id){ return typeof id === "string" && id.length >= 2 && id.length <= 16; }
function validPw(pw){ return typeof pw === "string" && pw.length >= 4 && pw.length <= 64; }

app.post("/api/signup", async (req, res) => {
  const { id, pw } = req.body || {};
  if (!validId(id) || !validPw(pw)) {
    return res.status(400).json({ message: "아이디는 2~16자, 비밀번호는 4자 이상이어야 합니다." });
  }
  try {
    const existing = await tursoExec("SELECT id FROM users WHERE id = ?", [id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "이미 존재하는 아이디입니다." });
    }
    const hash = await bcrypt.hash(pw, 10);
    await tursoExec("INSERT INTO users (id, password_hash, gender, best_floor) VALUES (?, ?, NULL, 1)", [id, hash]);
    return res.json({ id, gender: null, bestFloor: 1 });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "[DEBUG] " + (e.message || String(e)) });
  }
});

app.post("/api/login", async (req, res) => {
  const { id, pw } = req.body || {};
  if (!validId(id) || !validPw(pw)) {
    return res.status(400).json({ message: "입력값이 올바르지 않습니다." });
  }
  try {
    const result = await tursoExec("SELECT * FROM users WHERE id = ?", [id]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    const ok = await bcrypt.compare(pw, user.password_hash);
    if (!ok) return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return res.json({ id: user.id, gender: user.gender, bestFloor: user.best_floor });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "[DEBUG] " + (e.message || String(e)) });
  }
});

app.post("/api/set-gender", async (req, res) => {
  const { id, gender } = req.body || {};
  if (!validId(id) || !["male", "female"].includes(gender)) {
    return res.status(400).json({ message: "입력값이 올바르지 않습니다." });
  }
  try {
    await tursoExec("UPDATE users SET gender = ? WHERE id = ?", [gender, id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "[DEBUG] " + (e.message || String(e)) });
  }
});

app.post("/api/best-floor", async (req, res) => {
  const { id, floor } = req.body || {};
  if (!validId(id) || typeof floor !== "number") {
    return res.status(400).json({ message: "입력값이 올바르지 않습니다." });
  }
  try {
    await tursoExec("UPDATE users SET best_floor = MAX(best_floor, ?) WHERE id = ?", [floor, id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "[DEBUG] " + (e.message || String(e)) });
  }
});

app.get("/", (_req, res) => res.send("PRINTOUT API is running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PRINTOUT server listening on port ${PORT}`));

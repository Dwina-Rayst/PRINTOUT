// ============================================================
// PRINTOUT - Backend Server
// Express + Turso (libSQL) 를 사용한 회원가입/로그인 API
// Render 등 Node 호스팅에 그대로 배포 가능합니다.
// ============================================================
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { createClient } from "@libsql/client";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,       // 예: libsql://your-db.turso.io
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function init(){
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      gender TEXT,
      best_floor INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
init().catch((e) => console.error("DB init 실패:", e));

function validId(id){ return typeof id === "string" && id.length >= 2 && id.length <= 16; }
function validPw(pw){ return typeof pw === "string" && pw.length >= 4 && pw.length <= 64; }

app.post("/api/signup", async (req, res) => {
  const { id, pw } = req.body || {};
  if (!validId(id) || !validPw(pw)) {
    return res.status(400).json({ message: "아이디는 2~16자, 비밀번호는 4자 이상이어야 합니다." });
  }
  try {
    const existing = await db.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [id] });
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "이미 존재하는 아이디입니다." });
    }
    const hash = await bcrypt.hash(pw, 10);
    await db.execute({
      sql: "INSERT INTO users (id, password_hash, gender, best_floor) VALUES (?, ?, NULL, 1)",
      args: [id, hash],
    });
    return res.json({ id, gender: null, bestFloor: 1 });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

app.post("/api/login", async (req, res) => {
  const { id, pw } = req.body || {};
  if (!validId(id) || !validPw(pw)) {
    return res.status(400).json({ message: "입력값이 올바르지 않습니다." });
  }
  try {
    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    const ok = await bcrypt.compare(pw, user.password_hash);
    if (!ok) return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return res.json({ id: user.id, gender: user.gender, bestFloor: user.best_floor });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

app.post("/api/set-gender", async (req, res) => {
  const { id, gender } = req.body || {};
  if (!validId(id) || !["male", "female"].includes(gender)) {
    return res.status(400).json({ message: "입력값이 올바르지 않습니다." });
  }
  try {
    await db.execute({ sql: "UPDATE users SET gender = ? WHERE id = ?", args: [gender, id] });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

app.post("/api/best-floor", async (req, res) => {
  const { id, floor } = req.body || {};
  if (!validId(id) || typeof floor !== "number") {
    return res.status(400).json({ message: "입력값이 올바르지 않습니다." });
  }
  try {
    await db.execute({
      sql: "UPDATE users SET best_floor = MAX(best_floor, ?) WHERE id = ?",
      args: [floor, id],
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

app.get("/", (_req, res) => res.send("PRINTOUT API is running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PRINTOUT server listening on port ${PORT}`));

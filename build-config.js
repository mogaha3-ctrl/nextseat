// build-config.js — Vercel 배포 때 환경변수로 config.js를 만든다.
// Vercel → Settings → Environment Variables 에 SUPABASE_URL, SUPABASE_KEY(공개용 키)를 넣으면
// 배포할 때마다 이 파일이 config.js를 새로 씁니다. 값이 없으면 저장소의 config.js를 그대로 씁니다.
// ⚠ 브라우저로 전달되는 값이므로 Publishable(anon) 키만 넣습니다. Secret/service_role 키 금지.
const fs = require("fs");

const url = (process.env.SUPABASE_URL || "").trim();
const key = (process.env.SUPABASE_KEY || "").trim();

if (!url || !key) {
  console.log("[build-config] 환경변수가 없어 저장소의 config.js를 그대로 사용합니다.");
  process.exit(0);
}
if (/service_role|^sb_secret_/i.test(key)) {
  console.error("[build-config] Secret/service_role 키는 사용할 수 없습니다. Publishable(anon) 키를 넣어 주세요.");
  process.exit(1);
}

const content =
  "// config.js — Vercel 환경변수로 자동 생성됨 (build-config.js)\n" +
  `const SUPABASE_URL = ${JSON.stringify(url)};\n` +
  `const SUPABASE_KEY = ${JSON.stringify(key)};\n`;
fs.writeFileSync("config.js", content);
console.log("[build-config] 환경변수로 config.js를 만들었습니다.");

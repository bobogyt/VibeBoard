#!/usr/bin/env bash
# 一键 HTTP E2E(需隧道可用):健康 → 登录 → 模型配置增删 → mock GLM 对话全链路。
# 前置:1) 后端已启动  2) mock 已启动:node server/test/run-mock-glm.mjs 3900
#       3) 后端以 MODEL_BASE_URL_DEEPSEEK=http://127.0.0.1:3900 启动(覆盖 DeepSeek 指向 mock)
# 用法:bash server/test/e2e-check.sh
set -euo pipefail
BASE=${BASE:-http://localhost:3000}
E2E_USER=${E2E_USER:-e2euser}
E2E_PASS=${E2E_PASS:-e2epass123}

echo "== health =="
curl -sf "$BASE/api/health"
echo

TOKEN=$(curl -sf -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$E2E_USER\",\"password\":\"$E2E_PASS\"}" | sed 's/.*"token":"\([^"]*\)".*/\1/')
[ -n "$TOKEN" ] && echo "login ok (token len ${#TOKEN})"

AUTH="Authorization: Bearer $TOKEN"
JSON='Content-Type: application/json'

echo "== models GET(初始状态)=="
curl -sf "$BASE/api/agent/models" -H "$AUTH"
echo

echo "== models PUT(保存 DeepSeek 密钥并激活)=="
curl -sf -X PUT "$BASE/api/agent/models" -H "$AUTH" -H "$JSON" \
  -d '{"provider":"deepseek","model":"deepseek-chat","apiKey":"sk-e2e-test-key-123456"}' | head -c 400
echo

echo "== agent run(经 mock 走完 读任务→改优先级→复核 汇报)=="
curl -sf -X POST "$BASE/api/agent/run" -H "$AUTH" -H "$JSON" \
  -d '{"message":"把今天最重要的任务调整为 P0"}' | head -c 600
echo

echo "== cleanup:把被改的优先级还原 =="
node -e "
const base = '$BASE', token = '$TOKEN';
const board = await (await fetch(base + '/api/board', { headers: { Authorization: 'Bearer ' + token } })).json();
let touched = false;
for (const col of ['todo', 'doing', 'done']) {
  for (const t of board.columns[col]) {
    if (t.priority === 'P0') { t.priority = null; touched = true; }
  }
}
if (touched) {
  const res = await fetch(base + '/api/board', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(board) });
  console.log('priority reset:', res.ok);
} else {
  console.log('nothing to reset');
}
" --input-type=module

echo "== models DELETE(清除密钥)=="
curl -sf -X DELETE "$BASE/api/agent/models/deepseek" -H "$AUTH" | head -c 300
echo

echo "== E2E all green =="

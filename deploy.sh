#!/usr/bin/env bash
# MSubGA 一键部署：拉代码 -> 装依赖 -> 构建 -> 重启服务 -> 健康检查
#
#   ./deploy.sh              正常部署
#   SKIP_PULL=1 ./deploy.sh  跳过 git pull，只重新构建重启
#   ./deploy.sh stop         停掉服务
#   ./deploy.sh status       看运行状态
#
# 首次部署前把 .env.deploy 配好（见 .env.deploy.example）
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

# 站点相关配置放 .env.deploy，不进版本库
if [ -f "$APP_DIR/.env.deploy" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env.deploy"
  set +a
fi

BRANCH="${BRANCH:-main}"
PORT="${PORT:-27981}"
# 默认监听所有网卡：反代和本服务经常不在同一台机器，绑回环的话反代连不上。
# 想收紧成只给同机反代用，就在 .env.deploy 里改成 127.0.0.1。
# 注意 0.0.0.0 意味着内网可直连，记得别让路由器把这个端口也转发到公网。
HOST="${HOST:-0.0.0.0}"
MSUBGA_DATA_DIR="${MSUBGA_DATA_DIR:-$APP_DIR/data}"
SKIP_PULL="${SKIP_PULL:-0}"
# 交给 systemd 管进程时置 1：只拉代码和构建，不自己起服务
SKIP_START="${SKIP_START:-0}"

PID_FILE="$APP_DIR/.msubga.pid"
LOG_FILE="$APP_DIR/msubga.log"
HEALTH_URL="http://127.0.0.1:$PORT/healthz"

log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

listening_pids() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p' | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u
  else
    netstat -ltnp 2>/dev/null | awk -v p=":$PORT\$" '$4 ~ p {print $7}' | cut -d/ -f1 |
      grep '^[0-9][0-9]*$' | sort -u || true
  fi
}

stop_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  log "停止进程 $pid"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  log "强制停止 $pid"
  kill -9 "$pid" 2>/dev/null || true
}

stop_all() {
  [ -f "$PID_FILE" ] && stop_pid "$(cat "$PID_FILE" 2>/dev/null || true)"
  for pid in $(listening_pids); do stop_pid "$pid"; done
  rm -f "$PID_FILE"
}

case "${1:-deploy}" in
  stop)
    stop_all
    log "已停止"
    exit 0
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      log "运行中，PID $(cat "$PID_FILE")，端口 $PORT"
      curl -fsS "$HEALTH_URL" >/dev/null 2>&1 && log "健康检查正常" || log "健康检查失败"
    else
      log "未运行"
    fi
    exit 0
    ;;
  deploy) ;;
  *) die "未知命令: $1（可用: deploy / stop / status）" ;;
esac

command -v node >/dev/null 2>&1 || die "没装 node。CentOS 上可以用 nvm 装：nvm install 22"
# 数据库用的是 Node 内置的 node:sqlite，其中 setReturnArrays 需要 22.13+
NODE_OK="$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); (a>22||(a===22&&b>=13))?"1":"0"')"
[ "$NODE_OK" = "1" ] || die "Node 版本太低（当前 $(node -v)），需要 22.13+ 或 24+"

log "目录: $APP_DIR"
log "分支: $BRANCH   端口: $HOST:$PORT"
log "数据: $MSUBGA_DATA_DIR"

if [ "$SKIP_PULL" != "1" ]; then
  # 数据库和内核都在 data/ 里，已被 gitignore，pull 不会碰它们
  DIRTY="$(git status --short --untracked-files=no || true)"
  [ -z "$DIRTY" ] || die "工作区有未提交的改动，先处理掉再部署：
$DIRTY"
  log "拉取最新代码"
  git pull --ff-only origin "$BRANCH"
else
  log "跳过 git pull"
fi

log "安装依赖"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

log "构建"
npm run build

if [ "$SKIP_START" = "1" ]; then
  log "构建完成，未启动服务（SKIP_START=1）。记得 systemctl restart msubga"
  exit 0
fi

stop_all

# 首次部署且没设过密码时给个提醒，否则用户会对着登录页发呆
if [ ! -f "$MSUBGA_DATA_DIR/msubga.db" ] && [ -z "${MSUBGA_PASSWORD:-}" ]; then
  log "提示：这是首次部署且没设 MSUBGA_PASSWORD，打开页面时会让你在界面上设置管理员密码"
fi

log "启动服务"
: > "$LOG_FILE"
HOST="$HOST" PORT="$PORT" NODE_ENV=production \
  MSUBGA_DATA_DIR="$MSUBGA_DATA_DIR" \
  MSUBGA_BASE_URL="${MSUBGA_BASE_URL:-}" \
  MSUBGA_PASSWORD="${MSUBGA_PASSWORD:-}" \
  MIHOMO_PATH="${MIHOMO_PATH:-}" \
  nohup node packages/server/dist/index.js >"$LOG_FILE" 2>&1 &

NEW_PID="$!"
echo "$NEW_PID" > "$PID_FILE"

for _ in $(seq 1 60); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "ERROR: 服务启动即退出" >&2
    tail -40 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 0.5
done

curl -fsS "$HEALTH_URL" >/dev/null || {
  echo "ERROR: 健康检查一直没通过" >&2
  tail -40 "$LOG_FILE" >&2 || true
  exit 1
}

log "部署成功"
echo "    PID:  $NEW_PID"
echo "    监听: $HOST:$PORT"
[ -n "${MSUBGA_BASE_URL:-}" ] && echo "    对外: $MSUBGA_BASE_URL/"
echo "    日志: $LOG_FILE"

# 健康检查走的是 127.0.0.1，绑在回环上也会通过，
# 所以这里必须单独提醒一句，否则「部署成功」但别的机器连不上会很费解。
if [ "$HOST" = "127.0.0.1" ] || [ "$HOST" = "localhost" ]; then
  echo
  echo "    注意：只监听回环，本机以外访问不到。"
  echo "    反向代理在同一台机器上 —— 这是对的，保持不变。"
  echo "    反代在别的机器、或想用 http://<内网IP>:$PORT 直连 —— 把 .env.deploy 里的"
  echo "    HOST 改成 0.0.0.0 再跑一次，并确认防火墙放行了 $PORT。"
fi

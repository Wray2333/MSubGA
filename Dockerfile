# ---------- 构建 ----------
# 全部依赖都是纯 JS（数据库走 Node 内置的 node:sqlite），不需要任何编译工具链。
# 用 bookworm 而不是 alpine 是为了 mihomo 内核：运行时下载的是 linux-amd64 构建，
# glibc 环境最稳妥。
FROM node:22-bookworm-slim AS build

WORKDIR /app

# 先只拷 manifest，依赖没变时这一层可以命中缓存
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- 运行 ----------
FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=27981
ENV MSUBGA_DATA_DIR=/data

WORKDIR /app

# 拉 mihomo 内核和远程规则集都要走 HTTPS
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/drizzle ./packages/server/drizzle
COPY --from=build /app/packages/web/dist ./packages/web/dist

# 数据库、mihomo 内核和它的运行时配置都落在这里，必须挂出去
VOLUME ["/data"]
EXPOSE 27981

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||27981)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]

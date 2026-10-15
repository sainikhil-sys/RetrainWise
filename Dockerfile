# RetrainWise: the complete application in one container
# (Next.js web app + Python ML engine + SQLite databases on a persistent disk).
#
#   docker build -t retrainwise .
#   docker run -p 3000:3000 -v retrainwise-data:/data --env-file .env.production retrainwise
#
# Everything that must survive restarts lives under /data (mount a volume there):
#   /data/app.db            accounts, sessions, workspaces, notifications, audit log
#   /data/workspaces/<id>/  each workspace's engine database and model artifacts
#   /data/datasets/         downloaded real datasets with provenance

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Python engine dependencies (CPU-only, pinned)
FROM base AS python
COPY engine/requirements.txt engine/requirements.txt
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r engine/requirements.txt

# ---- Web app build
FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npx next build

# ---- Runtime
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    RETRAINWISE_PYTHON=/opt/venv/bin/python \
    DATABASE_URL=file:/data/app.db \
    RETRAINWISE_WORKSPACES_DIR=/data/workspaces \
    RETRAINWISE_DATASETS_DIR=/data/datasets \
    PYTHONDONTWRITEBYTECODE=1
COPY --from=python /opt/venv /opt/venv
COPY --from=build /app /app
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "mkdir -p /data/workspaces /data/datasets && npx prisma migrate deploy && npx next start -p ${PORT:-3000} -H 0.0.0.0"]

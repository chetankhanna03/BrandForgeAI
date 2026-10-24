FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV BACKEND_URL=http://127.0.0.1:8000
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    BACKEND_URL=http://127.0.0.1:8000 \
    BRANDFORGE_DB=/var/data/brandforge.db
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ /app/backend/
COPY deploy/start.py /app/deploy/start.py
COPY --from=frontend-build /app/frontend/.next/standalone /app/frontend/
COPY --from=frontend-build /app/frontend/.next/static /app/frontend/.next/static/
COPY --from=frontend-build /app/frontend/public /app/frontend/public/
RUN mkdir -p /var/data && chown -R node:node /var/data /app
USER node
EXPOSE 10000
CMD ["python", "deploy/start.py"]

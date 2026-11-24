# syntax=docker/dockerfile:1
# wled-studio: the web UI (built with Node) served by the Python backend.

# The effect preview: example effects compiled to WebAssembly (platform-independent output), in
# exact colours: WLED's own colour code from the WLED commit of a builder pins file.
FROM --platform=$BUILDPLATFORM emscripten/emsdk:7.0.1@sha256:73aece2e0ab748487945ad117b79fc4d277e9f656e54fc800a9b1a0a6562715b AS preview
ARG BUILDER_REPO=https://github.com/Laffs2k5/wled-studio-builder.git
ARG BUILDER_COMMIT=346df96c0dc38fdb3376a86deb180d3e9bf97523
ARG PREVIEW_PINS=quinled-16.0.1.json
WORKDIR /src
RUN git init -q builder && git -C builder fetch -q --depth 1 "$BUILDER_REPO" "$BUILDER_COMMIT" \
 && git -C builder checkout -q FETCH_HEAD
# The compiled preview contains WLED's colour code (EUPL-1.2) and fastled_slim (MIT): NOTICE.txt
# next to it says where the source is and carries fastled_slim's licence.
RUN set -e; set -- $(python3 -c 'import json, sys; w = json.load(open(sys.argv[1]))["wled"]; print(w["repo"], w["commit"])' "builder/pins/$PREVIEW_PINS") \
 && git init -q wled && git -C wled fetch -q --depth 1 "$1" "$2" && git -C wled checkout -q FETCH_HEAD \
 && WLED_SRC=/src/wled builder/preview/build.sh /out builder/examples/usermods/studio_example_fx \
 && { echo "The effect preview (preview.wasm) contains code from WLED, licensed under the EUPL-1.2:"; \
      echo "colour and palette code, compiled from $1 at commit $2 (wled00/colors.cpp, FX_fcn.cpp,"; \
      echo "palettes.cpp, colors.h), and fastled_slim (MIT, derived from FastLED), whose licence follows."; \
      echo; cat /out/wled-colors/src/dependencies/fastled_slim/LICENSE.txt; } > /out/NOTICE.txt \
 && rm -rf /out/wled-colors

FROM --platform=$BUILDPLATFORM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS web
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
# no install scripts: none of the build's packages need them
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
LABEL org.opencontainers.image.title="wled-studio" \
      org.opencontainers.image.description="A local web app for WLED: looks, playlists, palettes and effect settings" \
      org.opencontainers.image.licenses="EUPL-1.2"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin app \
 && mkdir /data && chown app:app /data
# git and ssh: committing and pushing an effect folder that is a git clone (effects_git.py);
# tzdata: so a TZ set on the container (e.g. Europe/Oslo) applies, to commit times among others
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# dependencies pinned by version and file hash (backend/requirements.txt, generated with
# uv pip compile pyproject.toml --universal --python-version 3.12 --generate-hashes)
COPY backend/requirements.txt ./backend/
RUN pip install --require-hashes -r ./backend/requirements.txt
COPY backend/pyproject.toml ./backend/
COPY backend/src ./backend/src
RUN pip install --no-deps ./backend && rm -rf ./backend
COPY --from=web /src/dist /app/static
COPY --from=preview /out /app/static/preview
ENV WLEDSTUDIO_STATIC=/app/static \
    WLEDSTUDIO_DATA=/data \
    WLEDSTUDIO_BIND=0.0.0.0 \
    WLEDSTUDIO_PORT=8080
USER app
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=2)" || exit 1
ENTRYPOINT ["wled-studio"]

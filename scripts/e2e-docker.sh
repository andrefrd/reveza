#!/bin/sh
# Teste de ponta a ponta da instalação num contêiner Linux descartável (o instalador mexe no HOME e instala serviço):
# instalador de verdade + emulador da nuvem + agente de verdade. Uso: sh scripts/e2e-docker.sh [--com-react-bits]
set -e
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
COPYFILE_DISABLE=1 tar -C "$RAIZ" --exclude=node_modules --exclude=dist --exclude=capturas --exclude=.git -czf "$TMP/reveza.tgz" .
# O repositório fica dentro de um node_modules, como o `npx github:dantaspaulo/reveza` deixa (~/.npm/_npx/<...>/node_modules/
# reveza): o primeiro computador novo de verdade parou num filtro de cópia que olhava o caminho inteiro.
docker run --rm --memory=2g -v "$TMP/reveza.tgz:/reveza.tgz:ro" node:20-alpine sh -c "
  mkdir -p /npx/_npx/e2e/node_modules/reveza && cd /npx/_npx/e2e/node_modules/reveza && tar xzf /reveza.tgz &&
  npm ci --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null &&
  node instalador/testes/e2e.mjs $*"

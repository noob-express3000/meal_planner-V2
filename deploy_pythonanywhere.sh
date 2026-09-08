#!/usr/bin/env bash
set -euo pipefail

USERNAME="$(whoami)"
REPO_DIR="/home/${USERNAME}/the-watchlist"
VENV_DIR="/home/${USERNAME}/.virtualenvs/watchlist"
DOMAIN_SUFFIX="${PA_DOMAIN_SUFFIX:-pythonanywhere.com}"
DOMAIN="${USERNAME}.${DOMAIN_SUFFIX}"

if [ ! -d "${REPO_DIR}/.git" ]; then
  git clone https://github.com/noob-express3000/the-watchlist.git "${REPO_DIR}"
else
  git -C "${REPO_DIR}" pull --ff-only
fi

if [ ! -x "${VENV_DIR}/bin/python" ]; then
  python3.10 -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/pip" install --upgrade pip
"${VENV_DIR}/bin/pip" install -r "${REPO_DIR}/requirements.txt"

COMMAND="${VENV_DIR}/bin/uvicorn --app-dir ${REPO_DIR} --uds \${DOMAIN_SOCKET} app:app"

if pa website get --domain "${DOMAIN}" >/dev/null 2>&1; then
  pa website update --domain "${DOMAIN}" --command "${COMMAND}"
else
  pa website create --domain "${DOMAIN}" --command "${COMMAND}"
fi

printf '\nLive URL: https://%s\n' "${DOMAIN}"
printf 'Health check: https://%s/healthz\n' "${DOMAIN}"

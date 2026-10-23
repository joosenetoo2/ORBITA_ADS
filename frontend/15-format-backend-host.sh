#!/bin/sh
set -e

# Se BACKEND_HOST não estiver definido ou for o valor genérico "backend:8000" / "backend"
if [ -z "$BACKEND_HOST" ] || [ "$BACKEND_HOST" = "backend:8000" ] || [ "$BACKEND_HOST" = "backend" ]; then
    if getent hosts sge_orbita-backend >/dev/null 2>&1; then
        export BACKEND_HOST="sge_orbita-backend:8000"
    elif getent hosts orbita-backend >/dev/null 2>&1; then
        export BACKEND_HOST="orbita-backend:8000"
    elif getent hosts backend >/dev/null 2>&1; then
        export BACKEND_HOST="backend:8000"
    else
        export BACKEND_HOST="sge_orbita-backend:8000"
    fi
fi

# Remover http://, https:// e barra final se o usuário tiver colado a URL completa
export BACKEND_HOST=$(echo "$BACKEND_HOST" | sed -e 's|^http://||' -e 's|^https://||' -e 's|/$||')

# Se não foi fornecida porta, adiciona a porta 8000 padrão
case "$BACKEND_HOST" in
    *:*) ;;
    *) export BACKEND_HOST="${BACKEND_HOST}:8000" ;;
esac

echo "==> Nginx configurado com BACKEND_HOST=${BACKEND_HOST}"

# Garantir que o envsubst do nginx substitua SOMENTE a variável BACKEND_HOST
export NGINX_ENVSUBST_FILTER="BACKEND_HOST"

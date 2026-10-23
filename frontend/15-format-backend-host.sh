#!/bin/sh
set -e

# Garantir valor padrão se a variável não tiver sido definida
if [ -z "$BACKEND_HOST" ]; then
    export BACKEND_HOST="backend:8000"
fi

# Remover http:// ou https:// caso o usuário tenha inserido no Easypanel
export BACKEND_HOST=$(echo "$BACKEND_HOST" | sed -e 's|^http://||' -e 's|^https://||')

# Instruir o envsubst do nginx a substituir SOMENTE a variável BACKEND_HOST,
# preservando intactas as variáveis internas do Nginx ($host, $uri, $scheme, etc.)
export NGINX_ENVSUBST_FILTER="BACKEND_HOST"

#!/bin/sh
set -e

echo "==> Executando migrações do banco de dados..."
python manage.py migrate --noinput

echo "==> Coletando arquivos estáticos..."
python manage.py collectstatic --noinput 2>/dev/null || true

echo "==> Iniciando aplicação..."
exec "$@"

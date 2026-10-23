# Guia de Deploy no Easypanel — Órbita Acadêmico

Este guia explica como hospedar o **Órbita Acadêmico** no [Easypanel](https://easypanel.io) utilizando o repositório GitHub:
👉 **`https://github.com/joosenetoo2/ORBITA_ADS`**

---

## 🏗️ Arquitetura no Easypanel

O projeto roda com 3 componentes em containers Docker:

1. **`db` (PostgreSQL 16):** Banco de dados relacional.
2. **`orbita-backend` (Django / Gunicorn):** API REST em Python 3.12 (porta 8000). Executa migrações automáticas e coleta de estáticos na inicialização.
3. **`orbita-frontend` (React / Vite + Nginx):** SPA em Nginx com suporte a portas 80 e 7895. Faz proxy reverso transparente de `/api/` para o container do backend.

---

## 🚀 Configuração dos Serviços no Easypanel

### 1. Serviço de Banco (PostgreSQL)
- Crie um serviço **Postgres** no Easypanel.
- Nome sugerido: `db` (ou `postgres`).
- Copie a string de conexão interna para usar no backend.

---

### 2. Serviço do Backend (`orbita-backend`)
- **Tipo:** App
- **Fonte:** GitHub (`joosenetoo2/ORBITA_ADS`, branch `main`)
- **Build Path / Root Directory:** `/backend`
- **Build Method:** `Dockerfile` (apontando para `backend/Dockerfile` ou `Dockerfile` relativo ao root)
- **Container Port:** `8000`
- **Variáveis de Ambiente (Environment):**
  ```env
  DATABASE_URL=postgres://usuario:senha@db:5432/nomedobanco
  DJANGO_SECRET_KEY=sua-chave-secreta-longa-e-aleatoria
  DJANGO_DEBUG=false
  DJANGO_ALLOWED_HOSTS=*
  CORS_ALLOWED_ORIGINS=*
  CSRF_TRUSTED_ORIGINS=https://orbita.adsunifip.com,https://sge-orbita-frontend.tiegds.easypanel.host
  ```
  *(O Django agora aceita `*` com conversão automática para `CORS_ALLOW_ALL_ORIGINS = True` e sanitiza as origens confiáveis sem erro 4_0.E001).*

---

### 3. Serviço do Frontend (`orbita-frontend`)
- **Tipo:** App
- **Fonte:** GitHub (`joosenetoo2/ORBITA_ADS`, branch `main`)
- **Build Path / Root Directory:** `/frontend`
- **Build Method:** `Dockerfile`
- **Container Port:** `80` ou `7895` (o Nginx escuta automaticamente em **ambas** as portas!)
- **Variáveis de Ambiente (Environment):**
  ```env
  BACKEND_HOST=sge_orbita-backend:8000
  ```
  *(Se você não preencher, o script detecta automaticamente `sge_orbita-backend:8000` ou `orbita-backend:8000`).*
- **Domínios:**
  - Adicione seu domínio (ex: `https://orbita.adsunifip.com/` ou o domínio padrão `.easypanel.host`).

---

### 4. Criar Superusuário Inicial (Login de Administrador)
Depois que os containers estiverem verdes (Running):
1. Acesse o serviço **`orbita-backend`** no Easypanel.
2. Abra a aba **Console** (terminal do container).
3. Execute:
   ```bash
   python manage.py createsuperuser
   ```
4. Informe o username (ex: `admin`), e-mail e senha.
5. Acesse seu domínio no navegador (`https://orbita.adsunifip.com/`) e entre com o usuário criado!

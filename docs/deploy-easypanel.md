# Guia de Deploy no Easypanel — Órbita Acadêmico

Este guia explica passo a passo como hospedar o **Órbita Acadêmico** no [Easypanel](https://easypanel.io) utilizando o repositório GitHub:
👉 **`https://github.com/joosenetoo2/ORBITA_ADS`**

---

## 🏗️ Arquitetura no Easypanel

O projeto é composto por 3 componentes que rodam isolados e comunicam-se via rede interna do Docker:

1. **`db` (PostgreSQL 16):** Banco de dados relacional.
2. **`backend` (Django / Gunicorn):** API REST em Python 3.12 (porta 8000). Executa migrações automáticas ao iniciar.
3. **`frontend` (React / Vite + Nginx):** Interface SPA com Nginx (porta 80). Faz proxy reverso transparente de `/api/` para o backend (sem problemas de CORS ou cookies!).

---

## 🚀 Método 1: Criação dos Apps Individuais (Recomendado)

### Passo 1: Criar o Projeto no Easypanel
1. No painel do Easypanel, clique em **`+ Project`**.
2. Digite o nome: `orbita` (ou `orbita-academico`).

---

### Passo 2: Criar o Banco de Dados PostgreSQL
1. Dentro do projeto, clique em **`+ Service`** ➔ escolha **`Postgres`**.
2. Dê o nome ao serviço de: **`db`** (ou `postgres`).
3. Clique em **Deploy**.
4. Na aba **Environment** ou **Connection**, copie a string de conexão interna (ex: `postgres://postgres:senha@db:5432/postgres` ou similar).

---

### Passo 3: Criar o Serviço do Backend (API Django)
1. Clique em **`+ Service`** ➔ escolha **`App`**.
2. Dê o nome de: **`backend`**.
3. Na aba **Source**:
   - Selecione **GitHub**.
   - Conecte ao seu repositório: `joosenetoo2/ORBITA_ADS`.
   - Branch: `main`.
   - Build Path / Root Directory: `/backend` (ou selecione Dockerfile e aponte para `backend/Dockerfile`).
4. Na aba **Build**:
   - Build Method: **`Dockerfile`**.
   - Dockerfile Path: `Dockerfile` (se o root directory for `/backend`) ou `backend/Dockerfile`.
5. Na aba **Environment** (variáveis de ambiente), adicione:
   ```env
   DATABASE_URL=postgres://usuario:senha@db:5432/nomedobanco
   DJANGO_SECRET_KEY=gere-uma-chave-longa-e-segura-aqui
   DJANGO_DEBUG=false
   DJANGO_ALLOWED_HOSTS=*
   CORS_ALLOWED_ORIGINS=https://seu-dominio.com.br
   CSRF_TRUSTED_ORIGINS=https://seu-dominio.com.br
   ```
   *(Substitua `DATABASE_URL` pela URL real gerada no Passo 2 e `seu-dominio.com.br` pelo domínio que você vai usar).*
6. Na aba **Deploy**:
   - Container Port: **`8000`**.
7. Clique em **Deploy**. O backend irá compilar a imagem, aplicar as migrações no banco e iniciar o servidor Gunicorn!

---

### Passo 4: Criar o Serviço do Frontend (React + Nginx)
1. Clique em **`+ Service`** ➔ escolha **`App`**.
2. Dê o nome de: **`frontend`**.
3. Na aba **Source**:
   - Selecione **GitHub**.
   - Repositório: `joosenetoo2/ORBITA_ADS`.
   - Branch: `main`.
   - Build Path / Root Directory: `/frontend` (ou aponte para `frontend/Dockerfile`).
4. Na aba **Build**:
   - Build Method: **`Dockerfile`**.
   - Dockerfile Path: `Dockerfile` (se o root directory for `/frontend`) ou `frontend/Dockerfile`.
5. Na aba **Environment**:
   ```env
   BACKEND_HOST=backend:8000
   ```
   *(Caso tenha dado outro nome ao serviço do backend no Passo 3, use `nome-do-servico:8000`).*
6. Na aba **Domains**:
   - Adicione seu domínio público (ex: `grade.meudominio.com.br`).
   - O Easypanel gerará o certificado SSL HTTPS (Let's Encrypt) automaticamente.
7. Na aba **Deploy**:
   - Container Port: **`80`**.
8. Clique em **Deploy**.

---

### Passo 5: Criar o Superusuário Inicial (Administrador)
Depois que os containers estiverem rodando:
1. Vá até o serviço **`backend`** no Easypanel.
2. Clique na aba **Console** (terminal web do container).
3. Execute o comando:
   ```bash
   python manage.py createsuperuser
   ```
4. Informe o nome de usuário (ex: `admin`), e-mail e defina a senha.
5. Pronto! Acesse seu domínio no navegador e faça login com as credenciais criadas.

---

## ⚡ Método 2: Via Docker Compose (Tudo em 1 Clique)

O Easypanel também suporta subir a stack inteira via Docker Compose:

1. No Easypanel, clique em **`+ Service`** ➔ **`Docker Compose`**.
2. Dê o nome de `orbita-stack`.
3. Conecte ao GitHub `joosenetoo2/ORBITA_ADS` selecionando o arquivo `docker-compose.yml`.
4. Defina as variáveis no painel:
   - `POSTGRES_PASSWORD`: defina uma senha forte.
   - `DJANGO_SECRET_KEY`: defina uma chave secreta.
   - `APP_URL`: seu domínio HTTPS (ex: `https://grade.meudominio.com.br`).
5. Aponte o domínio no Easypanel para a porta 80 do serviço `frontend`.
6. Clique em **Deploy**.

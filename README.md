# Órbita Acadêmico

Primeira base de implementação da [spec do MVP](orbita_academico_sdd_mvp_v1_1.md). O repositório contém um backend Django REST e uma interface React/TypeScript. Esta entrega cobre a base das fases 0 e 1 e inicia a fase 2 com alocação manual, prévia de conflitos e leitura semanal. Geração CP-SAT e publicação ainda não estão implementadas.

## Uso da grade

A aplicação abre diretamente na grade semanal, seguindo a [forma de trabalho da planilha](docs/fluxo-grade-planilha.md). Em **Nova grade**, informe curso, período, turmas e faixas de horário. Depois clique em uma célula para preencher disciplina, professor, sala e duração; os cadastros necessários são feitos ao salvar. A alternância **Por professor** mostra as aulas de cada docente. **Colar planilha** recebe uma área tabulada de aulas de uma turma por vez, com duas linhas por célula (`Disciplina` e `Professor - Sala`).

Para uma grade criada antes deste editor: abra **Grade de aulas** no menu. Se as turmas aparecerem sem linhas de horário, use **Configurar horários** na própria grade. Depois clique no botão **+** no cruzamento da turma, dia e horário desejados. Os campos da aula sugerem as disciplinas, professores e salas já cadastrados.

## Requisitos

- Python 3.11 ou superior
- Node.js 20 ou superior
- PostgreSQL 16 (o `docker-compose.yml` oferece apenas o banco)

## Início local

1. Execute `docker compose up -d db` ou disponibilize um PostgreSQL equivalente.
2. Em `backend/`, crie um ambiente virtual, instale `requirements.txt` e configure as variáveis de `backend/.env.example` no ambiente. O arquivo `.env` não é carregado automaticamente.
3. Execute `python manage.py migrate` e `python manage.py createsuperuser`. A migração inicial já está em `backend/academic/migrations/`.
4. Execute `python manage.py runserver`.
5. Em `frontend/`, execute `npm install` e `npm run dev`.
6. Acesse `http://localhost:5173`. A tela de login aparece antes da plataforma; entre com o usuário criado no passo 3. A sessão pode ser encerrada pelo botão **Sair** no topo.

No ambiente atual do projeto, Python 3.13.17 e as dependências estão instalados em `backend/.venv`. Esse diretório é local e não deve ser versionado. Para executar os testes sem PostgreSQL, defina `DATABASE_URL=sqlite:///:memory:` somente durante o comando de teste; a configuração normal da aplicação continua apontando para PostgreSQL.

Para uma avaliação local no Windows sem PostgreSQL, execute `backend/run-local.ps1 -CreateSuperuser` uma vez e depois `backend/run-local.ps1` em um terminal; execute `npm run dev` em `frontend/` em outro. O script usa `backend/db.sqlite3` apenas nesse modo local. Para a configuração com PostgreSQL, siga os passos acima.

## API e permissões

Os endpoints de dados começam em `/api/v1/` e exigem sessão autenticada. `/api/v1/auth/session/`, `/api/v1/auth/login/` e `/api/v1/auth/logout/` cuidam da entrada e saída; login e saída exigem token CSRF. Grupos Django reconhecidos: `Administrador`, `Coordenador` e `Colaborador acadêmico`; superusuários possuem acesso de escrita. Crie os grupos pelo Admin antes de atribuir usuários. Configurações de instituição e janelas exigem `Administrador`. Escritas comuns são permitidas aos três grupos. Exclusão física de cadastros está desativada na API.

Recursos iniciais: instituição, períodos, cursos, disciplinas, matrizes, professores, salas, turmas, ofertas, requisitos de encontros, perfis/janelas/bloqueios e grades. Em `/api/v1/schedules/{id}/sessions/`, a escrita exige `If-Match` com a revisão atual da grade; a resposta inclui `session` e a nova `revision`. `POST /api/v1/schedules/{id}/sessions/preview/` verifica uma alocação sem salvá-la. A validação verifica duração, janelas, bloqueios, elegibilidade, capacidade, recursos, limite semanal docente e conflitos de professor/sala/turma no mesmo período letivo. Use `/api/v1/schedules/{id}/validate/` para avaliar o rascunho. Alterações em perfis, janelas e bloqueios que invalidariam alocações existentes são recusadas com os IDs afetados.

Na interface, um encontro pode ser aberto para edição por formulário ou arrastado para outro dia da semana. O arraste mantém o horário e os recursos, abre uma prévia e exige confirmação explícita. A edição por formulário permite alterar dia, horário, professor e sala sem usar arrastar e soltar.

## Verificação

- `cd frontend && npm run build`
- `cd backend && python manage.py check && python manage.py makemigrations --check --dry-run && python manage.py test`

## Próximas etapas

1. Versionar a migração inicial e validar os testes do backend em Python/PostgreSQL.
2. Completar disponibilidade contextual e a prévia de conflitos no editor.
3. Implementar o solver OR-Tools e seu validador independente antes de permitir aplicação de propostas.
4. Implementar auditoria, publicação imutável, exportação e verificação de acessibilidade.

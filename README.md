# Órbita Acadêmico

Aplicação web baseada na [spec do MVP](orbita_academico_sdd_mvp_v1_1.md), com backend Django REST e interface React/TypeScript. A grade pode ser montada manualmente, validada e publicada em uma consulta pública. A geração automática CP-SAT ainda está pendente.

## Uso da grade

O fluxo recomendado é: cadastrar cada disciplina com seu período curricular; criar cada turma com período curricular e turno (Manhã ou Noite); preparar as ofertas com professores; montar a grade do turno; validar e publicar. A oferta mostra somente disciplinas do período da turma. Grades de Manhã e Noite são independentes e podem ser alternadas em **Grade Ativa**. **Excluir grade** remove aulas e versões após confirmação, preservando turmas e ofertas.

O coordenador ou administrador publica uma grade completa pelo botão **Publicar horário**. A publicação salva um instantâneo imutável: edições posteriores ficam no rascunho até **Republicar alterações**. A consulta dos alunos está em `/horarios`, sem login, com filtros por grade, período curricular, turma, dia, professor e sala. **Retirar publicação** oculta a grade pública sem apagar o rascunho.

A aplicação abre diretamente na grade semanal, seguindo a [forma de trabalho da planilha](docs/fluxo-grade-planilha.md). Cadastre as turmas, disciplinas e professores; em **Cadastros → Ofertas de Disciplinas**, escolha uma turma, marque várias disciplinas, atribua um professor a cada uma e clique em **Salvar ofertas**. Em seguida, **Criar horário com estas ofertas** abre a grade do curso e período. Configure as faixas de horário, se necessário, e clique em uma célula para alocar uma disciplina ofertada, seu professor vinculado, sala e duração. A alternância **Por professor** mostra as aulas de cada docente. **Colar planilha** recebe uma área tabulada de aulas de uma turma por vez, com duas linhas por célula (`Disciplina` e `Professor - Sala`); as disciplinas também precisam estar ofertadas previamente.

Para uma grade criada antes deste editor: abra **Grade de aulas** no menu. Se as turmas aparecerem sem linhas de horário, use **Configurar horários** na própria grade. O modal mostra os dias e as faixas de 60 minutos derivados das janelas ativas em **Regras de horário**; **Aplicar janelas na grade** atualiza a matriz e preserva as aulas alocadas. Se uma aula existente não couber nas novas janelas do seu dia, a atualização é recusada até que a janela seja ajustada. Depois clique no botão **+** no cruzamento da turma, dia e horário desejados. A grade permite apenas disciplinas ofertadas para a turma e professores vinculados à oferta. Salas podem ser informadas ao salvar.

As aulas de várias faixas aparecem como blocos únicos. Arraste um bloco para outro dia ou horário livre **da mesma turma**. O sistema valida professor, sala e turma ao soltar; se houver conflito, a aula permanece no local original. O formulário do bloco também permite mudar dia e horário por teclado ou toque.

O cabeçalho de cada turma ou professor mostra disciplinas distintas, blocos agendados e aulas presenciais de 60 minutos com o total de horas. Por exemplo, uma disciplina de 4 horas alocada em dois blocos aparece como **1 disciplina · 2 blocos · 4 aulas / 4 h presenciais**. Horas EAD não entram nessa conta.

Em **Cadastros**, disciplinas usam créditos, horas presenciais semanais e horas EAD semanais. Cada crédito representa 1 hora-aula semanal de 60 minutos e 20 horas-aula totais: 4 créditos correspondem a 80 horas totais e podem ser distribuídos em 3 horas presenciais + 1 hora EAD por semana. Apenas as horas presenciais entram na grade. A ação **Ofertar · professor** liga disciplina, turma e docente e prepara automaticamente os blocos semanais; não é necessário cadastrar “encontros requeridos”. Existe uma única oferta de cada disciplina por turma. Repetir a oferta com o mesmo professor é recusado; vincular outro professor mantém a oferta e não cria novas aulas. A grade aceita apenas os blocos previstos dentro das horas presenciais semanais. Em **Importar em lote**, é possível carregar CSV/TSV ou colar linhas para cursos, disciplinas, professores, salas, turmas e ofertas. O CSV de disciplinas usa a coluna `horas_ead`; modelos antigos com percentual são rejeitados para evitar conversão ambígua. **Regras de horário** agrupa as janelas por perfil.

Em **Regras de horário**, **Ativar Manhã e Noite** cria os dois perfis vigentes com janelas editáveis de segunda a sexta (08:00–12:00 e 17:50–21:50). A alocação exige 11 horas de descanso do professor entre dias consecutivos: após terminar às 21:50, a próxima aula pode começar às 08:50 ou depois. Intervalos dentro do mesmo dia podem ser cadastrados como bloqueios de horário por instituição, curso, turma ou professor.

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

Os endpoints de dados começam em `/api/v1/` e exigem sessão autenticada, exceto `/api/v1/public/schedules/` e `/api/v1/public/schedules/{id}/`, que retornam apenas versões publicadas. `/api/v1/auth/session/`, `/api/v1/auth/login/` e `/api/v1/auth/logout/` cuidam da entrada e saída; login e saída exigem token CSRF. Grupos Django reconhecidos: `Administrador`, `Coordenador` e `Colaborador acadêmico`; superusuários possuem acesso de escrita. Crie os grupos pelo Admin antes de atribuir usuários. Configurações de instituição e janelas exigem `Administrador`. A publicação e a retirada exigem `Administrador` ou `Coordenador`.

Recursos iniciais: instituição, períodos, cursos, disciplinas, matrizes, professores, salas, turmas, ofertas, requisitos internos de encontros, perfis/janelas/bloqueios e grades. A importação em lote usa `POST /api/v1/batch-import/` e é transacional. A ação `POST /api/v1/subjects/{id}/offer/` cria ou atualiza uma oferta individual. `POST /api/v1/subject-offerings/bulk-assign/` recebe `group_id` e `items` com `subject_id`, `teacher_id` e `block_hours`; a operação inteira é transacional. `POST /api/v1/schedules/from-offerings/` cria ou abre a grade do curso, período letivo e turno de uma turma com oferta. Em `/api/v1/schedules/{id}/sessions/`, a escrita exige `If-Match` com a revisão atual da grade; a resposta inclui `session` e a nova `revision`. `POST /api/v1/schedules/{id}/sessions/preview/` verifica uma alocação sem salvá-la. A validação verifica duração, janelas, bloqueios, elegibilidade, capacidade, recursos e conflitos de professor/sala/turma no mesmo período letivo. Use `/api/v1/schedules/{id}/validate/` para avaliar o rascunho; `POST /api/v1/schedules/{id}/publish/` para publicar e `POST /api/v1/schedules/{id}/unpublish/` para retirar a publicação. Alterações em perfis, janelas e bloqueios que invalidariam alocações existentes são recusadas com os IDs afetados.

Na interface principal, o bloco pode ser aberto para edição ou arrastado para uma célula livre da mesma turma. A gravação do arraste é validada pela API e revertida quando houver conflito. O editor detalhado legado continua disponível para ajustes avançados.

## Verificação

- `cd frontend && npm run build`
- `cd backend && python manage.py check && python manage.py makemigrations --check --dry-run && python manage.py test`

## Próximas etapas

1. Versionar a migração inicial e validar os testes do backend em Python/PostgreSQL.
2. Completar disponibilidade contextual e a prévia de conflitos no editor.
3. Implementar o solver OR-Tools e seu validador independente antes de permitir aplicação de propostas.
4. Completar comparação entre versões publicadas, exportação PDF/XLSX e verificação de acessibilidade.

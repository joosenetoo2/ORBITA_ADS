# Órbita Acadêmico

Aplicação web baseada na [spec do MVP](orbita_academico_sdd_mvp_v1_1.md), com backend Django REST e interface React/TypeScript. A grade pode ser montada manualmente, receber propostas de geração automática, ser validada e publicada em uma consulta pública.

## Disponibilidade docente

Em **Disponibilidade docente**, selecione o período letivo e o professor. Cadastre uma faixa para vários dias de uma vez:

- **Pode lecionar:** quando existir ao menos uma faixa desse tipo para o professor no período, cada aula deve caber integralmente em uma delas. Sem faixas desse tipo, valem as janelas gerais da grade.
- **Indisponível:** bloqueia aulas que cruzem a faixa, mesmo dentro de uma faixa permitida.
- **Preferido:** orienta a geração automática, sem bloquear uma alocação manual fora da faixa.

As regras são semanais e valem para as grades da manhã e da noite do mesmo período letivo. Horários administrativos avulsos continuam sendo cadastrados na visão **Por professor**. Criar, editar ou excluir uma regra rígida que invalidaria aulas já alocadas é recusado com a lista de aulas afetadas. A geração automática usa as mesmas restrições e prioriza as faixas preferidas.

## Uso da grade

O fluxo recomendado é: cadastrar cada disciplina com seu período curricular; criar cada turma com período curricular e turno (Manhã ou Noite); preparar as ofertas com professores; montar a grade do turno; validar e publicar. A oferta mostra somente disciplinas do período da turma. Grades de Manhã e Noite são independentes e podem ser alternadas em **Grade Ativa**. **Excluir grade** remove aulas e versões após confirmação, preservando turmas e ofertas.

O coordenador ou administrador publica uma grade completa pelo botão **Publicar horário**. A publicação salva um instantâneo imutável: edições posteriores ficam no rascunho até **Republicar alterações**. A consulta dos alunos está em `/horarios`, sem login, com filtros por grade, período curricular, turma, dia, professor e sala. **Retirar publicação** oculta a grade pública sem apagar o rascunho.

A aplicação abre diretamente na grade semanal, seguindo a [forma de trabalho da planilha](docs/fluxo-grade-planilha.md). Cadastre as turmas, disciplinas e professores; em **Cadastros → Ofertas de Disciplinas**, escolha uma turma, marque várias disciplinas, atribua um professor a cada uma e clique em **Salvar ofertas**. Em seguida, **Criar horário com estas ofertas** abre a grade do curso e período. Configure as faixas de horário, se necessário, e clique em uma célula para alocar uma disciplina ofertada, seu professor vinculado, sala e duração. A alternância **Por professor** mostra as aulas de cada docente. **Colar planilha** recebe uma área tabulada de aulas de uma turma por vez, com duas linhas por célula (`Disciplina` e `Professor - Sala`); as disciplinas também precisam estar ofertadas previamente.

Em **Grade de aulas → Por professor**, a matriz semanal reúne as aulas de todas as grades do período letivo selecionado, incluindo manhã e noite, e os compromissos avulsos de tarde ou de qualquer outro horário. As linhas são geradas pelos horários efetivamente cadastrados. Escolha um docente e use **Adicionar horário avulso** para registrar, por exemplo, orientação administrativa; o compromisso aparece somente na visão docente e não integra a grade da turma nem o horário público dos alunos. A aba **Balanço de horas** mostra aulas, blocos, horários avulsos, horas totais e alertas de intervalo por professor. É possível voltar à semana de um professor diretamente do painel.

Para uma grade criada antes deste editor: abra **Grade de aulas** no menu. Se as turmas aparecerem sem linhas de horário, use **Configurar horários** na própria grade. O modal mostra os dias e as faixas de 60 minutos derivados das janelas ativas em **Regras de horário**; **Aplicar janelas na grade** atualiza a matriz e preserva as aulas alocadas. Se uma aula existente não couber nas novas janelas do seu dia, a atualização é recusada até que a janela seja ajustada. Depois clique no botão **+** no cruzamento da turma, dia e horário desejados. A grade permite apenas disciplinas ofertadas para a turma e professores vinculados à oferta. Salas podem ser informadas ao salvar.

As aulas de várias faixas aparecem como blocos únicos. Arraste um bloco para outro dia ou horário livre **da mesma turma**. O sistema valida professor, sala e turma ao soltar; se houver conflito, a aula permanece no local original. O formulário do bloco também permite mudar dia e horário por teclado ou toque.

O cabeçalho de cada turma ou professor mostra disciplinas distintas, blocos agendados e aulas presenciais de 60 minutos com o total de horas. Por exemplo, uma disciplina de 4 horas alocada em dois blocos aparece como **1 disciplina · 2 blocos · 4 aulas / 4 h presenciais**. Horas EAD não entram nessa conta.

Em **Cadastros**, disciplinas usam créditos, horas presenciais semanais e horas EAD semanais. Cada crédito representa 1 hora-aula semanal de 60 minutos e 20 horas-aula totais: 4 créditos correspondem a 80 horas totais e podem ser distribuídos em 3 horas presenciais + 1 hora EAD por semana. Apenas as horas presenciais entram na grade. A ação **Ofertar · professor** liga disciplina, turma e docente e prepara automaticamente os blocos semanais; não é necessário cadastrar “encontros requeridos”. Existe uma única oferta de cada disciplina por turma. Repetir a oferta com o mesmo professor é recusado; vincular outro professor mantém a oferta e não cria novas aulas. A grade aceita apenas os blocos previstos dentro das horas presenciais semanais. Em **Importar em lote**, é possível carregar CSV/TSV ou colar linhas para cursos, disciplinas, professores, salas, turmas e ofertas. O CSV de disciplinas usa a coluna `horas_ead`; modelos antigos com percentual são rejeitados para evitar conversão ambígua. **Regras de horário** agrupa as janelas por perfil.

Em **Regras de horário**, **Ativar Manhã e Noite** cria os dois perfis vigentes com janelas editáveis de segunda a sexta (08:00–12:00 e 17:50–21:50). A validação considera todas as grades e horários avulsos do professor no mesmo período letivo: exige 11 horas de descanso entre dias consecutivos, 15 minutos de intervalo para carga diária acima de 4 até 6 horas e 60 minutos acima de 6 horas, conforme os parâmetros gerais dos [arts. 66 e 71 da CLT](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm). Uma atividade longa com intervalo deve ser cadastrada em blocos separados. Acordos aplicáveis à instituição precisam ser conferidos antes de usar os alertas como verificação trabalhista definitiva.

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

Recursos iniciais: instituição, períodos, cursos, disciplinas, matrizes, professores, salas, turmas, ofertas, requisitos internos de encontros, perfis/janelas/bloqueios e grades. A importação em lote usa `POST /api/v1/batch-import/` e é transacional. A ação `POST /api/v1/subjects/{id}/offer/` cria ou atualiza uma oferta individual. `POST /api/v1/subject-offerings/bulk-assign/` recebe `group_id` e `items` com `subject_id`, `teacher_id` e `block_hours`; a operação inteira é transacional. `POST /api/v1/schedules/from-offerings/` cria ou abre a grade do curso, período letivo e turno de uma turma com oferta. Em `/api/v1/schedules/{id}/sessions/`, a escrita exige `If-Match` com a revisão atual da grade; a resposta inclui `session` e a nova `revision`. `POST /api/v1/schedules/{id}/sessions/preview/` verifica uma alocação sem salvá-la. A validação verifica duração, janelas, bloqueios, elegibilidade, recursos, disponibilidade docente e conflitos de professor/sala/turma no mesmo período letivo. Use `/api/v1/schedules/{id}/validate/` para avaliar o rascunho; `POST /api/v1/schedules/{id}/publish/` para publicar e `POST /api/v1/schedules/{id}/unpublish/` para retirar a publicação. Alterações em perfis, janelas, bloqueios e disponibilidade docente que invalidariam alocações existentes são recusadas com os IDs afetados.

`GET /api/v1/teacher-availability/?term_id=...&teacher_id=...` lista as regras semanais. `POST /api/v1/teacher-availability/` aceita `weekdays` para criar a mesma faixa em vários dias; `PATCH` e `DELETE` atuam em uma faixa. Somente coordenadores e administradores podem alterar essas regras.

Na interface principal, o bloco pode ser aberto para edição ou arrastado para uma célula livre da mesma turma. A gravação do arraste é validada pela API e revertida quando houver conflito. O editor detalhado legado continua disponível para ajustes avançados.

## Verificação

- `cd frontend && npm run build`
- `cd backend && python manage.py check && python manage.py makemigrations --check --dry-run && python manage.py test`

## Próximas etapas

1. Versionar a migração inicial e validar os testes do backend em Python/PostgreSQL.
2. Completar disponibilidade contextual e a prévia de conflitos no editor.
3. Executar a busca OR-Tools em um worker para grades grandes e aprofundar os diagnósticos de inviabilidade.
4. Completar comparação entre versões publicadas, exportação PDF/XLSX e verificação de acessibilidade.

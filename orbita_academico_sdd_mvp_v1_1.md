# ORBITA Acadêmico — Especificação SDD do MVP

**Versão:** 1.1  
**Status:** Base aprovada para detalhamento e implementação  
**Tipo:** Documento de requisitos e especificações para Spec-Driven Development  
**Idioma:** Português brasileiro

---

## 1. Objetivo

Desenvolver uma aplicação web para uma instituição de ensino superior que permita cadastrar sua estrutura acadêmica, montar grades horárias por curso e período letivo, editar alocações visualmente e gerar propostas de horários automaticamente por meio de um motor de otimização baseado em Google OR-Tools CP-SAT.

O documento é a fonte de verdade inicial para produto, domínio, arquitetura, API, testes e implementação. Mudanças nos requisitos devem atualizar este documento e as especificações afetadas antes ou junto da alteração do código.

## 2. Decisões aprovadas

| Tema | Decisão |
|---|---|
| Instituição | Uma instituição ativa no MVP; arquitetura preparada para expansão futura |
| Turnos | Janelas de dias e horários configuráveis, sem turnos fixos obrigatórios |
| Tempo | Hora-aula e hora-relógio configuráveis e explicitamente diferenciadas |
| Turmas compartilhadas | Fora do MVP; cada turma pertence a um único curso |
| Unidade de planejamento | Uma grade por curso e período letivo |
| Recursos globais | Disponibilidade e conflitos de professores e salas são validados entre grades |
| Frontend | React + TypeScript |
| Backend | Python + Django + Django REST Framework |
| Banco | PostgreSQL |
| Otimização | Google OR-Tools CP-SAT |
| Entrada de dados | Cadastro manual; importação e integração externa fora do MVP |
| Edição | Editor visual e edição por formulários |
| Publicação | Rascunhos, validação, versões e publicação controlada |

## 3. Objetivos do MVP

1. Manter cadastros acadêmicos necessários à montagem de horários.
2. Configurar períodos letivos, dias, janelas de funcionamento, intervalos e duração da hora-aula.
3. Definir a oferta de disciplinas por turma em um período letivo.
4. Registrar carga horária, quantidade e duração de encontros, professores elegíveis, requisitos de sala e restrições.
5. Montar e alterar uma grade manualmente.
6. Validar conflitos locais e conflitos com outras grades do mesmo período de planejamento.
7. Gerar uma ou mais propostas automaticamente.
8. Preservar grades publicadas e manter histórico de versões.
9. Consultar grades por turma, professor e sala.
10. Exportar grades em PDF e XLSX, caso essas exportações sejam incluídas no corte final do MVP.

## 4. Fora do escopo do MVP

- Matrícula de estudantes, notas, frequência e diário de classe.
- Folha de pagamento ou gestão contratual de docentes.
- Compartilhamento de uma mesma aula entre turmas de cursos diferentes.
- Importação por planilhas, integração com ERP/SIS ou APIs externas.
- Aplicativos móveis nativos.
- Planejamento integrado com otimização simultânea de todos os cursos.
- Distribuição automática de estudantes em salas.
- Calendário detalhado de encontros por data, feriados e reposições; o MVP trabalha principalmente com grade semanal recorrente.
- Inteligência artificial generativa para decidir alocações. O motor de decisão é baseado em restrições e otimização.

## 5. Vocabulário do domínio

- **Curso:** programa de graduação, por exemplo, Análise e Desenvolvimento de Sistemas.
- **Matriz curricular:** versão do currículo de um curso.
- **Período curricular:** etapa da matriz, como 1º ou 2º período.
- **Disciplina:** item do catálogo acadêmico.
- **Turma:** grupo acadêmico de um curso, como ADS-2027.1-A.
- **Oferta de disciplina:** instância de uma disciplina oferecida para uma turma em um período letivo.
- **Encontro:** ocorrência semanal de uma oferta, com duração definida.
- **Alocação:** associação de encontro, dia, horário, professor e sala.
- **Grade:** conjunto de alocações para um curso e período letivo.
- **Versão da grade:** snapshot imutável de uma grade em determinado estado.
- **Hora-aula:** unidade acadêmica configurável, que pode ter duração diferente de 60 minutos.
- **Hora-relógio:** duração efetiva em minutos.
- **Restrição rígida:** condição que toda solução válida deve cumprir.
- **Preferência flexível:** condição desejável, penalizada se não atendida.
- **Geração:** execução do motor de otimização sobre um cenário de planejamento.

## 6. Perfis e permissões

### 6.1 Papéis

| Papel | Permissões |
|---|---|
| Administrador | Configura instituição, usuários, papéis e parâmetros globais |
| Coordenador | Gerencia dados acadêmicos, ofertas, grades, geração, validação e publicação |
| Colaborador acadêmico | Mantém cadastros e edita grades conforme permissões concedidas |
| Professor | Consulta sua disponibilidade e suas grades publicadas; edição de disponibilidade só se autorizada |
| Consulta | Visualiza grades publicadas sem alteração |

### 6.2 Regras de autorização

- Todas as operações de escrita devem verificar autorização no servidor.
- A interface não pode ser o único mecanismo de controle de acesso.
- Ações de publicação, arquivamento e alteração de configurações globais devem exigir permissão específica.
- O MVP pode utilizar um único tenant institucional, mas entidades centrais devem ter uma fronteira de instituição preparada para futura expansão, sem implementar multi-tenancy complexo prematuramente.
- Registrar eventos de auditoria para publicação, despublicação, alteração de restrições, exclusão lógica e mudanças de alocações.

## 7. Requisitos funcionais

### 7.1 Cadastros

**RF-001 — Configuração institucional**  
O sistema deve permitir configurar nome da instituição, fuso horário, dias de funcionamento, unidade de hora-aula, duração padrão em minutos e parâmetros de grade.

**RF-002 — Período letivo**  
Deve permitir criar períodos com nome, data inicial, data final e status. Períodos encerrados não podem receber novas publicações sem reabertura autorizada.

**RF-003 — Cursos**  
Deve permitir cadastrar código, nome, modalidade, duração prevista e status.

**RF-004 — Matrizes curriculares**  
Deve permitir criar versões de matriz vinculadas a um curso, com períodos curriculares e disciplinas.

**RF-005 — Disciplinas**  
Deve permitir cadastrar código, nome, descrição, carga horária, unidade de referência, natureza e requisitos de espaço/equipamento.

**RF-006 — Professores**  
Deve permitir cadastrar identificador interno, nome, status, carga máxima semanal configurada e qualificações por disciplina.

**RF-007 — Salas**  
Deve permitir cadastrar código, nome, capacidade, localização, status e recursos disponíveis.

**RF-008 — Disponibilidade docente**  
Deve permitir definir intervalos semanais disponíveis, indisponíveis e preferenciais.

**RF-009 — Disponibilidade de salas**  
Deve permitir definir janelas de funcionamento, bloqueios e recursos da sala.

**RF-010 — Janelas de turma**  
Deve permitir definir dias e intervalos em que a turma pode ter aula.

**RF-011 — Ofertas**  
Deve permitir criar ofertas de disciplinas associadas a turma e período letivo.

**RF-012 — Encontros requeridos**  
Deve permitir definir para cada oferta o número de encontros semanais e a duração de cada encontro em minutos ou unidades de hora-aula convertidas explicitamente.

### 7.2 Editor de grade

**RF-013 — Visualização semanal**  
Exibir dias e intervalos configurados, com blocos de aula proporcionais à duração.

**RF-014 — Alocação manual**  
Permitir alocar um encontro a dia, horário, professor e sala.

**RF-015 — Arrastar e soltar**  
Permitir mover encontros, apresentando uma prévia de validade antes de confirmar.

**RF-016 — Validação imediata**  
Verificar conflitos de professor, sala, turma, disponibilidade, duração e requisitos de espaço após qualquer alteração.

**RF-017 — Explicação de conflito**  
Informar o recurso em conflito, o horário, a alocação concorrente e a regra violada, quando esses dados estiverem disponíveis.

**RF-018 — Alocação bloqueada**  
Permitir bloquear uma alocação para que seja preservada durante uma geração posterior.

**RF-019 — Desfazer/refazer**  
Permitir desfazer e refazer mudanças recentes na sessão de edição; alterações confirmadas no servidor devem continuar auditáveis.

**RF-020 — Rascunho**  
Permitir salvar grades incompletas sem publicação.

### 7.3 Geração automática

**RF-021 — Criar execução**  
Permitir solicitar uma geração para um curso e período letivo, selecionando ofertas, restrições e limite de tempo.

**RF-022 — Respeitar alocações externas**  
Por padrão, o gerador deve tratar alocações de outras grades no mesmo período como ocupações fixas dos recursos globais compartilhados.

**RF-023 — Restrições rígidas**  
Nenhuma proposta aceita como válida pode violar restrições rígidas.

**RF-024 — Preferências ponderadas**  
Otimizar preferências configuradas usando pesos explícitos e documentados.

**RF-025 — Estados da geração**  
Expor os estados `PENDING`, `RUNNING`, `FEASIBLE`, `OPTIMAL`, `INFEASIBLE`, `UNKNOWN`, `FAILED` e `CANCELLED`.

**RF-026 — Diagnóstico**  
Quando o modelo for comprovadamente inviável, apresentar diagnóstico disponível. Quando houver timeout sem prova de inviabilidade, apresentar `UNKNOWN`, e não afirmar que não existe solução.

**RF-027 — Alternativas**  
Permitir guardar propostas distintas e compará-las por pontuação, alocações e preferências atendidas.

**RF-028 — Regeneração parcial**  
Permitir regenerar ofertas selecionadas mantendo as alocações bloqueadas e as alocações externas protegidas.

**RF-029 — Aplicar proposta**  
Uma proposta só passa a alterar o rascunho depois de uma ação explícita do usuário e nova validação no servidor.

### 7.4 Validação e publicação

**RF-030 — Validação completa**  
Validar carga horária, quantidade de encontros, conflitos, disponibilidade, sala, capacidade e recursos.

**RF-031 — Publicação protegida**  
Bloquear publicação se existir violação rígida ou pendência obrigatória.

**RF-032 — Versionamento**  
Cada publicação deve gerar uma versão imutável identificada e datada.

**RF-033 — Histórico**  
Permitir consultar autor, data e diferenças entre versões.

**RF-034 — Consultas**  
Permitir visualizar grades por curso, período, turma, professor e sala.

**RF-035 — Exportação**  
Disponibilizar exportação em PDF e XLSX, com identificação da versão publicada ou do rascunho exportado.

## 8. Regras de negócio e invariantes

### 8.1 Tempo e carga horária

1. O banco deve armazenar os horários como minutos desde o início do dia ou como `time` com regra explícita de conversão; não armazenar duração apenas como texto.
2. A duração efetiva de cada encontro deve ser representada em minutos.
3. A instituição configura a duração padrão da hora-aula em minutos.
4. A carga curricular total e a carga semanal devem possuir unidade explícita.
5. Conversões entre hora-aula e hora-relógio devem ocorrer por regra explícita e auditável.
6. O sistema não deve presumir que uma hora-aula equivale a 60 minutos.
7. O intervalo de aula é tratado como semiaberto `[início, fim)`, de modo que uma aula terminando às 20:00 pode ser seguida por outra começando às 20:00, desde que não exista intervalo obrigatório.
8. A grade semanal recorrente é o modelo principal do MVP.

### 8.2 Restrições rígidas

- Um professor não pode estar alocado em encontros sobrepostos.
- Uma sala não pode receber encontros sobrepostos.
- Uma turma não pode ter encontros sobrepostos.
- Um encontro deve ocorrer dentro das janelas permitidas da turma.
- O professor deve estar disponível durante todo o encontro.
- A sala deve estar disponível durante todo o encontro.
- A sala deve possuir capacidade suficiente, quando a capacidade for obrigatória.
- A sala deve possuir todos os recursos exigidos pela oferta.
- A quantidade e a duração dos encontros devem cumprir o padrão configurado para a oferta.
- Alocações bloqueadas não podem ser alteradas por geração automática.
- Alocações existentes em outras grades são consideradas ocupações fixas dos professores e salas no período temporal relevante.
- Grades publicadas não podem ser alteradas diretamente; qualquer modificação gera novo rascunho/versão.
- A mesma turma não pode possuir duas aulas simultâneas, mesmo que professor e sala sejam diferentes.

### 8.3 Preferências flexíveis iniciais

- Respeitar preferências de dia/horário do professor.
- Reduzir janelas entre aulas de uma turma.
- Distribuir aulas de uma disciplina ao longo da semana, se solicitado.
- Evitar excesso de aulas consecutivas para um professor.
- Evitar concentrar toda a carga de uma turma em poucos dias.
- Preferir salas específicas quando isso não violar restrições rígidas.

Pesos devem ser configuráveis por categoria e documentados. O MVP não deve prometer que a melhor pontuação representa uma solução universalmente ideal.

### 8.4 Regras de exclusão

Cadastros referenciados por ofertas, grades ou versões publicadas devem usar arquivamento/inativação em vez de exclusão física. Exclusão física só é permitida para registros nunca utilizados e sem referências.



## 8.5 Janelas de funcionamento e horários dinâmicos

**Requisito central:** o sistema não deve possuir turnos, horários de início ou fim, duração de aula ou sequência de períodos fixados no código. Todas as janelas temporais devem ser configuráveis pela instituição e aplicáveis por contexto.

### Conceitos

- **Janela de funcionamento:** intervalo no qual podem ocorrer aulas, por exemplo, 07:50–11:50.
- **Perfil de horário:** agrupamento nomeado de janelas, como “Manhã”, “Noite”, “Sábado” ou “Laboratório”.
- **Janela avulsa:** intervalo independente de um perfil tradicional, como 12:00–13:30 ou 18:20–20:00.
- **Slot candidato:** possível horário de início de um encontro, gerado a partir das janelas, da granularidade e da duração do encontro.
- **Intervalo/bloqueio:** período dentro de uma janela no qual aulas não podem ser alocadas, como intervalo para descanso ou fechamento de prédio.
- **Regra de recorrência:** dias da semana nos quais a janela se aplica.

### Requisitos funcionais adicionais

**RF-036 — Gerenciar perfis de horário**  
O sistema deve permitir criar, editar, ativar, arquivar e ordenar perfis nomeados livremente, sem impor a existência de manhã, tarde ou noite.

**RF-037 — Definir janelas por dia**  
Cada perfil deve aceitar uma ou mais janelas com dia da semana, hora inicial e hora final. Uma janela pode ser válida em dias diferentes com horários diferentes.

**RF-038 — Horários avulsos**  
O sistema deve permitir cadastrar janelas que não pertencem a um turno tradicional e aplicá-las a cursos, turmas, professores, salas ou ofertas conforme permissões.

**RF-039 — Configurar granularidade**  
O administrador deve configurar o intervalo mínimo entre possíveis inícios de aula, por exemplo 5, 10, 15 ou 20 minutos. A granularidade não define a duração da aula.

**RF-040 — Configurar durações de encontro**  
O sistema deve aceitar encontros de durações diferentes e não presumir que todas as aulas ocupam o mesmo número de minutos.

**RF-041 — Intervalos e bloqueios**  
Deve permitir cadastrar pausas, indisponibilidades e bloqueios dentro ou fora das janelas, com escopo global ou específico.

**RF-042 — Restrições por contexto**  
Uma janela pode ser permitida ou proibida para uma instituição, curso, turma, professor, sala ou oferta. Restrições específicas devem ser combinadas com as regras globais sem ignorar restrições rígidas.

**RF-043 — Gerar slots candidatos**  
O editor e o solver devem gerar os horários possíveis dinamicamente a partir das janelas ativas, granularidade, duração do encontro e restrições aplicáveis.

**RF-044 — Validar limites**  
Um encontro só é válido se seu intervalo completo estiver contido em uma janela permitida e não cruzar um bloqueio, salvo se uma regra explícita autorizar esse comportamento.

**RF-045 — Alterar configurações com segurança**  
Alterações nas janelas não devem deslocar nem modificar silenciosamente encontros já alocados ou grades publicadas. O sistema deve identificar alocações afetadas e exigir validação antes de aplicar mudanças.

### Modelo de dados adicional

Adicionar ao modelo de domínio:

| Entidade | Campos essenciais |
|---|---|
| `TimeProfile` | nome, descrição, ativo, ordem de exibição |
| `TimeWindow` | perfil opcional, dia da semana, início, fim, tipo, status |
| `TimeWindowScope` | janela, tipo de escopo, identificador do escopo |
| `TimeBlock` | dia, início, fim, motivo, escopo, tipo de bloqueio |
| `SchedulingSettings` | granularidade em minutos, duração padrão da hora-aula, regras de intervalo |
| `AllowedStartRule` | escopo, dia, início, fim, granularidade opcional, status |

A estrutura final poderá ser normalizada de outra forma durante o desenho do banco, mas deve preservar as capacidades descritas. O horário inicial e final deve ser armazenado em formato temporal validável, e não como texto livre.

### Exemplo de configuração

Uma instituição poderia cadastrar:

| Perfil/janela | Dias | Início | Fim |
|---|---|---:|---:|
| Manhã | Seg–Sex | 07:50 | 11:50 |
| Tarde | Seg–Sex | 13:00 | 17:00 |
| Noite | Seg–Sex | 17:50 | 21:50 |
| Atendimento avulso | Quarta | 12:00 | 13:30 |
| Laboratório especial | Sábado | 08:20 | 12:20 |

Esses dados são ilustrativos e não devem ser semeados como valores obrigatórios do produto. A instituição poderá cadastrar outros dias, nomes, intervalos e combinações.

### Regras para o solver

1. O solver recebe as janelas aplicáveis ao cenário e não pressupõe turnos fixos.
2. O conjunto de possíveis inícios é construído dinamicamente a partir da janela, da granularidade e da duração do encontro.
3. O encontro deve terminar até o limite da janela permitida e não pode atravessar bloqueios.
4. Se um encontro exigir 100 minutos e a janela restante tiver apenas 90 minutos, aquele início não será candidato.
5. Janelas sobrepostas não devem duplicar candidatos nem permitir sobreposição de recursos.
6. Uma oferta pode utilizar mais de um perfil de horário se isso estiver explicitamente permitido.
7. A preferência por determinado perfil pode ser flexível, mas a janela obrigatória é uma restrição rígida.
8. Se não houver slots suficientes, o diagnóstico deve apontar a incompatibilidade entre duração, disponibilidade e janelas configuradas.

### Critérios de aceitação adicionais

**CA-013 — Perfis customizados**  
Dado que o administrador crie um perfil com nome e horários não convencionais, quando esse perfil for associado a uma turma, então o editor e o solver devem utilizar suas janelas sem exigir alteração de código.

**CA-014 — Janela avulsa**  
Dado que exista uma janela avulsa válida para uma oferta, quando a grade for gerada, então o solver poderá alocar encontros nela se todos os demais requisitos forem atendidos.

**CA-015 — Duração variável**  
Dado um encontro com duração configurada, quando os candidatos forem gerados, então somente os horários cujo intervalo completo caiba em uma janela permitida devem ser considerados.

**CA-016 — Bloqueio de intervalo**  
Dado um bloqueio dentro de uma janela, quando o solver gerar candidatos, então nenhum encontro poderá atravessar o bloqueio.

**CA-017 — Mudança de janela**  
Dado que uma janela seja modificada após existirem alocações, quando a configuração for salva, então o sistema deverá identificar alocações afetadas e exigir validação, sem alterar silenciosamente a grade.

**CA-018 — Sem pressupostos fixos**  
Dado um perfil com nome e horários arbitrários, quando for utilizado na aplicação, então o sistema deve funcionar sem depender dos nomes “Manhã”, “Tarde” ou “Noite”.

### Interface de configuração

A tela de janelas deverá permitir:
- Criar perfis com nome livre.
- Adicionar várias janelas por perfil e por dia.
- Copiar a configuração de um dia para outros dias.
- Definir intervalos e bloqueios.
- Configurar a granularidade dos horários candidatos.
- Pré-visualizar os slots possíveis para durações de encontro selecionadas.
- Associar perfis a cursos, turmas, professores, salas ou ofertas.
- Identificar janelas sobrepostas e inconsistências.
- Visualizar quais alocações existentes serão afetadas antes de salvar alterações.

A configuração de janelas deve ser um módulo de primeira classe, não um conjunto de constantes no frontend ou no algoritmo.

## 9. Modelo de domínio inicial

### 9.1 Entidades

| Entidade | Campos essenciais |
|---|---|
| `InstitutionSettings` | nome, fuso horário, duração padrão da hora-aula, dias ativos, configuração de grade |
| `AcademicTerm` | nome, data inicial, data final, status |
| `Course` | código, nome, modalidade, status |
| `Curriculum` | curso, versão, vigência, status |
| `CurriculumPeriod` | matriz, número/ordem, nome |
| `Subject` | código, nome, carga total, unidade, recursos requeridos |
| `CurriculumSubject` | matriz, período curricular, disciplina, obrigatoriedade |
| `Teacher` | código, nome, status, limite semanal |
| `TeacherQualification` | professor, disciplina |
| `TeacherAvailability` | professor, dia da semana, início, fim, tipo |
| `Room` | código, nome, capacidade, localização, status |
| `RoomFeature` | código e descrição do recurso |
| `RoomFeatureAssignment` | sala, recurso |
| `RoomAvailability` | sala, dia da semana, início, fim, tipo |
| `ClassGroup` | curso, período letivo, matriz/período curricular opcional, código, turno informativo |
| `SubjectOffering` | turma, disciplina, período letivo, carga semanal, status |
| `OfferingSessionRequirement` | oferta, duração em minutos, quantidade semanal, tipo de encontro |
| `OfferingTeacher` | oferta, professor, papel e carga atribuída |
| `Schedule` | curso, período letivo, status corrente |
| `ScheduleVersion` | grade, número, status, criado por, data, snapshot |
| `ScheduledSession` | versão/rascunho, oferta, dia, início, fim, sala, professor, bloqueada |
| `SchedulingConstraint` | escopo, tipo, rigidez, peso, configuração |
| `GenerationJob` | cenário, estado, início/fim, limite, solver, resultado e diagnóstico |
| `GenerationCandidate` | execução, pontuação, estado, solução serializada |
| `AuditEvent` | ator, ação, entidade, identificador, data, metadados |

### 9.2 Decisões de modelagem

- `Subject` representa a disciplina no catálogo; `SubjectOffering` representa sua oferta concreta.
- `ClassGroup` pertence a um curso e a um período letivo.
- A grade é planejada por curso e período letivo, mas o conflito de professor/sala é institucional.
- O cadastro de professores e salas não pertence exclusivamente a uma grade.
- `ScheduledSession` deve permitir duração variável.
- A versão publicada deve ser imutável.
- A solução do solver deve ser convertida para entidades de domínio antes de ser aplicada.
- O modelo deve permitir que uma oferta tenha mais de um professor somente quando a configuração de docência compartilhada dentro da mesma turma for autorizada; compartilhamento entre turmas fica fora do MVP.

## 10. Arquitetura técnica

### 10.1 Componentes

**Frontend**
- React + TypeScript.
- Biblioteca de componentes acessíveis.
- Editor de grade semanal com arrastar e soltar.
- Cliente tipado para API.
- Validação de formulários no cliente para usabilidade, sempre repetida no servidor.

**Backend**
- Django.
- Django REST Framework.
- Camadas separadas de API, aplicação/serviços, domínio e persistência.
- Autenticação e autorização por papel.
- Validação de conflitos no servidor.

**Banco**
- PostgreSQL.
- Migrações versionadas.
- Transações para alterações de grade.
- Índices para consultas por professor, sala, turma, período e intervalo.

**Solver**
- Google OR-Tools CP-SAT.
- Adaptador de domínio entre dados da aplicação e modelo de otimização.
- Limite de tempo configurável.
- Semente aleatória controlável para testes reproduzíveis.
- Validador independente da solução.
- Execução assíncrona recomendada para grades reais.

### 10.2 Organização sugerida do repositório

```text
orbita-academico/
├── specs/
│   ├── product-requirements.md
│   ├── domain-model.md
│   ├── architecture.md
│   ├── database-schema.md
│   ├── api-spec.md
│   ├── scheduling-model.md
│   ├── security.md
│   ├── acceptance-tests.md
│   └── features/
│       ├── academic-cadastres.md
│       ├── schedule-editor.md
│       ├── schedule-validation.md
│       ├── schedule-generation.md
│       └── schedule-publication.md
├── backend/
├── frontend/
├── solver/
├── tests/
├── docs/
└── README.md
```

O diretório `solver/` pode ser um módulo Python dentro do backend no início; não é necessário criar um serviço independente antes de existir necessidade operacional.

## 11. API inicial

Prefixo: `/api/v1/`

| Método | Endpoint | Objetivo |
|---|---|---|
| `GET/POST` | `/academic-terms/` | Listar/criar períodos letivos |
| `GET/POST` | `/courses/` | Listar/criar cursos |
| `GET/POST` | `/curricula/` | Listar/criar matrizes |
| `GET/POST` | `/subjects/` | Listar/criar disciplinas |
| `GET/POST` | `/teachers/` | Listar/criar professores |
| `GET/POST` | `/rooms/` | Listar/criar salas |
| `GET/POST` | `/class-groups/` | Listar/criar turmas |
| `GET/POST` | `/subject-offerings/` | Listar/criar ofertas |
| `GET/POST` | `/availability/teachers/` | Consultar/manter disponibilidade docente |
| `GET/POST` | `/availability/rooms/` | Consultar/manter disponibilidade de salas |
| `GET/POST` | `/schedules/` | Criar/listar grades |
| `GET` | `/schedules/{id}/` | Obter grade e metadados |
| `POST` | `/schedules/{id}/validate/` | Validar rascunho |
| `POST` | `/schedules/{id}/sessions/` | Criar encontro/alocação |
| `PATCH/DELETE` | `/schedules/{id}/sessions/{session_id}/` | Editar/remover alocação de rascunho |
| `POST` | `/schedules/{id}/generation-jobs/` | Solicitar geração |
| `GET` | `/generation-jobs/{id}/` | Consultar estado/resultado da geração |
| `POST` | `/generation-jobs/{id}/apply/` | Aplicar proposta a um rascunho |
| `POST` | `/schedules/{id}/publish/` | Validar e publicar versão |
| `GET` | `/schedules/{id}/versions/` | Listar versões |
| `GET` | `/teachers/{id}/schedule/` | Consultar grade do professor |
| `GET` | `/rooms/{id}/schedule/` | Consultar grade da sala |

Regras de API:
- Usar paginação e filtros em listagens.
- Retornar erros estruturados com código, mensagem e detalhes por campo.
- Usar controle de concorrência otimista, por exemplo `version` ou `updated_at`, em alterações de grade.
- A aplicação de uma proposta e a publicação devem ser operações transacionais.
- Uma requisição repetida de criação de geração deve aceitar chave de idempotência ou mecanismo equivalente.
- Os endpoints exatos devem ser consolidados em OpenAPI antes da implementação final.

### Exemplo de resposta de conflito

```json
{
  "valid": false,
  "conflicts": [
    {
      "code": "TEACHER_OVERLAP",
      "severity": "HARD",
      "message": "O professor já possui uma aula neste intervalo.",
      "resource_type": "teacher",
      "resource_id": "teacher-123",
      "interval": {
        "day": "MONDAY",
        "start": "19:00",
        "end": "20:40"
      },
      "conflicting_session_id": "session-456"
    }
  ]
}
```

Os identificadores do exemplo são ilustrativos.

## 12. Especificação do motor de otimização

### 12.1 Entrada

O cenário do solver deve conter:
- ofertas a planejar;
- requisitos de encontros;
- professores elegíveis e respectivas disponibilidades;
- salas, recursos e capacidades;
- janelas da turma;
- restrições rígidas e preferências;
- alocações bloqueadas;
- ocupações de recursos oriundas de outras grades;
- limite de tempo e parâmetros de execução.

### 12.2 Variáveis conceituais

Para cada encontro requerido, o modelo deve selecionar:
- dia da semana;
- horário de início;
- horário de término derivado da duração;
- professor elegível;
- sala elegível.

O modelo pode enumerar slots de início permitidos em uma granularidade configurável. A granularidade não deve forçar que todos os encontros tenham duração idêntica.

### 12.3 Restrições rígidas

- Ausência de sobreposição por professor.
- Ausência de sobreposição por sala.
- Ausência de sobreposição por turma.
- Respeito à disponibilidade do professor e da sala.
- Respeito às janelas de funcionamento da turma.
- Compatibilidade de sala, capacidade e recursos.
- Cumprimento da quantidade e duração dos encontros.
- Preservação de alocações bloqueadas.
- Respeito às ocupações fixas de recursos em outras grades.
- Respeito a limites de carga semanal configurados.

### 12.4 Objetivo inicial

Minimizar a soma ponderada de penalidades de preferências flexíveis:

`minimize Σ(weight_i × penalty_i)`

Cada penalidade precisa ser explicável e testável. Não misturar violações rígidas com penalidades flexíveis por meio de pesos arbitrariamente grandes.

### 12.5 Estados

- `PENDING`: aguardando processamento.
- `RUNNING`: em execução.
- `FEASIBLE`: solução válida encontrada, sem prova de otimalidade.
- `OPTIMAL`: solução ótima para o modelo e objetivo configurados.
- `INFEASIBLE`: inviabilidade comprovada pelo solver.
- `UNKNOWN`: busca inconclusiva, por exemplo, por timeout sem solução comprovada.
- `FAILED`: erro operacional.
- `CANCELLED`: execução cancelada.

Se o solver encontrar solução viável e depois atingir o limite de tempo, o estado deve continuar refletindo que há solução válida (`FEASIBLE`), registrando que a busca foi interrompida; não rotular como `INFEASIBLE`.

### 12.6 Validação independente

Antes de uma proposta ser aplicada, um validador fora do modelo do solver deve verificar:
- todas as sobreposições;
- todas as disponibilidades;
- capacidade e recursos de sala;
- duração e quantidade de encontros;
- alocações bloqueadas;
- conflitos com outras grades;
- carga horária.

A solução não pode ser aceita apenas porque o solver a retornou.

## 13. Segurança, auditoria e integridade

- Autenticação segura e política de sessão documentada.
- Autorização no backend para cada ação sensível.
- Proteção contra CSRF quando aplicável ao mecanismo de autenticação escolhido.
- Validação de entradas no servidor.
- Segredos fora do repositório.
- HTTPS em ambientes implantados.
- Auditoria de alterações críticas.
- Exclusão lógica para dados acadêmicos referenciados.
- Transações para mover alocações e aplicar propostas.
- Bloqueio ou controle otimista de concorrência para evitar sobrescritas silenciosas.
- Backups e procedimento de restauração documentados antes do piloto.
- Aplicar minimização de dados pessoais e princípios da LGPD.

## 14. Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF-001 | Operações de escrita devem ser autorizadas no servidor. |
| RNF-002 | Alterações de grade devem preservar integridade transacional. |
| RNF-003 | Meta inicial de resposta p95 inferior a 2 segundos para consultas e edições comuns, em ambiente de referência documentado. |
| RNF-004 | Gerações devem ter limite de tempo configurável e não bloquear indefinidamente requisições HTTP. |
| RNF-005 | Falha de geração não pode corromper nem substituir a grade existente. |
| RNF-006 | Grades publicadas devem ser imutáveis como versões históricas. |
| RNF-007 | A interface deve buscar WCAG 2.2 AA e fornecer alternativa acessível ao drag-and-drop. |
| RNF-008 | Registrar erros, duração e estado das gerações. |
| RNF-009 | Cobrir regras rígidas com testes automatizados. |
| RNF-010 | Documentar instalação local, configuração e implantação. |

## 15. Critérios de aceitação do MVP

### CA-001 — Cadastro básico
**Dado** um usuário autorizado, **quando** cadastrar curso, professor, sala, disciplina e turma com dados válidos, **então** os registros devem ser persistidos e consultáveis.

### CA-002 — Hora-aula configurável
**Dado** que a instituição configure a hora-aula para uma duração específica em minutos, **quando** uma oferta usar essa unidade, **então** a duração efetiva deve ser calculada conforme a configuração registrada.

### CA-003 — Conflito de professor
**Dado** que um professor esteja alocado em um intervalo, **quando** outra alocação sobreposta for tentada em qualquer grade relevante, **então** a operação deve ser rejeitada ou marcada inválida com diagnóstico.

### CA-004 — Conflito de sala
**Dado** que uma sala esteja ocupada, **quando** outra aula sobreposta for alocada, **então** a operação deve ser rejeitada ou marcada inválida.

### CA-005 — Conflito de turma
**Dado** que uma turma possua aula em determinado intervalo, **quando** outra aula sobreposta for alocada à mesma turma, **então** a operação deve ser inválida.

### CA-006 — Geração viável
**Dado** um cenário de referência com recursos suficientes, **quando** a geração terminar com uma solução, **então** a proposta deve passar pelo validador independente sem violações rígidas.

### CA-007 — Inviabilidade comprovada
**Dado** um cenário de teste comprovadamente inviável, **quando** o solver provar inviabilidade, **então** o job deve terminar como `INFEASIBLE`.

### CA-008 — Timeout inconclusivo
**Dado** que a execução atinja o limite sem provar inviabilidade, **quando** não houver solução, **então** o estado deve ser `UNKNOWN`, sem alegação de impossibilidade definitiva.

### CA-009 — Preservar alocação bloqueada
**Dado** um encontro bloqueado, **quando** uma nova geração for executada, **então** o encontro deve permanecer no mesmo intervalo, com os mesmos recursos protegidos.

### CA-010 — Preservar grade publicada
**Dado** que exista uma versão publicada, **quando** o usuário editar ou gerar uma nova proposta, **então** a versão publicada não deve ser alterada.

### CA-011 — Publicação inválida
**Dado** um rascunho com conflito rígido, **quando** tentar publicá-lo, **então** a publicação deve ser recusada e o conflito informado.

### CA-012 — Concorrência
**Dado** que dois usuários editem a mesma grade, **quando** um salvar uma versão mais recente, **então** o outro deve receber aviso de conflito de versão em vez de sobrescrever silenciosamente os dados.

## 16. Plano de implementação

### Fase 0 — Fundação
- Criar repositório, ambientes, convenções e integração contínua.
- Formalizar decisões de arquitetura.
- Criar modelo inicial de domínio e autenticação.
- Configurar migrações e testes.

### Fase 1 — Cadastros e configuração
- Instituição e parâmetros temporais.
- Períodos letivos, cursos, matrizes, disciplinas e turmas.
- Professores, qualificações, salas e recursos.
- Disponibilidades e ofertas.

### Fase 2 — Grade manual
- Visualização semanal.
- Criação, edição e remoção de encontros.
- Drag-and-drop.
- Validador de conflitos.
- Rascunhos e controle de concorrência.

### Fase 3 — Geração automática
- Construção do modelo CP-SAT.
- Restrições rígidas.
- Ocupações externas fixas.
- Execução controlada e estados de job.
- Validação independente e aplicação da proposta.

### Fase 4 — Preferências e publicação
- Penalidades flexíveis e comparação de alternativas.
- Bloqueio de alocações.
- Versionamento e publicação.
- Auditoria.

### Fase 5 — Qualidade do piloto
- Consultas por turma, professor e sala.
- Exportação PDF/XLSX se mantida no corte do MVP.
- Testes de carga representativos.
- Testes de acessibilidade e segurança.
- Documentação operacional e validação com usuários.

## 17. Definition of Done

Uma funcionalidade só pode ser considerada concluída quando:
1. A especificação foi aprovada e versionada.
2. Os critérios de aceitação foram implementados.
3. Os testes unitários e de integração relevantes passam.
4. A autorização e validação de servidor foram verificadas.
5. Os estados de erro e os casos-limite foram tratados.
6. A documentação da API e do domínio foi atualizada.
7. Não há alteração silenciosa de grades publicadas.
8. O código passou por revisão.
9. A interface foi verificada em desktop e em tamanhos menores relevantes.
10. A mudança não contradiz requisitos ou invariantes existentes.

## 18. Riscos e questões a resolver antes do solver definitivo

1. **Granularidade temporal:** definir se o horário inicial pode variar a cada 5, 10, 15 ou outro número de minutos.
2. **Carga horária curricular:** definir a regra institucional para converter horas-aula em carga total curricular.
3. **Aulas consecutivas:** determinar quando uma oferta exige encontros indivisíveis de 2, 3 ou mais horas-aula.
4. **Docência compartilhada:** decidir se dois professores podem ministrar o mesmo encontro simultaneamente no MVP.
5. **Ocupações externas:** definir se grades não publicadas também bloqueiam recursos para outras grades ou se somente grades publicadas são consideradas fixas.
6. **Publicação:** definir se pode existir uma única versão publicada por curso/período e como ocorre a substituição.
7. **Capacidade de salas:** definir se a quantidade de estudantes da turma é obrigatória ou opcional.
8. **Escala de referência:** definir quantidade aproximada de cursos, turmas, professores, salas e encontros para testar desempenho.

Até que essas decisões sejam fechadas, a implementação deve utilizar configurações explícitas, evitando regras implícitas no código.

---

## Próximo passo recomendado

Implementar primeiro a **Fase 0 e a Fase 1**, com as especificações de domínio, banco e API revisadas. Em paralelo, criar cenários sintéticos de horários para testar o modelo do solver antes de conectá-lo ao editor visual.

O motor automático deve ser validado com dados artificiais pequenos e casos de conflito conhecidos antes de ser utilizado para gerar grades acadêmicas reais.

# Proposta: assistente de geração de grade

**Estado em 25/10/2026:** a primeira versão funcional foi implementada. As seções abaixo preservam a visão completa do módulo; os pontos ainda futuros estão discriminados a seguir.

## Implementado nesta etapa

- Ação **Gerar sugestão** na grade: diagnóstico prévio, preenchimento de lacunas ou reorganização de aulas não fixadas, duas alternativas e aplicação explícita.
- OR-Tools CP-SAT com carga presencial, blocos `AUTO_OFFER` preferenciais, divisão flexível por hora quando necessário, professor designado, sala ativa/compatível, janelas, bloqueios, eventos docentes, aulas de outras grades, sobreposições e descanso de 11 h. A auditoria de intrajornada usa as regras atuais.
- Diagnósticos para dados ausentes, ausência de sala compatível, tempo insuficiente de uma sala obrigatória, falta de horários candidatos e inviabilidade combinada. A quantidade de alunos da turma não é exigida nem usada para filtrar salas.
- Propostas e execuções persistidas. Aplicação com revisão `If-Match`, validação da grade e transação, sem alterar versões publicadas até nova publicação.
- Endpoints: `GET /api/v1/schedules/{id}/generation/preflight/`, `POST /api/v1/schedules/{id}/generation/`, `GET /api/v1/generation-jobs/{id}/` e `POST /api/v1/generation-candidates/{id}/apply/`.

**Próximas etapas:** execução em worker e cancelamento; diagnóstico avançado de conflitos combinados; preferências ajustáveis; prévia visual completa em cinco colunas; ausência em data específica; teste de carga em PostgreSQL. A busca atual tem limite de 30 segundos e ocorre na requisição web.

## Objetivo

Gerar uma ou mais propostas de grade semanal a partir das ofertas já preparadas, respeitando professores, turmas, salas, janelas, bloqueios, aulas fixadas e ocupações de outras grades do mesmo período letivo. O módulo deve explicar o que falta cadastrar, onde há escassez de recursos e por que uma oferta não foi alocada. Uma proposta só altera o rascunho quando a coordenação a escolhe e confirma.

## Base existente e lacunas

| Existe hoje | Implicação para o gerador |
| --- | --- |
| `SubjectOffering`, `ClassGroup`, `TimeProfile`, `TimeWindow`, `TimeBlock`, `Room`, `RoomFeature`, `TeacherEvent` e `ScheduledSession` | Já há dados para construir candidatos e detectar conflitos semanais. |
| `scheduling.validate_session()` e `workload.audit_intervals()` | Validam sobreposição, janelas, recursos, intervalo intrajornada e descanso interjornada; precisam de adaptação para validar uma proposta **em memória**, sem gravá-la antes. |
| `ScheduleViewSet.validate()` | Compara horas presenciais da oferta com horas alocadas e protege publicação; pode ser a auditoria final, após aplicação transacional. |
| `ScheduleSlot` e `_profile_structure()` | O conjunto de horários permitidos já deriva do perfil da grade; o gerador deve usar os mesmos slots e limites por dia. |
| `ScheduledSession.is_locked`, revisão da grade e versões publicadas | Há base para preservar aulas fixas, impedir sobrescrita concorrente e manter a publicação atual. |
| Oferta com `eligible_teachers` | Não distingue o professor **designado** de professores alternativos. É preciso decidir se o gerador pode trocar o docente. |
| Requisitos `AUTO_OFFER` e `GRADE` | O bloco da oferta é uma sugestão; a montagem manual aceita, por exemplo, 3 h como 2 + 1. O gerador não deve somar os dois tipos como carga separada. |
| `requirements.txt` e `docker-compose.yml` | OR-Tools, modelos de execução/proposta e processo de trabalho em segundo plano ainda não existem. |

O campo legado `Teacher.max_weekly_minutes` continua no modelo e no validador, apesar de ter sido removido do fluxo de cadastro. Antes do solver, a regra deve ser alinhada com a política efetivamente usada pela instituição; o gerador e o validador não podem aplicar políticas diferentes.

## Jornada proposta

1. **Preparar:** em **Grade de aulas**, ação **Gerar sugestão**. Escolher grade (curso, período letivo e perfil), todas as turmas ou um subconjunto, e modo **Completar lacunas** ou **Reorganizar aulas não fixadas**. O padrão preserva todas as aulas existentes; o segundo modo exige escolha explícita.
2. **Conferir dados:** painel com ofertas, horas presenciais pendentes, docentes, salas compatíveis, janelas e aulas fixadas. Itens sem dados obrigatórios recebem ação direta: **Abrir oferta**, **Cadastrar sala**, **Ajustar janela** ou **Registrar indisponibilidade**.
3. **Diagnóstico rápido:** antes do solver, calcular candidatos de dia, horário, professor e sala para cada bloco; mostrar ofertas com zero candidatos, demanda maior que a capacidade disponível e gargalos por recurso/intervalo.
4. **Gerar:** executar o solver com limite de tempo explícito e mostrar progresso/estado. Manter o rascunho intacto.
5. **Comparar:** exibir até três propostas diferentes, com prévia em cinco colunas, horas alocadas/pendentes, mudanças em relação ao rascunho e indicadores de qualidade. Destacar aulas fixas e salas/laboratórios.
6. **Aplicar:** escolher uma proposta; verificar revisão e alterações externas; validar a solução independentemente; aplicar em transação. A publicação continua sendo uma ação separada.

## Entrada e política de geração

- **Unidade:** cada hora-aula presencial equivale a 60 minutos no fluxo atual. Horas EAD não geram blocos na grade. A carga alvo é `Subject.onsite_weekly_hours`; `weekly_minutes` da oferta serve como compatibilidade para dados antigos e deve ser normalizado.
- **Blocos:** permitir configuração por oferta, por exemplo `2 + 1` para 3 h semanais. Na primeira versão, usar o padrão `AUTO_OFFER` como preferência editável, com opção de divisão em blocos de 1 a 4 h. Um bloco marcado **indivisível** é restrição rígida; os demais podem ser repartidos sem alterar a carga total.
- **Professor:** usar o docente designado na oferta como padrão. Acrescentar `assigned_teacher` ou uma relação explícita com papel e carga; tratar outros elegíveis como alternativas apenas se a coordenação permitir. Não escolher silenciosamente o primeiro elemento da lista.
- **Salas:** filtrar por status ativo, recursos exigidos pela disciplina e pela oferta, janela/bloqueio e ocupação no período letivo. A lotação de alunos não faz parte das restrições da grade; a capacidade cadastrada da sala fica apenas como informação.
- **Ausências:** `TeacherEvent` e `TimeBlock` representam compromissos/bloqueios semanais e já devem retirar candidatos. Para ausência recorrente, oferecer cadastro simples que crie bloqueio docente. Ausência de uma data específica não cabe numa grade semanal recorrente: tratar posteriormente como substituição/reposição pontual, sem refazer silenciosamente o semestre.
- **Escopo:** uma execução gera uma grade por curso, período letivo e perfil; ocupações das outras grades do mesmo período letivo entram como compromissos fixos de professores e salas. Mesmo perfil diferente (manhã/noite) importa para interjornada.
- **Rascunho versus publicação:** as aulas atuais ficam em `ScheduledSession`, enquanto a versão publicada é um snapshot. A política de ocupação externa deve escolher explicitamente qual é a fonte autoritativa quando o rascunho mudou após publicar; não somar os dois como duas ocupações nem ignorar a versão que os alunos ainda veem. O padrão recomendado é proteger a publicação vigente e também sinalizar conflitos com rascunhos ativos, exigindo resolução antes de aplicar.

## Restrições do motor

| Rígidas | Preferências ajustáveis |
| --- | --- |
| Carga presencial completa por oferta; duração e distribuição de blocos declarados indivisíveis; uma aula por turma no mesmo intervalo. | Distribuir aulas da turma pelos dias, evitando concentração quando possível. |
| Sem sobreposição de professor, sala e compromissos avulsos no mesmo período letivo. | Preservar ao máximo a grade atual ao reorganizar. |
| Professor designado ou alternativa explicitamente autorizada; oferta e recursos ativos. | Preferir salas habituais e reduzir trocas de sala. |
| Janela aplicável à turma, professor, sala e oferta; bloqueios; slots consecutivos reais do perfil. | Reduzir janelas vazias entre aulas de turma/professor. |
| Capacidade e recursos de sala quando exigidos; aulas fixadas e ocupações externas preservadas. | Evitar horários indesejados configurados pela coordenação. |
| Descanso mínimo de 11 h entre dias consecutivos, inclusive domingo→segunda; intervalo intrajornada conforme a política validada. | Preferências de dia/horário do docente, se cadastradas futuramente. |

Usar intervalos semiabertos `[início, fim)`: terminar às 18:50 e iniciar às 18:50 não é sobreposição. Restrições rígidas não devem virar apenas penalidades altas. O escopo da intrajornada inclui aulas de todos os perfis e horários avulsos do professor; uma pausa só conta quando há intervalo real entre atividades.

## Motor e diagnóstico

1. **Snapshot de cenário:** ler ofertas, slots, recursos, eventos, bloqueios e ocupações externas, com revisão da grade e horário da coleta. Congelar essa entrada para tornar execução e diagnóstico reproduzíveis.
2. **Pré-checagem determinística:** verificar campos ausentes, horas semanais incompatíveis com janelas da turma, bloco maior que qualquer janela, zero professor elegível, zero sala compatível e demanda/capacidade por dia, tipo de sala e professor. Usar correspondência entre blocos e posições de sala compatíveis para detectar escassez que a contagem total de salas esconderia. Exemplo: 6 blocos de laboratório exigidos no mesmo turno e apenas 4 posições de laboratório disponíveis → gargalo comprovado por contagem. Essas verificações são condições necessárias, não prova geral de viabilidade.
3. **Candidatos:** para cada bloco, enumerar combinações `(dia, início, professor, sala)` que caibam integralmente nas faixas do perfil e respeitem recursos, janelas, bloqueios e ocupações fixas. Guardar o motivo de descarte por categoria para explicar **zero candidatos**.
4. **CP-SAT:** variável booleana por candidato; exatamente uma escolha por bloco obrigatório; incompatibilidades para pares que se sobreponham por turma/professor/sala; restrições de intervalo e descanso entre blocos de cada professor, inclusive manhã e noite. Minimizar preferências após satisfazer todas as restrições rígidas. Para aulas com blocos flexíveis, enumerar apenas partições permitidas e selecionar uma partição por oferta.
5. **Resultado:** distinguir `OPTIMAL`, `FEASIBLE`, `INFEASIBLE`, `UNKNOWN`, `FAILED` e `CANCELLED`. Um timeout sem solução é **inconclusivo**, não falta comprovada de salas. Quando houver solução parcial exploratória, rotular como **rascunho incompleto** e nunca oferecer como proposta publicável.
6. **Explicação:** usar pré-checagens e contagens de candidatos como evidência principal; para inviabilidade mais complexa, usar grupos de hipóteses por oferta/recurso e tentar extrair um núcleo de conflitos. Não prometer uma causa única se várias combinações explicarem o problema. Cada diagnóstico deve incluir `code`, severidade, oferta/turma, recurso, intervalo, evidência quantitativa e ação sugerida.
7. **Validação independente:** validar a proposta inteira em memória contra as regras de domínio e as ocupações atualizadas. Na aplicação, repetir a verificação dentro de transação e rejeitar caso a revisão ou a disponibilidade tenha mudado. Só então criar/alterar `ScheduledSession` e executar a validação completa do rascunho.

Exemplo de mensagem útil: **"P4-M · Banco de Dados II: faltam 2 h presenciais. O professor designado está livre em 3 blocos, mas nenhuma sala com 35 lugares e laboratório está livre nesses blocos. Libere o Lab H08 na terça 08:00–10:00, cadastre outra sala compatível ou autorize outro turno."** A mensagem só deve listar essa causa se os dados sustentarem a conclusão; caso contrário, mostrar as restrições observadas sem afirmar causalidade definitiva.

## Interface da coordenação

- **Cabeçalho:** `12 ofertas · 38 h presenciais · 32 h já alocadas · 6 h pendentes`, calculado na grade escolhida.
- **Painel de prontidão:** cartões **Pronto para gerar**, **Dados faltantes**, **Salas insuficientes**, **Docentes indisponíveis** e **Aulas fixas**, cada um abrindo uma lista com ação.
- **Mapa de capacidade:** matriz dia × faixa, com demanda de turmas, professores disponíveis e salas compatíveis. Cores indicam disponibilidade, saturação e conflito; texto/ícone repetem a informação para acessibilidade.
- **Configuração curta:** modo de geração, turmas incluídas, preservar aulas, limite de busca e até três preferências. Configurações avançadas ficam recolhidas.
- **Resultados:** propostas A/B/C com estado, carga atendida, número de movimentos, distribuição por dia e ressalvas; comparar com o rascunho e aplicar explicitamente. A opção **Mostrar por que não alocou** abre diagnóstico por oferta.
- **Sem solução:** lista por prioridade (**cadastro**, **janela**, **docente**, **sala**, **conflito combinado**) e uma ação verificável para cada item. Não mostrar uma longa sequência de erros técnicos repetidos.

## Estrutura técnica e API

- Novo serviço `academic/generation/` com módulos `snapshot.py`, `preflight.py`, `candidates.py`, `solver.py`, `diagnostics.py` e `proposal_validator.py`. Extrair regras compartilhadas de `scheduling.py` para evitar divergência entre editor, gerador e publicação.
- Modelos `GenerationJob` (grade, revisão de origem, parâmetros, snapshot/checksum, estado, limites, tempos, resumo e diagnóstico) e `GenerationCandidate` (job, pontuação, métricas, alocações serializadas, resultado da auditoria). Propostas são privadas e não substituem `ScheduleVersion` publicada.
- `POST /api/v1/schedules/{id}/generation/preflight/`: relatório sem iniciar busca. `POST /api/v1/schedules/{id}/generation-jobs/`: criar execução idempotente. `GET /api/v1/generation-jobs/{id}/`: progresso/diagnóstico. `GET /api/v1/generation-jobs/{id}/candidates/`: alternativas. `POST /api/v1/generation-candidates/{id}/apply/`: exigir `If-Match` da revisão, validar e aplicar transacionalmente. `POST /api/v1/generation-jobs/{id}/cancel/`: cancelar busca ativa.
- OR-Tools deve entrar como dependência versionada. O `docker-compose.yml` atual não possui worker nem fila; incluir um processo de trabalho dedicado e limite de CPU/tempo por job antes de expor geração em produção. Consultas de estado podem usar polling moderado; a geração não deve ocupar o processo de requisição web.
- Apenas coordenador e administrador podem gerar/aplicar; registrar autor, parâmetros, diagnóstico, proposta aplicada e revisão no `AuditEvent`. A publicação permanece protegida pela validação atual e por permissão própria.

## Fases de implementação

1. **Base confiável:** alinhar professor designado, regra de blocos flexíveis e capacidade obrigatória; extrair validador de proposta em memória; criar cenários sintéticos e testes de manhã/noite.
2. **Diagnóstico sem solver:** snapshot, pré-checagens, disponibilidade real de salas/docentes e painel de gargalos. Já ajuda a coordenação a corrigir cadastros antes da geração.
3. **Primeira geração:** CP-SAT para completar lacunas preservando tudo que já está alocado, com uma proposta e aplicação transacional.
4. **Reorganização e alternativas:** preservar só aulas fixadas, comparar até três propostas, pesos de preferências e explicações de inviabilidade mais profundas.
5. **Operação:** worker, cancelamento, limites, métricas de desempenho e teste em PostgreSQL com volume semelhante ao uso real.

## Critérios de aceite mínimos

- Uma disciplina de 3 h presenciais pode ser alocada em `2 + 1`; a hora EAD não aparece na grade.
- Nenhuma proposta válida conflita com professor, sala, turma, evento docente, janela, bloqueio, recursos, intrajornada ou 11 h de interjornada entre perfis.
- Aula fixada e aula de outra grade no mesmo período letivo permanecem intocadas.
- Falta de sala compatível ou de horas livres suficientes gera diagnóstico com a demanda observada.
- Dados incompletos bloqueiam a geração da oferta afetada e apontam o cadastro necessário.
- `UNKNOWN` por limite de tempo nunca é apresentado como inviabilidade comprovada.
- Aplicar proposta com revisão desatualizada é recusado sem alterar a grade; publicação existente não muda.
- Após aplicação, a grade passa pelo mesmo validador usado antes de publicar.

## Decisões de produto antes da implementação do solver

1. Uma oferta com dois docentes elegíveis pode trocar de professor automaticamente ou o professor designado é fixo?
2. O padrão `2 + 1`, `1 + 1 + 1` etc. é preferência ou obrigação por disciplina? Quem pode marcar bloco indivisível?
3. A geração pode mover aulas manuais não bloqueadas por padrão, ou só completar horas pendentes?
4. Ocupações de grades ainda em rascunho do mesmo período letivo bloqueiam recursos? A proposta recomenda **sim**, com opção explícita de cenário isolado apenas para simulação.
5. A lotação de alunos fica fora da geração conforme decisão da coordenação; a capacidade de assentos da sala é informativa.
6. Ausência de um dia específico será tratada no módulo semanal ou num fluxo separado de reposição/substituição? A proposta recomenda fluxo separado.

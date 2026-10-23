# Fluxo da grade inspirado na planilha existente

Atualização de produto em 22/10/2026, a partir das três capturas de horários fornecidas pelo usuário. Este fluxo complementa a spec SDD v1.1 e prioriza o modo de trabalho já utilizado.

1. A tela inicial é a grade semanal. Cada turma aparece em um bloco, com horários nas linhas e dias nas colunas.
2. A configuração rápida solicita instituição, curso, período, datas, nomes das turmas, faixas horárias e dias. Não exige cadastrar disciplinas, professores, salas, ofertas ou requisitos antes de editar a grade.
3. Um clique na célula vazia abre apenas disciplina, professor, sala e quantidade de faixas consecutivas. Esses registros e vínculos são criados ou reaproveitados ao salvar.
4. Uma célula preenchida pode ser editada ou excluída. Cores distinguem disciplinas. A visão por professor usa a mesma grade e mostra turma e sala.
5. É possível colar uma região tabulada de aulas copiada da planilha. A primeira faixa e o primeiro dia são escolhidos na tela. Cada célula deve conter `Disciplina` na primeira linha e `Professor - Sala` na última. Células iguais e consecutivas na mesma coluna são agrupadas em uma aula. A colagem é transacional: um conflito impede a gravação de todo o lote.
6. Os cadastros detalhados e as regras de horário permanecem disponíveis para casos avançados. A duração das faixas é configurável, inclusive para horários matutinos e noturnos.

Limites atuais: a colagem recebe a área de aulas de uma turma por vez; não interpreta cabeçalhos, células mescladas ou um arquivo de planilha completo. A visão por professor é de consulta. A grade usa o conjunto de faixas do curso e período, então turmas com faixas distintas aparecem com linhas vazias onde não há aula.

## Cadastros e ofertas (revisão de 23/10/2026)

- As disciplinas usam créditos e horas presenciais por semana. Uma hora-aula equivale a 60 minutos; 4 créditos representam 80 horas-aula totais em 20 semanas. O percentual EAD é registrado, e as horas presenciais informadas pelo usuário determinam o que entra na grade.
- A oferta é criada na disciplina ou a partir do professor, escolhendo turma e docente. Os blocos semanais são gerados internamente; “encontros requeridos” não é um cadastro do fluxo principal.
- Professores não precisam de limite semanal em minutos. A interface deixa de pedir esse campo.
- Turmas têm nome próprio opcional no modelo e obrigatório no formulário, com sugestões como “1º A”. Registros antigos recebem o código como nome inicial.
- Importação transacional de CSV/TSV ou dados colados para cursos, disciplinas, professores, salas, turmas e ofertas. Duplicatas por código são ignoradas; linhas inválidas cancelam o lote.
- A configuração de janelas é apresentada dentro de cada perfil. Janelas antigas sem perfil ficam em uma seção própria para reassociação.
- Um bloco de aula pode ser arrastado para dia e faixa livres na mesma turma; a API valida a mudança antes de persistir. O formulário permite a mesma mudança sem arrastar.

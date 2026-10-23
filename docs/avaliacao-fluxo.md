# Avaliação do fluxo do Órbita Acadêmico

## Fluxo recomendado

1. Configurar a instituição, o período letivo e os perfis Manhã e Noite com suas janelas.
2. Cadastrar as disciplinas com período curricular, créditos e horas presenciais/EAD.
3. Cadastrar as turmas com curso, período letivo, período curricular e turno.
4. Em **Ofertas de Disciplinas**, escolher uma turma, vincular os professores e salvar em lote na tela.
5. Abrir a grade daquele turno, distribuir as aulas, validar e publicar.
6. Compartilhar `/horarios?grade=ID` com os alunos. A consulta pública permite filtrar por período curricular, turma, dia, professor e sala.

## Melhorias prioritárias propostas

| Prioridade | Observação no repositório | Melhoria proposta |
| --- | --- | --- |
| Alta | A navegação abre na grade e ainda mantém dois editores (`GridWorkspace` e `ScheduleEditor`). | Consolidar a edição na grade principal e deixar o editor detalhado somente para funções avançadas claramente identificadas. Exibir no topo a sequência Cadastro → Ofertas → Grade → Publicação, com estado de cada etapa. |
| Alta | `App.tsx` carrega todos os recursos da API no início, mesmo quando a pessoa abre apenas a grade. | Carregar os dados por tela e por curso/período letivo; manter cache curto para a troca entre cadastro e oferta. Isso reduz espera e chamadas em bases maiores. |
| Alta | As regras de validação e publicação estão concentradas em `views.py`, e a publicação depende da mesma verificação usada pela ação Validar. | Extrair um serviço de validação de grade com retorno estruturado para a tela de revisão prévia. Mostrar horas previstas, alocadas e pendentes por turma antes do botão Publicar. |
| Média | O período curricular é um número simples na disciplina e na turma; o modelo de matriz curricular já existe, mas não participa desse fluxo. | Quando houver mais de uma matriz por curso, relacionar a disciplina ao período da matriz específica. Isso evita ambiguidades entre versões curriculares. |
| Média | O histórico de versões armazena instantâneos, mas a interface mostra somente a versão atual. | Criar uma tela de histórico com autor, data e diferenças por turma; permitir visualizar versões anteriores sem alterá-las. |
| Média | A consulta pública apresenta a semana em cartões por dia. | Acrescentar uma visualização matricial semelhante à planilha para uma turma selecionada, mantendo cartões como opção para celular. |
| Média | Não há geração automática CP-SAT nem exportação dedicada. | Priorizar geração assistida após estabilizar os dados e as regras; adicionar PDF/XLSX com identificação da versão publicada. |

## Regras de publicação implementadas

- Somente administrador ou coordenador pode publicar ou retirar uma publicação.
- Uma grade com conflitos ou aulas obrigatórias pendentes não é publicada.
- Cada publicação cria um instantâneo imutável. A edição do rascunho não altera a consulta dos alunos até nova publicação.
- A consulta pública retorna apenas a versão atualmente publicada; retirar publicação ou excluir a grade remove a exibição pública.

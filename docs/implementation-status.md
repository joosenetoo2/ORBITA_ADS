# Estado da implementação

Referência: [spec SDD v1.1](../orbita_academico_sdd_mvp_v1_1.md).

## Ajuste da jornada de uso

A tela inicial agora é a grade semanal por turma, conforme [fluxo baseado na planilha](fluxo-grade-planilha.md). A configuração rápida recebe turmas e faixas em listas; clicar em uma célula cadastra ou reaproveita disciplina, professor, sala, oferta e requisito. Há consulta por professor e colagem transacional de células tabuladas. Os cadastros detalhados ficam como opção avançada.

## Implementado nesta primeira etapa

- Projeto Django REST com autenticação por sessão e autorização de escrita por grupos.
- Modelos iniciais de instituição, período, curso, matriz, disciplina, professor, sala, turma, oferta, requisitos, perfis e janelas de horário, bloqueios, grade e alocação.
- API de cadastro e listagem em `/api/v1/`, com paginação padrão.
- Validação inicial de alocações para duração, janela, bloqueio, recursos, capacidade e sobreposição de professor, sala e turma. Intervalos usam `[início, fim)`.
- Controle de revisão nas operações de alocação manual por `If-Match` e auditoria básica das mudanças.
- Interface React para visão geral, cadastros básicos, ofertas, requisitos, janelas, criação de grades e alocação por formulário.
- Arrastar um encontro para outro dia abre uma prévia de validação; salvar continua sendo uma ação explícita. O formulário é a alternativa para teclado e toque.
- Alterações de configuração temporal recusadas quando introduziriam conflitos em alocações existentes.
- Migração inicial versionada e testes de cenários temporais, API, concorrência e conflitos.

## Pendente antes de um piloto

1. Testar a migração e a API com PostgreSQL; os testes locais passaram em SQLite.
2. Completar a execução local integrada do backend e frontend com autenticação.
3. Fechar as decisões abertas da seção 18 da spec, especialmente ocupações externas, capacidade e publicação.
4. Completar disponibilidade contextual, filtros e paginação da interface e prévia de impacto das mudanças em janelas.
5. Completar arrastar e soltar para outros horários, desfazer/refazer e testes de acessibilidade.
6. Implementar geração OR-Tools, propostas, auditoria, publicação imutável, consultas e exportação.

O editor manual possui criação, edição e remoção por formulário e arraste entre dias, mas ainda não cobre todos os requisitos da fase 2. O gerador ainda não foi iniciado.

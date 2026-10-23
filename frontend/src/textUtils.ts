/**
 * Utilitários para tratamento de acentuação, pontuação e buscas no Órbita Acadêmico.
 */

/**
 * Normaliza uma cadeia de caracteres removendo acentos e marcas diacríticas,
 * convertendo para minúsculas e eliminando espaços sobressalentes.
 *
 * Exemplos:
 * - "Programação" -> "programacao"
 * - "José" -> "jose"
 * - "Análise e Desenvolvimento" -> "analise e desenvolvimento"
 * - "1º A" -> "1º a"
 */
export function normalizeText(text: unknown): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Verifica se o termo de busca está contido no texto-alvo,
 * ignorando diferenças de caixa alta/baixa e acentuação gráfica.
 */
export function matchesSearch(target: unknown, query: string): boolean {
  if (!query || !query.trim()) return true;
  return normalizeText(target).includes(normalizeText(query));
}


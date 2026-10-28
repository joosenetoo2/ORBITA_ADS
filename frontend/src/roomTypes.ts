export const roomTypeOptions: [string, string][] = [
  ['CLASSROOM', 'Sala de Aula'],
  ['LABORATORY', 'Laboratório'],
  ['METALAB', 'Metalab'],
];

export function roomTypeLabel(value: unknown): string {
  return roomTypeOptions.find(([code]) => code === value)?.[1] ?? 'Tipo não informado';
}

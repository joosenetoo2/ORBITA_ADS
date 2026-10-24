import type { Conflict } from './api';
import './validation-issues.css';

export default function ValidationIssues({ conflicts, title = 'Pendências da grade' }: { conflicts: Conflict[]; title?: string }) {
  const unique = [...new Map(conflicts.map((item) => [`${item.code}:${item.offering_id ?? item.message}:${item.conflicting_session_id ?? ''}`, item])).values()];
  if (!unique.length) return null;
  const grouped = new Map<string, Conflict[]>();
  for (const item of unique) {
    const group = item.group_code || 'Outros conflitos';
    grouped.set(group, [...(grouped.get(group) ?? []), item]);
  }
  return <section className="validation-issues" role="alert" aria-label={title}>
    <div className="validation-issues-head"><strong>{title}</strong><span>{unique.length} {unique.length === 1 ? 'item' : 'itens'}</span></div>
    <p className="validation-issues-intro">{unique.some((item) => item.code === 'OFFERING_HOURS') ? 'Confira as horas presenciais de cada oferta antes de publicar.' : 'Revise os itens abaixo e ajuste as aulas indicadas.'}</p>
    {[...grouped].map(([group, items]) => <div className="validation-issues-group" key={group}>
      <h4>{group}</h4>
      <ul>{items.map((item, index) => <li key={`${item.code}-${item.offering_id ?? index}`}>
        {item.code === 'OFFERING_HOURS' && item.subject_name && item.required_minutes !== undefined && item.allocated_minutes !== undefined
          ? <><strong>{item.subject_name}</strong><span>{item.allocated_minutes < item.required_minutes ? 'Faltam' : 'Excedem'} {Math.abs(item.required_minutes - item.allocated_minutes) / 60} h · {item.allocated_minutes / 60} de {item.required_minutes / 60} h presenciais alocadas</span></>
          : <span>{item.message}{item.conflicting_session_id ? ` Encontro #${item.conflicting_session_id}.` : ''}</span>}
      </li>)}</ul>
    </div>)}
  </section>;
}

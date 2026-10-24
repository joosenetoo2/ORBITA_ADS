import { CalendarPlus, GraduationCap, MapPin } from 'lucide-react';
import type { AgendaItem } from './TeacherAgenda';

const days = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const abbreviations = ['', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];

export default function TeacherWeek({ name, color, items, onAdd, onEdit, onDelete }: {
  name: string;
  color: string;
  items: AgendaItem[];
  onAdd: () => void;
  onEdit: (item: AgendaItem) => void;
  onDelete: (item: AgendaItem) => void;
}) {
  const weekdays = [1, 2, 3, 4, 5, 6, 7].filter((day) => day <= 5 || items.some((item) => item.weekday === day));
  const boundaries = [...new Set(items.flatMap((item) => [item.start, item.end]))].sort();
  const rows = boundaries.slice(0, -1).map((start, index) => ({ start, end: boundaries[index + 1] }))
    .filter(({ start, end }) => items.some((item) => item.start < end && item.end > start));
  const lessons = items.filter((item) => item.kind === 'LESSON');
  const events = items.filter((item) => item.kind === 'EVENT');
  const lessonMinutes = lessons.reduce((sum, item) => sum + duration(item), 0);
  const lessonStyle = palette(color, name);

  return <section className="sheet-wrap teacher-week" aria-label={`Semana de ${name}`}>
    <div className="sheet-title-header">
      <div className="sheet-title-text"><GraduationCap size={18} className="text-secondary" /><span>{name}</span><span className="sheet-title-badge">Docente</span></div>
      <div className="sheet-title-summary"><span className="text-muted">{lessons.length} bloco(s) · {formatHours(lessonMinutes)} h de aula · {events.length} horário(s) avulso(s)</span><button type="button" className="button small" onClick={onAdd}><CalendarPlus size={14} />Horário avulso</button></div>
    </div>
    {rows.length ? <div className="sheet-scroll"><table className="sheet-table" aria-label={`Todos os horários de ${name}`}>
      <thead><tr><th scope="col">Horário</th>{weekdays.map((day) => <th scope="col" key={day}><div className="day-header-cell"><span className="day-abbr">{abbreviations[day]}</span><span>{days[day]}</span></div></th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.start}-${row.end}`}><th scope="row">{row.start} – {row.end}</th>{weekdays.map((day) => {
        const item = items.find((entry) => entry.weekday === day && entry.start <= row.start && entry.end >= row.end);
        const previous = rows[index - 1];
        if (item && previous && item.start <= previous.start && item.end >= previous.end) return null;
        const span = item ? rows.slice(index).filter((segment) => segment.start >= item.start && segment.end <= item.end).length : 1;
        return <td key={day} rowSpan={span}>{item ? <div className={`teacher-week-entry ${item.kind === 'EVENT' ? 'is-event' : ''}`} style={item.kind === 'LESSON' ? lessonStyle : undefined}>
          <strong>{item.title}</strong><span>{item.kind === 'EVENT' ? 'Avulso' : item.source}</span>
          {item.detail && <small>{item.detail}</small>}
          {item.location && <small className="teacher-week-location"><MapPin size={12} />{item.location}</small>}
          {item.kind === 'EVENT' && <div className="teacher-week-actions"><button type="button" className="button small ghost" onClick={() => onEdit(item)}>Editar</button><button type="button" className="button small danger ghost" onClick={() => onDelete(item)}>Excluir</button></div>}
        </div> : <span className="sheet-dash">–</span>}</td>;
      })}</tr>)}</tbody>
    </table></div> : <p className="sheet-helper">Nenhum horário neste período.</p>}
  </section>;
}

function duration(item: AgendaItem) {
  const [startHour, startMinute] = item.start.split(':').map(Number);
  const [endHour, endMinute] = item.end.split(':').map(Number);
  return (endHour - startHour) * 60 + endMinute - startMinute;
}

function formatHours(minutes: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(minutes / 60);
}

function palette(color: string, name: string) {
  const fallback = ['#2563eb', '#059669', '#7c3aed', '#ea580c', '#db2777', '#0891b2', '#4338ca', '#d97706'];
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const chosen = /^#[0-9a-f]{6}$/i.test(color) ? color : fallback[hash % fallback.length];
  const channels = [1, 3, 5].map((index) => Number.parseInt(chosen.slice(index, index + 2), 16));
  const brightness = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
  return { backgroundColor: chosen, borderLeftColor: chosen, color: brightness >= 155 ? '#0f172a' : '#ffffff' };
}

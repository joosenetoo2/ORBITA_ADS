import { useMemo, useState, type FormEvent } from 'react';
import { FileUp, X } from 'lucide-react';
import { api, type RecordItem } from './api';
import './catalog-actions.css';

type CatalogData = { subjects: RecordItem[]; teachers: RecordItem[]; 'class-groups': RecordItem[]; 'subject-offerings': RecordItem[]; courses: RecordItem[]; 'academic-terms': RecordItem[] };
type ImportKind = 'courses' | 'subjects' | 'teachers' | 'rooms' | 'class-groups' | 'offerings';
const importLabels: Record<ImportKind, string> = { courses: 'Cursos', subjects: 'Disciplinas', teachers: 'Professores', rooms: 'Salas', 'class-groups': 'Turmas', offerings: 'Ofertas' };
const examples: Record<ImportKind, string> = {
  courses: 'codigo;nome;modalidade\nADS;Análise e Desenvolvimento de Sistemas;Presencial',
  subjects: 'codigo;nome;creditos;horas_presenciais;horas_ead\nOO;Programação OO;4;3;1',
  teachers: 'codigo;nome\nANA;Ana Oliveira\nBRUNO;Bruno Silva',
  rooms: 'codigo;nome;capacidade\nH01;Sala H01;40',
  'class-groups': 'codigo;nome\nP1A;1º A\nP1B;1º B',
  offerings: 'turma;disciplina;professor;horas_por_bloco\nP1A;OO;ANA;2',
};
const aliases: Record<string, string> = {
  codigo: 'code', cod: 'code', code: 'code', nome: 'name', name: 'name',
  creditos: 'credits', credits: 'credits', horas_presenciais: 'onsite_weekly_hours', horas_presenciais_semanais: 'onsite_weekly_hours', onsite_weekly_hours: 'onsite_weekly_hours',
  horas_ead: 'ead_weekly_hours', ead_horas: 'ead_weekly_hours', horas_ead_semanais: 'ead_weekly_hours', ead_weekly_hours: 'ead_weekly_hours',
  ead_percentual: 'ead_percentage', percentual_ead: 'ead_percentage', ead_percentage: 'ead_percentage',
  capacidade: 'capacity', capacity: 'capacity', turma: 'group_code', group_code: 'group_code',
  disciplina: 'subject_code', subject_code: 'subject_code', professor: 'teacher_code', teacher_code: 'teacher_code',
  horas_por_bloco: 'block_hours', block_hours: 'block_hours',
  modalidade: 'modality', modality: 'modality',
};
function normalize(value: string) { return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
function parseDelimited(source: string) {
  const firstLine = source.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  const delimiter = ['\t', ';', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const input = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' && !quoted) { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('Há aspas sem fechamento no arquivo.');
  row.push(cell.trim()); rows.push(row);
  if (rows.length < 2) throw new Error('Inclua cabeçalho e ao menos uma linha de dados.');
  const keys = rows[0].map((value) => aliases[normalize(value)] ?? normalize(value));
  const result = rows.slice(1).filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(keys.map((key, index) => [key, values[index] ?? ''])));
  if (!result.length) throw new Error('Nenhum registro encontrado.');
  return result;
}

export function OfferModal({ data, subjectId, teacherId, groupId, onClose, onSaved }: { data: CatalogData; subjectId?: number; teacherId?: number; groupId?: number; onClose: () => void; onSaved: (message: string) => void }) {
  const [subject, setSubject] = useState(String(subjectId ?? ''));
  const [teacher, setTeacher] = useState(String(teacherId ?? ''));
  const [group, setGroup] = useState(String(groupId ?? ''));
  const [blockHours, setBlockHours] = useState('2');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = data.subjects.find((item) => item.id === Number(subject));
  const existing = data['subject-offerings'].find((item) => Number(item.group) === Number(group) && Number(item.subject) === Number(subject));
  const teacherAlreadyLinked = Boolean(existing && Array.isArray(existing.eligible_teachers) && existing.eligible_teachers.some((id) => Number(id) === Number(teacher)));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (teacherAlreadyLinked) { setError('Esta disciplina já está ofertada para a turma com este professor.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ created: boolean }>(`subjects/${subject}/offer/`, { method: 'POST', body: JSON.stringify({ group_id: Number(group), teacher_id: Number(teacher), block_hours: Number(blockHours) }) });
      onSaved(result.created ? 'Disciplina ofertada. As aulas presenciais já estão prontas para alocação na grade.' : 'Professor vinculado à oferta existente. Nenhuma aula nova foi criada.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível ofertar.'); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal catalog-modal" role="dialog" aria-modal="true" aria-labelledby="offer-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">OFERTA DE DISCIPLINA</span><h2 id="offer-title">{existing ? 'Professor da oferta existente' : 'Ofertar e alocar professor'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X /></button></div><form onSubmit={submit}><div className="form-grid"><label className="form-field">Disciplina<select required value={subject} onChange={(event) => setSubject(event.target.value)}><option value="">Selecione…</option>{data.subjects.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label><label className="form-field">Turma<select required value={group} onChange={(event) => setGroup(event.target.value)}><option value="">Selecione…</option>{data['class-groups'].map((item) => <option key={item.id} value={item.id}>{String(item.name || item.code)} · {String(data.courses.find((course) => course.id === item.course)?.code ?? '')} · {String(data['academic-terms'].find((term) => term.id === item.term)?.name ?? '')}</option>)}</select></label><label className="form-field">Professor<select required value={teacher} onChange={(event) => setTeacher(event.target.value)}><option value="">Selecione…</option>{data.teachers.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label>{!existing && <label className="form-field">Duração preferida do bloco<select value={blockHours} onChange={(event) => setBlockHours(event.target.value)}>{[1, 2, 3, 4].map((hours) => <option key={hours} value={hours}>{hours} {hours === 1 ? 'hora' : 'horas'}</option>)}</select></label>}</div><p className="catalog-hint">{existing ? teacherAlreadyLinked ? 'Esta disciplina já está ofertada para a turma com este professor. Nenhuma nova oferta ou aula será criada.' : 'Esta disciplina já está ofertada para a turma. O professor selecionado será vinculado à oferta existente, sem criar novas aulas.' : selected ? `${selected.credits ?? '—'} créditos · ${selected.total_workload ?? '—'} horas totais · ${selected.onsite_weekly_hours ?? '—'} horas presenciais + ${selected.ead_weekly_hours ?? 0} horas EAD por semana. Apenas as presenciais entram na grade.` : 'Selecione a disciplina para ver a carga semanal que será alocada.'}</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy || teacherAlreadyLinked}>{busy ? 'Salvando…' : existing ? 'Vincular professor' : 'Ofertar disciplina'}</button></div></form></section></div>;
}

export function ImportModal({ kind, data, onClose, onSaved }: { kind: ImportKind; data: CatalogData; onClose: () => void; onSaved: (message: string) => void }) {
  const [source, setSource] = useState('');
  const [course, setCourse] = useState('');
  const [term, setTerm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => { try { return source.trim() ? parseDelimited(source) : []; } catch { return []; } }, [source]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const rows = parseDelimited(source);
      const result = await api<{ created: number; skipped: number; updated: number }>('batch-import/', { method: 'POST', body: JSON.stringify({ resource: kind, rows, course_id: Number(course), term_id: Number(term) }) });
      onSaved(`${result.created} criado(s), ${result.updated} atualizado(s) e ${result.skipped} já existente(s).`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar.'); }
    finally { setBusy(false); }
  }
  function downloadExample() { const blob = new Blob(['\uFEFF', examples[kind].replace(/\n/g, '\r\n')], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `modelo-${kind}.csv`; link.click(); URL.revokeObjectURL(link.href); }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal catalog-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">IMPORTAÇÃO EM LOTE</span><h2 id="import-title">Importar {importLabels[kind].toLowerCase()}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X /></button></div><form onSubmit={submit}><p className="catalog-hint">Cole dados da planilha ou escolha um arquivo CSV/TSV. A primeira linha deve conter os títulos das colunas. Se uma linha falhar, nada será importado.</p>{(kind === 'class-groups' || kind === 'offerings') && <div className="form-grid">{kind === 'class-groups' && <label className="form-field">Curso<select required value={course} onChange={(event) => setCourse(event.target.value)}><option value="">Selecione…</option>{data.courses.map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label>}<label className="form-field">Período letivo<select required value={term} onChange={(event) => setTerm(event.target.value)}><option value="">Selecione…</option>{data['academic-terms'].map((item) => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label></div>}<div className="catalog-import-controls"><label className="form-field catalog-file"><FileUp size={17} />Escolher arquivo CSV ou TSV<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setSource).catch(() => setError('Não foi possível ler o arquivo.')); }} /></label><button type="button" className="button small" onClick={downloadExample}>Baixar modelo</button></div><label className="form-field">Dados para importar<textarea required value={source} onChange={(event) => setSource(event.target.value)} placeholder={examples[kind]} /></label><p className="catalog-hint"><strong>Colunas esperadas:</strong> {examples[kind].split('\n')[0]}{preview.length > 0 && ` · ${preview.length} linha(s) pronta(s)`}</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? 'Importando…' : 'Importar lote'}</button></div></form></section></div>;
}

export type { ImportKind };

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BookOpen,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  DoorOpen,
  FileUp,
  GraduationCap,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  School,
  Search,
  Settings2,
  Trash2,
  Users,
  X
} from 'lucide-react';
import { api, create, listAll, remove, update, type RecordItem } from './api';
import ScheduleEditor from './ScheduleEditor';
import GridWorkspace from './GridWorkspace';
import OfferPlanner from './OfferPlanner';
import type { AuthUser } from './AuthGate';
import { matchesSearch } from './textUtils';
import { ImportModal, OfferModal, type ImportKind } from './CatalogActions';

type Section = 'grid' | 'overview' | 'catalog' | 'import' | 'time' | 'schedules';
type Resource =
  | 'institutions'
  | 'academic-terms'
  | 'courses'
  | 'subjects'
  | 'teachers'
  | 'rooms'
  | 'class-groups'
  | 'subject-offerings'
  | 'session-requirements'
  | 'time-profiles'
  | 'time-windows'
  | 'time-blocks';

export type Data = Record<Resource, RecordItem[]>;

const emptyData: Data = {
  institutions: [],
  'academic-terms': [],
  courses: [],
  subjects: [],
  teachers: [],
  rooms: [],
  'class-groups': [],
  'subject-offerings': [],
  'session-requirements': [],
  'time-profiles': [],
  'time-windows': [],
  'time-blocks': [],
};

const weekdayNames = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

const resourceNames: Record<Resource, string> = {
  institutions: 'Instituição',
  'academic-terms': 'Período letivo',
  courses: 'Curso',
  subjects: 'Disciplina',
  teachers: 'Professor',
  rooms: 'Sala',
  'class-groups': 'Turma',
  'subject-offerings': 'Oferta',
  'session-requirements': 'Encontro requerido',
  'time-profiles': 'Perfil de horário',
  'time-windows': 'Janela de horário',
  'time-blocks': 'Intervalo bloqueado',
};

const resourcePluralNames: Record<Resource, string> = {
  institutions: 'Instituições',
  'academic-terms': 'Períodos letivos',
  courses: 'Cursos',
  subjects: 'Disciplinas',
  teachers: 'Professores',
  rooms: 'Salas',
  'class-groups': 'Turmas',
  'subject-offerings': 'Ofertas de disciplinas',
  'session-requirements': 'Encontros requeridos',
  'time-profiles': 'Perfis de horários',
  'time-windows': 'Janelas de horários',
  'time-blocks': 'Intervalos bloqueados',
};

const resourceAddLabels: Record<Resource, string> = {
  institutions: 'Nova instituição',
  'academic-terms': 'Novo período letivo',
  courses: 'Novo curso',
  subjects: 'Nova disciplina',
  teachers: 'Novo professor',
  rooms: 'Nova sala',
  'class-groups': 'Nova turma',
  'subject-offerings': 'Nova oferta',
  'session-requirements': 'Novo encontro requerido',
  'time-profiles': 'Novo perfil de horário',
  'time-windows': 'Nova janela de horário',
  'time-blocks': 'Novo intervalo',
};

const labels: Record<string, string> = {
  name: 'Nome',
  code: 'Código',
  timezone: 'Fuso horário',
  class_minutes: 'Minutos por hora-aula',
  slot_granularity_minutes: 'Granularidade em minutos',
  starts_on: 'Data inicial',
  ends_on: 'Data final',
  modality: 'Modalidade',
  total_workload: 'Carga horária total',
  credits: 'Créditos',
  onsite_weekly_hours: 'Horas presenciais por semana',
  ead_weekly_hours: 'Horas EAD por semana',
  period_number: 'Período curricular',
  time_profile: 'Turno / perfil de horários',
  weekly_hours: 'Horas presenciais/semana',
  max_weekly_minutes: 'Limite semanal (minutos)',
  capacity: 'Capacidade',
  location: 'Localização',
  course: 'Curso',
  term: 'Período letivo',
  weekday: 'Dia da semana',
  starts_at: 'Início',
  ends_at: 'Fim',
  profile: 'Perfil',
  institution: 'Instituição',
  scope: 'Aplicar a',
  scope_id: 'Registro associado',
  group: 'Turma',
  subject: 'Disciplina',
  weekly_minutes: 'Carga semanal (minutos)',
  eligible_teachers: 'Professores elegíveis',
  offering: 'Oferta',
  duration_minutes: 'Duração (minutos)',
  weekly_count: 'Encontros por semana',
  kind: 'Tipo de encontro',
  reason: 'Motivo',
  color: 'Cor na grade',
};

const PRESET_TEACHER_COLORS = [
  { label: 'Azul Real', value: '#2563eb' },
  { label: 'Azul Marinho', value: '#1e3a5f' },
  { label: 'Verde Esmeralda', value: '#059669' },
  { label: 'Verde Floresta', value: '#15803d' },
  { label: 'Roxo Nobre', value: '#7c3aed' },
  { label: 'Violeta / Uva', value: '#581c87' },
  { label: 'Rosa Pink', value: '#db2777' },
  { label: 'Vinho / Carmim', value: '#831843' },
  { label: 'Laranja', value: '#ea580c' },
  { label: 'Âmbar / Dourado', value: '#d97706' },
  { label: 'Ciano Oceano', value: '#0891b2' },
  { label: 'Índigo', value: '#4338ca' },
  { label: 'Ardósia / Grafite', value: '#334155' },
  { label: 'Marrom Café', value: '#78350f' },
];

type Field = {
  key: string;
  type?: string;
  options?: [string, string][];
  source?: Resource;
  required?: boolean;
  multiple?: boolean;
  scopeSource?: boolean;
};

const fieldsets: Record<Resource, Field[]> = {
  institutions: [
    { key: 'name', required: true },
    { key: 'timezone', required: true },
    { key: 'slot_granularity_minutes', type: 'number', required: true }
  ],
  'academic-terms': [
    { key: 'institution', source: 'institutions', required: true },
    { key: 'name', required: true },
    { key: 'starts_on', type: 'date', required: true },
    { key: 'ends_on', type: 'date', required: true }
  ],
  courses: [
    { key: 'institution', source: 'institutions', required: true },
    { key: 'code', required: true },
    { key: 'name', required: true },
    { key: 'modality' }
  ],
  subjects: [
    { key: 'institution', source: 'institutions', required: true },
    { key: 'code', required: true },
    { key: 'name', required: true },
    { key: 'period_number', options: Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1}º período`]), required: true },
    { key: 'credits', type: 'number', required: true },
    { key: 'onsite_weekly_hours', type: 'number', required: true },
    { key: 'ead_weekly_hours', type: 'number', required: true }
  ],
  teachers: [
    { key: 'institution', source: 'institutions', required: true },
    { key: 'code', required: true },
    { key: 'name', required: true },
    { key: 'color', type: 'color' }
  ],
  rooms: [
    { key: 'institution', source: 'institutions', required: true },
    { key: 'code', required: true },
    { key: 'name', required: true },
    { key: 'capacity', type: 'number' },
    { key: 'location' }
  ],
  'class-groups': [
    { key: 'course', source: 'courses', required: true },
    { key: 'term', source: 'academic-terms', required: true },
    { key: 'period_number', options: Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1}º período`]), required: true },
    { key: 'time_profile', source: 'time-profiles', required: true },
    { key: 'code', required: true },
    { key: 'name', required: true }
  ],
  'subject-offerings': [
    { key: 'group', source: 'class-groups', required: true },
    { key: 'subject', source: 'subjects', required: true },
    { key: 'eligible_teachers', source: 'teachers', multiple: true, required: true },
  ],
  'session-requirements': [],
  'time-profiles': [
    { key: 'institution', source: 'institutions', required: true },
    { key: 'name', required: true }
  ],
  'time-windows': [
    { key: 'institution', source: 'institutions', required: true },
    { key: 'profile', source: 'time-profiles', required: true },
    {
      key: 'scope',
      options: [
        ['INSTITUTION', 'Instituição'],
        ['COURSE', 'Curso'],
        ['GROUP', 'Turma'],
        ['TEACHER', 'Professor'],
        ['ROOM', 'Sala'],
        ['OFFERING', 'Oferta']
      ],
      required: true
    },
    { key: 'scope_id', scopeSource: true },
    {
      key: 'weekday',
      options: weekdayNames.slice(1).map((name, index) => [String(index + 1), name]),
      required: true
    },
    { key: 'starts_at', type: 'time', required: true },
    { key: 'ends_at', type: 'time', required: true }
  ],
  'time-blocks': [
    { key: 'institution', source: 'institutions', required: true },
    { key: 'scope', options: [['INSTITUTION', 'Instituição'], ['COURSE', 'Curso'], ['GROUP', 'Turma'], ['TEACHER', 'Professor'], ['ROOM', 'Sala'], ['OFFERING', 'Oferta']], required: true },
    { key: 'scope_id', scopeSource: true },
    { key: 'weekday', options: weekdayNames.slice(1).map((name, index) => [String(index + 1), name]), required: true },
    { key: 'starts_at', type: 'time', required: true },
    { key: 'ends_at', type: 'time', required: true },
    { key: 'reason', required: true },
  ],
};

const immutableRelations: Partial<Record<Resource, string[]>> = {
  'academic-terms': ['institution'],
  courses: ['institution'],
  subjects: ['institution'],
  teachers: ['institution'],
  rooms: ['institution'],
  'class-groups': ['course', 'term'],
  'subject-offerings': ['group', 'subject'],
  'session-requirements': ['offering'],
  'time-profiles': ['institution'],
  'time-windows': ['institution'],
  'time-blocks': ['institution'],
};

function displayName(item: RecordItem) {
  return String(item.name ?? item.code ?? (item.subject ? `Oferta #${item.id}` : item.id));
}

function getResourceColumns(resource: Resource): string[] {
  return resource === 'academic-terms'
    ? ['name', 'starts_on', 'ends_on']
    : resource === 'rooms'
    ? ['code', 'name', 'capacity', 'location']
    : resource === 'time-windows'
    ? ['weekday', 'starts_at', 'ends_at']
    : resource === 'time-blocks'
    ? ['weekday', 'starts_at', 'ends_at', 'reason', 'scope']
    : resource === 'subject-offerings'
    ? ['group', 'subject', 'weekly_hours', 'eligible_teachers']
    : resource === 'session-requirements'
    ? ['offering', 'duration_minutes', 'weekly_count', 'kind']
    : resource === 'institutions'
    ? ['name', 'timezone', 'slot_granularity_minutes']
    : resource === 'time-profiles'
    ? ['name']
    : resource === 'courses'
    ? ['code', 'name', 'modality']
    : resource === 'subjects'
    ? ['code', 'name', 'period_number', 'credits', 'total_workload', 'onsite_weekly_hours', 'ead_weekly_hours']
    : resource === 'teachers'
    ? ['code', 'name', 'color']
    : resource === 'class-groups'
    ? ['code', 'name', 'period_number', 'time_profile', 'course', 'term']
    : ['code', 'name'];
}

function displayResourceValue(row: RecordItem, key: string, data: Data) {
  if (key === 'color') {
    const hex = String(row[key] || '').trim();
    if (!hex) {
      return (
        <span style={{ color: 'var(--color-text-dim)', fontSize: '12px', fontStyle: 'italic' }}>
          Automática
        </span>
      );
    }
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        <span
          style={{
            display: 'inline-block',
            width: 18,
            height: 18,
            borderRadius: '50%',
            backgroundColor: hex,
            border: '2px solid rgba(255,255,255,0.8)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.2)'
          }}
        />
        <code style={{ fontSize: '12px', fontWeight: 600 }}>{hex}</code>
      </div>
    );
  }
  if (key === 'weekday') return weekdayNames[Number(row[key])];
  if (key === 'weekly_hours') return `${Number(row.weekly_minutes ?? 0) / 60} h`;
  if (key === 'total_workload') return `${String(row[key] ?? '—')} h`;
  if (key === 'ead_weekly_hours') return `${String(row[key] ?? 0)} h`;
  if (key === 'period_number') return row[key] ? `${row[key]}º` : 'Definir';
  if (key === 'workload_unit') return row[key] === 'CLASS_HOUR' ? 'Hora-aula' : 'Hora-relógio';
  if (key === 'eligible_teachers' && Array.isArray(row[key])) {
    const teacherNames = (row[key] as number[]).map((id) => {
      const t = data.teachers.find((teacher) => teacher.id === id);
      return t ? displayName(t) : `#${id}`;
    });
    return teacherNames.join(', ') || 'Nenhum';
  }
  const relation = (
    {
      group: 'class-groups',
      subject: 'subjects',
      offering: 'subject-offerings',
      course: 'courses',
      term: 'academic-terms',
      institution: 'institutions',
      profile: 'time-profiles',
      time_profile: 'time-profiles',
    } as Partial<Record<string, Resource>>
  )[key];

  if (relation) {
    const item = data[relation].find((entry) => entry.id === row[key]);
    return item ? displayName(item) : row[key] ? `#${row[key]}` : '—';
  }

  return String(row[key] ?? '—');
}

function getInitialValues(resource: Resource, item: RecordItem | null, data: Data): Record<string, string> {
  if (!item) {
    return {
      timezone: 'America/Fortaleza',
      class_minutes: '60',
      slot_granularity_minutes: '10',
      workload_unit: 'CLASS_HOUR',
      ead_weekly_hours: '0',
      scope: 'INSTITUTION',
      institution: String(data.institutions[0]?.id ?? '')
    };
  }

  const values: Record<string, string> = {};
  for (const field of fieldsets[resource]) {
    const raw = item[field.key];
    if (raw === undefined || raw === null) {
      values[field.key] = '';
    } else if (field.multiple && Array.isArray(raw)) {
      values[field.key] = raw.map(String).join(',');
    } else if (field.type === 'time' && typeof raw === 'string') {
      values[field.key] = raw.slice(0, 5);
    } else {
      values[field.key] = String(raw);
    }
  }

  if (resource === 'time-windows' && !values.scope) {
    values.scope = 'INSTITUTION';
  }

  return values;
}

function Modal({
  resource,
  item,
  defaults,
  data,
  onClose,
  onSaved,
  onDelete
}: {
  resource: Resource;
  item: RecordItem | null;
  defaults?: Record<string, string>;
  data: Data;
  onClose: () => void;
  onSaved: (noticeMessage: string) => void;
  onDelete?: (item: RecordItem) => void;
}) {
  const isEditing = Boolean(item);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...getInitialValues(resource, item, data), ...defaults }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      const immutables = isEditing ? immutableRelations[resource] ?? [] : [];

      for (const field of fieldsets[resource]) {
        if (isEditing && immutables.includes(field.key)) {
          continue;
        }

        const raw = values[field.key] ?? '';
        if (!raw) {
          if (!field.required) {
            payload[field.key] = field.type === 'number' ? null : '';
          }
          continue;
        }

        payload[field.key] = field.multiple
          ? raw.split(',').filter(Boolean).map(Number)
          : field.type === 'number' || field.source || field.scopeSource || field.key === 'weekday'
          ? Number(raw)
          : raw;
      }

      if (isEditing && item) {
        await update(resource, item.id, payload);
        onSaved(`${resourceNames[resource]} “${displayName({ ...item, ...payload })}” atualizado(a) com sucesso.`);
      } else {
        await create(resource, payload);
        onSaved(`${resourceNames[resource]} cadastrado(a) com sucesso.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-heading"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">{isEditing ? 'EDITAR CADASTRO' : 'NOVO CADASTRO'}</span>
            <h2 id="modal-heading">
              {isEditing ? `Editar ${resourceNames[resource]}` : resourceNames[resource]}
            </h2>
            {isEditing && item && (
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                Identificador: #{item.id} · {displayName(item)}
              </p>
            )}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fechar modal">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="form-grid">
            {fieldsets[resource].map((field) => {
              if (field.scopeSource && values.scope === 'INSTITUTION') return null;

              const isImmutable = isEditing && (immutableRelations[resource] ?? []).includes(field.key);

              const scopeResource = (
                {
                  COURSE: 'courses',
                  GROUP: 'class-groups',
                  TEACHER: 'teachers',
                  ROOM: 'rooms',
                  OFFERING: 'subject-offerings'
                } as Partial<Record<string, Resource>>
              )[values.scope];

              const choices =
                field.scopeSource && scopeResource
                  ? data[scopeResource].map((entry): [string, string] => [String(entry.id), displayName(entry)])
                  : field.source
                  ? data[field.source].filter((entry) => field.key !== 'time_profile' || (entry.is_active && (!values.course || Number(entry.institution) === Number(data.courses.find((course) => course.id === Number(values.course))?.institution)))).map((entry): [string, string] => [String(entry.id), displayName(entry)])
                  : field.options;

              return (
                <label className={`form-field ${field.multiple || field.key === 'color' ? 'wide' : ''}`} key={field.key}>
                  <span>
                    {labels[field.key] ?? field.key}
                    {isImmutable && (
                      <small style={{ marginLeft: 6, color: 'var(--color-text-dim)', fontWeight: 500 }}>
                        (vínculo fixo)
                      </small>
                    )}
                  </span>
                  {choices ? (
                    <select
                      required={!isImmutable && (field.required || field.scopeSource)}
                      disabled={isImmutable}
                      multiple={field.multiple}
                      value={field.multiple ? (values[field.key] ?? '').split(',').filter(Boolean) : values[field.key] ?? ''}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          [field.key]: field.multiple
                            ? Array.from(event.target.selectedOptions).map((option) => option.value).join(',')
                            : event.target.value,
                          ...(field.key === 'scope' ? { scope_id: '' } : {})
                        })
                      }
                    >
                      {!field.multiple && <option value="">Selecione…</option>}
                      {choices.map(([value, name]) => (
                        <option value={value} key={value}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : field.key === 'color' ? (
                    <div style={{ marginTop: '4px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        {PRESET_TEACHER_COLORS.map((c) => {
                          const isSelected = (values.color || '').toLowerCase() === c.value.toLowerCase();
                          return (
                            <button
                              key={c.value}
                              type="button"
                              title={`${c.label} (${c.value})`}
                              onClick={() => setValues({ ...values, color: c.value })}
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                backgroundColor: c.value,
                                border: isSelected ? '3px solid #ffffff' : '2px solid transparent',
                                boxShadow: isSelected
                                  ? '0 0 0 2px var(--color-primary, #3b82f6), 0 2px 4px rgba(0,0,0,0.25)'
                                  : '0 1px 3px rgba(0,0,0,0.2)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transform: isSelected ? 'scale(1.15)' : 'none',
                                transition: 'transform 0.15s, box-shadow 0.15s',
                                padding: 0
                              }}
                            >
                              {isSelected && <Check size={16} color="#ffffff" strokeWidth={3} />}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="color"
                          title="Escolher cor personalizada"
                          value={values.color && /^#[0-9a-fA-F]{6}$/.test(values.color) ? values.color : '#2563eb'}
                          onChange={(e) => setValues({ ...values, color: e.target.value })}
                          style={{
                            width: '40px',
                            height: '38px',
                            padding: '2px',
                            borderRadius: '8px',
                            border: '1px solid var(--color-border)',
                            cursor: 'pointer',
                            background: 'none'
                          }}
                        />
                        <input
                          type="text"
                          placeholder="Ex: #2563eb ou escolha uma cor acima"
                          value={values.color ?? ''}
                          onChange={(e) => setValues({ ...values, color: e.target.value })}
                          style={{ flex: 1, fontFamily: 'monospace' }}
                        />
                        {values.color && (
                          <button
                            type="button"
                            className="button small ghost"
                            onClick={() => setValues({ ...values, color: '' })}
                            title="Remover cor e usar cor automática"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                      <small style={{ display: 'block', marginTop: '6px', color: 'var(--color-text-dim)', fontSize: '11.5px' }}>
                        Todas as aulas deste professor na grade usarão esta cor para identificação rápida.
                      </small>
                    </div>
                  ) : (
                    <input
                      required={!isImmutable && field.required}
                      disabled={isImmutable}
                      type={field.type ?? 'text'}
                      min={field.type === 'number' ? 0 : undefined}
                      max={resource === 'subjects' && (field.key === 'onsite_weekly_hours' || field.key === 'ead_weekly_hours') && values.credits ? Number(values.credits) : undefined}
                      list={resource === 'class-groups' && field.key === 'name' ? 'group-name-options' : undefined}
                      value={values[field.key] ?? ''}
                      onChange={(event) => setValues({ ...values, [field.key]: event.target.value, ...(resource === 'subjects' && field.key === 'credits' && !values.onsite_weekly_hours ? { onsite_weekly_hours: event.target.value } : {}) })}
                    />
                  )}
                </label>
              );
            })}
          </div>
          {resource === 'class-groups' && <datalist id="group-name-options">{Array.from({ length: 10 }, (_, index) => index + 1).flatMap((period) => ['A', 'B', 'C', 'D'].map((letter) => <option key={`${period}-${letter}`} value={`${period}º ${letter}`} />))}</datalist>}
          {resource === 'subjects' && <p className="catalog-hint">Cada crédito corresponde a 1 hora-aula semanal de 60 minutos e a 20 horas-aula totais. Exemplo: 4 créditos = 3 horas presenciais + 1 hora EAD por semana. Apenas as horas presenciais entram na grade.</p>}

          {error && (
            <p className="form-error" role="alert">
              <CircleAlert size={16} />
              {error}
            </p>
          )}

          <div className="modal-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            {isEditing && item && resource !== 'institutions' ? (
              <button
                className="button danger ghost"
                type="button"
                onClick={() => onDelete?.(item)}
                title={`Excluir este(a) ${resourceNames[resource].toLowerCase()}`}
              >
                <Trash2 size={16} />
                Excluir {resourceNames[resource].toLowerCase()}
              </button>
            ) : <span />}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button className="button ghost" type="button" onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button className="button primary" type="submit" disabled={saving}>
                {saving ? 'Salvando…' : isEditing ? 'Salvar alterações' : 'Salvar cadastro'}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function DataCard({
  title,
  count,
  icon: Icon,
  description
}: {
  title: string;
  count: number;
  icon: typeof School;
  description: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className="stat-icon">
          <Icon size={22} />
        </span>
        <span className="stat-count">{count.toString().padStart(2, '0')}</span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function ListPanel({
  resource,
  rows,
  title,
  onAdd,
  onEdit,
  onDelete,
  data
}: {
  resource: Resource;
  rows: RecordItem[];
  title?: string;
  onAdd: () => void;
  onEdit: (item: RecordItem) => void;
  onDelete?: (item: RecordItem) => void;
  data: Data;
}) {
  const columns = getResourceColumns(resource);

  return (
    <section className="panel list-panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">CONFIGURAÇÃO</span>
          <h3>
            {title ?? (rows.length === 1 ? resourceNames[resource] : resourcePluralNames[resource])}
          </h3>
        </div>
        <button className="button small" onClick={onAdd} aria-label={`Adicionar ${resourceAddLabels[resource].toLowerCase()}`}>
          <Plus size={15} />
          {resourceAddLabels[resource]}
        </button>
      </div>

      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((key) => (
                  <th key={key} scope="col">
                    {labels[key] ?? key}
                  </th>
                ))}
                <th scope="col" className="row-actions-cell">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((key) => (
                    <td key={key}>{displayResourceValue(row, key, data)}</td>
                  ))}
                  <td className="row-actions-cell">
                    <div className="row-actions">
                      <button
                        className="button small ghost row-action"
                        onClick={() => onEdit(row)}
                        title={`Editar ${resourceNames[resource]}`}
                        aria-label={`Editar ${displayName(row)}`}
                      >
                        <Pencil size={14} />
                        <span>Editar</span>
                      </button>
                      {resource !== 'institutions' && (
                        <button
                          className="button small danger ghost row-action"
                          onClick={() => onDelete?.(row)}
                          title={`Excluir ${resourceNames[resource]}`}
                          aria-label={`Excluir ${displayName(row)}`}
                        >
                          <Trash2 size={14} />
                          <span>Excluir</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-list">Nenhum registro ainda. Use “Adicionar” para começar.</div>
      )}
    </section>
  );
}

export default function App({
  user,
  onLogout,
  authError
}: {
  user: AuthUser;
  onLogout: () => void;
  authError: string;
}) {
  const [section, setSection] = useState<Section>('grid');
  const [data, setData] = useState<Data>(emptyData);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalTarget, setModalTarget] = useState<{ resource: Resource; item: RecordItem | null; defaults?: Record<string, string> } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [gridRefresh, setGridRefresh] = useState(0);
  const [settingShifts, setSettingShifts] = useState(false);
  const [preferredScheduleId, setPreferredScheduleId] = useState<number | null>(null);
  const [offerTarget, setOfferTarget] = useState<{ subjectId?: number; teacherId?: number; groupId?: number } | null>(null);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ resource: Resource; item: RecordItem } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Tabbed catalog state
  const [catalogTab, setCatalogTab] = useState<Resource>('subjects');
  const [catalogSearch, setCatalogSearch] = useState('');

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const resources = Object.keys(emptyData) as Resource[];
      const results = await Promise.all(resources.map((resource) => listAll(resource)));
      setData(Object.fromEntries(resources.map((resource, index) => [resource, results[index]])) as Data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, []);

  async function executeDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await remove(deleteTarget.resource, deleteTarget.item.id);
      setNotice(`${resourceNames[deleteTarget.resource]} "${displayName(deleteTarget.item)}" excluído(a) com sucesso.`);
      setDeleteTarget(null);
      setModalTarget(null);
      await loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao excluir o registro.';
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const institution = data.institutions[0];

  async function setupShifts() {
    if (!institution) return;
    setSettingShifts(true);
    setError('');
    try {
      await api('time-profiles/setup-shifts/', { method: 'POST', body: JSON.stringify({ institution_id: institution.id }) });
      setNotice('Perfis Manhã e Noite ativos. As janelas padrão podem ser ajustadas abaixo; o descanso mínimo do professor é de 11 horas entre dias consecutivos.');
      await loadData(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível configurar os perfis.'); }
    finally { setSettingShifts(false); }
  }

  const nav = useMemo(
    () => [
      { id: 'grid' as Section, title: 'Grade de aulas', icon: CalendarDays },
      { id: 'catalog' as Section, title: 'Cadastros', icon: BookOpen },
      { id: 'import' as Section, title: 'Importar em lote', icon: FileUp },
      { id: 'overview' as Section, title: 'Visão geral', icon: LayoutDashboard },
      { id: 'time' as Section, title: 'Regras de horário', icon: Clock3 },
      { id: 'schedules' as Section, title: 'Editor detalhado', icon: Settings2 },
    ],
    []
  );

  const catalogTabs = useMemo(
    () => [
      { id: 'subjects' as Resource, label: 'Disciplinas', icon: BookOpen, count: data.subjects.length, description: 'Matriz curricular, cargas horárias e disciplinas' },
      { id: 'class-groups' as Resource, label: 'Turmas', icon: Users, count: data['class-groups'].length, description: 'Turmas vinculadas a cursos e períodos letivos' },
      { id: 'teachers' as Resource, label: 'Professores', icon: GraduationCap, count: data.teachers.length, description: 'Docentes disponíveis para as ofertas de disciplinas' },
      { id: 'rooms' as Resource, label: 'Salas', icon: DoorOpen, count: data.rooms.length, description: 'Salas de aula, laboratórios e capacidade de ocupação' },
      { id: 'academic-terms' as Resource, label: 'Períodos Letivos', icon: Calendar, count: data['academic-terms'].length, description: 'Semestres acadêmicos e intervalos de vigência' },
      { id: 'courses' as Resource, label: 'Cursos', icon: School, count: data.courses.length, description: 'Cursos de graduação e tecnologia da instituição' },
      { id: 'subject-offerings' as Resource, label: 'Ofertas de Disciplinas', icon: Layers, count: data['subject-offerings'].length, description: 'Vínculo das disciplinas ofertadas a turmas e docentes' },
      { id: 'institutions' as Resource, label: 'Instituição', icon: Settings2, count: data.institutions.length, description: 'Configuração geral de hora-aula, fuso e granularidade' },
    ],
    [data]
  );

  const navigate = (next: Section) => {
    setSection(next);
    setMobileNav(false);
  };

  const userInitials = useMemo(() => {
    const parts = (user.name || user.username).trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return (user.username.slice(0, 2) || 'OA').toUpperCase();
  }, [user]);

  const userRole = useMemo(() => {
    if (user.is_superuser) return 'Superusuário';
    return user.groups?.[0] || 'Coordenador';
  }, [user]);

  const openCreateModal = (resource: Resource, defaults?: Record<string, string>) => {
    setModalTarget({ resource, item: null, defaults });
  };

  const openEditModal = (resource: Resource, item: RecordItem) => {
    setModalTarget({ resource, item });
  };

  // Determine active resource in the catalog tab
  const activeResource: Resource = catalogTab;

  const activeRows = data[activeResource] ?? [];
  const filteredRows = useMemo(() => {
    if (!catalogSearch.trim()) return activeRows;
    return activeRows.filter((row) =>
      Object.values(row).some((val) => matchesSearch(val, catalogSearch))
    );
  }, [activeRows, catalogSearch]);

  return (
    <div className="app-shell">
      {/* Sidebar Navigation */}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
          <div>
            <strong>ÓRBITA</strong>
            <small>ACADÊMICO</small>
          </div>
        </div>

        <div className="sidebar-label">PLANEJAMENTO</div>
        <nav aria-label="Navegação principal">
          {nav.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${section === id ? 'active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{title}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="institution-mark">
            <School size={18} />
          </div>
          <div>
            <strong>{String(institution?.name ?? 'Instituição de Ensino')}</strong>
            <small>{institution ? 'Ambiente acadêmico ativo' : 'Configuração inicial'}</small>
          </div>
          {institution && (
            <button
              className="icon-button"
              style={{ width: '28px', height: '28px', color: '#94a3b8' }}
              onClick={() => openEditModal('institutions', institution)}
              title="Editar dados da instituição"
              aria-label="Editar dados da instituição"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </aside>

      {mobileNav && <button className="mobile-scrim" aria-label="Fechar menu" onClick={() => setMobileNav(false)} />}

      {/* Main Container */}
      <main className="main">
        {/* Topbar */}
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobileNav(true)}
            aria-label="Abrir menu de navegação"
          >
            <Menu size={22} />
          </button>

          <div className="breadcrumb">
            <span>Área de trabalho</span>
            <span>/</span>
            <strong>{nav.find((item) => item.id === section)?.title}</strong>
          </div>

          <div className="top-actions">
            <span className="date-badge">
              <CalendarDays size={15} />
              Planejamento acadêmico
            </span>

            <button
              className={`icon-button ${loading ? 'spinning' : ''}`}
              onClick={() => {
                if (section === 'grid') setGridRefresh((v) => v + 1);
                else void loadData();
              }}
              aria-label="Atualizar dados"
              title="Atualizar dados acadêmicos"
            >
              <RefreshCw size={18} />
            </button>

            {/* User Profile Pill */}
            <div className="top-user-pill" title={`Conectado como ${user.username}`}>
              <div className="top-avatar">{userInitials}</div>
              <div className="top-user-info">
                <span className="top-user-name">{user.name || user.username}</span>
                <span className="top-user-role">{userRole}</span>
              </div>
            </div>

            <button className="icon-button" onClick={onLogout} aria-label="Sair da plataforma" title="Encerrar sessão">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div className="content">
          {notice && (
            <div className="notice success" role="status">
              <CheckCircle2 size={18} />
              <span>{notice}</span>
              <button className="icon-button" onClick={() => setNotice('')} aria-label="Fechar aviso">
                <X size={16} />
              </button>
            </div>
          )}

          {authError && (
            <div className="notice error" role="alert">
              <CircleAlert size={18} />
              <span>{authError}</span>
            </div>
          )}

          {error && (
            <div className="notice error" role="alert">
              <CircleAlert size={18} />
              <span>{error}</span>
            </div>
          )}

          {section === 'grid' ? (
            <GridWorkspace key={gridRefresh} initialScheduleId={preferredScheduleId} onSetup={() => void loadData()} onOpenOffers={() => { setCatalogTab('subject-offerings'); navigate('catalog'); }} onOpenTimeProfiles={() => navigate('time')} />
          ) : loading ? (
            <div className="loading-state">
              <RefreshCw size={30} className="spinning" style={{ color: 'var(--color-secondary)' }} />
              <p>Carregando registros acadêmicos…</p>
            </div>
          ) : (
            <>
              {section === 'overview' && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">PAINEL DE CONTROLE</span>
                      <h1>Visão geral da instituição</h1>
                      <p>Acompanhe os principais indicadores da estrutura acadêmica e prepare as próximas grades.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {institution && (
                        <button
                          className="button"
                          onClick={() => openEditModal('institutions', institution)}
                        >
                          <Pencil size={16} />
                          Editar instituição
                        </button>
                      )}
                      <button
                        className="button primary"
                        onClick={() => openCreateModal(institution ? 'courses' : 'institutions')}
                      >
                        <Plus size={18} />
                        {institution ? 'Novo curso' : 'Configurar instituição'}
                      </button>
                    </div>
                  </div>

                  <div className="stats">
                    <DataCard
                      title="Cursos"
                      count={data.courses.length}
                      icon={GraduationCap}
                      description="Programas acadêmicos ativos"
                    />
                    <DataCard
                      title="Turmas"
                      count={data['class-groups'].length}
                      icon={Users}
                      description="Grupos em períodos letivos"
                    />
                    <DataCard
                      title="Docentes"
                      count={data.teachers.length}
                      icon={School}
                      description="Professores cadastrados"
                    />
                    <DataCard
                      title="Salas"
                      count={data.rooms.length}
                      icon={DoorOpen}
                      description="Espaços e laboratórios"
                    />
                  </div>

                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <div>
                          <span className="eyebrow">PASSO A PASSO</span>
                          <h3>Preparação do ambiente acadêmico</h3>
                        </div>
                        <Settings2 size={20} className="muted-icon" />
                      </div>
                      <div className="steps">
                        {[
                          ['Instituição', !!institution, 'Defina o nome da instituição e a duração da hora-aula.', 'institutions' as Resource, institution],
                          ['Período letivo', data['academic-terms'].length > 0, 'Estabeleça as datas de início e fim do semestre.', 'academic-terms' as Resource, data['academic-terms'][0]],
                          ['Cursos e recursos', data.courses.length > 0 && data.rooms.length > 0, 'Cadastre os cursos, professores e salas.', 'courses' as Resource, data.courses[0]],
                          ['Janelas de horário', data['time-windows'].length > 0, 'Configure os dias e faixas de horários reais.', 'time-windows' as Resource, data['time-windows'][0]],
                        ].map(([title, complete, detail, resource, sampleItem]) => (
                          <div
                            className="step"
                            key={String(title)}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                              <span className={`step-number ${complete ? 'done' : ''}`}>
                                {complete ? '✓' : '•'}
                              </span>
                              <span>
                                <strong>{String(title)}</strong>
                                <small>{String(detail)}</small>
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {complete && sampleItem ? (
                                <button
                                  className="button small ghost"
                                  onClick={() => openEditModal(resource as Resource, sampleItem as RecordItem)}
                                  title="Editar cadastro"
                                >
                                  <Pencil size={14} />
                                  <span>Editar</span>
                                </button>
                              ) : null}
                              <button
                                className="button small"
                                onClick={() => openCreateModal(resource as Resource)}
                                title="Novo cadastro"
                              >
                                <Plus size={14} />
                                <span>Adicionar</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="panel highlight-panel">
                      <span className="eyebrow">HORÁRIOS FLEXÍVEIS</span>
                      <div className="highlight-illustration">
                        <Clock3 size={48} strokeWidth={1.5} />
                      </div>
                      <h3>Organização sem turnos fixos</h3>
                      <p>
                        O Órbita Acadêmico permite modelar horários dinâmicos por minutos reais. Crie perfis customizados
                        por curso ou turma sem depender de modelos rígidos.
                      </p>
                      <button className="text-button" onClick={() => navigate('time')}>
                        Gerenciar perfis e janelas →
                      </button>
                    </section>
                  </div>
                </>
              )}

              {/* SEGMENTED TABBED CATALOG VIEW */}
              {section === 'catalog' && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">ESTRUTURA ACADÊMICA</span>
                      <h1>Gestão de cadastros</h1>
                      <p>Visualize, filtre e edite de forma clara e organizada os recursos essenciais do planejamento.</p>
                    </div>
                  </div>

                  {/* Horizontal Segmented Tabs Bar */}
                  <div className="catalog-tabs-container">
                    <div className="catalog-tabs" role="tablist" aria-label="Abas de cadastros acadêmicos">
                      {catalogTabs.map(({ id, label, icon: Icon, count }) => (
                        <button
                          key={id}
                          role="tab"
                          aria-selected={catalogTab === id}
                          className={`catalog-tab-btn ${catalogTab === id ? 'active' : ''}`}
                          onClick={() => {
                            setCatalogTab(id);
                            setCatalogSearch('');
                          }}
                        >
                          <Icon size={16} />
                          <span>{label}</span>
                          <span className="tab-badge">{count}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Focused Dedicated Table Panel */}
                  <div className="catalog-panel">
                    <div className="catalog-panel-header">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800 }}>
                            {catalogTabs.find((t) => t.id === catalogTab)?.label}
                          </h2>
                          <span className="tab-badge" style={{ fontSize: '12px', padding: '3px 10px' }}>
                            {filteredRows.length} registro(s)
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                          {catalogTabs.find((t) => t.id === catalogTab)?.description}
                        </p>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <div className="catalog-search-wrap">
                          <Search size={15} />
                          <input
                            type="search"
                            placeholder={`Filtrar ${resourcePluralNames[activeResource].toLowerCase()}…`}
                            value={catalogSearch}
                            onChange={(e) => setCatalogSearch(e.target.value)}
                            aria-label={`Filtrar ${resourcePluralNames[activeResource]}`}
                          />
                        </div>

                        {(['courses', 'subjects', 'teachers', 'rooms', 'class-groups', 'subject-offerings'] as Resource[]).includes(activeResource) && <button className="button" onClick={() => setImportKind(activeResource === 'subject-offerings' ? 'offerings' : activeResource as ImportKind)}><FileUp size={16} />Importar em lote</button>}
                        <button className="button primary" onClick={() => activeResource === 'subject-offerings' ? setOfferTarget({}) : openCreateModal(activeResource)}><Plus size={16} />{activeResource === 'subject-offerings' ? 'Ofertar disciplina' : resourceAddLabels[activeResource]}</button>
                      </div>
                    </div>

                    {catalogTab === 'subject-offerings' && <div className="catalog-hint-banner">Cada turma recebe uma única oferta por disciplina. As horas presenciais semanais são definidas na disciplina; os blocos da grade são preparados na primeira oferta.</div>}

                    {catalogTab === 'subject-offerings' && <OfferPlanner data={data} onSaved={async (message) => { setNotice(message); await loadData(true); }} onOpenGrid={(id) => { setPreferredScheduleId(id); setGridRefresh((value) => value + 1); navigate('grid'); }} />}

                    {/* Table View */}
                    <div className="table-wrap catalog-table-wrap">
                      {filteredRows.length > 0 ? (
                        <table className={`catalog-table catalog-table--${activeResource}`}>
                          <thead>
                            <tr>
                              {getResourceColumns(activeResource).map((key) => (
                                <th key={key} scope="col">
                                  {labels[key] ?? key}
                                </th>
                              ))}
                              <th scope="col" className="row-actions-cell">
                                Ações
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRows.map((row) => (
                              <tr key={row.id}>
                                {getResourceColumns(activeResource).map((key) => (
                                  <td key={key} data-label={labels[key] ?? key}>{displayResourceValue(row, key, data)}</td>
                                ))}
                                <td className="row-actions-cell" data-label="Ações">
                                  <div className="row-actions">
                                    <button
                                      className="button small ghost row-action"
                                      onClick={() => openEditModal(activeResource, row)}
                                      title={`Editar ${resourceNames[activeResource]}`}
                                      aria-label={`Editar ${displayName(row)}`}
                                    >
                                      <Pencil size={14} />
                                      <span>Editar</span>
                                    </button>

                                    {activeResource !== 'institutions' && (
                                      <button
                                        className="button small danger ghost row-action"
                                        onClick={() => { setDeleteError(''); setDeleteTarget({ resource: activeResource, item: row }); }}
                                        title={`Excluir ${resourceNames[activeResource]}`}
                                        aria-label={`Excluir ${displayName(row)}`}
                                      >
                                        <Trash2 size={14} />
                                        <span>Excluir</span>
                                      </button>
                                    )}

                                    {activeResource === 'subjects' && <button className="button small row-action" onClick={() => setOfferTarget({ subjectId: row.id })} aria-label={`Ofertar ${displayName(row)} e alocar professor`}><BookOpen size={14} /><span>Ofertar</span></button>}
                                    {activeResource === 'teachers' && <button className="button small row-action" onClick={() => setOfferTarget({ teacherId: row.id })} aria-label={`Alocar ${displayName(row)} a uma oferta`}><Users size={14} /><span>Alocar</span></button>}
                                    {activeResource === 'subject-offerings' && <button className="button small row-action" onClick={() => setOfferTarget({ subjectId: Number(row.subject), groupId: Number(row.group) })} aria-label={`Alocar professor para ${displayName(row)}`}><Users size={14} /><span>Alocar</span></button>}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="empty-list" style={{ padding: '60px 24px' }}>
                          {catalogSearch
                            ? `Nenhum registro encontrado para "${catalogSearch}".`
                            : `Nenhum(a) ${resourceNames[activeResource].toLowerCase()} cadastrado(a) ainda. Clique em "Novo ${resourceNames[activeResource]}" acima para começar.`}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {section === 'import' && <><div className="page-heading"><div><span className="eyebrow">CADASTRO RÁPIDO</span><h1>Importar em lote</h1><p>Cole linhas da planilha ou carregue CSV/TSV. Baixe um modelo para cada tipo de cadastro.</p></div></div><div className="import-grid">{([['courses', 'Cursos', 'Códigos, nomes e modalidades'], ['subjects', 'Disciplinas', 'Créditos, horas presenciais e horas EAD semanais'], ['teachers', 'Professores', 'Códigos e nomes, sem limite semanal'], ['rooms', 'Salas', 'Códigos, nomes e capacidade'], ['class-groups', 'Turmas', 'Códigos e nomes vinculados ao curso e período'], ['offerings', 'Ofertas', 'Turma, disciplina, professor e horas por bloco']] as [ImportKind, string, string][]).map(([kind, title, description]) => <section className="panel import-card" key={kind}><FileUp size={22} /><h3>{title}</h3><p>{description}</p><button className="button primary" onClick={() => setImportKind(kind)}>Importar {title.toLowerCase()}</button></section>)}</div></>}

              {section === 'time' && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">CONFIGURAÇÃO TEMPORAL</span>
                      <h1>Janelas de horários e perfis</h1>
                      <p>Organize as janelas vigentes de Manhã e Noite. Entre aulas de dias consecutivos, o professor precisa descansar ao menos 11 horas.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="button primary" disabled={!institution || settingShifts} onClick={() => void setupShifts()}><Clock3 size={18} />{settingShifts ? 'Configurando…' : 'Ativar Manhã e Noite'}</button>
                      <button className="button" onClick={() => openCreateModal('time-profiles')}><Plus size={18} />Novo perfil</button>
                    </div>
                  </div>
                  <div className="profile-grid">
                    {data['time-profiles'].map((profile) => {
                      const windows = data['time-windows'].filter((window) => Number(window.profile) === profile.id);
                      return (
                        <section className="panel profile-card" key={profile.id}>
                          <div className="panel-head">
                            <div>
                              <span className="eyebrow">PERFIL DE HORÁRIO</span>
                              <h3>{String(profile.name)}</h3>
                              <small>{windows.length} janela(s)</small>
                            </div>
                            <div className="profile-actions">
                              <button className="button small ghost" onClick={() => openEditModal('time-profiles', profile)}>
                                <Pencil size={14} />Editar perfil
                              </button>
                              <button
                                className="button small ghost"
                                style={{ color: 'var(--color-destructive)' }}
                                onClick={() => { setDeleteError(''); setDeleteTarget({ resource: 'time-profiles', item: profile }); }}
                              >
                                <Trash2 size={14} />Excluir
                              </button>
                              <button className="button small" onClick={() => openCreateModal('time-windows', { profile: String(profile.id), institution: String(profile.institution) })}>
                                <Plus size={14} />Janela neste perfil
                              </button>
                            </div>
                          </div>
                          {windows.length ? (
                            <div className="profile-windows">
                              {windows.map((window) => (
                                <div className="profile-window" key={window.id}>
                                  <span>
                                    <strong>{weekdayNames[Number(window.weekday)]}</strong> {String(window.starts_at).slice(0, 5)}–{String(window.ends_at).slice(0, 5)} <small>· {String(window.scope === 'INSTITUTION' ? 'Instituição' : window.scope)}</small>
                                  </span>
                                  <div style={{ display: 'inline-flex', gap: 4 }}>
                                    <button className="button small ghost" onClick={() => openEditModal('time-windows', window)}>
                                      <Pencil size={14} />Editar
                                    </button>
                                    <button
                                      className="button small ghost"
                                      style={{ color: 'var(--color-destructive)' }}
                                      onClick={() => { setDeleteError(''); setDeleteTarget({ resource: 'time-windows', item: window }); }}
                                      title="Excluir janela"
                                    >
                                      <Trash2 size={14} />Excluir
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="empty-list">Nenhuma janela neste perfil. Use “Janela neste perfil”.</div>
                          )}
                        </section>
                      );
                    })}
                    <ListPanel
                      resource="time-windows"
                      title="Janelas sem perfil"
                      rows={data['time-windows'].filter((window) => !window.profile)}
                      data={data}
                      onAdd={() => openCreateModal('time-windows')}
                      onEdit={(item) => openEditModal('time-windows', item)}
                      onDelete={(item) => { setDeleteError(''); setDeleteTarget({ resource: 'time-windows', item }); }}
                    />
                    <ListPanel
                      resource="time-blocks"
                      title="Intervalos dentro do dia"
                      rows={data['time-blocks']}
                      data={data}
                      onAdd={() => openCreateModal('time-blocks', { institution: String(institution?.id ?? '') })}
                      onEdit={(item) => openEditModal('time-blocks', item)}
                      onDelete={(item) => { setDeleteError(''); setDeleteTarget({ resource: 'time-blocks', item }); }}
                    />
                  </div>
                  <div className="info-note">
                    <Clock3 size={18} />
                    <span>Os perfis padrão usam 08:00–12:00 e 17:50–21:50, de segunda a sexta, e podem ser editados. A regra de 11 horas vale entre dias consecutivos; intervalos dentro do mesmo dia podem ser bloqueados acima.</span>
                  </div>
                </>
              )}

              {section === 'schedules' && <ScheduleEditor data={data} />}
            </>
          )}
        </div>
      </main>

      {/* Dynamic Creation / Edit Modal */}
      {modalTarget && (
        <Modal
          key={`${modalTarget.resource}-${modalTarget.item?.id ?? 'new'}`}
          resource={modalTarget.resource}
          item={modalTarget.item}
          defaults={modalTarget.defaults}
          data={data}
          onClose={() => setModalTarget(null)}
          onSaved={(msg) => {
            setModalTarget(null);
            setNotice(msg);
            void loadData();
          }}
          onDelete={(item) => {
            setDeleteError('');
            setDeleteTarget({ resource: modalTarget.resource, item });
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="modal-backdrop" onMouseDown={() => !deleting && setDeleteTarget(null)}>
          <section
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-heading"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ maxWidth: '440px' }}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow" style={{ color: 'var(--color-destructive)' }}>CONFIRMAR EXCLUSÃO</span>
                <h2 id="delete-heading">Excluir {resourceNames[deleteTarget.resource]}?</h2>
              </div>
              <button
                className="icon-button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                aria-label="Fechar"
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '16px 0 24px', fontSize: '13.5px', lineHeight: 1.6, color: 'var(--color-text)' }}>
              <p>
                Tem certeza que deseja apagar o registro <strong>"{displayName(deleteTarget.item)}"</strong>?
              </p>
              <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                Itens vinculados a ofertas, aulas ou outros cadastros não podem ser excluídos. Remova esses vínculos primeiro.
              </p>
            </div>

            {deleteError && (
              <p className="form-error" role="alert" style={{ marginBottom: 16 }}>
                <CircleAlert size={16} />
                {deleteError}
              </p>
            )}

            <div className="modal-actions">
              <button
                className="button ghost"
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancelar
              </button>
              <button
                className="button danger"
                type="button"
                disabled={deleting || deleteTarget.resource === 'institutions'}
                onClick={() => void executeDelete()}
              >
                <Trash2 size={16} />
                {deleting ? 'Excluindo…' : 'Sim, excluir'}
              </button>
            </div>
          </section>
        </div>
      )}

      {offerTarget && <OfferModal data={data} {...offerTarget} onClose={() => setOfferTarget(null)} onSaved={(message) => { setOfferTarget(null); setNotice(message); void loadData(); }} />}
      {importKind && <ImportModal kind={importKind} data={data} onClose={() => setImportKind(null)} onSaved={(message) => { setImportKind(null); setNotice(message); void loadData(); }} />}
    </div>
  );
}

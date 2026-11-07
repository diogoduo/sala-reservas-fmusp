import { CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  ADMINISTRATIVE_KIND_LABELS,
  CCEX_STATUS_LABELS,
  COURSE_YEARS,
  CULTURE_KIND_LABELS,
  DEFENSE_LEVEL_LABELS,
  EXTERNAL_ENTITIES,
  ORGANIZER_ENTITY_GROUPS,
  UNDERGRADUATE_CLASS_TYPE_LABELS,
} from "../../lib/activities";
import type { ActivityType } from "../../lib/types";
import { Alert } from "../ui/Feedback";
import { Input, Select, Switch, Textarea } from "../ui/Field";

/**
 * Valores dos campos específicos do tipo de atividade, do jeito que saem dos
 * inputs (texto e checkboxes). Vão como `details` no POST /api/reservations;
 * o back-end converte os números, valida por tipo e descarta o que não for do
 * tipo escolhido — por isso dá para trocar de tipo sem limpar o formulário.
 */
export type DetailValues = Record<string, string | boolean>;

// Formulário começa em branco: nada vem marcado (a pessoa escolhe "Sim"/"Não").
export const INITIAL_DETAIL_VALUES: DetailValues = { free: false };

/** Nº de pessoas informado no formulário de cada tipo (para o resumo lateral). */
export function attendeesOf(type: ActivityType, values: DetailValues): string {
  const field = {
    UNDERGRADUATE: "studentCount",
    GRADUATE: "studentCount",
    CULTURE_EXTENSION: "participantCount",
    PUBLIC_EXAM: "audience",
    DEFENSE: "audience",
    ADMINISTRATIVE: "participantCount",
  }[type];
  const value = values[field];
  return typeof value === "string" ? value : "";
}

interface Props {
  type: ActivityType;
  values: DetailValues;
  onChange: (name: string, value: string | boolean) => void;
}

interface PillsProps {
  legend: string;
  name: string;
  options: [string, string][];
  value: unknown;
  onChange: (value: string) => void;
  required?: boolean;
}

/** Escolha única em formato de "pílulas" (radio por baixo, acessível pelo teclado). */
function ChoicePills({ legend, name, options, value, onChange, required }: PillsProps) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground">
        {legend}
        {required && (
          <span aria-hidden className="ml-0.5 text-danger-foreground">
            *
          </span>
        )}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([optionValue, label]) => (
          <label
            key={optionValue}
            className="inline-flex h-10 items-center rounded-full border border-border-strong bg-surface px-4 text-sm font-medium text-muted transition-colors hover:border-primary/50 hover:text-foreground has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary-soft-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <input
              type="radio"
              name={name}
              value={optionValue}
              required={required}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface LinkedDiscipline {
  id: string;
  code: string;
  name: string;
  department: string | null;
  level: "UNDERGRADUATE" | "GRADUATE";
}

/** Fase 19: as disciplinas ligadas a quem está pedindo (vazio = pede para qualquer disciplina). */
function useMyDisciplines(enabled: boolean) {
  const [list, setList] = useState<LinkedDiscipline[]>([]);
  useEffect(() => {
    if (!enabled) return;
    api<{ disciplines: LinkedDiscipline[] }>("/disciplines/mine")
      .then((res) => setList(res.disciplines))
      .catch(() => setList([]));
  }, [enabled]);
  return list;
}

interface CatalogDiscipline {
  code: string;
  name: string;
  department: string | null;
  level: "UNDERGRADUATE" | "GRADUATE";
  /** Nomes dos docentes ligados. */
  teachers: string[];
}

const DISCIPLINE_CODE = /^[A-Z]{3}\d{4}$/;
const LEVEL_LABEL = { UNDERGRADUATE: "Graduação", GRADUATE: "Pós-Graduação" } as const;

/**
 * Com o código completo, busca a disciplina no cadastro do SAD e preenche o
 * nome, o departamento e o responsável (os docentes ligados). Só mexe em campo
 * vazio ou que ela mesma preencheu: o que a pessoa digitou fica.
 */
function useDisciplineAutofill(enabled: boolean, values: DetailValues, onChange: Props["onChange"]) {
  const code = typeof values.disciplineCode === "string" ? values.disciplineCode.trim().toUpperCase() : "";
  const [result, setResult] = useState<{ code: string; discipline: CatalogDiscipline | null } | null>(null);
  const filled = useRef<Record<string, string>>({});
  const latest = useRef({ values, onChange });
  latest.current = { values, onChange };

  useEffect(() => {
    if (!enabled || !DISCIPLINE_CODE.test(code)) {
      setResult(null);
      return;
    }
    let cancelled = false;
    api<{ discipline: CatalogDiscipline | null }>(`/disciplines/lookup/${code}`)
      .then(({ discipline }) => {
        if (cancelled) return;
        setResult({ code, discipline });
        // Fora do cadastro: limpa só o que veio de outra disciplina buscada antes.
        const next = {
          disciplineName: discipline?.name ?? "",
          department: discipline?.department ?? "",
          disciplineOwner: discipline?.teachers.join(", ") ?? "",
        };
        const { values: current, onChange: set } = latest.current;
        for (const [field, value] of Object.entries(next)) {
          const now = typeof current[field] === "string" ? (current[field] as string) : "";
          const auto = filled.current[field];
          if (now !== "" && now !== auto) continue;
          if (now !== value) set(field, value);
          if (value) filled.current[field] = value;
          else delete filled.current[field];
        }
      })
      .catch(() => !cancelled && setResult(null));
    return () => {
      cancelled = true;
    };
  }, [enabled, code]);

  return result && result.code === code ? result.discipline ?? false : null;
}

/** Campos que mudam conforme o tipo de atividade (seção "Sobre a atividade"). */
export function ActivityFields({ type, values, onChange }: Props) {
  const { user } = useAuth();
  const linked = useMyDisciplines(user?.role === "USER").filter((d) => d.level === type);
  const text = (name: string) => ({
    name,
    value: typeof values[name] === "string" ? (values[name] as string) : "",
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(name, e.target.value),
  });

  // Graduação e Pós-Graduação compartilham os campos da disciplina. O código
  // completo busca a disciplina no cadastro do SAD e preenche o resto.
  // found: a disciplina; false: fora do cadastro; null: código incompleto.
  const found = useDisciplineAutofill(type === "UNDERGRADUATE" || type === "GRADUATE", values, onChange);
  const codeHint =
    found === null ? (
      "3 letras e 4 números"
    ) : found === false ? (
      "Não está no cadastro do SAD: preencha a disciplina, o responsável e o departamento."
    ) : (
      <span className="inline-flex items-center gap-1 text-success-foreground">
        <CheckCircleIcon size={14} weight="fill" aria-hidden />
        {found.name}: dados preenchidos pelo cadastro do SAD
        {found.level !== type ? ` (cadastrada como ${LEVEL_LABEL[found.level]})` : ""}.
      </span>
    );

  const disciplineFields = linked.length > 0 ? (
    <>
      <Select
        label="Disciplina"
        required
        value={typeof values.disciplineCode === "string" ? values.disciplineCode : ""}
        onChange={(e) => onChange("disciplineCode", e.target.value)}
        hint="As disciplinas ligadas a você pelo SAD. Para outra, fale com o SAD."
        containerClassName="sm:col-span-2"
      >
        <option value="">Selecione</option>
        {linked.map((d) => (
          <option key={d.code} value={d.code}>
            {d.code} · {d.name}
          </option>
        ))}
      </Select>
      <Input label="Nº de alunos" required type="number" inputMode="numeric" min={1} {...text("studentCount")} />
      <Input label="Responsável pela disciplina" required {...text("disciplineOwner")} />
    </>
  ) : (
    <>
      <Input
        label="Código da disciplina"
        required
        {...text("disciplineCode")}
        pattern="[A-Za-z]{3}[0-9]{4}"
        title="3 letras e 4 números, ex.: MCM0101"
        placeholder="MCM0101"
        maxLength={7}
        autoCapitalize="characters"
        hint={codeHint}
        className="uppercase placeholder:normal-case"
      />
      <Input label="Disciplina" required {...text("disciplineName")} />
      <Input label="Nº de alunos" required type="number" inputMode="numeric" min={1} {...text("studentCount")} />
      <Input label="Responsável pela disciplina" required {...text("disciplineOwner")} />
    </>
  );

  const department = <Input label="Departamento" required {...text("department")} />;

  switch (type) {
    case "UNDERGRADUATE":
      return (
        <>
          <Select label="Tipo" required {...text("classType")}>
            <option value="">Selecione</option>
            {Object.entries(UNDERGRADUATE_CLASS_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select label="Ano" required {...text("courseYear")}>
            <option value="">Selecione</option>
            {COURSE_YEARS.map((year) => (
              <option key={year} value={String(year)}>
                {year}º ano
              </option>
            ))}
          </Select>
          {disciplineFields}
          {department}
        </>
      );

    case "GRADUATE":
      return (
        <>
          {disciplineFields}
          {department}
        </>
      );

    case "CULTURE_EXTENSION": {
      const entity = typeof values.entity === "string" ? values.entity : "";
      return (
        <>
          <div className="space-y-3 sm:col-span-2">
            <ChoicePills
              legend="Tipo de reserva"
              name="kind"
              required
              value={values.kind}
              onChange={(value) => onChange("kind", value)}
              options={Object.entries(CULTURE_KIND_LABELS)}
            />
            {values.kind === "OTHER" && (
              <Input
                label="Qual?"
                required
                {...text("otherKind")}
                maxLength={120}
                containerClassName="max-w-sm animate-fade-in"
              />
            )}
          </div>
          <Input label="Título da atividade" required {...text("activityTitle")} containerClassName="sm:col-span-2" />
          <div className="space-y-3 sm:col-span-2">
            <Select label="Entidade organizadora" required {...text("entity")} hint="Quem promove a atividade (Portaria 2793, Art. 4º).">
              <option value="">Selecione</option>
              {ORGANIZER_ENTITY_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            {EXTERNAL_ENTITIES.includes(entity) && (
              <Alert tone="warning" className="animate-fade-in">
                Entidades externas à FMUSP dependem de autorização expressa da Divisão Acadêmica (Portaria 2793, Art. 4º §1º).
              </Alert>
            )}
          </div>
          <Input label="Nº de participantes" required type="number" inputMode="numeric" min={1} {...text("participantCount")} />
          <Input
            label="Público-alvo"
            required
            placeholder="Ex.: alunos de graduação, residentes, comunidade externa"
            maxLength={200}
            {...text("targetAudience")}
          />
          <Textarea
            label="Programação completa"
            required
            rows={4}
            maxLength={4000}
            placeholder={"Ex.:\n09:00 Abertura\n09:30 Palestra — Prof. Fulano\n11:00 Mesa-redonda"}
            hint="Horários e atividades de cada parte (Portaria 2793, Art. 20 §1º)."
            {...text("program")}
            containerClassName="sm:col-span-2"
          />
          <Input
            label="Valor da taxa (R$)"
            required={!values.free}
            disabled={values.free === true}
            type="number"
            inputMode="decimal"
            min={0.01}
            step={0.01}
            placeholder={values.free ? "Gratuita" : "0,00"}
            {...text("fee")}
          />
          <div className="rounded-xl border border-border p-4">
            <Switch
              checked={values.free === true}
              onChange={(checked) => {
                onChange("free", checked);
                if (checked) onChange("fee", "");
              }}
              label="Atividade gratuita"
              description="Sem taxa de inscrição para os participantes."
            />
          </div>
          <div className="space-y-3 rounded-xl border border-border p-4 sm:col-span-2">
            <ChoicePills
              legend="Autorização prévia da CCEx"
              name="ccexStatus"
              required
              value={values.ccexStatus}
              onChange={(value) => onChange("ccexStatus", value)}
              options={Object.entries(CCEX_STATUS_LABELS)}
            />
            <Input label="Nº do processo ou protocolo na CCEx" maxLength={120} {...text("ccexProcess")} containerClassName="max-w-sm" />
            <p className="text-xs text-muted">
              Toda atividade fora do currículo, dos programas de pós, da residência e da pesquisa precisa da autorização da Comissão de
              Cultura e Extensão (Portaria 2793, Art. 20). A reserva só é confirmada depois dela e da aprovação da Divisão Acadêmica.
            </p>
          </div>
          <Input label="Responsável" required {...text("responsible")} />
          <Input label="Contato do responsável" required placeholder="E-mail ou telefone" maxLength={200} {...text("responsibleContact")} />
          <Input label="Departamento, setor ou entidade" required {...text("department")} containerClassName="sm:col-span-2" />
        </>
      );
    }

    case "ADMINISTRATIVE":
      return (
        <>
          <div className="sm:col-span-2">
            <ChoicePills
              legend="Tipo"
              name="kind"
              required
              value={values.kind}
              onChange={(value) => onChange("kind", value)}
              options={Object.entries(ADMINISTRATIVE_KIND_LABELS)}
            />
          </div>
          <Input label="Assunto" required {...text("meetingTitle")} containerClassName="sm:col-span-2" />
          <Input label="Nº de participantes" required type="number" inputMode="numeric" min={1} {...text("participantCount")} />
          <Input label="Responsável" required {...text("responsible")} />
          <Input label="Setor ou departamento" required {...text("department")} containerClassName="sm:col-span-2" />
        </>
      );

    case "PUBLIC_EXAM":
      return (
        <>
          <Input label="Título" required {...text("examTitle")} containerClassName="sm:col-span-2" />
          <Input
            label="Público previsto"
            required
            type="number"
            inputMode="numeric"
            min={1}
            hint="Total de pessoas na sala, candidatos inclusos."
            {...text("audience")}
          />
          <Input label="Nº de candidatos" required type="number" inputMode="numeric" min={1} {...text("candidateCount")} />
          <Input label="Responsável pelo concurso" required {...text("responsible")} />
          {department}
          <Textarea
            label="Nomes dos candidatos"
            required
            rows={3}
            hint="Um por linha."
            {...text("candidateNames")}
            containerClassName="sm:col-span-2"
          />
        </>
      );

    case "DEFENSE":
      return (
        <>
          <Input
            label="Trabalho"
            required
            placeholder="Título da dissertação ou tese"
            {...text("work")}
            containerClassName="sm:col-span-2"
          />
          <Input label="Candidato" required {...text("candidate")} />
          <Input label="Orientador" required {...text("advisor")} />
          <Select label="Nível" required {...text("level")}>
            <option value="">Selecione</option>
            {Object.entries(DEFENSE_LEVEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Input label="Público previsto" required type="number" inputMode="numeric" min={1} {...text("audience")} />
          {department}
        </>
      );
  }
}

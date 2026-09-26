import type { ChangeEvent, ReactNode } from "react";
import {
  COURSE_YEARS,
  CULTURE_KIND_LABELS,
  DEFENSE_LEVEL_LABELS,
  UNDERGRADUATE_CLASS_TYPE_LABELS,
} from "../../lib/activities";
import type { ActivityType } from "../../lib/types";

/**
 * Valores dos campos específicos do tipo de atividade, do jeito que saem dos
 * inputs (texto e checkboxes). Vão como `details` no POST /api/reservations;
 * o back-end converte os números, valida por tipo e descarta o que não for do
 * tipo escolhido — por isso dá para trocar de tipo sem limpar o formulário.
 */
export type DetailValues = Record<string, string | boolean>;

export const INITIAL_DETAIL_VALUES: DetailValues = { free: false, linkedToCcex: false };

interface Props {
  type: ActivityType;
  values: DetailValues;
  onChange: (name: string, value: string | boolean) => void;
}

const inputClass = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100";

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Options({ labels }: { labels: Record<string, string> }) {
  return (
    <>
      <option value="">Selecione</option>
      {Object.entries(labels).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}

/** Campos que mudam conforme o tipo de atividade (seção "Informações da reserva"). */
export function ActivityFields({ type, values, onChange }: Props) {
  const text = (name: string) => ({
    name,
    value: typeof values[name] === "string" ? (values[name] as string) : "",
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange(name, e.target.value),
  });

  // Graduação e Pós-Graduação compartilham os campos da disciplina.
  // ⚠️ O código só tem o formato checado; a validação contra uma tabela de
  // disciplinas no banco é um passo futuro.
  const disciplineFields = (
    <>
      <Field label="Código da disciplina">
        <input
          required
          {...text("disciplineCode")}
          pattern="[A-Za-z]{3}[0-9]{4}"
          title="3 letras e 4 números, ex.: MCM0101"
          placeholder="MCM0101"
          maxLength={7}
          className={`${inputClass} uppercase`}
        />
      </Field>
      <Field label="Disciplina">
        <input required {...text("disciplineName")} className={inputClass} />
      </Field>
      <Field label="Nº de alunos">
        <input required type="number" min={1} {...text("studentCount")} className={inputClass} />
      </Field>
      <Field label="Responsável pela disciplina">
        <input required {...text("disciplineOwner")} className={inputClass} />
      </Field>
    </>
  );

  const department = (
    <Field label="Departamento">
      <input required {...text("department")} className={inputClass} />
    </Field>
  );

  switch (type) {
    case "UNDERGRADUATE":
      return (
        <>
          <Field label="Tipo">
            <select required {...text("classType")} className={inputClass}>
              <Options labels={UNDERGRADUATE_CLASS_TYPE_LABELS} />
            </select>
          </Field>
          <Field label="Ano">
            <select required {...text("courseYear")} className={inputClass}>
              <Options labels={Object.fromEntries(COURSE_YEARS.map((y) => [String(y), `${y}º ano`]))} />
            </select>
          </Field>
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

    case "CULTURE_EXTENSION":
      return (
        <>
          <fieldset className="col-span-2">
            <legend className="text-sm font-medium text-slate-700">Tipo de reserva</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {Object.entries(CULTURE_KIND_LABELS).map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="kind" required value={value} checked={values.kind === value} onChange={() => onChange("kind", value)} />
                  {label}
                </label>
              ))}
            </div>
            {values.kind === "OTHER" && (
              <input required {...text("otherKind")} placeholder="Qual?" maxLength={120} className={`${inputClass} max-w-xs`} />
            )}
          </fieldset>
          <Field label="Título da atividade">
            <input required {...text("activityTitle")} className={inputClass} />
          </Field>
          <Field label="Nº de participantes">
            <input required type="number" min={1} {...text("participantCount")} className={inputClass} />
          </Field>
          <div>
            <Field label="Valor da taxa (R$)">
              <input
                required={!values.free}
                disabled={values.free === true}
                type="number"
                min={0.01}
                step={0.01}
                {...text("fee")}
                className={inputClass}
              />
            </Field>
            <label className="mt-1 flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={values.free === true}
                onChange={(e) => {
                  onChange("free", e.target.checked);
                  if (e.target.checked) onChange("fee", "");
                }}
              />
              Atividade gratuita
            </label>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">Vinculada à CCEx</legend>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" name="linkedToCcex" checked={values.linkedToCcex === true} onChange={() => onChange("linkedToCcex", true)} />
                Sim
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="radio" name="linkedToCcex" checked={values.linkedToCcex === false} onChange={() => onChange("linkedToCcex", false)} />
                Não
              </label>
            </div>
          </fieldset>
          <Field label="Responsável">
            <input required {...text("responsible")} className={inputClass} />
          </Field>
          {department}
        </>
      );

    case "PUBLIC_EXAM":
      return (
        <>
          <Field label="Título" wide>
            <input required {...text("examTitle")} className={inputClass} />
          </Field>
          <Field label="Público previsto">
            <input required type="number" min={1} {...text("audience")} className={inputClass} />
          </Field>
          <Field label="Nº de candidatos">
            <input required type="number" min={1} {...text("candidateCount")} className={inputClass} />
          </Field>
          <Field label="Responsável pelo concurso">
            <input required {...text("responsible")} className={inputClass} />
          </Field>
          {department}
          <Field label="Nomes dos candidatos" wide>
            <textarea required rows={2} {...text("candidateNames")} className={inputClass} />
          </Field>
        </>
      );

    case "DEFENSE":
      return (
        <>
          <Field label="Trabalho" wide>
            <input required {...text("work")} placeholder="Título da dissertação ou tese" className={inputClass} />
          </Field>
          <Field label="Candidato">
            <input required {...text("candidate")} className={inputClass} />
          </Field>
          <Field label="Orientador">
            <input required {...text("advisor")} className={inputClass} />
          </Field>
          <Field label="Nível">
            <select required {...text("level")} className={inputClass}>
              <Options labels={DEFENSE_LEVEL_LABELS} />
            </select>
          </Field>
          <Field label="Público previsto">
            <input required type="number" min={1} {...text("audience")} className={inputClass} />
          </Field>
          {department}
        </>
      );
  }
}

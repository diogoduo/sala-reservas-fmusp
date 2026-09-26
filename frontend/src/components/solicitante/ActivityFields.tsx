import type { ChangeEvent } from "react";
import {
  COURSE_YEARS,
  CULTURE_KIND_LABELS,
  DEFENSE_LEVEL_LABELS,
  UNDERGRADUATE_CLASS_TYPE_LABELS,
} from "../../lib/activities";
import type { ActivityType } from "../../lib/types";
import { Input, Select, Switch, Textarea } from "../ui/Field";

/**
 * Valores dos campos específicos do tipo de atividade, do jeito que saem dos
 * inputs (texto e checkboxes). Vão como `details` no POST /api/reservations;
 * o back-end converte os números, valida por tipo e descarta o que não for do
 * tipo escolhido — por isso dá para trocar de tipo sem limpar o formulário.
 */
export type DetailValues = Record<string, string | boolean>;

export const INITIAL_DETAIL_VALUES: DetailValues = { free: false, linkedToCcex: false };

/** Nº de pessoas informado no formulário de cada tipo (para o resumo lateral). */
export function attendeesOf(type: ActivityType, values: DetailValues): string {
  const field = { UNDERGRADUATE: "studentCount", GRADUATE: "studentCount", CULTURE_EXTENSION: "participantCount", PUBLIC_EXAM: "audience", DEFENSE: "audience" }[type];
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

/** Campos que mudam conforme o tipo de atividade (seção "Sobre a atividade"). */
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
      <Input
        label="Código da disciplina"
        required
        {...text("disciplineCode")}
        pattern="[A-Za-z]{3}[0-9]{4}"
        title="3 letras e 4 números, ex.: MCM0101"
        placeholder="MCM0101"
        maxLength={7}
        autoCapitalize="characters"
        hint="3 letras e 4 números"
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

    case "CULTURE_EXTENSION":
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
          <Input label="Nº de participantes" required type="number" inputMode="numeric" min={1} {...text("participantCount")} />
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
          <div className="rounded-xl border border-border p-4 sm:col-span-2">
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
          <ChoicePills
            legend="Vinculada à CCEx"
            name="linkedToCcex"
            value={values.linkedToCcex === true ? "yes" : "no"}
            onChange={(value) => onChange("linkedToCcex", value === "yes")}
            options={[
              ["yes", "Sim"],
              ["no", "Não"],
            ]}
          />
          <Input label="Responsável" required {...text("responsible")} />
          {department}
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

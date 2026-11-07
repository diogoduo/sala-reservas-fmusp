import { ListChecksIcon } from "@phosphor-icons/react";
import { useSearchParams } from "react-router";
import { SegmentedControl } from "../ui/SegmentedControl";
import { PageHeader } from "../ui/Surface";
import { ChecklistTab, isoDay } from "./ChecklistTab";

// Fase 17 — Plantão do SAD e do NUCEV: o checklist do dia (e, no bloco 17b, a
// passagem de plantão e a visão do dia seguinte).

type Tab = "checklist";

export function PlantaoPage() {
  const [params, setParams] = useSearchParams();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("data") ?? "") ? params.get("data")! : isoDay(new Date());
  const tab: Tab = "checklist";
  const setQuery = (next: { data?: string; aba?: Tab }) => setParams({ data: next.data ?? date, aba: next.aba ?? tab }, { replace: true });

  return (
    <div className="space-y-6">
      <PageHeader title="Plantão" description="O checklist do dia da equipe do SAD e do NUCEV, com as pendências dos eventos." />
      <SegmentedControl label="Seção" value={tab} onChange={(aba) => setQuery({ aba })} options={[{ value: "checklist", label: "Checklist do dia", icon: ListChecksIcon }]} />
      <ChecklistTab date={date} onDateChange={(data) => setQuery({ data })} />
    </div>
  );
}

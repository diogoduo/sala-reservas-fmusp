import { CalendarPlusIcon, CaretLeftIcon, CaretRightIcon, HandshakeIcon, ListChecksIcon, StackIcon } from "@phosphor-icons/react";
import { useSearchParams } from "react-router";
import { Button, IconButton } from "../ui/Button";
import { Input } from "../ui/Field";
import { SegmentedControl } from "../ui/SegmentedControl";
import { PageHeader } from "../ui/Surface";
import { ChecklistTab, isoDay, longDay, shiftDay } from "./ChecklistTab";
import { HandoverTab } from "./HandoverTab";
import { MaterialsTab } from "./MaterialsTab";
import { NextDayTab } from "./NextDayTab";

// Fase 17 — Plantão do SAD e do NUCEV (documento SAD/NUCEV, 5.3 e 5.4): o
// checklist do dia, a passagem de plantão e a visão do dia seguinte.

type Tab = "checklist" | "passagem" | "amanha" | "pranchoes";
const TABS: Tab[] = ["checklist", "passagem", "amanha", "pranchoes"];

export function PlantaoPage() {
  const [params, setParams] = useSearchParams();
  const today = isoDay(new Date());
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("data") ?? "") ? params.get("data")! : today;
  const tab: Tab = TABS.includes(params.get("aba") as Tab) ? (params.get("aba") as Tab) : "checklist";
  const setQuery = (next: { data?: string; aba?: Tab }) => setParams({ data: next.data ?? date, aba: next.aba ?? tab }, { replace: true });

  return (
    <div className="space-y-6">
      <PageHeader title="Plantão" description="O checklist do dia, a passagem de plantão, o dia seguinte e os pranchões, para a equipe do SAD e do NUCEV." />
      <SegmentedControl
        label="Seção"
        value={tab}
        onChange={(aba) => setQuery({ aba })}
        options={[
          { value: "checklist", label: "Checklist do dia", icon: ListChecksIcon },
          { value: "passagem", label: "Passagem de plantão", icon: HandshakeIcon },
          { value: "amanha", label: "Dia seguinte", icon: CalendarPlusIcon },
          { value: "pranchoes", label: "Pranchões", icon: StackIcon },
        ]}
      />
      {tab === "pranchoes" ? (
        <MaterialsTab />
      ) : tab === "checklist" ? (
        <ChecklistTab date={date} onDateChange={(data) => setQuery({ data })} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <IconButton icon={CaretLeftIcon} label="Dia anterior" variant="secondary" onClick={() => setQuery({ data: shiftDay(date, -1) })} />
            <IconButton icon={CaretRightIcon} label="Próximo dia" variant="secondary" onClick={() => setQuery({ data: shiftDay(date, 1) })} />
            <Button variant="secondary" onClick={() => setQuery({ data: today })}>
              Hoje
            </Button>
            <Input type="date" aria-label="Escolher o dia" value={date} onChange={(e) => e.target.value && setQuery({ data: e.target.value })} className="w-44" />
            {tab === "passagem" && <p className="ml-1 text-base font-semibold sm:text-lg">{longDay(date)}</p>}
          </div>
          {tab === "passagem" ? <HandoverTab key={date} date={date} /> : <NextDayTab date={shiftDay(date, 1)} />}
        </>
      )}
    </div>
  );
}

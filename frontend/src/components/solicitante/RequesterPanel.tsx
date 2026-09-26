import { useState } from "react";
import { ReservationForm } from "./ReservationForm";
import { RoomSearch } from "./RoomSearch";

type Tab = "search" | "form";

export function RequesterPanel() {
  const [tab, setTab] = useState<Tab>("search");

  const tabClass = (t: Tab) =>
    `rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`;

  return (
    <section className="mt-6">
      <div className="flex gap-2 border-b border-slate-200 pb-3">
        <button onClick={() => setTab("search")} className={tabClass("search")}>
          Consultar salas
        </button>
        <button onClick={() => setTab("form")} className={tabClass("form")}>
          Reservar uma sala
        </button>
      </div>

      <div className="mt-4">{tab === "search" ? <RoomSearch /> : <ReservationForm onDone={() => setTab("search")} />}</div>
    </section>
  );
}

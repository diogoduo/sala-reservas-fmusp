import { useState } from "react";
import { RequestsAdmin } from "./RequestsAdmin";
import { ResourcesAdmin } from "./ResourcesAdmin";
import { RoomsAdmin } from "./RoomsAdmin";

type Tab = "requests" | "rooms" | "resources";

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>("requests");

  const tabClass = (t: Tab) =>
    `rounded-md px-3 py-1.5 text-sm ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`;

  return (
    <section className="mt-6">
      <div className="flex gap-2 border-b border-slate-200 pb-3">
        <button onClick={() => setTab("requests")} className={tabClass("requests")}>
          Solicitações
        </button>
        <button onClick={() => setTab("rooms")} className={tabClass("rooms")}>
          Salas
        </button>
        <button onClick={() => setTab("resources")} className={tabClass("resources")}>
          Recursos
        </button>
      </div>

      <div className="mt-4">
        {tab === "requests" && <RequestsAdmin />}
        {tab === "rooms" && <RoomsAdmin />}
        {tab === "resources" && <ResourcesAdmin />}
      </div>
    </section>
  );
}

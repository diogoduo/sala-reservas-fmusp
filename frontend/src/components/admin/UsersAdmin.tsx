import { MagnifyingGlassIcon, PencilSimpleLineIcon, UserPlusIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  DEFAULT_PERMISSIONS,
  permissionChanges,
  PERMISSION_LABELS,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Permission,
  type UserRole,
} from "../../lib/permissions";
import { useToast } from "../../lib/toast";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Alert, CardListSkeleton, EmptyState } from "../ui/Feedback";
import { Input, Select, Switch } from "../ui/Field";
import { Card, PageHeader } from "../ui/Surface";

interface Person {
  id: string;
  name: string;
  email: string;
  uspNumber: string | null;
  role: UserRole;
  permissions: Permission[];
  createdAt: string;
}

const ROLES: UserRole[] = ["USER", "ADMIN", "NUCEV"];
const ROLE_TONES: Record<UserRole, "neutral" | "primary" | "info"> = { USER: "neutral", ADMIN: "primary", NUCEV: "info" };

const PERMISSION_HINTS: Record<Permission, string> = {
  REQUEST_UNDERGRADUATE: "Aulas, provas e reposições da Graduação (ex.: Serviço de Graduação, docentes).",
  REQUEST_GRADUATE: "Disciplinas da Pós-Graduação (ex.: Serviço de Pós-Graduação, docentes).",
  REQUEST_DEFENSE: "Defesas de mestrado e doutorado (ex.: Serviço de Pós-Graduação).",
  REQUEST_CULTURE_EXTENSION: "Eventos, cursos e palestras fora do currículo. Todo cadastro já vem com esta.",
  REQUEST_PUBLIC_EXAM: "Concursos e processos seletivos. Todo cadastro já vem com esta.",
};

/** Papel e permissões, iguais no cadastro e na edição. */
function AccessFields({
  role,
  permissions,
  onRole,
  onPermissions,
  lockRole,
}: {
  role: UserRole;
  permissions: Permission[];
  onRole: (role: UserRole) => void;
  onPermissions: (permissions: Permission[]) => void;
  lockRole?: boolean;
}) {
  const name = useId();
  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Papel</legend>
        {ROLES.map((r) => (
          <label
            key={r}
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-checked:border-primary has-checked:bg-primary-soft/40 has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <input
              type="radio"
              name={name}
              value={r}
              checked={role === r}
              disabled={lockRole && r !== role}
              onChange={() => onRole(r)}
              className="mt-1 size-4 accent-[var(--primary)]"
            />
            <span>
              <span className="block text-sm font-semibold">{ROLE_LABELS[r]}</span>
              <span className="block text-sm text-muted">{ROLE_DESCRIPTIONS[r]}</span>
            </span>
          </label>
        ))}
        {lockRole && <p className="text-xs text-muted">Você não pode tirar o seu próprio acesso de SAD. Peça a outra pessoa do SAD.</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Permissões</legend>
        <p className="text-sm text-muted">
          {role === "ADMIN"
            ? "O SAD já reserva qualquer tipo de atividade."
            : "Graduação, Pós-Graduação e Defesa só com a permissão. Cultura e Extensão e Concurso todo cadastro já tem, e dá para tirar. Reunião todos podem pedir."}
        </p>
        {PERMISSIONS.map((p) => (
          <Switch
            key={p}
            label={PERMISSION_LABELS[p]}
            description={PERMISSION_HINTS[p]}
            checked={permissions.includes(p)}
            disabled={role === "ADMIN"}
            onChange={(on) => onPermissions(on ? [...permissions, p] : permissions.filter((x) => x !== p))}
          />
        ))}
      </fieldset>
    </div>
  );
}

/** Só o que foge do padrão: o que o SAD concedeu e o que tirou (o SAD já pede tudo). */
function PermissionBadges({ person }: { person: Person }) {
  if (person.role === "ADMIN") return null;
  const { granted, removed } = permissionChanges(person.permissions);
  if (granted.length + removed.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {granted.map((x) => (
        <Badge key={x} tone="success">
          {PERMISSION_LABELS[x]}
        </Badge>
      ))}
      {removed.map((x) => (
        <Badge key={x} tone="neutral">
          Sem {PERMISSION_LABELS[x].replace(/^Pedir /, "")}
        </Badge>
      ))}
    </div>
  );
}

function EditPersonDrawer({ person, onClose, onSaved }: { person: Person; onClose: () => void; onSaved: (p: Person) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [role, setRole] = useState(person.role);
  const [permissions, setPermissions] = useState(person.permissions);
  const [saving, setSaving] = useState(false);
  const isSelf = user?.id === person.id;
  const changed = role !== person.role || [...permissions].sort().join() !== [...person.permissions].sort().join();

  async function save() {
    setSaving(true);
    try {
      const { user: saved } = await api<{ user: Person }>(`/admin/users/${person.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role, permissions }),
      });
      toast.success("Acesso atualizado.", `${saved.name} já pode usar o novo acesso, sem precisar entrar de novo.`);
      onSaved(saved);
    } catch (e) {
      toast.error("Não foi possível salvar.", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      variant="drawer"
      onClose={onClose}
      title={person.name}
      description={`${person.email}${person.uspNumber && !person.uspNumber.startsWith("mock-") ? ` · nº USP ${person.uspNumber}` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={!changed} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      <AccessFields role={role} permissions={permissions} onRole={setRole} onPermissions={setPermissions} lockRole={isSelf} />
    </Dialog>
  );
}

function NewPersonDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Person) => void }) {
  const toast = useToast();
  const formId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [uspNumber, setUspNumber] = useState("");
  const [role, setRole] = useState<UserRole>("USER");
  const [permissions, setPermissions] = useState<Permission[]>(DEFAULT_PERMISSIONS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { user } = await api<{ user: Person }>("/admin/users", {
        method: "POST",
        body: JSON.stringify({ name, email, uspNumber, role, permissions }),
      });
      toast.success("Pessoa cadastrada.", "No primeiro acesso pela Senha Única, ela já entra com esse acesso.");
      onCreated(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível cadastrar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      variant="drawer"
      onClose={onClose}
      title="Cadastrar pessoa"
      description="Para dar o acesso antes do primeiro login. A pessoa é reconhecida pelo e-mail quando entrar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={saving} icon={UserPlusIcon}>
            Cadastrar
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="space-y-6">
        <div className="space-y-4">
          <Input label="Nome" required data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="E-mail USP" type="email" required placeholder="nome@fm.usp.br" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Nº USP" hint="Opcional." inputMode="numeric" value={uspNumber} onChange={(e) => setUspNumber(e.target.value)} />
        </div>
        <AccessFields role={role} permissions={permissions} onRole={setRole} onPermissions={setPermissions} />
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}

/** Tela "Pessoas" do SAD: papel (Solicitante, SAD, NUCEV) e permissões de cada pessoa. */
export function UsersAdmin() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const [permission, setPermission] = useState<Permission | "">("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams(Object.entries({ q: query, role, permission }).filter(([, v]) => v)).toString();

  useEffect(() => {
    let active = true;
    setPeople(null);
    api<{ users: Person[]; nextCursor: string | null }>(`/admin/users?${params}`)
      .then((res) => {
        if (!active) return;
        setPeople(res.users);
        setCursor(res.nextCursor);
      })
      .catch((e: Error) => {
        if (!active) return;
        toast.error("Não foi possível carregar as pessoas.", e.message);
        setPeople([]);
      });
    return () => {
      active = false;
    };
  }, [params]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api<{ users: Person[]; nextCursor: string | null }>(`/admin/users?${params}${params ? "&" : ""}cursor=${cursor}`);
      setPeople((current) => [...(current ?? []), ...res.users]);
      setCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const replace = (p: Person) => setPeople((current) => current?.map((x) => (x.id === p.id ? p : x)) ?? null);
  const filtered = Boolean(query || role || permission);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pessoas"
        description="Papel e o que cada pessoa pode pedir. Na lista aparece só o que foge do padrão (Cultura e Extensão, Concurso e Reunião)."
        actions={
          <Button icon={UserPlusIcon} onClick={() => setCreating(true)}>
            Cadastrar pessoa
          </Button>
        }
      />

      <div className="grid grid-cols-2 items-end gap-3 lg:grid-cols-[1fr_12rem_14rem]">
        <div className="relative col-span-2 lg:col-span-1">
          <Input
            type="search"
            aria-label="Buscar pessoa"
            placeholder="Nome, e-mail ou nº USP"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        </div>
        <Select label="Papel" value={role} onChange={(e) => setRole(e.target.value as UserRole | "")}>
          <option value="">Todos</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Select label="Permissão" value={permission} onChange={(e) => setPermission(e.target.value as Permission | "")}>
          <option value="">Todas</option>
          {PERMISSIONS.map((p) => (
            <option key={p} value={p}>
              {PERMISSION_LABELS[p]}
            </option>
          ))}
        </Select>
      </div>

      {people === null ? (
        <CardListSkeleton />
      ) : people.length === 0 ? (
        <EmptyState
          icon={filtered ? MagnifyingGlassIcon : UsersThreeIcon}
          title={filtered ? "Ninguém encontrado" : "Ninguém cadastrado ainda"}
          description={filtered ? "Nenhuma pessoa com esses filtros." : "As pessoas aparecem aqui depois do primeiro acesso, ou quando o SAD cadastra."}
        />
      ) : (
        <>
          <Card className="divide-y divide-border">
            {people.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
                <Avatar name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="font-semibold">{p.name}</p>
                    <Badge tone={ROLE_TONES[p.role]}>{ROLE_LABELS[p.role]}</Badge>
                  </div>
                  <p className="truncate text-sm text-muted">{p.email}</p>
                  <PermissionBadges person={p} />
                </div>
                <Button variant="secondary" size="sm" icon={PencilSimpleLineIcon} onClick={() => setEditing(p)} className="ml-auto">
                  Editar acesso
                </Button>
              </div>
            ))}
          </Card>
          {cursor && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}

      {editing && (
        <EditPersonDrawer
          key={editing.id}
          person={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            replace(p);
            setEditing(null);
          }}
        />
      )}
      {creating && (
        <NewPersonDialog
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setPeople((current) => [p, ...(current ?? [])]);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

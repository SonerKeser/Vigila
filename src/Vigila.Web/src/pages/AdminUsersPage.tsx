import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, KeyRound, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/AppShell";
import { useToast } from "../components/toast";
import { Button, Dialog, ErrorNote, Field, Input, NumberInput, PageLoader, Pill, Segmented, Switch } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useMe } from "../lib/auth";
import { fmt, relative } from "../lib/format";
import type { AdminUser, Role } from "../lib/types";

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ displayName: "", email: "", password: "", role: "researcher" as Role, unlimited: false, credits: 20 });
  const create = useMutation({
    mutationFn: () => api.createUser({ email: form.email, displayName: form.displayName, password: form.password, role: form.role, credits: form.unlimited ? null : form.credits }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      toast("Kullanıcı eklendi.");
      onClose();
      setForm({ displayName: "", email: "", password: "", role: "researcher", unlimited: false, credits: 20 });
    },
  });
  const fe = (n: string) => (create.error instanceof ApiError ? create.error.field(n) : undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <Dialog open={open} onClose={onClose} title="Kullanıcı ekle" description="Parolayı kullanıcıya güvenli bir yoldan iletin; ilk girişten sonra hesap ayarlarından değiştirebilir.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Ad soyad" error={fe("displayName")}>{(id) => <Input id={id} required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}</Field>
        <Field label="E-posta" error={fe("email")}>{(id) => <Input id={id} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
        <Field label="Geçici parola" hint="En az 8 karakter." error={fe("password")}>
          {(id) => <Input id={id} type="text" required minLength={8} autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <Field label="Rol">
          {() => <Segmented<Role> label="Rol" value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={[{ value: "researcher", label: "Araştırmacı" }, { value: "admin", label: "Yönetici" }]} />}
        </Field>
        <div className="flex items-end gap-4">
          <Field label="Oturum kredisi" className="flex-1" error={fe("credits")}>
            {(id) => <NumberInput id={id} min={0} value={form.credits} onChange={(v) => setForm({ ...form, credits: v })} />}
          </Field>
          <label className="flex h-11 items-center gap-2.5 text-sm text-mist">
            <Switch label="Sınırsız kredi" checked={form.unlimited} onChange={(v) => setForm({ ...form, unlimited: v })} /> Sınırsız
          </label>
        </div>
        {create.error instanceof ApiError && Object.keys(create.error.fields).length === 0 && <ErrorNote error={create.error} />}
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" variant="primary" loading={create.isPending}>Kullanıcıyı ekle</Button>
        </div>
      </form>
    </Dialog>
  );
}

function UserRow({ user, self }: { user: AdminUser; self: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [amount, setAmount] = useState(10);
  const [password, setPassword] = useState("");

  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.updateUser>[1]) => api.updateUser(user.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast(e.message, "error"),
  });
  const reset = useMutation({
    mutationFn: () => api.resetPassword(user.id, password),
    onSuccess: () => {
      toast("Parola değiştirildi; kullanıcının açık oturumları kapatıldı.");
      setPasswordOpen(false);
      setPassword("");
    },
  });

  return (
    <tr className="hover:bg-ink-850">
      <td className="px-4 py-3">
        <p className="font-medium text-paper">
          {user.displayName} {self && <span className="text-[12px] font-normal text-haze">(siz)</span>}
        </p>
        <p className="text-[12.5px] text-haze">{user.email}</p>
      </td>
      <td className="px-4 py-3">{user.role === "admin" ? <Pill tone="av">Yönetici</Pill> : <Pill>Araştırmacı</Pill>}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        <button onClick={() => setCreditsOpen(true)} className="rounded-md px-2 py-1 text-paper hover:bg-ink-700" title="Krediyi düzenle">
          {user.creditsRemaining == null ? "Sınırsız" : fmt.int(user.creditsRemaining)}
        </button>
        <p className="text-[12px] text-haze">{fmt.int(user.creditsUsed)} kullanıldı</p>
      </td>
      <td className="px-4 py-3 text-right text-mist tabular-nums">
        {user.experimentCount} / {user.sessionCount}
      </td>
      <td className="px-4 py-3 text-mist">{user.lastLoginAt ? relative(user.lastLoginAt) : "Hiç girmedi"}</td>
      <td className="px-4 py-3">
        <Switch label="Hesap etkin" checked={user.isActive} disabled={self} onChange={(v) => update.mutate({ isActive: v })} />
      </td>
      <td className="px-4 py-3 text-right">
        <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setPasswordOpen(true)}>
          Parola
        </Button>
      </td>

      <Dialog
        open={creditsOpen}
        onClose={() => setCreditsOpen(false)}
        title="Oturum kredisi"
        description={`${user.displayName} için şu an ${user.creditsRemaining == null ? "sınırsız" : `${user.creditsRemaining} kredi`} tanımlı.`}
        footer={<Button variant="ghost" onClick={() => setCreditsOpen(false)}>Kapat</Button>}
      >
        <div className="flex flex-col gap-4">
          <Field label="Miktar">{(id) => <NumberInput id={id} min={0} value={amount} onChange={setAmount} />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={user.creditsRemaining == null || !(amount > 0)} loading={update.isPending} onClick={() => update.mutate({ credits: { mode: "add", value: amount } }, { onSuccess: () => toast(`${amount} kredi eklendi.`) })}>
              Ekle
            </Button>
            <Button disabled={!(amount >= 0)} onClick={() => update.mutate({ credits: { mode: "set", value: amount } }, { onSuccess: () => toast(`Kredi ${amount} olarak ayarlandı.`) })}>
              Bu değere ayarla
            </Button>
            <Button variant="ghost" onClick={() => update.mutate({ credits: { mode: "unlimited", value: 0 } }, { onSuccess: () => toast("Kredi sınırı kaldırıldı.") })}>
              Sınırsız yap
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        title="Parolayı sıfırla"
        description="Yeni parola hemen geçerli olur ve kullanıcının açık oturumları kapanır."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasswordOpen(false)}>Vazgeç</Button>
            <Button variant="primary" disabled={password.length < 8} loading={reset.isPending} onClick={() => reset.mutate()}>Parolayı değiştir</Button>
          </>
        }
      >
        <Field label="Yeni parola" hint="En az 8 karakter." error={reset.error instanceof ApiError ? reset.error.field("newPassword") : undefined}>
          {(id) => <Input id={id} value={password} autoComplete="off" onChange={(e) => setPassword(e.target.value)} />}
        </Field>
      </Dialog>
    </tr>
  );
}

export function AdminUsersPage() {
  const me = useMe().data!;
  const q = useQuery({ queryKey: ["users"], queryFn: api.users });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Kullanıcılar"
        description="Araştırmacı hesapları ve oturum kredileri. Kredi her yeni oturumda sunucuda düşülür; istemci tarafında değiştirilemez."
        actions={
          <>
            <a href="/api/admin/backup" download title="Veritabanı, medya dosyaları ve anahtarlar tek zip dosyasında">
              <Button icon={<DatabaseBackup className="size-4" />}>Yedek indir</Button>
            </a>
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreating(true)}>
              Kullanıcı ekle
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-haze">
                <th className="px-4 py-3 font-medium">Kullanıcı</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 text-right font-medium">Kalan kredi</th>
                <th className="px-4 py-3 text-right font-medium">Deney / oturum</th>
                <th className="px-4 py-3 font-medium">Son giriş</th>
                <th className="px-4 py-3 font-medium">Etkin</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data!.map((u) => (
                <UserRow key={u.id} user={u} self={u.id === me.id} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

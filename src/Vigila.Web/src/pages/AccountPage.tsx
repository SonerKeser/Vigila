import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { PageHeader } from "../components/AppShell";
import { Logo } from "../components/bits";
import { useToast } from "../components/toast";
import { Button, Field, Input } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useMe } from "../lib/auth";
import { fmt } from "../lib/format";

export function AccountPage() {
  const me = useMe().data!;
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      toast("Parolanız değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.");
      setCurrent("");
      setNext("");
      setRepeat("");
    },
  });
  const fe = (n: string) => (change.error instanceof ApiError ? change.error.field(n) : undefined);
  const mismatch = repeat.length > 0 && next !== repeat;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch) change.mutate();
  };

  return (
    <>
      <PageHeader title="Hesap" description="Profil bilgileriniz ve parolanız." />
      <div className="grid gap-10 lg:grid-cols-2">
        <section className="panel p-6">
          <h2 className="display text-[26px] leading-none">Profil</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-haze">Ad soyad</dt>
              <dd className="text-paper">{me.displayName}</dd>
            </div>
            <div>
              <dt className="text-haze">E-posta</dt>
              <dd className="text-paper">{me.email}</dd>
            </div>
            <div>
              <dt className="text-haze">Rol</dt>
              <dd className="text-paper">{me.role === "admin" ? "Yönetici" : "Araştırmacı"}</dd>
            </div>
            <div>
              <dt className="text-haze">Oturum kredisi</dt>
              <dd className="text-paper">
                {me.creditsRemaining == null ? "Sınırsız" : `${fmt.int(me.creditsRemaining)} kaldı`}, {fmt.int(me.creditsUsed)} kullanıldı
              </dd>
            </div>
          </dl>
          {me.role === "admin" && (
            <Link to="/yonetim" className="mt-6 inline-block text-sm text-av hover:underline">
              Kullanıcıları ve kredileri yönetin
            </Link>
          )}
        </section>

        <section className="panel p-6">
          <h2 className="display text-[26px] leading-none">Parolayı değiştir</h2>
          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <Field label="Mevcut parola" error={fe("currentPassword")}>
              {(id) => <Input id={id} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
            </Field>
            <Field label="Yeni parola" hint="En az 8 karakter." error={fe("newPassword")}>
              {(id) => <Input id={id} type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />}
            </Field>
            <Field label="Yeni parola (tekrar)" error={mismatch ? "Parolalar aynı değil." : undefined}>
              {(id) => <Input id={id} type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} invalid={mismatch} />}
            </Field>
            <Button type="submit" variant="primary" loading={change.isPending} disabled={mismatch} className="self-start">
              Parolayı değiştir
            </Button>
          </form>
        </section>
      </div>
      <p className="mt-16 flex items-center gap-3 text-[12px] text-haze">
        <Logo className="scale-75 opacity-70" /> Video tabanlı uyaran-tepki deney platformu
      </p>
    </>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="display text-[96px] leading-none text-haze">404</p>
      <h1 className="display text-[36px]">Bu sayfa bulunamadı</h1>
      <p className="text-mist">Adres yanlış yazılmış ya da sayfa kaldırılmış olabilir.</p>
      <Link to="/">
        <Button variant="primary">Panoya dön</Button>
      </Link>
    </div>
  );
}

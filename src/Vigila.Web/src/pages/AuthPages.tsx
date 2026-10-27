import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Logo } from "../components/bits";
import { SignalHero } from "../components/SignalHero";
import { Button, ErrorNote, Field, Input, PageLoader } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useMe } from "../lib/auth";

function AuthLayout({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-ink-950 px-12 py-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_20%_10%,rgb(48_55_124/0.5),transparent)]" />
        <Logo className="relative" />
        <div className="relative flex flex-1 flex-col items-start justify-center gap-10 py-10">
          <SignalHero />
          <div className="max-w-[560px]">
            <h2 className="display text-[44px] leading-[1.04]">Video izlerken verilen tepkileri milisaniyesiyle ölçün.</h2>
            <p className="mt-4 max-w-[46ch] text-[15px] text-mist">
              Görsel ve işitsel uyaranları videonun üzerine planlayın, katılımcılara bağlantı gönderin, isabet ve tepki sürelerini oturum biter bitmez inceleyin.
            </p>
          </div>
        </div>
        <p className="relative text-[12px] text-haze">Uyaran-tepki araştırmaları için deney platformu</p>
      </section>

      <section className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-[400px]">
          <Logo className="mb-10 lg:hidden" />
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <h1 className="display text-[42px]">{title}</h1>
            <p className="mt-2 mb-8 text-[15px] text-mist">{intro}</p>
            {children}
          </motion.div>
        </div>
      </section>
    </div>
  );
}

export function LoginPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setupStatus, staleTime: Infinity });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (me.isLoading || setup.isLoading) return <PageLoader />;
  if (setup.data?.needsSetup) return <Navigate to="/kurulum" replace />;
  if (me.data) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(email, password, remember);
      qc.setQueryData(["me"], user);
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Giriş yapın" intro="Deneylerinize ve sonuçlarınıza erişmek için hesabınızla giriş yapın.">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="E-posta">{(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Parola">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-mist">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--color-av)]" />
          Bu cihazda oturumum açık kalsın
        </label>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1 w-full">
          Giriş yap
        </Button>
        <p className="text-center text-[13px] text-haze">Hesabınız yoksa laboratuvar yöneticinizden davet isteyin.</p>
      </form>
    </AuthLayout>
  );
}

export function SetupPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setupStatus, staleTime: Infinity });
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (setup.isLoading) return <PageLoader />;
  if (!setup.data?.needsSetup) return <Navigate to="/giris" replace />;

  const fieldError = (name: string) => (error instanceof ApiError ? error.field(name) : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.setup(form.email, form.displayName, form.password);
      qc.setQueryData(["me"], user);
      qc.setQueryData(["setup"], { needsSetup: false });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Kurulumu tamamlayın" intro="İlk hesap yönetici olarak açılır. Araştırmacıları ve kredilerini daha sonra bu hesaptan yönetirsiniz.">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Ad soyad" error={fieldError("displayName")}>
          {(id) => <Input id={id} autoComplete="name" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}
        </Field>
        <Field label="E-posta" error={fieldError("email")}>
          {(id) => <Input id={id} type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Parola" hint="En az 8 karakter." error={fieldError("password")}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        {error instanceof ApiError && Object.keys(error.fields).length === 0 && <ErrorNote error={error} />}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-1 w-full">
          Kurulumu tamamla
        </Button>
      </form>
    </AuthLayout>
  );
}

import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { FlaskConical, History, LayoutDashboard, Library, LogOut, Menu, Settings, Users, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useLogout, useMe } from "../lib/auth";
import { fmt } from "../lib/format";
import { Logo } from "./bits";

const nav = [
  { to: "/", label: "Pano", icon: LayoutDashboard, end: true },
  { to: "/deneyler", label: "Deneyler", icon: FlaskConical },
  { to: "/medya", label: "Medya kütüphanesi", icon: Library },
  { to: "/oturumlar", label: "Oturumlar", icon: History },
];

function NavItem({ to, label, icon: Icon, end, onNavigate }: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => clsx("relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors", isActive ? "text-paper" : "text-mist hover:text-paper")}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="nav-active" transition={{ type: "spring", stiffness: 500, damping: 40 }} className="absolute inset-0 rounded-[10px] border border-line bg-ink-800" />}
          <Icon className="relative size-[18px] shrink-0" strokeWidth={1.8} />
          <span className="relative">{label}</span>
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe().data!;
  const logout = useLogout();
  const navigate = useNavigate();
  const unlimited = me.creditsRemaining == null;
  const total = (me.creditsRemaining ?? 0) + me.creditsUsed;

  return (
    <div className="flex h-full flex-col gap-6 px-4 py-6">
      <div className="px-2">
        <Logo />
      </div>
      <nav className="flex flex-col gap-1">
        {nav.map((n) => (
          <NavItem key={n.to} {...n} onNavigate={onNavigate} />
        ))}
        {me.role === "admin" && <NavItem to="/yonetim" label="Kullanıcılar" icon={Users} onNavigate={onNavigate} />}
      </nav>

      <div className="mt-auto space-y-4">
        <div className="rounded-[14px] border border-line px-3.5 py-3">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-mist">Oturum kredisi</span>
            <span className="text-paper tabular-nums">{unlimited ? "Sınırsız" : fmt.int(me.creditsRemaining)}</span>
          </div>
          {!unlimited && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-950">
              <div className={clsx("h-full rounded-full", (me.creditsRemaining ?? 0) <= 3 ? "bg-warn" : "bg-av")} style={{ width: `${total > 0 ? ((me.creditsRemaining ?? 0) / total) * 100 : 0}%` }} />
            </div>
          )}
          <p className="mt-1.5 text-[11.5px] text-haze">{fmt.int(me.creditsUsed)} oturum kullanıldı</p>
        </div>

        <div className="flex items-center gap-3 px-1">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-700 text-[13px] font-semibold text-paper">
            {me.displayName
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toLocaleUpperCase("tr")}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-paper">{me.displayName}</p>
            <p className="truncate text-[12px] text-haze">{me.email}</p>
          </div>
          <NavLink to="/hesap" onClick={onNavigate} aria-label="Hesap ayarları" title="Hesap ayarları" className="grid size-8 place-items-center rounded-lg text-haze hover:bg-ink-800 hover:text-paper">
            <Settings className="size-4" />
          </NavLink>
          <button
            aria-label="Çıkış yap"
            title="Çıkış yap"
            className="grid size-8 place-items-center rounded-lg text-haze hover:bg-ink-800 hover:text-paper"
            onClick={async () => {
              await logout();
              navigate("/giris", { replace: true });
            }}
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-line bg-ink-950 lg:block">
        <Sidebar />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-ink-950/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button aria-label="Menüyü aç" className="grid size-9 place-items-center rounded-lg text-mist hover:bg-ink-800" onClick={() => setOpen(true)}>
          <Menu className="size-5" />
        </button>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <motion.aside className="absolute inset-y-0 left-0 w-[280px] border-r border-line bg-ink-950" initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: "spring", stiffness: 420, damping: 40 }}>
              <button aria-label="Menüyü kapat" className="absolute top-5 right-3 grid size-9 place-items-center rounded-lg text-mist hover:bg-ink-800" onClick={() => setOpen(false)}>
                <X className="size-5" />
              </button>
              <Sidebar onNavigate={() => setOpen(false)} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_70%_100%_at_30%_0%,rgb(48_55_124/0.45),transparent)]" />
        <motion.div key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className="relative mx-auto max-w-[1320px] px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}

/** Sayfa başlığı: serif başlık, tek satırlık açıklama, sağda eylemler. */
export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-8">
      {back && <div className="mb-4">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display text-[40px] sm:text-[48px]">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-[15px] text-mist">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

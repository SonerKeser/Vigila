import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FlaskConical, Link2, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../../components/toast";
import { Button, ConfirmDialog, Field, Input, Kbd, NumberInput, Switch } from "../../components/ui";
import { api } from "../../lib/api";
import { useMe } from "../../lib/auth";
import { fmt, keyLabel } from "../../lib/format";
import type { Experiment, ExperimentDraft } from "../../lib/types";

/** ISO tarih ↔ datetime-local alanı (yerel saat). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

function LinkRules({ experiment, draft, onChange, errors }: { experiment: Experiment; draft: ExperimentDraft; onChange: (d: ExperimentDraft) => void; errors: Record<string, string[]> }) {
  const err = (f: string) => errors[f]?.[0];
  const expired = draft.linkExpiresAt != null && new Date(draft.linkExpiresAt) < new Date();
  const full = draft.maxParticipants != null && experiment.linkCompletedCount >= draft.maxParticipants;
  return (
    <section className="lg:col-span-2">
      <h2 className="display text-[26px] leading-none">Bağlantı kuralları</h2>
      <p className="mt-1.5 text-[13px] text-haze">Değişiklikler sayfanın üstündeki Kaydet düğmesiyle kaydedilir.</p>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Field
          label="Katılımcı sınırı"
          hint={draft.maxParticipants == null ? `Sınırsız. Şu ana dek ${experiment.linkCompletedCount} kişi tamamladı.` : `${experiment.linkCompletedCount} / ${draft.maxParticipants} kişi tamamladı.${full ? " Sınıra ulaşıldı; bağlantı yeni katılımcı kabul etmiyor." : ""}`}
          error={err("maxParticipants")}
        >
          {(id) => <NumberInput id={id} min={1} value={draft.maxParticipants ?? NaN} onChange={(v) => onChange({ ...draft, maxParticipants: Number.isNaN(v) ? null : v })} />}
        </Field>
        <Field label="Son katılım tarihi" hint={expired ? "Tarih geçti; bağlantı kapalı." : "Boş bırakılırsa süresiz açık kalır."}>
          {(id) => <Input id={id} type="datetime-local" value={toLocalInput(draft.linkExpiresAt)} onChange={(e) => onChange({ ...draft, linkExpiresAt: fromLocalInput(e.target.value) })} />}
        </Field>
        <Field
          label="Bitişte yönlendirme adresi"
          className="md:col-span-2"
          hint="Deney biten katılımcı bu adrese gönderilir; {kod} katılımcı koduyla değişir. Anket ya da katılımcı havuzu platformuna dönüş için kullanın."
          error={err("completionUrl")}
        >
          {(id) => <Input id={id} placeholder="https://anket.ornek.edu.tr/tamamlandi?kod={kod}" value={draft.completionUrl ?? ""} onChange={(e) => onChange({ ...draft, completionUrl: e.target.value || null })} />}
        </Field>
        <div className="flex items-center justify-between gap-4 md:col-span-2">
          <div>
            <p className="text-[13px] font-medium">Tekrar katılımı engelle</p>
            <p className="text-[12.5px] text-haze">Aynı tarayıcıdan ya da aynı katılımcı koduyla ikinci kez katılınamaz.</p>
          </div>
          <Switch label="Tekrar katılımı engelle" checked={draft.preventRepeat} onChange={(v) => onChange({ ...draft, preventRepeat: v })} />
        </div>
      </div>
      <p className="mt-5 max-w-3xl text-[13px] text-mist">
        Bağlantının sonuna <code className="rounded bg-ink-800 px-1.5 py-0.5 text-paper">?kod=K-017</code> eklerseniz katılımcı kodu kendiliğinden dolar. Katılımcı havuzu platformları için kod alanına platformun kimlik değişkenini yazın.
      </p>
    </section>
  );
}

export function ParticipationTab({
  experiment,
  dirty,
  draft,
  onChange,
  errors,
}: {
  experiment: Experiment;
  dirty: boolean;
  draft: ExperimentDraft;
  onChange: (d: ExperimentDraft) => void;
  errors: Record<string, string[]>;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const me = useMe().data!;
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const ready = experiment.readiness.ready && !dirty;

  const link = useMutation({
    mutationFn: ({ enabled, regenerate }: { enabled: boolean; regenerate?: boolean }) => api.setRunLink(experiment.id, enabled, regenerate),
    onSuccess: (r, vars) => {
      void qc.invalidateQueries({ queryKey: ["experiment", experiment.id] });
      void qc.invalidateQueries({ queryKey: ["experiments"] });
      setConfirmRegenerate(false);
      toast(vars.regenerate ? "Yeni bağlantı üretildi; eski bağlantı artık çalışmıyor." : r.enabled ? "Katılım bağlantısı açıldı." : "Katılım bağlantısı kapatıldı.");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const url = experiment.runToken ? `${window.location.origin}/k/${experiment.runToken}` : "";

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section className="panel p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="display flex items-center gap-2 text-[28px] leading-none">
              <Link2 className="size-5 text-av" /> Bağlantıyla katılım
            </h2>
            <p className="mt-2 max-w-md text-sm text-mist">Katılımcılar bağlantıyı kendi bilgisayarlarında açar, hesap gerekmez. Her başlayan oturum bir kredi kullanır.</p>
          </div>
          <Switch label="Bağlantıyla katılım" checked={experiment.runLinkEnabled} onChange={(v) => link.mutate({ enabled: v })} />
        </div>

        {!ready && !experiment.runLinkEnabled && (
          <p className="mt-5 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3 text-[13px] text-warn">
            {dirty ? "Önce değişiklikleri kaydedin." : `Bağlantı açılmadan önce: ${experiment.readiness.issues.join(" ")}`}
          </p>
        )}

        {experiment.runLinkEnabled && url && (
          <div className="mt-6 space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Katılım bağlantısı" className="font-[450] text-[13px]" />
              <Button variant="primary" onClick={copy} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
                {copied ? "Kopyalandı" : "Kopyala"}
              </Button>
            </div>
            <button onClick={() => setConfirmRegenerate(true)} className="inline-flex items-center gap-1.5 text-[13px] text-haze hover:text-paper">
              <RefreshCw className="size-3.5" /> Yeni bağlantı üret
            </button>
          </div>
        )}
      </section>

      <section className="panel p-6">
        <h2 className="display flex items-center gap-2 text-[28px] leading-none">
          <FlaskConical className="size-5 text-audio" /> Laboratuvar oturumu
        </h2>
        <p className="mt-2 max-w-md text-sm text-mist">Deneyi bu bilgisayarda tam ekran başlatın. Katılımcı kodunu boş bırakırsanız otomatik üretilir.</p>
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
          <Field label="Katılımcı kodu" className="flex-1">
            {(id) => <Input id={id} value={code} maxLength={64} placeholder="Ör. K-017" onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Button variant="primary" icon={<Play className="size-4" />} disabled={!ready} onClick={() => navigate(`/lab/${experiment.id}`, { state: { code } })}>
            Laboratuvarda başlat
          </Button>
        </div>
        <p className="mt-3 text-[12.5px] text-haze">Kalan kredi: {me.creditsRemaining == null ? "sınırsız" : fmt.int(me.creditsRemaining)}</p>
      </section>

      <LinkRules experiment={experiment} draft={draft} onChange={onChange} errors={errors} />

      <section className="lg:col-span-2">
        <h2 className="display text-[26px] leading-none">Katılımcının göreceği yönerge</h2>
        <div className="mt-5 max-w-2xl rounded-[var(--radius-panel)] border border-line bg-black p-8">
          <p className="display text-[32px]">{experiment.name}</p>
          <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-mist">{experiment.instructionText || "Yönerge metni girilmedi."}</p>
          <p className="mt-6 flex flex-wrap items-center gap-2 text-sm text-mist">
            Yanıt tuşu <Kbd>{keyLabel(experiment.settings.responseKey)}</Kbd>
          </p>
        </div>
      </section>

      <ConfirmDialog
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        onConfirm={() => link.mutate({ enabled: true, regenerate: true })}
        loading={link.isPending}
        title="Yeni bağlantı üretilsin mi?"
        description="Şu anki bağlantıyı paylaştığınız katılımcılar artık deneye giremez. Devam eden oturumlar etkilenmez."
        confirmLabel="Yeni bağlantı üret"
      />
    </div>
  );
}

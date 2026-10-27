import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, Play, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { PageHeader } from "../../components/AppShell";
import { useToast } from "../../components/toast";
import { Button, ConfirmDialog, ErrorNote, PageLoader, Pill, Tabs } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import type { Experiment, ExperimentDraft } from "../../lib/types";
import { DesignTab } from "./DesignTab";
import { ParticipationTab } from "./ParticipationTab";
import { ResultsTab } from "./ResultsTab";

type Tab = "tasarim" | "sonuclar" | "katilim";

export function toDraft(e: Experiment): ExperimentDraft {
  return {
    name: e.name,
    description: e.description,
    instructionText: e.instructionText,
    videoId: e.videoId,
    instructionVideoId: e.instructionVideoId,
    imageIds: e.imageIds,
    audioIds: e.audioIds,
    settings: e.settings,
    consentText: e.consentText,
    questions: e.questions,
    maxParticipants: e.maxParticipants,
    linkExpiresAt: e.linkExpiresAt,
    preventRepeat: e.preventRepeat,
    completionUrl: e.completionUrl,
  };
}

export function ExperimentPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("sekme") as Tab) || "tasarim";
  const q = useQuery({ queryKey: ["experiment", id], queryFn: () => api.experiment(id) });
  const [draft, setDraft] = useState<ExperimentDraft | null>(null);

  useEffect(() => {
    if (q.data && !draft) setDraft(toDraft(q.data));
  }, [q.data, draft]);

  const saved = useMemo(() => (q.data ? JSON.stringify(toDraft(q.data)) : ""), [q.data]);
  const dirty = draft != null && JSON.stringify(draft) !== saved;

  const save = useMutation({
    mutationFn: (d: ExperimentDraft) => api.saveExperiment(id, d),
    onSuccess: (e) => {
      qc.setQueryData(["experiment", id], e);
      setDraft(toDraft(e));
      void qc.invalidateQueries({ queryKey: ["experiments"] });
      toast(e.readiness.ready ? "Deney kaydedildi ve çalışmaya hazır." : "Deney kaydedildi.");
    },
    onError: (e) => toast(e instanceof ApiError && Object.keys(e.fields).length ? "Bazı alanlar hatalı; işaretli alanları düzeltin." : e.message, "error"),
  });

  const doSave = useCallback(() => {
    if (draft && dirty && !save.isPending) save.mutate(draft);
  }, [draft, dirty, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  if (q.isLoading || (!draft && !q.error)) return <PageLoader />;
  if (q.error) return <ErrorNote error={q.error} />;
  const experiment = q.data!;
  const ready = experiment.readiness.ready && !dirty;

  return (
    <>
      <PageHeader
        back={
          <Link to="/deneyler" className="inline-flex items-center gap-1.5 text-sm text-mist hover:text-paper">
            <ArrowLeft className="size-4" /> Deneyler
          </Link>
        }
        title={draft!.name || "Adsız deney"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {dirty ? (
              <Pill tone="warn">Kaydedilmemiş değişiklikler</Pill>
            ) : experiment.readiness.ready ? (
              <Pill tone="success">
                <CircleCheck className="size-3.5" /> Çalışmaya hazır
              </Pill>
            ) : (
              <Pill tone="warn">
                <TriangleAlert className="size-3.5" /> {experiment.readiness.issues[0]}
              </Pill>
            )}
            <span className="text-[13px] text-haze">Oturum başına {experiment.trialCount} uyaran, {experiment.sessionCount} oturum</span>
          </span>
        }
        actions={
          <>
            <Button variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={save.isPending} onClick={doSave} title="Ctrl+S">
              {dirty ? "Kaydet" : "Kaydedildi"}
            </Button>
            <Button icon={<Play className="size-4" />} disabled={!ready} onClick={() => navigate(`/lab/${id}`)} title={dirty ? "Önce değişiklikleri kaydedin" : undefined}>
              Laboratuvarda başlat
            </Button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={(v) => setParams(v === "tasarim" ? {} : { sekme: v }, { replace: true })}
        items={[
          { value: "tasarim", label: "Tasarım" },
          { value: "sonuclar", label: "Sonuçlar", count: experiment.sessionCount },
          { value: "katilim", label: "Katılım" },
        ]}
      />

      <div className="mt-8">
        {tab === "tasarim" && <DesignTab experiment={experiment} draft={draft!} onChange={setDraft} errors={save.error instanceof ApiError ? save.error.fields : {}} />}
        {tab === "sonuclar" && <ResultsTab experiment={experiment} />}
        {tab === "katilim" && (
          <ParticipationTab experiment={experiment} dirty={dirty} draft={draft!} onChange={setDraft} errors={save.error instanceof ApiError ? save.error.fields : {}} />
        )}
      </div>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        title="Değişiklikler kaydedilmedi"
        description="Bu sayfadan ayrılırsanız deneyde yaptığınız son değişiklikler kaybolur."
        confirmLabel="Kaydetmeden ayrıl"
      />
    </>
  );
}

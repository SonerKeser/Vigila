import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { PageLoader } from "../components/ui";
import { ApiError, api } from "./api";
import type { Me } from "./types";

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api.logout().catch(() => undefined);
    qc.clear();
    qc.setQueryData(["me"], null);
  };
}

/** Oturum açılmamışsa giriş ekranına, ilk kurulum yapılmamışsa kurulum ekranına yönlendirir. */
export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const me = useMe();
  const location = useLocation();
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setupStatus, enabled: me.data === null, staleTime: Infinity });

  if (me.isLoading || (me.data === null && setup.isLoading)) return <PageLoader />;
  if (!me.data) {
    if (setup.data?.needsSetup) return <Navigate to="/kurulum" replace />;
    return <Navigate to="/giris" replace state={{ from: location.pathname + location.search }} />;
  }
  if (admin && me.data.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

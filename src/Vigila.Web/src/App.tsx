import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./lib/auth";
import { AccountPage, NotFoundPage } from "./pages/AccountPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { LoginPage, SetupPage } from "./pages/AuthPages";
import { DashboardPage } from "./pages/DashboardPage";
import { ExperimentPage } from "./pages/experiment/ExperimentPage";
import { ExperimentsPage } from "./pages/ExperimentsPage";
import { MediaPage } from "./pages/MediaPage";
import { RunnerPage } from "./pages/RunnerPage";
import { SessionPage } from "./pages/SessionPage";
import { SessionsPage } from "./pages/SessionsPage";

const router = createBrowserRouter([
  { path: "/giris", element: <LoginPage /> },
  { path: "/kurulum", element: <SetupPage /> },
  // Katılımcı bağlantısı: oturum açmadan erişilir.
  { path: "/k/:token", element: <RunnerPage mode="link" /> },
  {
    path: "/lab/:id",
    element: (
      <RequireAuth>
        <RunnerPage mode="lab" />
      </RequireAuth>
    ),
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "deneyler", element: <ExperimentsPage /> },
      { path: "deneyler/:id", element: <ExperimentPage /> },
      { path: "medya", element: <MediaPage /> },
      { path: "oturumlar", element: <SessionsPage /> },
      { path: "oturumlar/:id", element: <SessionPage /> },
      { path: "hesap", element: <AccountPage /> },
      {
        path: "yonetim",
        element: (
          <RequireAuth admin>
            <Outlet />
          </RequireAuth>
        ),
        children: [{ index: true, element: <AdminUsersPage /> }],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { AuthProvider } from "./AuthContext";

vi.mock("../pages/Dashboard", async () => {
  const { default: AppShell } = await vi.importActual("../components/AppShell.jsx");
  const { useAuth } = await vi.importActual("./useAuth.js");

  return {
    default: function TestDashboard({ onLogout }) {
      const { login, restoreSession, user } = useAuth();
      return (
        <AppShell title="Dashboard" onLogout={onLogout}>
          <p>Authenticated as {user?.email}</p>
          <button type="button" onClick={() => restoreSession()}>
            Restore session
          </button>
          <button
            type="button"
            onClick={() => login({ id: "user-b", email: "b@example.com" })}
          >
            Switch account
          </button>
          <button
            type="button"
            onClick={() => {
              window.__logoutForTest = onLogout();
            }}
          >
            Start logout for unmount
          </button>
        </AppShell>
      );
    },
  };
});

const success = (data = {}) => ({
  success: true,
  statusCode: 200,
  message: "Request completed successfully",
  data,
});

function response(status, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body ? JSON.stringify(body) : ""),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function createStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(String(key)) ?? null;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key) {
      values.delete(String(key));
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
  };
}

async function renderAuthenticated() {
  fetch.mockResolvedValueOnce(
    response(200, success({ user: { id: "user-a", email: "a@example.com" } })),
  );
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
  await screen.findByText("Authenticated as a@example.com");
  return user;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorage(),
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: createStorage(),
  });
  globalThis.fetch = vi.fn();
});

afterEach(cleanup);

describe("legacy AuthProvider logout", () => {
  it("logs out through the real Account action only after HTTP 204", async () => {
    const user = await renderAuthenticated();
    localStorage.setItem("active_location_id", "location-a");
    sessionStorage.setItem("cache:v2:posts", "cached");
    fetch.mockResolvedValueOnce(response(204));

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));

    await screen.findByRole("heading", { name: "Sign in" });
    const [url, options] = fetch.mock.calls[1];
    expect(url).toMatch(/\/api\/v1\/auth\/logout$/);
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
    expect(localStorage.getItem("active_location_id")).toBeNull();
    expect(sessionStorage.getItem("cache:v2:posts")).toBeNull();
  });

  it("disables duplicate logout while the request is pending", async () => {
    const user = await renderAuthenticated();
    const logoutResponse = deferred();
    fetch.mockReturnValueOnce(logoutResponse.promise);

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));

    const pendingButton = await screen.findByRole("menuitem", {
      name: "Logging out…",
    });
    expect(pendingButton.disabled).toBe(true);
    await user.click(pendingButton);
    expect(fetch).toHaveBeenCalledTimes(2);

    logoutResponse.resolve(response(204));
    await screen.findByRole("heading", { name: "Sign in" });
  });

  it("keeps the authenticated state and cache when logout fails", async () => {
    const user = await renderAuthenticated();
    localStorage.setItem("active_location_id", "location-a");
    fetch.mockResolvedValueOnce(
      response(503, {
        success: false,
        statusCode: 503,
        message: "Internal details must not leak",
        errors: [{ code: "unavailable", message: "Internal details must not leak" }],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Logout failed. Please try again.",
    );
    expect(screen.getByText("Authenticated as a@example.com")).toBeTruthy();
    expect(localStorage.getItem("active_location_id")).toBe("location-a");

    fetch.mockResolvedValueOnce(response(204));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));
    await screen.findByRole("heading", { name: "Sign in" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats a resolved non-204 logout response as retryable failure", async () => {
    const user = await renderAuthenticated();
    localStorage.setItem("active_location_id", "location-a");
    fetch.mockResolvedValueOnce(response(202, success({ accepted: true })));

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Logout failed. Please try again.",
    );
    expect(screen.getByText("Authenticated as a@example.com")).toBeTruthy();
    expect(localStorage.getItem("active_location_id")).toBe("location-a");
  });

  it("does not let an older restore overwrite logout", async () => {
    const user = await renderAuthenticated();
    const oldRestore = deferred();
    fetch.mockReturnValueOnce(oldRestore.promise);

    await user.click(screen.getByRole("button", { name: "Restore session" }));
    fetch.mockResolvedValueOnce(response(204));
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));
    await screen.findByRole("heading", { name: "Sign in" });

    oldRestore.resolve(
      response(200, success({ user: { id: "stale", email: "stale@example.com" } })),
    );
    await act(async () => oldRestore.promise);

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText("stale@example.com")).toBeNull();
  });

  it("clears the previous account cache and rejects an older restore on account switch", async () => {
    const user = await renderAuthenticated();
    localStorage.setItem("active_location_id", "location-a");
    const oldRestore = deferred();
    fetch.mockReturnValueOnce(oldRestore.promise);

    await user.click(screen.getByRole("button", { name: "Restore session" }));
    await user.click(screen.getByRole("button", { name: "Switch account" }));
    expect(await screen.findByText("Authenticated as b@example.com")).toBeTruthy();
    expect(localStorage.getItem("active_location_id")).toBeNull();

    oldRestore.resolve(
      response(200, success({ user: { id: "user-a", email: "a@example.com" } })),
    );
    await act(async () => oldRestore.promise);

    expect(screen.getByText("Authenticated as b@example.com")).toBeTruthy();
  });

  it("does not let an earlier account's logout consume the current account's logout", async () => {
    const user = await renderAuthenticated();
    const oldLogout = deferred();
    fetch.mockReturnValueOnce(oldLogout.promise);

    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));
    await user.click(screen.getByRole("button", { name: "Switch account" }));
    fetch.mockResolvedValueOnce(response(204));
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));

    await screen.findByRole("heading", { name: "Sign in" });
    expect(fetch).toHaveBeenCalledTimes(3);
    oldLogout.resolve(response(204));
    await act(async () => oldLogout.promise);
  });

  it("ignores a login response that started before a completed logout", async () => {
    fetch.mockResolvedValueOnce(
      response(401, {
        success: false,
        statusCode: 401,
        message: "Unauthorized",
        errors: [{ code: "unauthorized", message: "Unauthorized" }],
      }),
    );
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByPlaceholderText("Email"), "user@example.com");
    await user.type(screen.getByPlaceholderText("Password"), "password");
    const oldLogin = deferred();
    const currentLogin = deferred();
    fetch.mockReturnValueOnce(oldLogin.promise).mockReturnValueOnce(currentLogin.promise);

    await user.click(screen.getByRole("button", { name: "Login" }));
    await user.click(screen.getByRole("button", { name: "Login" }));
    currentLogin.resolve(
      response(200, success({ user: { id: "current", email: "current@example.com" } })),
    );
    await screen.findByText("Authenticated as current@example.com");

    fetch.mockResolvedValueOnce(response(204));
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Logout" }));
    await screen.findByRole("heading", { name: "Sign in" });

    oldLogin.resolve(
      response(200, success({ user: { id: "stale", email: "stale@example.com" } })),
    );
    await act(async () => oldLogin.promise);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText("stale@example.com")).toBeNull();
  });

  it("does not publish a late restore result after unmount", async () => {
    const restore = deferred();
    fetch.mockReturnValueOnce(restore.promise);
    const view = render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    view.unmount();

    restore.resolve(
      response(200, success({ user: { id: "late", email: "late@example.com" } })),
    );
    await act(async () => restore.promise);

    await waitFor(() => expect(view.container.childElementCount).toBe(0));
  });

  it("finishes confirmed logout cleanup without updating an unmounted provider", async () => {
    const user = await renderAuthenticated();
    localStorage.setItem("active_location_id", "location-a");
    const logoutResponse = deferred();
    fetch.mockReturnValueOnce(logoutResponse.promise);

    await user.click(screen.getByRole("button", { name: "Start logout for unmount" }));
    cleanup();
    logoutResponse.resolve(response(204));

    await expect(window.__logoutForTest).resolves.toBe(true);
    expect(localStorage.getItem("active_location_id")).toBeNull();
  });
});

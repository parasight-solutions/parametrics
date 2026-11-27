// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/reviews"}

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Reviews from "./Reviews";
import { api } from "../apiClient";

vi.mock("../apiClient", () => ({ api: vi.fn() }));
vi.mock("../session", () => ({ getActiveLocationId: () => "location-1" }));
vi.mock("../components/AppShell", () => ({
  default: ({ actions, children, title }) => <main><h1>{title}</h1>{actions}{children}</main>,
}));
vi.mock("../components/ActiveLocationPicker", () => ({
  default: ({ value, onChange }) => (
    <select aria-label="Active Location" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">No location</option>
      <option value="location-1">Location 1</option>
      <option value="location-2">Location 2</option>
    </select>
  ),
}));

const review = (id, reply = null) => ({
  id,
  reviewer: { displayName: `Reviewer ${id}` },
  comment: `Comment ${id}`,
  starRating: "FIVE",
  updateTime: "2026-11-25T10:00:00Z",
  reviewReply: reply == null ? null : { comment: reply },
});

const result = ({
  reviews = [review("1")],
  page = 1,
  perPage = 10,
  total = reviews.length,
  totalPages = total ? Math.ceil(total / perPage) : 0,
  counts = { total: 7, replied: 3, unreplied: 4 },
  sync = { last_synced_at: "2026-11-25T09:00:00Z" },
} = {}) => ({
  success: true,
  statusCode: 200,
  message: "Reviews fetched successfully",
  data: { reviews, pagination: { page, perPage, total, totalPages }, counts, sync },
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function mount(entry = "/reviews") {
  return render(<MemoryRouter initialEntries={[entry]}><Reviews /></MemoryRouter>);
}

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue(result());
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("legacy Reviews server state", () => {
  it("loads URL filters from the standardized paginated endpoint", async () => {
    api.mockResolvedValueOnce(result({
      reviews: [review("2", "Thank you")],
      page: 2,
      perPage: 20,
      total: 25,
      totalPages: 2,
    }));

    mount("/reviews?status=replied&keyword=Caf%C3%A9&page=2&perPage=20");

    await screen.findByText("Reviewer 2");
    expect(api).toHaveBeenCalledWith(
      "/reviews?locationId=location-1&status=replied&keyword=Caf%C3%A9&page=2&perPage=20",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByText(/7 total/)).toBeTruthy();
    expect(screen.getByText(/Unreplied: 4/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replied" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });

  it("consumes only numeric review ratings from the API contract", async () => {
    api.mockResolvedValueOnce(result({ reviews: [{ ...review("numeric"), starRating: 5 }] }));
    mount();
    expect(await screen.findByLabelText("Rating 5/5")).toBeTruthy();

    cleanup();
    api.mockResolvedValueOnce(result({ reviews: [{ ...review("legacy"), starRating: "FIVE" }] }));
    mount();
    expect(await screen.findByLabelText("Rating -")).toBeTruthy();
  });

  it("debounces keyword requests and resets the page", async () => {
    vi.useFakeTimers();
    mount("/reviews?page=3");
    await act(async () => Promise.resolve());
    expect(api).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText("Search reviewer / keyword…"), {
      target: { value: "Ada + Co" },
    });
    await act(async () => vi.advanceTimersByTime(349));
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));

    expect(api).toHaveBeenLastCalledWith(
      "/reviews?locationId=location-1&status=all&keyword=Ada+%2B+Co&page=1&perPage=10",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses authoritative pagination and page-size controls", async () => {
    api.mockResolvedValueOnce(result({ total: 21, totalPages: 3 }));
    mount();
    await screen.findByText("Reviewer 1");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith(
      expect.stringContaining("page=2&perPage=10"),
      expect.any(Object),
    ));

    fireEvent.change(screen.getByLabelText("Reviews per page"), { target: { value: "50" } });
    await waitFor(() => expect(api).toHaveBeenLastCalledWith(
      expect.stringContaining("page=1&perPage=50"),
      expect.any(Object),
    ));
  });

  it("does not let an older location response replace the current location", async () => {
    const oldRequest = deferred();
    api.mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(result({ reviews: [review("new")] }));
    mount();

    fireEvent.change(screen.getByLabelText("Active Location"), { target: { value: "location-2" } });
    await screen.findByText("Reviewer new");
    oldRequest.resolve(result({ reviews: [review("old")] }));
    await act(async () => oldRequest.promise);

    expect(screen.queryByText("Reviewer old")).toBeNull();
    expect(screen.getByText("Reviewer new")).toBeTruthy();
  });

  it("shows meaningful backend errors and keeps the active filters", async () => {
    api.mockRejectedValueOnce({ message: "Google reviews are temporarily unavailable" });
    mount("/reviews?status=unreplied&keyword=slow");

    expect((await screen.findByRole("alert")).textContent).toContain("Google reviews are temporarily unavailable");
    expect(screen.getByRole("button", { name: "Unreplied" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByDisplayValue("slow")).toBeTruthy();
  });

  it("queues synchronization, reports it, and refreshes metadata once", async () => {
    api.mockResolvedValueOnce(result())
      .mockResolvedValueOnce({ success: true, statusCode: 200, message: "Review synchronization queued", data: { queued: true } })
      .mockResolvedValueOnce(result({ sync: { status: "queued", last_synced_at: null } }));
    mount();
    await screen.findByText("Reviewer 1");

    fireEvent.click(screen.getByRole("button", { name: "Sync from Google" }));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Review synchronization queued");
    expect(api).toHaveBeenNthCalledWith(2, "/reviews/sync", {
      method: "POST",
      body: { locationId: "location-1" },
    });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
  });

  it("keeps the review visible and reports a failed provider reply", async () => {
    api.mockResolvedValueOnce(result())
      .mockRejectedValueOnce({ errors: [{ message: "Google rejected this reply" }] });
    mount();
    await screen.findByText("Reviewer 1");
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Thank you" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Reply" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Google rejected this reply");
    expect(screen.getByText("Reviewer 1")).toBeTruthy();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("recovers to the last valid page after a reply removes its final row", async () => {
    api.mockResolvedValueOnce(result({ reviews: [review("last")], page: 2, total: 1, totalPages: 2 }))
      .mockResolvedValueOnce({ success: true, statusCode: 200, message: "Review reply updated", data: { ok: true } })
      .mockResolvedValueOnce(result({ reviews: [], page: 2, total: 0, totalPages: 1 }))
      .mockResolvedValueOnce(result({ reviews: [review("first")], page: 1, total: 1, totalPages: 1 }));
    mount("/reviews?status=unreplied&page=2");
    await screen.findByText("Reviewer last");
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Resolved" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Reply" }));

    await screen.findByText("Reviewer first");
    expect(api).toHaveBeenLastCalledWith(
      expect.stringContaining("status=unreplied&keyword=&page=1&perPage=10"),
      expect.any(Object),
    );
  });

  it("does not let a late sync for the previous location replace the current location", async () => {
    const oldSync = deferred();
    api.mockResolvedValueOnce(result({ reviews: [review("old-initial")] }))
      .mockReturnValueOnce(oldSync.promise)
      .mockResolvedValueOnce(result({ reviews: [review("current")] }))
      .mockResolvedValueOnce(result({ reviews: [review("old-late")] }));
    mount();
    await screen.findByText("Reviewer old-initial");
    fireEvent.click(screen.getByRole("button", { name: "Sync from Google" }));
    fireEvent.change(screen.getByLabelText("Active Location"), { target: { value: "location-2" } });
    await screen.findByText("Reviewer current");

    oldSync.resolve({ success: true, statusCode: 200, message: "queued", data: { queued: true } });
    await act(async () => oldSync.promise);

    expect(screen.queryByText("Reviewer old-late")).toBeNull();
    expect(screen.getByText("Reviewer current")).toBeTruthy();
  });

  it("clears old rows and metadata immediately when the location is cleared", async () => {
    mount();
    await screen.findByText("Reviewer 1");

    fireEvent.change(screen.getByLabelText("Active Location"), { target: { value: "" } });

    expect(screen.queryByText("Reviewer 1")).toBeNull();
    expect(screen.getByText("Pick a location to load reviews.")).toBeTruthy();
    expect(screen.getByText(/Unreplied: 0/)).toBeTruthy();
  });
});

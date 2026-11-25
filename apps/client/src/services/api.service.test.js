import axios from "axios";
import { describe, expect, it, vi } from "vitest";

import { handleResponse, handleResponseError } from "./api.service";

const successEnvelope = {
  statusCode: 200,
  data: { posts: [] },
  message: "Posts loaded",
  success: true,
};

describe("Axios response boundary", () => {
  it("returns the standard envelope for JSON responses", () => {
    expect(handleResponse({ data: successEnvelope, config: {} })).toBe(successEnvelope);
  });

  it.each(["blob", "arraybuffer"])("preserves the Axios response for explicit %s requests", (responseType) => {
    const response = { data: new Uint8Array([1, 2]), headers: { "content-type": "application/pdf" }, config: { responseType } };
    expect(handleResponse(response)).toBe(response);
  });

  it("does not infer binary behavior from content type alone", () => {
    const response = { data: successEnvelope, headers: { "content-type": "application/octet-stream" }, config: {} };
    expect(handleResponse(response)).toBe(successEnvelope);
  });

  it("rejects the standardized backend envelope for HTTP errors", async () => {
    const envelope = { statusCode: 422, message: "Validation failed", success: false, errors: [{ code: "bad_request", message: "Validation failed" }] };
    await expect(handleResponseError({ response: { status: 422, data: envelope }, config: {} }, vi.fn())).rejects.toBe(envelope);
  });

  it.each(["blob", "arraybuffer"])(
    "decodes JSON error envelopes for explicit %s requests before auth detection",
    async (responseType) => {
      const envelope = {
        statusCode: 401,
        message: "Unauthorized",
        success: false,
        errors: [{ code: "unauthorized", message: "Unauthorized" }],
      };
      const text = JSON.stringify(envelope);
      const data = responseType === "blob"
        ? new Blob([text], { type: "application/json" })
        : new TextEncoder().encode(text).buffer;
      const dispatch = vi.fn();

      await expect(
        handleResponseError({
          response: {
            status: 401,
            data,
            headers: { "content-type": "application/json" },
          },
          config: { responseType, url: "/reports/download" },
        }, dispatch),
      ).rejects.toEqual(envelope);
      expect(dispatch).toHaveBeenCalledOnce();
    },
  );

  it("rejects a status-zero client envelope for network failures", async () => {
    await expect(handleResponseError({ request: {}, config: {} }, vi.fn())).rejects.toEqual({
      statusCode: 0,
      success: false,
      message: "Unable to reach the server",
      errors: [{ code: "network_error", message: "Unable to reach the server" }],
    });
  });

  it("preserves cancellation errors", async () => {
    const cancellation = new axios.CanceledError("cancelled");
    await expect(handleResponseError(cancellation, vi.fn())).rejects.toBe(cancellation);
  });
});

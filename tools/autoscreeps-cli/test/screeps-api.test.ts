import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreepsApiClient } from "../src/lib/screeps-api.ts";

describe("ScreepsApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-authenticates when an auth token expires before a later request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401, statusText: "Unauthorized" }))
      .mockResolvedValueOnce(new Response('{"token":"fresh-token"}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('{"status":"normal"}', {
          status: 200,
          headers: { "X-Token": "rotated-token" }
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const api = new ScreepsApiClient("http://127.0.0.1:21025");
    const session = {
      username: "baseline",
      password: "secret",
      token: "expired-token"
    };

    await expect(api.getWorldStatus(session)).resolves.toEqual({ status: "normal" });
    expect(session.token).toBe("rotated-token");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstRequest = fetchMock.mock.calls[0]?.[0] as Request;
    const secondRequest = fetchMock.mock.calls[1]?.[0] as Request;
    const thirdRequest = fetchMock.mock.calls[2]?.[0] as Request;

    expect(firstRequest.url).toBe("http://127.0.0.1:21025/api/user/world-status");
    expect(firstRequest.headers.get("X-Username")).toBe("baseline");
    expect(firstRequest.headers.get("X-Token")).toBe("expired-token");

    expect(secondRequest.url).toBe("http://127.0.0.1:21025/api/auth/signin");
    expect(secondRequest.method).toBe("POST");

    expect(thirdRequest.url).toBe("http://127.0.0.1:21025/api/user/world-status");
    expect(thirdRequest.headers.get("X-Token")).toBe("fresh-token");
  });
});

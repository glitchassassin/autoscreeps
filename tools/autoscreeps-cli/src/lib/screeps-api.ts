import type { AuthSession, RoomSummary, UserBadge, UserWorldStatus } from "./contracts.ts";

type RegisterPayload = {
  username: string;
  password: string;
  modules: Record<string, string>;
};

type RoomObjectsResponse = {
  objects: Array<{
    type: string;
    user?: string;
  }>;
  users: Record<string, { username: string }>;
};

export class ScreepsApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async waitForReady(timeoutMs = 120000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const response = await fetch(new URL("/api/version", this.baseUrl));
        if (response.ok) {
          return;
        }
      } catch {
        // Keep retrying until the timeout expires.
      }

      await delay(1000);
    }

    throw new Error(`Timed out waiting for ${this.baseUrl} to become ready.`);
  }

  async registerUser(payload: RegisterPayload): Promise<void> {
    await this.requestJson("/api/register/submit", {
      method: "POST",
      body: JSON.stringify({
        username: payload.username,
        email: "",
        password: payload.password,
        modules: payload.modules
      })
    });
  }

  async signIn(username: string, password: string): Promise<AuthSession> {
    const response = await this.requestJson<{ token?: string }>("/api/auth/signin", {
      method: "POST",
      body: JSON.stringify({
        email: username,
        password
      })
    });

    if (!response.token) {
      throw new Error(`Sign-in for '${username}' did not return a token.`);
    }

    return {
      username,
      password,
      token: response.token
    };
  }

  async placeAutoSpawn(session: AuthSession, room: string): Promise<void> {
    await this.requestAuthedJson(session, "/api/game/place-spawn", {
      method: "POST",
      body: JSON.stringify({
        room,
        name: "auto"
      })
    });
  }

  async setBadge(session: AuthSession, badge: UserBadge): Promise<void> {
    await this.requestAuthedJson(session, "/api/user/badge", {
      method: "POST",
      body: JSON.stringify({ badge })
    });
  }

  async getWorldStatus(session: AuthSession): Promise<UserWorldStatus> {
    return await this.requestAuthedJson<UserWorldStatus>(session, "/api/user/world-status");
  }

  async summarizeRoom(room: string): Promise<RoomSummary> {
    const response = await this.requestJson<RoomObjectsResponse>(`/api/game/room-objects?room=${encodeURIComponent(room)}`);
    const typeCounts: Record<string, number> = {};
    const owners: Record<string, number> = {};
    const controllerOwners = new Set<string>();
    const spawnOwners = new Set<string>();

    for (const object of response.objects) {
      typeCounts[object.type] = (typeCounts[object.type] ?? 0) + 1;

      if (!object.user) {
        continue;
      }

      const username = response.users[object.user]?.username ?? object.user;
      owners[username] = (owners[username] ?? 0) + 1;

      if (object.type === "controller") {
        controllerOwners.add(username);
      }
      if (object.type === "spawn") {
        spawnOwners.add(username);
      }
    }

    return {
      room,
      totalObjects: response.objects.length,
      typeCounts,
      owners,
      controllerOwners: Array.from(controllerOwners).sort(),
      spawnOwners: Array.from(spawnOwners).sort()
    };
  }

  private async requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await this.sendRequest(pathname, init);
    return this.readJsonResponse<T>(response, pathname);
  }

  private async requestAuthedJson<T>(session: AuthSession, pathname: string, init?: RequestInit): Promise<T> {
    let response = await this.sendRequest(pathname, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        "X-Username": session.username,
        "X-Token": session.token
      }
    });

    if (response.status === 401) {
      const refreshedSession = await this.signIn(session.username, session.password);
      session.token = refreshedSession.token;
      response = await this.sendRequest(pathname, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          "X-Username": session.username,
          "X-Token": session.token
        }
      });
    }

    const rotatedToken = response.headers.get("x-token");
    if (rotatedToken) {
      session.token = rotatedToken;
    }

    return this.readJsonResponse<T>(response, pathname);
  }

  private async sendRequest(pathname: string, init?: RequestInit): Promise<Response> {
    const headers = {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    };
    const request = new Request(new URL(pathname, this.baseUrl), {
      ...init,
      headers
    });

    return await fetch(request);
  }

  private async readJsonResponse<T>(response: Response, pathname: string): Promise<T> {
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${pathname}: ${body}`.trim());
    }

    if (!body) {
      return {} as T;
    }

    const parsed = JSON.parse(body) as { error?: string } & T;
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed as T;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

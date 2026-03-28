import { readFile } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

type ScreepsTarget = {
  host: string;
  username: string;
  password: string;
  branch: string;
  active?: boolean;
};

type BranchResponse = {
  list: Array<{
    branch: string;
  }>;
};

const defaultBuildModes = new Set(["development", "production", "test"]);

export function loadDeploymentTarget(rootDir: string, mode: string): ScreepsTarget | null {
  const configPath = path.join(rootDir, "screeps.json");
  let rawConfig: string;

  try {
    rawConfig = readFileSync(configPath, "utf8");
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === "ENOENT" && defaultBuildModes.has(mode)) {
      return null;
    }
    if (fileError.code === "ENOENT") {
      throw new Error(`Missing screeps.json for '${mode}' uploads. Copy screeps.sample.json to screeps.json first.`);
    }
    throw error;
  }

  const targets = JSON.parse(rawConfig) as Record<string, ScreepsTarget>;
  const target = targets[mode];

  if (!target) {
    if (defaultBuildModes.has(mode)) {
      return null;
    }
    throw new Error(`No deployment target named '${mode}' was found in screeps.json.`);
  }

  if (!target.host || !target.username || !target.password || !target.branch) {
    throw new Error(`Deployment target '${mode}' is missing one of: host, username, password, branch.`);
  }

  return {
    ...target,
    host: target.host.replace(/\/+$/, ""),
    active: target.active !== false
  };
}

export function resolveBundlePath(distDir: string): string {
  const preferredPaths = [
    path.join(distDir, "main.js"),
    path.join(distDir, "main"),
    path.join(distDir, "main.cjs")
  ];

  for (const preferredPath of preferredPaths) {
    try {
      readFileSync(preferredPath, "utf8");
      return preferredPath;
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const candidates = readdirSync(distDir);
  const bundleName =
    candidates.find((entry) => entry === "main.cjs") ??
    candidates.find((entry) => entry === "main") ??
    candidates.find((entry) => entry.startsWith("main.") && entry.endsWith(".js"));

  if (!bundleName) {
    throw new Error(`Could not find a built Screeps bundle in ${distDir}.`);
  }

  return path.join(distDir, bundleName);
}

export async function uploadBundle(bundlePath: string, target: ScreepsTarget): Promise<void> {
  const bundle = await readFile(bundlePath, "utf8");
  const token = await signIn(target);

  await ensureBranchExists(target, token);
  await requestJson(`${target.host}/api/user/code`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      branch: target.branch,
      modules: {
        main: bundle
      }
    })
  }, "upload code");

  if (target.active) {
    await requestJson(`${target.host}/api/user/set-active-branch`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        activeName: "activeWorld",
        branch: target.branch
      })
    }, "set active branch");
  }

  console.log(`[screeps] Uploaded ${path.basename(bundlePath)} to ${target.host} branch '${target.branch}'.`);
}

async function signIn(target: ScreepsTarget): Promise<string> {
  const response = await requestJson<{ token?: string }>(`${target.host}/api/auth/signin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: target.username,
      password: target.password
    })
  }, "sign in");

  if (!response.token) {
    throw new Error("Screeps sign-in did not return an auth token.");
  }

  return response.token;
}

async function ensureBranchExists(target: ScreepsTarget, token: string): Promise<void> {
  const branches = await requestJson<BranchResponse>(`${target.host}/api/user/branches`, {
    method: "GET",
    headers: {
      "X-Token": token
    }
  }, "list branches");

  const hasBranch = branches.list.some((branch) => branch.branch === target.branch);
  if (hasBranch) {
    return;
  }

  await requestJson(`${target.host}/api/user/clone-branch`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      newName: target.branch
    })
  }, "create branch");
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Token": token
  };
}

async function requestJson<T>(url: string, init: RequestInit, action: string): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to ${action}: ${response.status} ${response.statusText} ${body}`.trim());
  }

  if (!body) {
    return {} as T;
  }

  return JSON.parse(body) as T;
}

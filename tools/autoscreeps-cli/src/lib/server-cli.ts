import { execa } from "execa";

type CliOptions = {
  repoRoot: string;
  host: string;
  port: number;
};

type CliEnvelope<T> = {
  ok: boolean;
  value?: T;
  error?: string;
};

const cliProbeScript = [
  "const net = require('net');",
  "const vm = require('vm');",
  "const host = process.env.AUTO_CLI_HOST || '127.0.0.1';",
  "const port = parseInt(process.env.AUTO_CLI_PORT || '21026', 10);",
  "const command = process.env.AUTO_CLI_COMMAND;",
  "const socket = net.createConnection({ host: host, port: port });",
  "socket.setEncoding('utf8');",
  "let greeted = false;",
  "let buffer = '';",
  "const timeout = setTimeout(function () { console.error('Timed out waiting for Screeps CLI response'); process.exit(1); }, 10000);",
  "socket.on('data', function (chunk) {",
  "  if (!greeted) {",
  "    greeted = true;",
  "    buffer = '';",
  "    socket.write(command + '\\n', 'utf8');",
  "    return;",
  "  }",
  "  buffer += chunk;",
  "  const parts = buffer.split(/\\r?\\n/);",
  "  buffer = parts.pop() || '';",
  "  for (const line of parts) {",
  "    if (line.slice(0, 2) !== '< ') {",
  "      continue;",
  "    }",
  "    const literal = line.slice(2).trim();",
  "    if (!literal) {",
  "      continue;",
  "    }",
  "    try {",
  "      const value = vm.runInNewContext(literal);",
  "      clearTimeout(timeout);",
  "      process.stdout.write(value);",
  "      socket.end();",
  "      return;",
  "    } catch (error) {",
  "      clearTimeout(timeout);",
  "      console.error(error && (error.stack || String(error)));",
  "      process.exit(1);",
  "    }",
  "  }",
  "});",
  "socket.on('error', function (error) { clearTimeout(timeout); console.error(error && (error.stack || String(error))); process.exit(1); });",
  "socket.on('end', function () { if (!greeted) { clearTimeout(timeout); console.error('Screeps CLI closed before sending the greeting'); process.exit(1); } });"
].join(" ");

export class ScreepsServerCli {
  private readonly options: CliOptions;

  constructor(options: CliOptions) {
    this.options = options;
  }

  async waitForReady(timeoutMs = 120000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        await this.evaluate("'ready'");
        return;
      } catch {
        await delay(1000);
      }
    }

    throw new Error(`Timed out waiting for the Screeps CLI at ${this.options.host}:${this.options.port}.`);
  }

  async pauseSimulation(): Promise<void> {
    await this.evaluate("system.pauseSimulation()");
  }

  async resumeSimulation(): Promise<void> {
    await this.evaluate("system.resumeSimulation()");
  }

  async setTickDuration(tickDuration: number): Promise<void> {
    await this.evaluate(`system.setTickDuration(${tickDuration})`);
  }

  async importMap(mapId: string): Promise<void> {
    await this.evaluate(`utils.importMap(${JSON.stringify(mapId)})`);
  }

  async importMapFile(filePath: string): Promise<void> {
    await this.evaluate(`utils.importMapFile(${JSON.stringify(filePath)})`);
  }

  async setUserBanned(username: string, banned: boolean): Promise<void> {
    const serializedUsername = JSON.stringify(username);
    const serializedBanned = JSON.stringify(banned);
    const expression = `storage.db.users.findOne({ username: ${serializedUsername} }).then(function (user) { if (!user) { throw new Error("User not found: " + ${serializedUsername}); } return storage.db.users.update({ _id: user._id }, { $set: { banned: ${serializedBanned}, active: ${serializedBanned} ? 0 : user.active } }); })`;

    await this.evaluate(expression);
  }

  async setSpawnWhitelist(usernames: string[]): Promise<void> {
    const normalizedUsernames = usernames.map((username) => username.toLowerCase());
    const serializedUsernames = JSON.stringify(normalizedUsernames);
    const expression = `Promise.resolve().then(function () { var whitelist = ${serializedUsernames}; return storage.env.set(storage.env.keys.WHITELIST, JSON.stringify(whitelist)).then(function () { return storage.db.users.find().then(function (users) { return Promise.all(users.map(function (user) { var blocked = !(user.allowed || !user.banned || whitelist.length === 0 || (user.username && whitelist.indexOf(user.username.toLowerCase()) !== -1)); return storage.db.users.update({ _id: user._id }, { $set: { blocked: blocked } }); })); }); }); })`;

    await this.evaluate(expression);
  }

  async getGameTime(): Promise<number> {
    const value = await this.evaluate<string>("storage.env.get(storage.env.keys.GAMETIME)");
    const gameTime = Number(value);
    if (!Number.isFinite(gameTime)) {
      throw new Error(`Expected a numeric game time, received '${value}'.`);
    }
    return gameTime;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const command = `Promise.resolve().then(() => (${expression})).then((value) => JSON.stringify({ ok: true, value })).catch((error) => JSON.stringify({ ok: false, error: String(error && (error.stack || error)) }))`;

    const { stdout } = await execa(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "-e",
        `AUTO_CLI_HOST=${this.options.host}`,
        "-e",
        `AUTO_CLI_PORT=${this.options.port}`,
        "-e",
        `AUTO_CLI_COMMAND=${command}`,
        "screeps",
        "node",
        "-e",
        cliProbeScript
      ],
      {
        cwd: this.options.repoRoot,
        stdio: "pipe"
      }
    );

    const envelope = JSON.parse(stdout) as CliEnvelope<T>;
    if (!envelope.ok) {
      throw new Error(envelope.error ?? `CLI evaluation failed for ${expression}`);
    }

    return envelope.value as T;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

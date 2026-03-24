import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { Command } from "commander";
import { startWSClient } from "./ws-client.js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

function getServerUrl(): string {
  const root = resolve(process.cwd(), ".server-port");
  if (existsSync(root)) {
    try {
      const { port } = JSON.parse(readFileSync(root, "utf8")) as { port?: number };
      if (typeof port === "number") return `http://localhost:${port}`;
    } catch {
      // ignored
    }
  }
  return process.env.AGENT_SERVER_URL ?? "http://localhost:3000";
}

const program = new Command();

program
  .name("coding-agent")
  .description("Headless coding agent daemon")
  .option(
    "--server-url <url>",
    "Server URL to connect to",
    getServerUrl()
  )
  .option(
    "--working-dir <dir>",
    "Working directory for the agent",
    process.cwd()
  )
  .action(async (options) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("Error: ANTHROPIC_API_KEY environment variable is required");
      process.exit(1);
    }

    console.log(`Coding Agent starting...`);
    console.log(`  Server URL: ${options.serverUrl}`);
    console.log(`  Working Dir: ${options.workingDir}`);

    startWSClient({
      serverUrl: options.serverUrl,
      workingDir: options.workingDir,
      apiKey,
    });
  });

program.parse();

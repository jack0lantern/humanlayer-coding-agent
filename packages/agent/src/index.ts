import { Command } from "commander";
import { startWSClient } from "./ws-client.js";

const program = new Command();

program
  .name("coding-agent")
  .description("Headless coding agent daemon")
  .option(
    "--server-url <url>",
    "Server URL to connect to",
    process.env.AGENT_SERVER_URL || "http://localhost:3000"
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

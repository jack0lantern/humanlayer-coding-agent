import Anthropic from "@anthropic-ai/sdk";

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Read the contents of a file at the given path. Returns the file content as a string.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The absolute or relative file path to read",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write content to a file at the given path. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories as needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "The file path to write to",
        },
        content: {
          type: "string",
          description: "The content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "execute_command",
    description:
      "Execute a shell command and return its stdout and stderr. Use this for running programs, installing packages, git operations, etc.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 30000)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "list_directory",
    description:
      "List files and directories at the given path. Returns names with a trailing / for directories.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "The directory path to list (default: current working directory)",
        },
      },
      required: [],
    },
  },
];

# Project Brief: Coding Agent

## Overview

A **sync-based headless coding agent** with a real-time web interface. The system lets users submit prompts and watch an AI agent execute coding tasks live—reading files, writing code, running commands—with full streaming visibility.

## Core Requirements

- **Three components**: Server (API + persistence), headless agent daemon (LLM + tools), web UI (session management + live stream)
- **Real-time streaming**: Every LLM token, tool call, and result streams to the UI as discrete events
- **Outbound agent connection**: The agent initiates WebSocket to the server, enabling deployment in private networks or sandboxes without inbound ports
- **No authentication**: Single-user local development; auth is a documented future item

## Goals

1. Provide a reliable, observable coding agent experience
2. Persist all events for replay and debugging
3. Support golden-path evaluation of agent behavior
4. Run via Docker Compose or local dev

## Scope

- **In scope**: Session CRUD, agent assignment, event streaming, four tools (read_file, write_file, execute_command, list_directory), web UI
- **Out of scope (future)**: Multi-session concurrency, auth, human-in-the-loop approval gates, session resume

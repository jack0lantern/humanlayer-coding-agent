-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('online', 'offline');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('pending', 'running', 'completed', 'stopped', 'failed', 'waiting_for_user');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('thinking', 'text', 'tool_call', 'tool_result', 'error', 'session_complete', 'user_message');

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "status" "AgentStatus" NOT NULL DEFAULT 'offline',
    "working_dir" TEXT,
    "connected_at" TIMESTAMP(3),
    "last_heartbeat" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT,
    "prompt" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE INDEX "events_session_id_sequence_idx" ON "events"("session_id", "sequence");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

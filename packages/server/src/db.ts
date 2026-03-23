import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function ensureConnection() {
  try {
    await prisma.$connect();
    console.log("Database connected");
  } catch (error) {
    console.error("Failed to connect to database:", error);
    process.exit(1);
  }
}

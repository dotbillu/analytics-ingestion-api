import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

const connection = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT!, 10),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

new Worker(
  "analytics-events",
  async (job) => {
    const event = job.data;

    try {
      await prisma.analyticsEvent.create({
        data: {
          siteId: event.site_id,
          eventType: event.event_type,
          path: event.path,
          userId: event.user_id,
          timestamp: new Date(event.timestamp),
        },
      });

      console.log(`Processed event for: ${event.site_id}`);
    } catch (error) {
      console.error("Worker failed to process event", error);
    }
  },
  { connection },
);

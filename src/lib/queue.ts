import { Queue } from "bullmq";
import { Redis } from "ioredis";  
import "dotenv/config";

const connection = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT!, 10),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,  
});

export const eventsQueue = new Queue("analytics-events", { connection });


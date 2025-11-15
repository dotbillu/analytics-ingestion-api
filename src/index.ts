import express from "express";
import cors from "cors";
import "dotenv/config";
import { eventsQueue } from "@lib/queue";
import { prisma } from "@lib/prisma";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.post("/event", async (req, res) => {
  const event = req.body;

  if (!event.site_id || !event.event_type) {
    return res.status(400).json({ message: "site_id and event_type are required" });
  }

  await eventsQueue.add("process-event", event);
  return res.status(202).json({ message: "Event accepted" });
});

app.get("/stats", async (req, res) => {
  const { site_id, date } = req.query;

  if (!site_id || !date || typeof site_id !== "string" || typeof date !== "string") {
    return res.status(400).json({ message: "site_id and date are required" });
  }

  const dateStart = new Date(date + "T00:00:00.000Z");
  const dateEnd = new Date(date + "T23:59:59.999Z");

  const whereClause = {
    siteId: site_id,
    eventType: "page_view",
    timestamp: { gte: dateStart, lte: dateEnd },
  };

  try {
    const [totalViews, uniqueUserGroups, topPathsResult] = await Promise.all([
      prisma.analyticsEvent.count({ where: whereClause }),
      prisma.analyticsEvent.groupBy({
        by: ["userId"],
        where: whereClause,
      }),
      prisma.analyticsEvent.groupBy({
        by: ["path"],
        where: whereClause,
        _count: { path: true },
        orderBy: { _count: { path: "desc" } },
        take: 3,
      }),
    ]);

    const response = {
      site_id,
      date,
      total_views: totalViews,
      unique_users: uniqueUserGroups.length,
      top_paths: topPathsResult.map((item) => ({
        path: item.path,
        views: item._count!.path,
      })),
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error("server err");
    return res.status(500).json({ message: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`server up on http://localhost:${PORT}`);
});


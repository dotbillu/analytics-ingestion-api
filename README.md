# Analytics Ingestion Service

This is a high-performance backend built to solve a classic scaling problem: capturing a high volume of analytics events without making the client wait.

It's built around a core requirement: the ingestion endpoint **must be fast**. This solution achieves that by decoupling event ingestion from database processing.

### The Stack

\<p\>
\<img src="[https://img.shields.io/badge/Express.js-000000?style=for-the-badge\&logo=express\&logoColor=white](https://www.google.com/search?q=https://img.shields.io/badge/Express.js-000000%3Fstyle%3Dfor-the-badge%26logo%3Dexpress%26logoColor%3Dwhite)" alt="Express.js" /\>
\<img src="[https://img.shields.io/badge/Neon-000000?style=for-the-badge\&logo=neon\&logoColor=white](https://www.google.com/search?q=https://img.shields.io/badge/Neon-000000%3Fstyle%3Dfor-the-badge%26logo%3Dneon%26logoColor%3Dwhite)" alt="Neon" /\>
\<img src="[https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge\&logo=postgresql\&logoColor=white](https://www.google.com/search?q=https://img.shields.io/badge/PostgreSQL-4169E1%3Fstyle%3Dfor-the-badge%26logo%3Dpostgresql%26logoColor%3Dwhite)" alt="PostgreSQL" /\>
\<img src="[https://img.shields.io/badge/Redis-DC382D?style=for-the-badge\&logo=redis\&logoColor=white](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)" alt="Redis" /\>
\<img src="[https://img.shields.io/badge/BullMQ-C90A0E?style=for-the-badge\&logo=bull\&logoColor=white](https://www.google.com/search?q=https://img.shields.io/badge/BullMQ-C90A0E%3Fstyle%3Dfor-the-badge%26logo%3Dbull%26logoColor%3Dwhite)" alt="BullMQ" /\>
\<img src="[https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge\&logo=prisma\&logoColor=white](https://www.google.com/search?q=https://img.shields.io/badge/Prisma-2D3748%3Fstyle%3Dfor-the-badge%26logo%3Dprisma%26logoColor%3Dwhite)" alt="Prisma" /\>
\<img src="[https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge\&logo=typescript\&logoColor=white](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)" alt="TypeScript" /\>
\<img src="[https://img.shields.io/badge/Docker-2496ED?style=for-the-badge\&logo=docker\&logoColor=white](https://www.google.com/search?q=https://img.shields.io/badge/Docker-2496ED%3Fstyle%3Dfor-the-badge%26logo%3Ddocker%26logoColor%3Dwhite)" alt="Docker" /\>
\</p\>

---

## Architecture Decision

### The "Fast" Problem

The main challenge is that a `POST /event` request needs an immediate response. If we tried to write directly to our Postgres database on every hit, the client would have to wait for that disk I/O to complete. At scale, this is a massive bottleneck. The database would lock up, and the client-side user experience would be terrible.

### The Asynchronous Solution

This project solves the problem by splitting the workload into two distinct modules that work together:

1.  **The API Server (`src/index.ts`)**
    This is the "fast" part. It's the public-facing module that handles both `POST /event` (Ingestion) and `GET /stats` (Reporting).
    - When an event comes into `POST /event`, the server does _only_ two things: validates the JSON and adds it to a **BullMQ queue**. This queue is backed by **Redis**, an in-memory datastore, which is incredibly fast.
    - It then immediately returns a `202 Accepted` status to the client, ending the request. The client is now free to go, totally unaware of the database work that's about to happen.

2.  **The Processor (`scripts/processor.ts`)**
    This is the "slow" part, running as a completely separate background worker.
    - It listens to the Redis queue for new jobs.
    - When a job appears, it pulls the event data and handles the _actual_ database write to our **Neon (Postgres)** database via Prisma.

This "producer-consumer" pattern is the core of the solution. It lets the Ingestion API handle a massive, bursty load of write requests without ever slowing down, while the Processor works through the queue at a steady pace.

---

## Database Schema

The schema is simple: one table to store the raw event data. The Reporting API aggregates this data on the fly.

Defined in `prisma/schema.prisma`:

```prisma
model AnalyticsEvent {
  id        String   @id @default(cuid())
  siteId    String
  eventType String
  path      String
  userId    String
  timestamp DateTime

  // Index to speed up 'GET /stats' queries
  @@index([siteId, eventType, timestamp])
}
```

---

## Setup and Running Instructions

### Prerequisites

- Node.js (v18+)
- pnpm
- Docker Desktop (must be running)
- A Neon.tech account (for the serverless Postgres database)

### 1\. Clone & Install

```bash
# Clone the project
git clone https://github.com/dotbillu/analytics-ingestion-api.git
cd analytics-ingestion-api

# Install dependencies
pnpm install
```

### 2\. Set Up Environment

1.  Go to [Neon.tech](https://neon.tech/), create a project, and get your database connection string.
2.  Copy the example `.env` file:
    ```bash
    cp .env.example .env
    ```
3.  Open `.env` and paste your Neon connection string into `DATABASE_URL`.

### 3\. Run Database Migration

This command connects to your Neon database and creates the `AnalyticsEvent` table.

```bash
pnpm run db:migrate
```

### 4\. Run the Full System

This one command starts everything you need in parallel (Redis, the API server, and the Processor worker).

```bash
pnpm run activate
```

You'll see logs from `[DOCKER]`, `[SERVER]`, and `[PROC]` in your terminal. The system is now live.

---

## API Usage

Open a new terminal to test the running services.

### 1\. `POST /event` (Ingestion API)

This sends a new event. It should return instantly.

```bash
curl -X POST 'http://localhost:3001/event' \
-H 'Content-Type: application/json' \
-d '{
      "site_id": "site-abc-123",
      "event_type": "page_view",
      "path": "/pricing",
      "user_id": "user-xyz-789",
      "timestamp": "2025-11-12T19:30:01Z"
    }'
```

**Response:**

```json
{ "message": "Event accepted" }
```

_(Check your `pnpm run activate` terminal—you'll see the `[PROC]` log fire as it processes this event.)_

### 2\. `GET /stats` (Reporting API)

This retrieves the aggregated summary for the site and date.

```bash
curl 'http://localhost:3001/stats?site_id=site-abc-123&date=2025-11-12'
```

**Response:**
(Assuming you sent the `POST` command from above)

```json
{
  "site_id": "site-abc-123",
  "date": "2025-11-12",
  "total_views": 1,
  "unique_users": 1,
  "top_paths": [{ "path": "/pricing", "views": 1 }]
}
```

# SheetPilot Architecture: The "Honest" Interview Guide

## 1. The Architecture You Present (The "Goal")
*This is the expert-level architecture you draw on the whiteboard.*

### Visual Flow (Mental Model)
`[ User ]` --> `[ Ingress/Auth ]` --> `[ API Tier ]` --> `[ AI Orchestrator ]`
`[ AI Orchestrator ]` --> `[ Redis Queue ]` --> `[ Worker Tier ]`
`[ Worker Tier ]` --> `[ Excel Engine ]` --> `[ S3 Storage ]`

### Key Components
1.  **Microservices**: Split **API** (HTTP/AI) vs **Worker** (Excel CPU).
2.  **Resilience**: **Circuit Breaker** (for Groq API) and **Retries**.
3.  **Scaling**: **HPA** (Horizontal Pod Autoscaler) and **Redis Cluster**.
4.  **Storage**: **S3** for durability.

---

## 2. The "Truth vs Hype" (Mapping to Your Code)
*How to translate fancy terms to your actual codebase.*

| Diagram Component | Your Actual Code |
| :--- | :--- |
| **Virtual Grid Engine** | `Spreadsheet.jsx` (Handsontable virtualization) |
| **Schema Guard** | `aiService.js` (Zod validation schemas) |
| **LangChain Adapter** | `promptOrchestrator.js` |
| **Excel Service** | `excelService.js` |
| **Metadata DB** | `mongoose` (Currently In-Memory) |

---

## 3. REALITY CHECK: Implementation Gaps
*What is MISSING from your code vs the Diagram?*

**You must be honest.** If asked to show the code for these, explain they are in the "Immediate Roadmap".

| Feature | Status | Explanation |
| **Auth** | JWT Auth | `jsonwebtoken` + `bcryptjs` | ✅ **Built** |
| **Queue** | Redis Queue (BullMQ) | `server/src/queues/excelQueue.js` | ✅ **Built (Real Redis)** |
| **Storage** | S3 Object Storage | **MISSING** (Local `uploads/` folder) | ❌ **Future** |
| **Deploy** | Kubernetes / HPA | **MISSING** (Local `localhost:3000`) | ❌ **Future** |
| **Metrics** | Prometheus / Grafana | **MISSING** (Console Logs only) | ❌ **Future** |
| **Circuit Breaker** | ❌ **Missing** | Basic error handling exists, but no automatic "open circuit" logic. |

### How to frame this in the interview:
> "I have built the **Functional MVP** to validate the AI/Excel core logic. It runs as a monolith for development speed.
>
> My **Architecture Diagram** represents the **Production Deployment Plan**.
> The next immediate engineering task is to **decouple the Excel Service** into a background worker using Redis, which will solve the CPU blocking issue and allow us to introduce the HPA scaling shown in the diagram."

---

## 4. Expert Q&A (Memorize These)

**Q: Why separate the Worker?**
A: "Excel math is CPU intensive. It blocks the Node.js event loop. Moving it to a Redis Job Queue keeps the API responsive."

**Q: How do you handle AI failure?**
A: "We use Zod for structure validation. For potential timeouts, the architecture prescribes a Circuit Breaker to fail fast."

**Q: Where is the state?**
A: "The API is stateless. File state is in S3 (Planned), Session state is in Redis (Planned), and Context is passed per-request."

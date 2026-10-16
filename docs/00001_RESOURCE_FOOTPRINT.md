# Reducing the `stocks` service CPU and memory footprint

Assessment date: 2026-10-16

## Decision

Do **not** migrate this service to Platformatic or celld as the first optimization.

Between those two, **Platformatic Watt is the only viable candidate** because it supports existing Next.js applications. However, its worker threads target request throughput and isolation; they do not make Puppeteer's Chromium processes cheaper. More workers would create more V8 isolates and could duplicate the schedulers if they were started in every web worker.

**celld is not a fit for this repository.** It is a self-hosted Cloudflare Workers/Durable Objects runtime, not a drop-in Node.js/Next.js process manager. Its Node.js compatibility is partial, Browser Rendering is unsupported, and its container feature is experimental. Running the existing image as a celld-managed container would keep the same Next.js, Node, and Chromium resource usage while adding celld.

The best path to a small footprint is:

1. Prove which child processes use the resources.
2. Stop duplicate and overlapping collectors.
3. Poll less often while preserving an explicit freshness target.
4. Keep Chromium alive only for the short scrape phase.
5. Replace browser scraping with HTTP APIs/feeds, then remove Chromium from the image.
6. Add retention and container limits after measuring the new peak.

## Implementation status

Implemented on 2026-10-16:

- configurable five-minute quote and 15-minute Reddit/Polymarket defaults;
- a shared FIFO slot for scheduled quote and Reddit browser jobs;
- Chromium closes before quote database and LLM processing;
- images, media, and fonts are blocked in both Puppeteer collectors;
- full Yahoo page documents are captured/stored only when analysis is due;
- `RUN_SCHEDULERS_IN_WEB_PROCESS=false` is explicit in `.env.example`;
- Compose uses `init: true` to forward signals and reap descendants.

Deferred until production measurements or an external provider is selected:

- replacing Yahoo/Reddit Puppeteer with supported HTTP sources;
- database retention/downsampling;
- hard CPU/RAM limits;
- Platformatic benchmarking.

## What currently runs inside `stocks`

```text
stocks container
└── node scripts/start.mjs                  supervisor
    ├── node ... next start                 dashboard/API
    └── node workers.ts                     scheduler
        ├── shared browser collector queue
        │   ├── every 300 s: node stock-info.ts → Chrome Headless Shell
        │   └── every 900 s: node reddit-sentiment.ts → Chrome Headless Shell
        └── every 900 s: Polymarket HTTP refresh
```

There are three long-lived Node processes before a collection starts. The shared queue limits scheduled collection to one additional Node process and one Chromium process tree at a time.

The screenshot is consistent with this design: `stocks` owns most of the CPU and has periodic spikes. It does not prove which process is responsible, so the server measurements below should be taken before changing anything.

## Pre-change findings from this repository

The following table records the original causes that motivated the implementation above.

| Confidence | Finding | Resource effect |
| --- | --- | --- |
| High | `lib/stock-info-scheduler.ts` starts `stock-info.ts` every 60 seconds while the US market is open. | Up to 60 Chromium launches per hour. If a pass takes much of a minute, Chromium is resident almost continuously. |
| High | `lib/reddit-sentiment-scheduler.ts` starts immediately and every 300 seconds. `workers.ts` also starts the stock and Polymarket schedulers immediately. | The 60-second and 300-second schedules align every five minutes, allowing quote and Reddit Chromium instances to overlap. |
| High | `stock-info.ts` launches one browser per pass and processes all symbols sequentially. The browser remains open while each symbol performs database and optional LLM/HFT work. | Chromium can sit resident while waiting for non-browser work. HFT analysis is eligible every 20 minutes; general analysis every five hours. |
| High | `reddit-sentiment.ts` launches another browser, initially targets 100 rendered posts, and may scroll up to 50 times. | Periodic CPU, network, and memory bursts. |
| High | Both browser paths close the browser in `finally`. | There is no obvious normal-path browser leak in the source. A leak must be demonstrated from the process list rather than assumed. Abrupt signals can still leave descendants until the container is stopped/reaped. |
| High | `docker-compose.yml` has no CPU, memory, or PID limits. | The container can consume all resources the host permits. Docker containers have no resource constraints by default. |
| High | `RUN_SCHEDULERS_IN_WEB_PROCESS=true` would start all schedulers in Next.js **in addition to** the dedicated `workers.ts` process. | One mistaken environment value doubles collection work in this deployment. Multiple replicas would multiply it again. |
| Conditional | Compose forces `platform: linux/amd64`. | On an ARM64 server this requires emulation and can materially increase CPU. On an x86-64 server it is harmless. |
| Medium | Every quote pass stores a page body of up to `LLM_DOCUMENT_MAX_CHARS`, default 50,000, even when no LLM analysis is due. | At a one-minute cadence this is up to 19.5 million characters per symbol per 6.5-hour market day, before database/index overhead. |
| Medium | There is no visible retention/downsampling job. Summary queries use window functions and counts over growing history tables. | Disk usage and database work grow over time. The database CPU appears small in the screenshot today, but this will worsen with age. |
| Low | Next.js, the supervisor, and the worker each have their own Node/V8 runtime. | Some baseline RAM, but likely much smaller than Chromium. Replacing the runtime before fixing browser work optimizes the wrong layer. |

`shm_size: 1gb` is a maximum size for `/dev/shm`, not a 1 GB up-front RAM reservation. Reducing it is not, by itself, a memory optimization and can make Chromium unstable if set too low.

## Platformatic Watt vs celld

| Criterion for this repository | Platformatic Watt | celld |
| --- | --- | --- |
| Run the existing Next.js app | Supported | Not a drop-in target |
| Runtime model | Existing Node apps in isolated worker threads | Cloudflare Workers and Durable Objects in V8 isolates |
| Full Node.js compatibility | Yes, it is Node-based | Partial; only a documented subset is implemented |
| Run Puppeteer/browser rendering directly | It can run the Node code, but Chromium remains a separate process tree | Browser Rendering is explicitly unsupported |
| Improve the current collector CPU | No direct benefit | No direct benefit |
| Improve the current collector RAM | Possibly a small Node-process saving, but Chromium is unchanged; each worker still has its own V8 isolate/module state | A rewrite could be dense for Worker-style state, but it would not run this workload unchanged |
| Risk of duplicated schedulers | High if more than one app worker starts scheduler code | Cron/queue rewrite would be required |
| Migration cost | Moderate | High/full runtime and data-model rewrite |
| Maturity signal relevant here | Current runtime with Next.js integration | v0.6.2 beta; container support is experimental |
| Verdict | **Winner of these two, but defer it** | **Reject for this service** |

Platformatic's multi-worker benchmarks are about serving high request concurrency across available CPU cores. This service's hot work is scheduled Chromium navigation, not a saturated Next.js request event loop. Start with one web instance, not more workers.

The separate `platformatic/node-caged` image is also not the same thing as “use worker threads.” Platformatic reports lower V8 heap in a particular Next.js benchmark using a custom Node 25 build with experimental pointer compression. This repository currently builds on Node 24, and that change would not reduce Chromium memory. It is a later staging experiment only after the browser work is removed or proven secondary.

## Recommended changes, in order

### P0: verify and stop accidental duplication (no code)

In the deployed environment:

```dotenv
RUN_SCHEDULERS_IN_WEB_PROCESS=false
STOCK_INFO_RUN_WHEN_MARKET_CLOSED=false
```

Also verify:

- Exactly one `stocks` replica runs the dedicated worker.
- Only symbols that are genuinely needed are active in `/admin/symbols`.
- The host architecture is x86-64 if `platform: linux/amd64` remains.
- If LLM features are optional, set `OPENCODE_DISABLED=true`. To reduce the whole deployment footprint, also stop/remove the `opencode` service; the environment flag alone does not stop that container.
- If LLM features remain, test a smaller `LLM_DOCUMENT_MAX_CHARS` such as 8,000–12,000 and a smaller output limit. This reduces database/LLM work, not the base Chromium navigation cost, so validate analysis quality.

### P1: make cadence configurable and serialize browser jobs

The original intervals were hard-coded. The implementation adds environment-backed intervals with conservative defaults for this use case:

```dotenv
STOCK_INFO_INTERVAL_MS=300000
REDDIT_SENTIMENT_INTERVAL_MS=900000
POLYMARKET_INTERVAL_MS=900000
```

This changes the upper bound from 72 browser launches/hour during market hours (60 quote + 12 Reddit) to 16 (12 quote + 4 Reddit), about 78% fewer launches. Choose different values if the product has stricter freshness requirements.

Do not merely add a fixed offset. It lowers coincident peaks but does not guarantee exclusivity when a job is slow. Use a single collector queue in the worker so at most one browser-backed job runs at a time:

```text
quote due ───┐
reddit due ──┼──> one FIFO collector queue ──> at most one Chromium instance
```

Keep the existing per-job overlap guards as a second line of defense.

The queue is process-local and covers the scheduled jobs in `workers.ts`. An admin-triggered symbol run starts from the web process and can overlap a scheduled collector; avoid manual runs during collection windows, or move admin-triggered work into a durable worker queue if that path becomes frequent.

### P1: close Chromium before database and AI analysis

Split `stock-info.ts` into two phases:

1. Browser phase: navigate, extract the quote and the minimum page text, then close the browser.
2. Processing phase: write to libSQL and perform LLM/HFT calls without Chromium resident.

Today `processSymbol()` interleaves scraping, storage, and AI work, so the shared browser stays open through the entire symbol loop. The new phase boundary should be covered by a test that proves `browser.close()` happens before `runLlmAnalysis()`.

Do the same conceptually for Reddit: close its browser as soon as posts are extracted, before queue analysis begins. The current Reddit code already does this correctly; preserve that behavior.

### P1: block browser resources that are not used

Before each navigation, block images, media, and fonts. Do not block `document`, `script`, `xhr`, or `fetch` because Yahoo quotes and Reddit custom elements need dynamic content. Stylesheets should only be blocked after a scrape test proves selectors still render.

Puppeteer supports request interception, but every intercepted request must be synchronously continued or aborted. Validate both Yahoo consent/no-consent flows and Reddit scrolling after this change.

Expected benefit: less network transfer, decoding, rendering, and peak memory without changing the extracted fields.

### P1: stop storing full documents every minute

Keep the structured quote row at the configured cadence, but store a full page document only when an analysis is actually due or when the page content hash changes.

Suggested policy:

- `stock_history`: keep enough data for the existing one-year chart.
- `stock_documents`: create only for a general/HFT analysis input, not every quote.
- Old raw quote rows: downsample after 30 days if the one-year view can use daily buckets.
- Old unreferenced documents: delete with a bounded daily cleanup.
- Preserve documents referenced by retained analyses.

This removes most database growth without changing displayed quote freshness.

### P2: replace Puppeteer with lightweight sources

This is the **best overall solution** for minimum CPU and RAM.

For quotes, use an HTTP quote/market-data API that returns the required structured fields. Prefer a supported provider with terms and rate limits appropriate for production. An unofficial Yahoo endpoint may be lightweight, but it can change without notice; keep it behind a small adapter and retain the browser path only as a temporary fallback.

For Reddit, prefer the official OAuth API. RSS/Atom is a possible low-cost fallback if its coverage is sufficient. This repository already contains `parseRedditAtomPosts()` in `lib/reddit-core.ts`, so part of the parsing path exists even though the scheduled collector currently uses Puppeteer.

After both browser paths are gone:

- Remove `puppeteer` and the redundant direct `puppeteer-core` dependency if nothing imports it.
- Remove Chromium libraries and its download from the runner image.
- Remove `shm_size`.
- Remove the forced `linux/amd64` platform and build for the server's native architecture.
- Re-measure before considering a runtime migration.

This eliminates the expensive process family instead of trying to schedule it more efficiently.

### P2: bound database work

The dashboard supports a one-year chart, so blindly deleting history older than 30 days would remove a feature. Use retention plus downsampling:

- recent window: raw samples;
- older window: one row per chart bucket/day;
- maximum age: 365 days unless the product requires more;
- indexes aligned with `symbol, fetched_at, id` queries;
- cleanup in small batches so it does not create a new CPU spike.

Re-run query plans after representative data volume is loaded. The counts and `ROW_NUMBER()` queries in `lib/stocks.ts` should not scan an ever-growing raw table indefinitely.

### P3: add resource limits as guardrails

Limits protect the rest of the server; they do not reduce the work. Add them only after measuring a normal and worst-case cycle in staging.

An example starting point **after browser jobs are serialized** is:

```yaml
services:
  app:
    init: true
    cpus: "0.75"
    mem_limit: 768m
    pids_limit: 256
    # Keep 1gb until measured; test 256mb only after browser concurrency is one.
    shm_size: 1gb
```

Choose the memory limit from measured peak working set, not from this example: start near `p99 peak × 1.25`, run a full market-open cycle, and lower it gradually. A limit below Chromium's burst will cause OOM kills and restart loops. Do not disable the OOM killer.

`init: true` is useful here because Chromium creates child processes; the init process forwards signals and reaps orphaned descendants.

If setting `NODE_OPTIONS=--max-old-space-size=...`, remember that the limit applies to each Node/V8 process or isolate, not to the whole container. The Docker memory limit is the actual container-wide guardrail.

### P4: evaluate Platformatic only for a measured web bottleneck

After the previous steps, try Platformatic only if profiling shows the Next.js request event loop is saturated and the host has spare cores.

Rules for a fair trial:

- Start with exactly one Next.js worker.
- Keep schedulers in exactly one dedicated application/worker; never initialize them in every Next worker.
- Run the same traffic and collection replay against plain Node and Watt.
- Compare container RSS, average/p95 CPU, p95 response latency, cold start, and failure behavior.
- Keep Watt only if the measured result is better for this workload. Do not use extra workers merely because they are available.

Platformatic may improve observability and high-concurrency throughput, but neither is evidence that it will lower this service's collector footprint.

## Server measurement runbook

### 1. Confirm limits, architecture, and process tree

```bash
uname -m
docker inspect stocks --format 'platform={{.Platform}} memory={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}}'
docker top stocks -eo pid,ppid,pcpu,pmem,rss,etime,args
docker stats --no-stream stocks stocks-db stocks-opencode
```

Interpretation:

- `uname -m=aarch64` plus `platform=linux/amd64` means the app is emulated.
- Multiple `workers.ts` or duplicate `stock-info.ts` processes indicate duplicate scheduling/replicas.
- Multiple old `chrome-headless-shell` trees after logs say the browser closed indicate an orphan/leak problem.
- RSS is in KiB in common `ps` implementations; sum the Chromium tree separately from Node.

### 2. Correlate peaks with collectors

```bash
docker logs --timestamps stocks --since 30m 2>&1 \
  | grep -E 'Starting stock-info|Launching browser|Closing browser|Starting reddit-sentiment|Launching Puppeteer|Closed Puppeteer|Polymarket'
```

Take `docker stats --no-stream` samples every 5–10 seconds through at least one 15-minute boundary. Capture three windows:

1. market closed/idle;
2. a normal quote-only pass;
3. the 15-minute quote + Reddit + Polymarket boundary.

This distinguishes Next.js baseline, one Chromium pass, and concurrent collector peaks.

### 3. Check cgroup pressure and OOM history

On a cgroup v2 host:

```bash
docker exec stocks sh -lc 'cat /sys/fs/cgroup/memory.current; cat /sys/fs/cgroup/memory.events'
```

Non-zero/increasing `oom` or `oom_kill` means the service is already exceeding its effective memory budget.

### 4. Check growth, not just a snapshot

Repeat the same idle measurement after several hours. If RSS returns near the same baseline after each browser closes, the problem is workload cost, not a leak. If the baseline rises monotonically, capture the surviving PIDs and investigate those processes before tuning intervals.

## Proposed acceptance criteria

Adjust the freshness numbers if the product requires something else, but agree on them before implementation.

- Quote data is no more than 6 minutes old during regular market hours.
- Reddit and Polymarket data are no more than 16 minutes old.
- General and HFT analysis cadence remains unchanged unless intentionally reduced.
- At most one scheduled Chromium instance runs at a time; target zero after the HTTP-source migration.
- No collector runs outside market hours except Reddit/Polymarket by design.
- No duplicate schedulers with one deployed replica.
- Average market-hours CPU falls by at least 70% from the measured baseline.
- p95 memory falls by at least 50%, with zero cgroup OOM events.
- Dashboard p95 latency and collection success rate do not regress.
- Database growth is bounded and the one-year chart still works.

## Implementation order

1. Record the baseline with the runbook.
2. Fix duplicate scheduling or architecture emulation if found.
3. Add configurable intervals and one global collector queue.
4. Close Chromium before LLM work and block unused resources.
5. Stop storing page documents on every quote.
6. Replace Reddit Puppeteer, then quote Puppeteer, with HTTP sources.
7. Remove Chromium from the image and use the native server architecture.
8. Add measured Docker limits.
9. Only then benchmark plain Node against Platformatic Watt with one worker.

## References

- [Platformatic/Watt repository and supported frameworks](https://github.com/platformatic/platformatic)
- [Platformatic guide showing applications run in isolated worker threads](https://docs.platformatic.dev/docs/guides/datadog)
- [Platformatic's `node-caged` memory experiment and constraints](https://blog.platformatic.dev/we-cut-nodejs-memory-in-half)
- [celld overview and intended Cloudflare-compatible model](https://celld.dev/)
- [celld compatibility table: partial Node.js and no Browser Rendering](https://celld.dev/docs/cloudflare-compat/)
- [celld container support is experimental](https://celld.dev/docs/services/containers)
- [Docker resource constraints](https://docs.docker.com/engine/containers/resource_constraints/)
- [Docker Compose service limits and `shm_size`](https://docs.docker.com/reference/compose-file/services/)
- [Puppeteer request interception](https://pptr.dev/guides/request-interception/)


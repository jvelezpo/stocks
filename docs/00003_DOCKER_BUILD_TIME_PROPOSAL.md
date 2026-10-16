# Proposal: reduce Docker Compose build time

Assessment date: 2026-10-16

## Goal

Reduce `docker compose up -d --build` from the observed **138.9 seconds** to:

- **under 10 seconds** when no source or dependency files changed;
- **under 45 seconds** for a source-only rebuild on the same machine; and
- **under 75 seconds** after a dependency change.

Use the median of three runs on the same host. The targets are initial budgets, not promises; retain or tighten them after the first implementation benchmark.

## Implementation result

Implemented and verified on 2026-10-16:

- removed the forced `linux/amd64` platform and built natively for ARM64;
- installed system Chromium in a stable runtime layer;
- replaced the two independent `npm ci` steps with one shared dependency stage and a production prune stage;
- added persistent npm and Next.js BuildKit cache mounts;
- moved build/type-only packages to `devDependencies` and removed the redundant direct `puppeteer-core` declaration;
- kept bundled headless-shell as the local-development fallback while using normal headless mode for configured system Chromium; and
- excluded documentation and Compose-only files from the application source layer's cache key.

Measured results from the first implementation build:

| Metric | Before | After |
| --- | ---: | ---: |
| No-change warm build | Not recorded | 1.70 s |
| Source-change rebuild | Not recorded | 8.04 s |
| Export and unpack | 87.0 s | 20.4 s |
| Image size | 713 MB | 511 MB |
| Image architecture on this host | AMD64 under emulation | Native ARM64 |
| Dependency work | 27.8 s + 41.6 s installs | 14.1 s install + 7.1 s prune |
| Dockerized Next.js build | 21.0 s | 10.3 s |

The first native build took approximately 80 seconds because it downloaded and installed the ARM64 Chromium layer. Later builds reuse that layer. The running container passed its health check, returned HTTP 200, launched Chrome 155 through Puppeteer, and completed the scheduled Reddit collection successfully.

## Measured baseline

The supplied build log and the local image show:

| Work | Observed time | Interpretation |
| --- | ---: | --- |
| Complete build | 138.9 s | Current baseline |
| Export image layers | 71.5 s | Largest single cost |
| Unpack image | 15.4 s | Also proportional to changed image data |
| Builder `npm ci` | 27.8 s | Runs before the application build |
| Next.js build | 21.0 s | Main builder-stage work |
| Runner `npm ci --omit=dev` | 41.6 s | Runs in parallel with the builder path |
| Build context transfer | 0.0 s / 101.63 kB | Already healthy; not a useful optimization target |
| Final image size | 713 MB | Explains much of the export/unpack cost |

BuildKit runs the builder and runner stages concurrently, so the two `npm ci` durations must not simply be added to the total. The approximate critical path is the 49-second builder path followed by the 87-second export/unpack path. Image output is therefore the first bottleneck, while dependency installation and the Next.js build are the next ones.

There is also an architecture mismatch:

- build host: `arm64`;
- image forced by Compose: `linux/amd64`.

That forces emulation for Dockerfile `RUN` steps on this host. It should be removed only if the target deployment and the chosen Chromium installation both support ARM64.

## Recommendation

Implement the following in order. Re-measure after each phase so later work is done only if the target has not already been met.

### P0: do not build when only restarting the stack

Use:

```sh
docker compose up -d
```

for routine starts and restarts. Reserve this command for changes that need a new app image:

```sh
docker compose up -d --build
```

This is the only change capable of making an unchanged restart nearly immediate. It does not improve a real rebuild, so the remaining phases are still needed for development and deployment.

### P1: resolve the cross-architecture build

Choose one of these explicitly:

1. If this stack runs on ARM64, remove `platform: linux/amd64`, use an ARM64-compatible Chromium package, and build/run natively.
2. If production must remain AMD64, build the image on a native AMD64 CI/remote builder, push it, and let this host pull it instead of compiling it under emulation.
3. Keep the current setting only if neither option is possible; record that the slower local build is intentional.

Before choosing option 1, run the existing Yahoo and Reddit collector smoke tests against the ARM64 browser. Browser availability and behavior, not Next.js, are the compatibility gate.

### P1: separate Chromium from application dependency installation

The current runner executes `npm ci --omit=dev`, and Puppeteer's postinstall downloads Chrome into the same layer. A lockfile change therefore invalidates and re-exports a layer containing both `node_modules` and the large browser payload.

Prefer a stable runtime-browser layer:

- install the OS Chromium package in a `runtime-base` stage before copying `package.json` or `package-lock.json`;
- set `PUPPETEER_SKIP_DOWNLOAD=1` for every `npm ci`;
- set and verify Puppeteer's executable path at runtime;
- pin the base image digest and browser package inputs so updates are deliberate; and
- retain the existing browser smoke tests before accepting the change.

This may not remove all browser bytes from the 713 MB image, but it prevents ordinary JavaScript dependency changes from rebuilding and recompressing those bytes. If the OS browser is incompatible, keep Puppeteer's browser but download it in a dedicated, version-pinned stage and copy it into the runner as a separate stable layer.

### P1: install JavaScript dependencies once per build

Create a shared `deps` stage that runs full `npm ci` once with the Puppeteer download disabled. Use it as the source for two branches:

- `builder`: reuse the full dependencies and run `next build`;
- `prod-deps`: run `npm prune --omit=dev`, then supply the pruned tree to the runner.

Copy from the already-pruned stage into the final image. Do not copy the full dependency tree into the runner and prune it in a later runner layer, because deleted dev files would remain in the image's lower layer.

Also add BuildKit cache mounts:

```dockerfile
# syntax=docker/dockerfile:1.7
RUN --mount=type=cache,id=stocks-npm,target=/root/.npm npm ci
RUN --mount=type=cache,id=stocks-next,target=/app/.next/cache npm run build
```

The npm cache helps when the lockfile changes without putting the cache in the image. The `.next/cache` mount reduces repeated compilation work. Use cache export/import in CI if builders are ephemeral; local cache mounts alone will not survive a fresh CI worker.

### P1: remove build-only packages from the runner

Audit the production dependency list. These packages appear build/type-only and should move to `devDependencies` if the runtime smoke test confirms they are not loaded after startup:

- `@types/react`;
- `@types/react-dom`;
- `autoprefixer`;
- `postcss`;
- `tailwindcss`.

The direct `puppeteer-core` declaration also appears redundant because source files import `puppeteer`, which already depends on `puppeteer-core`. Removing only the direct declaration will not remove its transitive runtime files, so treat this as dependency hygiene rather than a major size win.

### P2: reduce the runtime artifact only if P1 misses the target

Next.js standalone output could reduce the web server's runtime dependency tree, but it is not a one-line change here. `scripts/start.mjs` also starts `workers.ts`, and those workers need source files and dependencies outside a basic standalone web-server bundle.

Evaluate one of these only after measuring P1:

- bundle the worker entry point and copy its traced runtime dependencies alongside `.next/standalone`; or
- build separate web and worker images, sharing the stable browser base only where it is needed.

The second option can produce the smallest web image but adds deployment complexity and another service. Do not take it merely to improve a local build if the P1 targets are already met.

## Proposed Dockerfile shape

The intended stage relationship is:

```text
node-base
├── deps (one full npm ci, no browser download)
│   ├── builder (Next.js build with persistent .next/cache)
│   └── prod-deps (prune dev dependencies)
└── runtime-base (OS libraries + pinned Chromium)
    └── runner (prod-deps + application build output)
```

This keeps dependency installation reusable, keeps browser bytes independent of the lockfile, and ensures only pruned dependencies enter the final image.

## Verification plan

Capture timings with plain BuildKit output:

```sh
/usr/bin/time -p docker compose build --progress=plain app
```

Measure these scenarios separately:

1. no changes, immediately after a successful build;
2. a normal source-only application change;
3. a `package-lock.json` change; and
4. a cold `--no-cache` build for worst-case visibility.

For each scenario, record the median of three runs, the image size, architecture, and the times for `npm ci`, `next build`, exporting layers, and unpacking. A phase is successful only if it improves the relevant scenario without shifting the cost into container startup.

Functional acceptance checks:

- the dashboard becomes healthy on port 5000;
- database migration and the background worker start successfully;
- one stock collection and one Reddit collection complete;
- Chromium exits after each collection; and
- the AMD64 production path still works if ARM64 is enabled locally.

## Expected result

The immediate workflow change should make unchanged starts take seconds. For real rebuilds, native execution, a stable browser layer, one dependency installation, and persistent npm/Next caches should remove most of the avoidable work. The main remaining floor will be the approximately 21-second Next.js compilation plus export of genuinely changed application layers.

Avoid spending time on the 101.63 kB build context, provenance metadata, or Compose service startup until measurements show they became significant; none explains the current 138.9-second result.

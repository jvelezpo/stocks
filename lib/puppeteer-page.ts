import type { Page } from "puppeteer";

const blockedResourceTypes = new Set(["font", "image", "media"]);

export async function blockUnneededPageResources(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) {
      return;
    }

    const resolution = blockedResourceTypes.has(request.resourceType())
      ? request.abort()
      : request.continue();
    void resolution.catch(() => {});
  });
}

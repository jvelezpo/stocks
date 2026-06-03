import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": [
      "./stock-info.ts",
      "./lib/**/*",
      "./prompts/**/*",
      "./node_modules/puppeteer/**/*",
      "./node_modules/puppeteer-core/**/*",
      "./node_modules/@puppeteer/**/*",
      "./node_modules/chromium-bidi/**/*",
      "./node_modules/devtools-protocol/**/*",
      "./node_modules/lilconfig/**/*",
      "./node_modules/modern-tar/**/*",
      "./node_modules/typed-query-selector/**/*",
      "./node_modules/webdriver-bidi-protocol/**/*",
      "./node_modules/ws/**/*",
      "./node_modules/yargs/**/*",
      "./node_modules/yargs-parser/**/*",
      "./node_modules/cliui/**/*",
      "./node_modules/string-width/**/*",
      "./node_modules/strip-ansi/**/*",
      "./node_modules/wrap-ansi/**/*",
      "./node_modules/emoji-regex/**/*",
      "./node_modules/ansi-regex/**/*",
      "./node_modules/ansi-styles/**/*",
      "./node_modules/escalade/**/*",
      "./node_modules/get-caller-file/**/*",
      "./node_modules/require-directory/**/*",
    ],
  },
};

export default nextConfig;

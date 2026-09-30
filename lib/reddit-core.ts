export const REDDIT_KEYWORDS = ["buy", "sell", "short", "long"] as const;

export type RedditKeyword = (typeof REDDIT_KEYWORDS)[number];

export type RedditPost = {
  redditPostId: string;
  subreddit: "wallstreetbets";
  title: string;
  author: string;
  postedAt: string;
  bodyText: string;
  sourceUrl: string;
  isStickied: boolean;
  matchedKeywords: RedditKeyword[];
};

export type RedditSentimentResult = {
  overallSentiment: "positive" | "negative" | "neutral";
  summary: string;
  trends: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: Record<string, unknown>,
  field: string,
  context: string
): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string" || !fieldValue.trim()) {
    throw new Error(`${context}.${field} must be a non-empty string.`);
  }

  return fieldValue.trim();
}

export function findMatchedKeywords(text: string): RedditKeyword[] {
  return REDDIT_KEYWORDS.filter((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(text)
  );
}

export function parsePuppeteerRedditPosts(value: unknown): RedditPost[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Puppeteer did not extract any Reddit posts.");
  }

  const posts = value.map((item, index): RedditPost => {
    const context = `Puppeteer Reddit post ${index}`;

    if (!isRecord(item)) {
      throw new Error(`${context} must be an object.`);
    }

    const rawPostId = requiredString(item, "redditPostId", context);
    const redditPostId = rawPostId.replace(/^t3_/i, "");
    const subreddit = requiredString(item, "subreddit", context).replace(
      /^r\//i,
      ""
    );
    const title = requiredString(item, "title", context);
    const author = requiredString(item, "author", context).replace(/^\/?u\//i, "");
    const postedAtValue = requiredString(item, "postedAt", context);
    const sourceUrlValue = requiredString(item, "sourceUrl", context);
    const bodyText = item.bodyText === undefined ? "" : item.bodyText;
    const isStickied = item.isStickied === undefined ? false : item.isStickied;

    if (!/^[a-z0-9]+$/i.test(redditPostId)) {
      throw new Error(`${context}.redditPostId was invalid.`);
    }

    if (subreddit.toLowerCase() !== "wallstreetbets") {
      throw new Error(`${context}.subreddit was not wallstreetbets.`);
    }

    if (typeof bodyText !== "string") {
      throw new Error(`${context}.bodyText must be a string.`);
    }

    if (typeof isStickied !== "boolean") {
      throw new Error(`${context}.isStickied must be a boolean.`);
    }

    const postedAt = new Date(postedAtValue);

    if (Number.isNaN(postedAt.getTime())) {
      throw new Error(`${context}.postedAt was invalid.`);
    }

    const sourceUrl = new URL(sourceUrlValue, "https://www.reddit.com");
    const sourceHostname = sourceUrl.hostname.toLowerCase();
    const permalinkPostId = sourceUrl.pathname.match(
      /^\/r\/wallstreetbets\/comments\/([a-z0-9]+)(?:\/|$)/i
    )?.[1];

    if (
      sourceUrl.protocol !== "https:" ||
      (sourceHostname !== "reddit.com" &&
        !sourceHostname.endsWith(".reddit.com")) ||
      permalinkPostId?.toLowerCase() !== redditPostId.toLowerCase()
    ) {
      throw new Error(`${context}.sourceUrl was outside r/wallstreetbets.`);
    }

    return {
      redditPostId,
      subreddit: "wallstreetbets",
      title,
      author,
      postedAt: postedAt.toISOString(),
      bodyText: bodyText.trim(),
      sourceUrl: sourceUrl.toString(),
      isStickied,
      matchedKeywords: findMatchedKeywords(`${title}\n${bodyText}`),
    };
  });

  return Array.from(
    new Map(posts.map((post) => [post.redditPostId, post] as const)).values()
  );
}

function decodeXmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (entity, codePoint: string) => {
      const value = Number.parseInt(codePoint, 16);
      return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    })
    .replace(/&#(\d+);/g, (entity, codePoint: string) => {
      const value = Number.parseInt(codePoint, 10);
      return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    })
    .replace(
      /&(amp|apos|gt|lt|quot);/gi,
      (_, name: string) => namedEntities[name.toLowerCase()]
    );
}

function atomElement(value: string, name: string): string {
  return value.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")
  )?.[1] ?? "";
}

function atomAttribute(value: string, element: string, attribute: string): string {
  return value.match(
    new RegExp(
      `<${element}\\b[^>]*\\b${attribute}\\s*=\\s*["']([^"']*)["']`,
      "i"
    )
  )?.[1] ?? "";
}

function atomContentText(value: string): string {
  const html = decodeXmlEntities(value);
  const postBody = html.match(
    /<!--\s*SC_OFF\s*-->([\s\S]*?)<!--\s*SC_ON\s*-->/i
  )?.[1];

  if (!postBody) {
    return "";
  }

  return decodeXmlEntities(
    postBody
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRedditAtomPosts(value: string): RedditPost[] {
  if (!/<feed\b/i.test(value)) {
    throw new Error("Reddit did not return an Atom feed.");
  }

  const entries = Array.from(
    value.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)
  );
  if (entries.length === 0) {
    return [];
  }

  return parsePuppeteerRedditPosts(
    entries.map((entry) => {
      const entryXml = entry[1] ?? "";
      const authorXml = atomElement(entryXml, "author");

      return {
        redditPostId: decodeXmlEntities(atomElement(entryXml, "id")),
        subreddit: decodeXmlEntities(atomAttribute(entryXml, "category", "term")),
        title: decodeXmlEntities(atomElement(entryXml, "title")),
        author: decodeXmlEntities(atomElement(authorXml, "name")),
        postedAt: decodeXmlEntities(
          atomElement(entryXml, "published") || atomElement(entryXml, "updated")
        ),
        sourceUrl: decodeXmlEntities(atomAttribute(entryXml, "link", "href")),
        bodyText: atomContentText(atomElement(entryXml, "content")),
        isStickied: false,
      };
    })
  );
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown;
      } catch {
        // Fall through to the stable validation error below.
      }
    }

    throw new Error("Reddit sentiment output was not valid JSON.");
  }
}

export function parseRedditSentiment(text: string): RedditSentimentResult {
  const parsed = extractJsonObject(text);

  if (!isRecord(parsed)) {
    throw new Error("Reddit sentiment output must be a JSON object.");
  }

  const overallSentiment = parsed.overall_sentiment;
  const summary = parsed.summary;
  const trends = parsed.trends;

  if (
    overallSentiment !== "positive" &&
    overallSentiment !== "negative" &&
    overallSentiment !== "neutral"
  ) {
    throw new Error(
      "Reddit sentiment overall_sentiment must be positive, negative, or neutral."
    );
  }

  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error("Reddit sentiment summary must be a non-empty string.");
  }

  if (!Array.isArray(trends) || trends.some((trend) => typeof trend !== "string")) {
    throw new Error("Reddit sentiment trends must be an array of strings.");
  }

  return {
    overallSentiment,
    summary: summary.trim(),
    trends: trends.map((trend) => trend.trim()).filter(Boolean),
  };
}

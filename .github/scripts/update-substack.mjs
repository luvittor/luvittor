import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const feedUrl = process.env.SUBSTACK_FEED_URL;
const maxPostCount = Number.parseInt(process.env.MAX_POST_COUNT ?? "5", 10);

if (!feedUrl) {
  throw new Error("SUBSTACK_FEED_URL is required.");
}

if (!Number.isInteger(maxPostCount) || maxPostCount < 1) {
  throw new Error("MAX_POST_COUNT must be a positive integer.");
}

const maxAttempts = 3;

async function fetchFeed(url) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;

    try {
      response = await fetch(url, {
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to fetch Substack RSS feed after ${maxAttempts} attempts.`,
          { cause: error },
        );
      }

      console.warn(
        `Substack RSS request failed (attempt ${attempt}/${maxAttempts}); retrying.`,
      );
      await delay(1000 * 2 ** (attempt - 1));
      continue;
    }

    if (response.ok) {
      return response.text();
    }

    const isRetryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;

    if (!isRetryable || attempt === maxAttempts) {
      throw new Error(
        `Substack RSS feed returned HTTP ${response.status} after ${attempt} attempt(s).`,
      );
    }

    console.warn(
      `Substack RSS feed returned HTTP ${response.status} (attempt ${attempt}/${maxAttempts}); retrying.`,
    );
    await delay(1000 * 2 ** (attempt - 1));
  }

  throw new Error("Substack RSS request ended without a response.");
}

function decodeXml(value) {
  const entities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi, (entity, code) => {
      if (code[0] !== "#") {
        return entities[code.toLowerCase()] ?? entity;
      }

      const isHex = code[1].toLowerCase() === "x";
      const codePoint = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);

      return codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    });
}

function getTagValue(xml, tagName) {
  const match = xml.match(
    new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, "i"),
  );

  return match ? decodeXml(match[1].trim()) : "";
}

const feedXml = await fetchFeed(feedUrl);
const items = [...feedXml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)];
const posts = items.slice(0, maxPostCount).map(([, item]) => ({
  title: getTagValue(item, "title") || "Untitled",
  link: getTagValue(item, "link"),
}));

if (posts.length === 0) {
  throw new Error("No Substack articles were returned.");
}

const markdownPosts = posts.map((post) => {
  const title = post.title
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
  const link = new URL(post.link);

  if (link.protocol !== "https:" && link.protocol !== "http:") {
    throw new Error(`Unsupported article URL protocol: ${link.protocol}`);
  }

  return `- [${title}](${link.href})`;
});

const readmePath = "README.md";
const startTag = "<!-- BLOG-POST-LIST:START -->";
const endTag = "<!-- BLOG-POST-LIST:END -->";
const readme = await readFile(readmePath, "utf8");
const startIndex = readme.indexOf(startTag);
const endIndex = readme.indexOf(endTag);

if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  throw new Error("Blog post markers were not found in README.md.");
}

const contentStart = startIndex + startTag.length;
const updatedReadme =
  readme.slice(0, contentStart) +
  `\n${markdownPosts.join("\n")}\n` +
  readme.slice(endIndex);

await writeFile(readmePath, updatedReadme, "utf8");
console.log(`Updated README.md with ${posts.length} Substack article(s).`);

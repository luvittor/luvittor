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
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (attempt === maxAttempts) {
        throw new Error(
          `Failed to fetch Substack posts after ${maxAttempts} attempts.`,
          { cause: error },
        );
      }

      console.warn(
        `Substack posts request failed (attempt ${attempt}/${maxAttempts}); retrying.`,
      );
      await delay(1000 * 2 ** (attempt - 1));
      continue;
    }

    if (response.ok) {
      return response.json();
    }

    const isRetryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;

    if (!isRetryable || attempt === maxAttempts) {
      throw new Error(
        `Substack posts endpoint returned HTTP ${response.status} after ${attempt} attempt(s).`,
      );
    }

    console.warn(
      `Substack posts endpoint returned HTTP ${response.status} (attempt ${attempt}/${maxAttempts}); retrying.`,
    );
    await delay(1000 * 2 ** (attempt - 1));
  }

  throw new Error("Substack posts request ended without a response.");
}

const endpoint = new URL(feedUrl);
endpoint.searchParams.set("limit", String(maxPostCount));

const data = await fetchFeed(endpoint);
const posts = (Array.isArray(data.posts) ? data.posts : [])
  .slice(0, maxPostCount)
  .map((post) => ({
    title: String(post.title ?? "").trim() || "Untitled",
    link: String(post.link ?? ""),
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

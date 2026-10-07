import { readFile, writeFile } from "node:fs/promises";

const feedUrl = process.env.SUBSTACK_FEED_URL;
const maxPostCount = Number.parseInt(process.env.MAX_POST_COUNT ?? "5", 10);

if (!feedUrl) {
  throw new Error("SUBSTACK_FEED_URL is required.");
}

if (!Number.isInteger(maxPostCount) || maxPostCount < 1) {
  throw new Error("MAX_POST_COUNT must be a positive integer.");
}

const endpoint = new URL("https://api.rss2json.com/v1/api.json");
endpoint.searchParams.set("rss_url", feedUrl);

const response = await fetch(endpoint, {
  headers: { Accept: "application/json" },
});

if (!response.ok) {
  throw new Error(`RSS service returned HTTP ${response.status}.`);
}

const data = await response.json();

if (data.status !== "ok") {
  throw new Error(`RSS service failed: ${data.message ?? "unknown error"}`);
}

const posts = data.items?.slice(0, maxPostCount) ?? [];

if (posts.length === 0) {
  throw new Error("No Substack articles were returned.");
}

const markdownPosts = posts.map((post) => {
  const title = String(post.title ?? "Untitled")
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

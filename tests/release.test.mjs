import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { repoFromUrl, releaseTag, expectedUrls, releaseProblems } from "../scripts/lib/release.mjs";

const base = {
  id: "performance-triage",
  version: "0.1.0",
  url: "https://github.com/Deadman6392/FoundryVTT-research-development"
};

test("repoFromUrl accepts repository URLs only", () => {
  assert.deepEqual(repoFromUrl("https://github.com/a/b"), { owner: "a", repo: "b" });
  assert.deepEqual(repoFromUrl("https://github.com/a/b.git"), { owner: "a", repo: "b" });
  assert.deepEqual(repoFromUrl("https://github.com/a/b/"), { owner: "a", repo: "b" });
  assert.equal(repoFromUrl("https://github.com/a/b/tree/main"), null);
  assert.equal(repoFromUrl(undefined), null);
});

test("expected URLs: stable manifest on main, versioned zip on the release", () => {
  const urls = expectedUrls(base);
  assert.equal(releaseTag(base), "performance-triage-v0.1.0");
  assert.equal(urls.manifest,
    "https://raw.githubusercontent.com/Deadman6392/FoundryVTT-research-development/main/modules/performance-triage/module.json");
  assert.equal(urls.download,
    "https://github.com/Deadman6392/FoundryVTT-research-development/releases/download/performance-triage-v0.1.0/performance-triage.zip");
});

test("releaseProblems catches a version bump without a matching download URL", () => {
  const ok = { ...base, ...expectedUrls(base) };
  assert.deepEqual(releaseProblems(ok), []);
  // The manifest URL is version-independent, so only the download URL goes stale
  const problems = releaseProblems({ ...ok, version: "0.2.0" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"download" must be ".*performance-triage-v0\.2\.0\/performance-triage\.zip"/);
});

test("releaseProblems flags missing fields and bad versions", () => {
  assert.ok(releaseProblems({ ...base }).some(p => p.includes("\"manifest\"")));
  assert.ok(releaseProblems({ ...base, version: "1.0" }).some(p => p.includes("not x.y.z")));
  assert.ok(releaseProblems({ ...base, url: "https://example.com" }).some(p => p.includes("GitHub repository")));
});

test("the shipped module.json is installable", () => {
  const manifest = JSON.parse(readFileSync(new URL("../modules/performance-triage/module.json", import.meta.url)));
  assert.deepEqual(releaseProblems(manifest), []);
});

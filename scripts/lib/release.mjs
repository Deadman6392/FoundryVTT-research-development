/**
 * Release URL rules shared by the checker, the packager and the version script, so they can never disagree.
 *
 * Each module is released from GitHub with its own tag, "<id>-v<version>". Foundry reads the manifest from the
 * default branch (a stable URL, which is how it detects updates) and downloads the zip attached to that version's
 * release. The repository is taken from the manifest's own "url" field.
 */

export const RELEASE_BRANCH = "main";

/** @returns {{owner: string, repo: string}|null} */
export function repoFromUrl(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url ?? "");
  return m ? { owner: m[1], repo: m[2] } : null;
}

export function releaseTag(manifest) {
  return `${manifest.id}-v${manifest.version}`;
}

/** The manifest and download URLs a module.json must contain for its current version. */
export function expectedUrls(manifest) {
  const gh = repoFromUrl(manifest.url);
  if ( !gh ) return null;
  const base = `${gh.owner}/${gh.repo}`;
  return {
    manifest: `https://raw.githubusercontent.com/${base}/${RELEASE_BRANCH}/modules/${manifest.id}/module.json`,
    download: `https://github.com/${base}/releases/download/${releaseTag(manifest)}/${manifest.id}.zip`
  };
}

/** Problems that would stop Foundry from installing or updating this module from GitHub. */
export function releaseProblems(manifest) {
  const problems = [];
  if ( !/^\d+\.\d+\.\d+$/.test(manifest.version ?? "") ) problems.push(`version "${manifest.version}" is not x.y.z`);
  const expected = expectedUrls(manifest);
  if ( !expected ) {
    problems.push(`"url" must be the GitHub repository (https://github.com/<owner>/<repo>), got "${manifest.url}"`);
    return problems;
  }
  for ( const field of ["manifest", "download"] ) {
    if ( manifest[field] !== expected[field] ) {
      problems.push(`"${field}" must be "${expected[field]}" (found "${manifest[field] ?? ""}"); run npm run set-version`);
    }
  }
  return problems;
}

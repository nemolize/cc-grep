import { pathToFileURL } from "node:url";

import { lt, prerelease, valid } from "semver";

export const classifyRelease = (version, latestVersion = "") => {
  if (valid(version) === null) {
    throw new Error(`invalid release version: ${version}`);
  }

  if (prerelease(version) !== null) {
    return { npmTag: "next", githubReleaseFlag: "--prerelease" };
  }

  if (latestVersion !== "" && valid(latestVersion) === null) {
    throw new Error(`invalid latest version: ${latestVersion}`);
  }

  if (latestVersion !== "" && lt(version, latestVersion)) {
    return { npmTag: "backport", githubReleaseFlag: "--latest=false" };
  }

  return { npmTag: "latest", githubReleaseFlag: "" };
};

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const [version, latestVersion = ""] = process.argv.slice(2);
  if (version === undefined) {
    throw new Error("usage: classify-release.mjs <version> [latest-version]");
  }

  const { npmTag, githubReleaseFlag } = classifyRelease(version, latestVersion);
  process.stdout.write(
    `npm_tag=${npmTag}\ngithub_release_flag=${githubReleaseFlag}\n`,
  );
}

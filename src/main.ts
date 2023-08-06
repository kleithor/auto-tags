import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectChangeType, getTagName, increaseVersion } from './util';

run();

export type ReleaseType = 'major' | 'minor' | 'patch';

const TagPrefix = 'v';
const GITHUB_WORKSPACE = process.env.GITHUB_WORKSPACE;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.INPUT_GITHUB_TOKEN;

async function run() {
  core.debug(
    ` Available environment variables:\n -> ${Object.keys(process.env)
      .map((i) => i + ' :: ' + process.env[i])
      .join('\n -> ')}`
  );

  if (!GITHUB_WORKSPACE) {
    return core.setFailed('No GITHUB_WORKSPACE provided');
  }

  const dir = fs
    .readdirSync(path.resolve(GITHUB_WORKSPACE), { withFileTypes: true })
    .map((entry) => {
      return `${entry.isDirectory() ? '> ' : '  - '}${entry.name}`;
    })
    .join('\n');

  core.debug(`Working Directory: ${GITHUB_WORKSPACE}:\n${dir}`);

  if (!GITHUB_TOKEN) {
    return core.setFailed('No GITHUB_TOKEN or INPUT_GITHUB_TOKEN provided');
  }

  const { owner, repo } = context.repo;

  try {
    const github = getOctokit(GITHUB_TOKEN);
    const Tags = await github.rest.repos.listTags({ owner, repo }); // FIXME: How does this scale with multiple hundreds of tags

    // Get previous version
    // const pkg_root = core.getInput('package_root', { required: false });
    // const pkgfile = path.join(GITHUB_WORKSPACE, pkg_root, 'package.json');
    // const pkg = fs.existsSync(pkgfile) ? require(pkgfile) : null;
    // core.debug(`Detected package.json version: ${pkg.version}`);

    const LatestTag = Tags && Tags.data.length > 0 ? Tags.data[0] : null;
    // let currentVersion: string =
    //   pkg && pkg.version
    //     ? pkg.version
    //     : !pkg && !pkg.version && LatestTag
    //     ? LatestTag.name.startsWith(TagPrefix)
    //       ? LatestTag.name.substring(TagPrefix.length)
    //       : LatestTag.name
    //     : '0.0.0';
    let currentVersion: string = LatestTag
      ? LatestTag.name.startsWith(TagPrefix)
        ? LatestTag.name.substring(TagPrefix.length)
        : LatestTag.name
      : '0.0.0';
    core.info(`Detected current version: ${currentVersion}`);

    // Detect change-type
    const Commits = await github.rest.repos.listCommits({
      owner,
      repo,
      sha: LatestTag?.commit.sha ?? undefined,
    });
    const ChangeType: ReleaseType = detectChangeType(Commits.data.map((cmt) => cmt.commit.message));
    core.info(`Detected change-type: ${ChangeType}`);

    let nextVersion = increaseVersion(currentVersion, ChangeType),
      nextVersionAlreadyExists = undefined;
    do {
      // Check if tag already exists
      for (const tag of Tags.data) {
        if (tag.name === getTagName(nextVersion)) {
          nextVersionAlreadyExists = true;
          break;
        }
      }

      if (nextVersionAlreadyExists) {
        core.info(`Tag "${getTagName(nextVersion)}" already exists. Trying a new version.`);
        nextVersion = increaseVersion(nextVersion, ChangeType);
        nextVersionAlreadyExists = undefined;
      }
    } while (nextVersionAlreadyExists);
    core.info(`New version: ${nextVersion}`);

    const isDryRunEnabled = core.getBooleanInput('dry_run');
    // TODO: const shouldUpdateVersionFiles = core.getBooleanInput('update_version_files');
    if (!isDryRunEnabled) {
      // Create new tag
      const GITHUB_SHA = process.env.GITHUB_SHA;
      if (!GITHUB_SHA) {
        return core.setFailed('No GITHUB_SHA provided');
      }

      const createdTag = await github.rest.git.createTag({
        owner,
        repo,
        tag: getTagName(nextVersion),
        message: `Version ${nextVersion}`,
        object: GITHUB_SHA,
        type: 'commit',
      });
      core.warning(`Created new tag: ${createdTag.data.tag}`);

      const createdRef = await github.rest.git.createRef({
        owner,
        repo,
        ref: `refs/tags/${createdTag.data.tag}`,
        sha: createdTag.data.sha,
      });
      core.warning(`Reference ${createdRef.data.ref} available at ${createdRef.data.url}` + os.EOL);

      // TODO: Update files
    }

    core.setOutput('version', nextVersion);
    core.setOutput('tagname', getTagName(nextVersion));
  } catch (error) {
    core.setFailed(error as Error | string);
  }
}

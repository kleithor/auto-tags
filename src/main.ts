import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

run();

type ReleaseType = 'major' | 'minor' | 'patch';

async function run() {
  core.debug(
    ` Available environment variables:\n -> ${Object.keys(process.env)
      .map((i) => i + ' :: ' + process.env[i])
      .join('\n -> ')}`
  );

  const GITHUB_WORKSPACE = process.env.GITHUB_WORKSPACE;
  if (GITHUB_WORKSPACE == undefined) {
    core.setFailed('No GITHUB_WORKSPACE provided');
    return;
  }
  const dir = fs
    .readdirSync(path.resolve(GITHUB_WORKSPACE), { withFileTypes: true })
    .map((entry) => {
      return `${entry.isDirectory() ? '> ' : '  - '}${entry.name}`;
    })
    .join('\n');

  core.debug(`Working Directory: ${GITHUB_WORKSPACE}:\n${dir}`);

  if (!process.env.hasOwnProperty('GITHUB_TOKEN')) {
    if (!process.env.hasOwnProperty('INPUT_GITHUB_TOKEN')) {
      core.setFailed('Invalid or missing GITHUB_TOKEN.');
      return;
    }
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.INPUT_GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    core.setFailed('No GITHUB_TOKEN provided');
    return;
  }

  const github = getOctokit(GITHUB_TOKEN);
  // Get owner and repo from context of payload that triggered the action
  const { owner, repo } = context.repo;

  let tags: {
    name: string;
    commit: {
      sha: string;
      url: string;
    };
    zipball_url: string;
    tarball_url: string;
    node_id: string;
  }[] = [];

  try {
    tags = (
      await github.rest.repos.listTags({
        owner,
        repo,
        per_page: 100,
      })
    ).data;
  } catch (error) {
    tags = [];
  }

  const pkg_root = core.getInput('package_root', { required: false });
  const pkgfile = path.join(GITHUB_WORKSPACE, pkg_root, 'package.json');
  const pkg = fs.existsSync(pkgfile) ? require(pkgfile) : null;
  core.debug(`Detected package.json version ${pkg.version}`);

  let currentVersion = pkg.version || '0.0.0'; // fallback version, if there isn't a tag for a previous version
  let latestTag: (typeof tags)[0] | null = null;
  if (!pkg.version && tags.length > 0) {
    latestTag = tags[0];
    core.debug(`Detected current version (based on tags) ${currentVersion}`);
    currentVersion = latestTag.name.toLowerCase().startsWith('v')
      ? latestTag.name.substring(1)
      : latestTag.name;
  }

  let changeType: ReleaseType = 'patch';
  const changes = await github.rest.repos.listCommits({
    owner,
    repo,
    sha: latestTag ? latestTag.commit.sha : undefined,
  });
  for (let change of changes.data) {
    const commitMsg = change.commit.message.toLowerCase();
    // TODO: Be able to detect breaking changes (as defined in conventional-commits guidelines)
    if (commitMsg.startsWith('feat')) {
      changeType = 'minor';
      break;
    }
  }
  core.debug(`Detected change-type of ${changeType}`);

  const nextVersion = increaseVersion(currentVersion, changeType);
  const newTagName = buildTagName(nextVersion);
  core.debug(`Detected next version ${nextVersion}`);
  core.debug(`New tag ${newTagName}`);

  // Check for existance of tag and abort (short circuit) if it already exists.
  for (let tag of tags) {
    if (tag.name === newTagName) {
      core.setFailed(`"${tag.name.trim()}" tag already exists.` + os.EOL);
      return;
    }
  }

  const isDryRunEnabled = core.getBooleanInput('dry_run');
  const shouldUpdateVersionFiles = core.getBooleanInput('update_version_files');
  if (!isDryRunEnabled) {
    try {
      const GITHUB_SHA = process.env.GITHUB_SHA;
      if (!GITHUB_SHA) {
        core.setFailed('No GITHUB_SHA provided');
        return;
      }

      const createdTag = await github.rest.git.createTag({
        owner,
        repo,
        tag: newTagName,
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

      if (pkg && shouldUpdateVersionFiles) {
        pkg.version = nextVersion;
        fs.writeFileSync(pkgfile, JSON.stringify(pkg, null, 2));
        core.warning(`Updated package.json version to ${nextVersion}`);

        const pkgLockfile = path.join(GITHUB_WORKSPACE, pkg_root, 'package-lock.json');
        const pkgLock = fs.existsSync(pkgLockfile) ? require(pkgLockfile) : null;
        if (pkgLock) {
          pkgLock.version = nextVersion;
          pkgLock.packages[''].version = nextVersion;
          fs.writeFileSync(pkgLockfile, JSON.stringify(pkgLock, null, 2));
          core.warning(`Updated package-lock.json version to ${nextVersion}`);
        }

        // Commit file changes
        const newTreeFiles = [
          {
            mode: '100644',
            type: 'blob',
            content: JSON.stringify(pkgLock, null, 2),
            path: pkgfile.replace(GITHUB_WORKSPACE + '/', ''),
          },
        ] as any[];
        if (pkgLockfile) {
          newTreeFiles.push({
            mode: '100644',
            type: 'blob',
            content: JSON.stringify(pkgLock, null, 2),
            path: pkgLockfile.replace(GITHUB_WORKSPACE + '/', ''),
          });
        }

        // MAGIC
        const baseTree = (
          await github.rest.git.getCommit({
            owner,
            repo,
            commit_sha: context.sha,
          })
        ).data.tree.sha;
        const previousTree = (
          await github.rest.git.getTree({
            owner,
            repo,
            tree_sha: baseTree,
            recursive: 'true',
          })
        ).data.tree;

        for (const file of previousTree) {
          if (
            file.path !== pkgfile.replace(GITHUB_WORKSPACE + '/', '') &&
            file.path !== pkgLockfile.replace(GITHUB_WORKSPACE + '/', '')
          ) {
            newTreeFiles.push(file);
          }
        }

        const newTree = await github.rest.git.createTree({
          owner,
          repo,
          tree: newTreeFiles,
          base_tree: baseTree,
        });

        const commit = await github.rest.git.createCommit({
          owner,
          repo,
          message: `chore(release): ${buildTagName(nextVersion)}`,
          tree: newTree.data.sha,
          parents: [context.sha],
          author: {
            name: 'auto-tags',
            email: 'noreply@auto-tags',
          },
        });

        const updatedRef = await github.rest.git.updateRef({
          owner,
          repo,
          ref: `heads/${context.ref.split('/').pop()}`,
          sha: commit.data.sha,
          force: true,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${e}`;
      core.warning('Failed to generate changelog from commits: ' + msg + os.EOL);
    }
  }

  core.setOutput('version', nextVersion);
  core.setOutput('tagname', newTagName);
}

/**
 * Appends prefix & suffix
 * @param version
 */
function buildTagName(version: string): string {
  return 'v' + version;
}

function increaseVersion(currentVersion: string, releaseType: ReleaseType = 'patch'): string {
  let [major, minor, patch] = currentVersion.split('.').map((num) => Number(num));

  switch (releaseType) {
    case 'major':
      return [major + 1, minor, patch].join('.');

    case 'minor':
      return [major, minor + 1, patch].join('.');

    default:
      return [major, minor, patch + 1].join('.');
  }
}

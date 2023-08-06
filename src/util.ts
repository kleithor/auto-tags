import { type ReleaseType } from './main';
import { getOctokit } from '@actions/github';

export function getTagName(version: string, option?: { prefix: string }) {
  return (option ? option.prefix : 'v') + version;
}

export function increaseVersion(
  currentVersion: string,
  releaseType: ReleaseType = 'patch'
): string {
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

export function isBreakingChange(input: string): boolean {
  const pattern = /^(\w+)(\([^)]+\))?!: .+/;
  return pattern.test(input);
}

export function detectChangeType(commitsMessages: string[]): ReleaseType {
  for (let msg of commitsMessages) {
    if (isBreakingChange(msg)) {
      return 'major';
    }
    if (msg.startsWith('feat')) {
      return 'minor';
    }
  }

  return 'patch';
}

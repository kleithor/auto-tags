import { getTagName, increaseVersion, isBreakingChange, detectChangeType } from './util';

describe('increaseVersion', () => {
  it('increase by patch', () => {
    expect(increaseVersion('1.0.0', 'patch')).toBe('1.0.1');
  });

  it('increase by minor', () => {
    expect(increaseVersion('1.0.0', 'minor')).toBe('1.1.0');
  });

  it('increase by major', () => {
    expect(increaseVersion('1.0.0', 'major')).toBe('2.0.0');
  });
});

describe('getTagName', () => {
  it('w/ default prefix', () => {
    expect(getTagName('1.0.0')).toBe('v1.0.0');
  });

  it('w/ custom prefix', () => {
    expect(getTagName('1.0.0', { prefix: 'pre-v' })).toBe('pre-v1.0.0');
  });
});

describe('isBreakingChange', () => {
  it('feat(scope)!: message', () => {
    expect(isBreakingChange('feat(scope)!: message')).toBeTruthy();
  });

  it('fix(scope)!: message', () => {
    expect(isBreakingChange('fix(scope)!: message')).toBeTruthy();
  });

  it('feat_dasda(scope)!: message', () => {
    expect(isBreakingChange('feat_dasda(scope)!: message')).toBeTruthy();
  });

  it('chore!: message', () => {
    expect(isBreakingChange('chore!: message')).toBeTruthy();
  });

  it('chore: message', () => {
    expect(isBreakingChange('chore: message')).toBeFalsy();
  });

  it('fix: message', () => {
    expect(isBreakingChange('fix: message')).toBeFalsy();
  });

  it('fix(scope): message', () => {
    expect(isBreakingChange('fix(scope): message')).toBeFalsy();
  });

  it('invalid message', () => {
    expect(isBreakingChange('invalid message')).toBeFalsy();
  });
});

describe('detectChangeType', () => {
  it('determine patch', () => {
    expect(detectChangeType(['fix: Something', 'fix: Other patch'])).toBe('patch');
  });

  it('determine minor', () => {
    expect(detectChangeType(['feat: Something', 'fix: Other patch', 'chore: release v1'])).toBe(
      'minor'
    );
  });

  it('determine major', () => {
    expect(detectChangeType(['feat!: Something', 'fix: Other patch'])).toBe('major');
  });

  it('determine major w/ scope', () => {
    expect(detectChangeType(['feat(scope)!: Something', 'fix: Other patch'])).toBe('major');
  });
});

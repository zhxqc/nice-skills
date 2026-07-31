import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  createReport,
  parseArgs,
  render,
  writeOutput,
} from '../skills/skill-observer/scripts/observatory.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const fixtureRoot = path.join(repo, 'tests', 'fixtures', 'skills');

function report(args) {
  const options = parseArgs([...args, '--no-standard-roots']);
  return createReport({ ...options, extraRoots: options.extraRoots.map((root) => path.resolve(root)) });
}

function makeTempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeSkill(root, folder, name, description, body = '') {
  const skill = path.join(root, folder);
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(
    path.join(skill, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
    'utf8',
  );
  return skill;
}

test('scans normal and unhealthy fixture Skills with required fields', () => {
  const result = report(['scan', '--extra-root', fixtureRoot]);
  const byName = new Map(result.skills.map((skill) => [skill.name, skill]));
  assert.equal(result.overview.skills_found, 13);
  assert.equal(byName.get('normal-skill').scope, 'extra');
  assert.equal(byName.get('normal-skill').scripts_count, 1);
  assert.equal(byName.get('normal-skill').references_count, 1);
  assert.equal(byName.get('normal-skill').usage_status, 'not-collected');
  assert.equal(byName.get('normal-skill').explicit_invocations, null);
  assert.equal(byName.get('normal-skill').enabled, 'unknown');
  assert.ok(byName.get('normal-skill').content_hash);
  assert.equal(byName.get('normal-skill').content_hash_scope, 'SKILL.md');
  assert.equal(byName.get('normal-skill').bundle_content_comparison, 'unavailable-without-reading-resource-contents');
  assert.ok(byName.get('normal-skill').relative_links.includes('references/guide.md'));
  assert.deepEqual(byName.get('missing-link').missing_links, ['references/not-found.md']);
  assert.ok(byName.get('missing-frontmatter').health_issues.includes('missing-frontmatter'));
  assert.ok(byName.get('missing-skill-md').health_issues.includes('missing-skill-md'));
  assert.ok(byName.get('missing-name').health_issues.includes('missing-name'));
  assert.ok(byName.get('missing-description').health_issues.includes('missing-description'));
});

test('detects same names, identical content, and similar descriptions', () => {
  const result = report(['doctor', '--extra-root', fixtureRoot]);
  const shared = result.skills.filter((skill) => skill.name === 'shared-name');
  assert.equal(shared.length, 2);
  assert.ok(shared.every((skill) => skill.duplicate_type.includes('same-name')));
  assert.ok(result.relationship_findings.some((finding) => finding.type === 'same-name'));
  assert.ok(result.relationship_findings.some((finding) => finding.type === 'identical-skill-md'));
  assert.ok(result.relationship_findings.some((finding) => finding.type === 'similar-description'));
  const relationshipOnly = result.skills.find((skill) => skill.path.endsWith(`identical-one`));
  assert.deepEqual(relationshipOnly.health_issues, []);
  assert.ok(relationshipOnly.duplicate_type.length > 0);
  assert.ok(result.overview.relationship_findings >= result.overview.duplicate_pairs);
  assert.equal(result.duplicate_pairs.length, result.overview.duplicate_pairs);
  assert.equal(result.relationship_findings.length, result.overview.relationship_findings);
});

test('reports a broken symlink without following it', (t) => {
  const tempRoot = makeTempRoot(t, 'skill-observer-link-');
  const link = path.join(tempRoot, 'broken-symlink');
  try {
    fs.symlinkSync(path.join(tempRoot, 'target-does-not-exist'), link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`);
    return;
  }
  const result = report(['scan', '--extra-root', tempRoot]);
  const broken = result.skills.find((skill) => skill.name === 'broken-symlink');
  assert.ok(broken);
  assert.ok(broken.health_issues.some((issue) => issue.startsWith('broken-symlink:')));
});

test('handles missing and inaccessible roots as coverage limitations', () => {
  const missing = path.join(os.tmpdir(), 'skill-observer-root-that-does-not-exist');
  const result = report(['report', '--extra-root', missing]);
  assert.equal(result.skills.length, 0);
  assert.equal(result.locations[0].status, 'missing');
  assert.equal(result.overview.locations_missing, 1);
  assert.equal(result.overview.locations_with_limited_access, 0);
  assert.match(result.limitations.join('\n'), /System-level|plugin-level/);
});

test('renders markdown and writes the same report to output', () => {
  const outputPath = path.join(os.tmpdir(), `skill-observer-${process.pid}.md`);
  try { fs.rmSync(outputPath, { force: true }); } catch { /* The path is already absent. */ }
  const result = report(['report', '--extra-root', fixtureRoot]);
  const markdown = render(result, 'markdown');
  const json = render(result, 'json');
  assert.match(markdown, /# Skill Observer · Skills 健康与使用报告/);
  assert.match(markdown, /## 🔥 常用的 Skills/);
  assert.match(markdown, /## 💤 不常用的 Skills/);
  assert.match(markdown, /## 🩺 Skills 体检/);
  assert.match(markdown, /## 🚨 有问题的 Skill/);
  assert.equal(JSON.parse(json).usage.status, 'not-collected');
  writeOutput(outputPath, markdown);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), `${markdown}\n`);
  assert.throws(() => writeOutput(outputPath, markdown), /Refusing to overwrite/);
  writeOutput(outputPath, 'replacement', true);
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'replacement\n');
  fs.rmSync(outputPath, { force: true });
});

test('prints help and accepts a portable absolute extra-root path', () => {
  assert.equal(parseArgs(['--help']).help, true);
  const result = report(['scan', '--extra-root', path.resolve(fixtureRoot)]);
  assert.ok(result.locations.some((location) => path.resolve(location.path) === path.resolve(fixtureRoot)));
  assert.equal(parseArgs(['report', '--with-codex-history']).withCodexHistory, true);
  assert.equal(parseArgs(['report', '--usage-days', '30']).usageDays, 30);
  assert.throws(() => parseArgs(['report', '--usage-days', '0']), /usage-days/);
});

test('scan, doctor, and report render distinct user-facing views', () => {
  const scan = report(['scan', '--extra-root', fixtureRoot]);
  const doctor = report(['doctor', '--extra-root', fixtureRoot]);
  const complete = report(['report', '--extra-root', fixtureRoot]);
  assert.match(render(scan, 'terminal'), /Skill Observer Scan/);
  assert.doesNotMatch(render(scan, 'terminal'), /静态上下文占用/);
  assert.match(render(doctor, 'markdown'), /# Skill Observer · Skills 体检/);
  assert.doesNotMatch(render(doctor, 'markdown'), /## Skill 清单/);
  assert.match(render(complete, 'terminal'), /上下文估算/);
  assert.equal(JSON.parse(render(scan, 'json')).result_scope, 'inventory');
  assert.equal(JSON.parse(render(doctor, 'json')).result_scope, 'health-and-relationship-findings');
  assert.equal(JSON.parse(render(complete, 'json')).result_scope, 'complete-report');
  assert.equal(JSON.parse(render(scan, 'json')).static_context, undefined);
  assert.ok(JSON.parse(render(complete, 'json')).static_context);
});

test('parses block-scalar descriptions and flags similar Chinese descriptions for manual review', (t) => {
  const root = makeTempRoot(t, 'skill-observer-frontmatter-');
  const first = path.join(root, 'chinese-one');
  fs.mkdirSync(first, { recursive: true });
  fs.writeFileSync(path.join(first, 'SKILL.md'), `---
name: chinese-one
description: >-
  检查本地安装的 Codex Skills，
  识别健康问题、重复项和上下文占用。
---

One.
`, 'utf8');
  writeSkill(
    root,
    'chinese-two',
    'chinese-two',
    '检查本地安装的 Codex Skills，识别健康问题、重复项和上下文占用情况。',
    'Two.',
  );
  const result = report(['doctor', '--extra-root', root]);
  const firstResult = result.skills.find((skill) => skill.name === 'chinese-one');
  assert.match(firstResult.description, /上下文占用/);
  const pair = result.relationship_findings.find((candidate) => candidate.type === 'similar-description');
  assert.ok(pair);
  assert.equal(pair.review_status, 'manual-review-recommended');
});

test('does not follow nested symlinks or inspect references outside the Skill', (t) => {
  const root = makeTempRoot(t, 'skill-observer-boundary-');
  const external = path.join(root, 'external');
  const skillRoot = path.join(root, 'skills');
  fs.mkdirSync(external, { recursive: true });
  fs.writeFileSync(path.join(external, 'secret.txt'), 'must not enter reports', 'utf8');
  const skill = writeSkill(
    skillRoot,
    'guarded-skill',
    'guarded-skill',
    'Inspect a guarded Skill without leaving its declared directory.',
    'See [outside](../../external/secret.txt).',
  );
  const referenceLink = path.join(skill, 'references');
  let symlinkCreated = true;
  try {
    fs.symlinkSync(external, referenceLink, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    symlinkCreated = false;
  }
  const linkedMdSkill = path.join(skillRoot, 'linked-md');
  fs.mkdirSync(linkedMdSkill, { recursive: true });
  let skillMdSymlinkCreated = true;
  try {
    fs.symlinkSync(
      path.join(external, 'secret.txt'),
      path.join(linkedMdSkill, 'SKILL.md'),
      process.platform === 'win32' ? 'file' : undefined,
    );
  } catch {
    skillMdSymlinkCreated = false;
  }
  const result = report(['doctor', '--extra-root', skillRoot]);
  const guarded = result.skills.find((candidate) => candidate.name === 'guarded-skill');
  assert.deepEqual(guarded.outside_links, ['../../external/secret.txt']);
  assert.ok(guarded.health_issues.includes('relative-reference-outside-skill'));
  if (symlinkCreated) {
    assert.ok(guarded.scan_notes.some((note) => note.startsWith('symlink-not-followed:references')));
    assert.equal(guarded.references_count, 1);
  }
  if (skillMdSymlinkCreated) {
    const linkedMd = result.skills.find((candidate) => candidate.name === 'linked-md');
    assert.ok(linkedMd.health_issues.includes('skill-md-symlink-not-followed'));
  }
  assert.doesNotMatch(JSON.stringify(result), /must not enter reports/);
});

test('hashes only SKILL.md and does not read resource contents for duplicate claims', (t) => {
  const root = makeTempRoot(t, 'skill-observer-hash-');
  const first = writeSkill(root, 'copy-one', 'copy-name', 'Same instruction metadata for local duplicate testing.', 'Same body.');
  const second = writeSkill(root, 'copy-two', 'copy-name', 'Same instruction metadata for local duplicate testing.', 'Same body.');
  for (const [skill, content] of [[first, 'export const value = 1;'], [second, 'export const value = 2;']]) {
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'scripts', 'code.mjs'), content, 'utf8');
  }
  const result = report(['doctor', '--extra-root', root]);
  assert.equal(result.skills[0].content_hash, result.skills[1].content_hash);
  assert.ok(result.relationship_findings.some((pair) => pair.type === 'identical-skill-md'));
  assert.ok(result.limitations.some((item) => /whole-bundle/.test(item)));
});

test('bounds oversized SKILL.md and deeply nested resource traversal', (t) => {
  const root = makeTempRoot(t, 'skill-observer-limits-');
  const huge = path.join(root, 'huge-skill');
  fs.mkdirSync(huge, { recursive: true });
  fs.writeFileSync(
    path.join(huge, 'SKILL.md'),
    `---\nname: huge-skill\ndescription: Oversized fixture.\n---\n${'x'.repeat(1024 * 1024 + 32)}`,
    'utf8',
  );
  const deep = writeSkill(root, 'deep-skill', 'deep-skill', 'Deep resource fixture.');
  let cursor = path.join(deep, 'references');
  for (let depth = 0; depth < 35; depth += 1) cursor = path.join(cursor, `d${depth}`);
  fs.mkdirSync(cursor, { recursive: true });
  fs.writeFileSync(path.join(cursor, 'end.md'), 'unreachable by bounded walk', 'utf8');
  const result = report(['doctor', '--extra-root', root]);
  const hugeResult = result.skills.find((skill) => skill.name === 'huge-skill');
  const deepResult = result.skills.find((skill) => skill.name === 'deep-skill');
  assert.ok(hugeResult.health_issues.includes('skill-md-too-large'));
  assert.ok(hugeResult.health_issues.some((issue) => issue.startsWith('skill-md-read-truncated:')));
  assert.equal(hugeResult.content_hash, null);
  assert.ok(deepResult.health_issues.some((issue) => issue.includes('resource-scan-truncated:depth-limit')));
});

test('checks reference definitions and angle-bracket paths containing spaces', (t) => {
  const root = makeTempRoot(t, 'skill-observer-links-');
  const skill = writeSkill(
    root,
    'link-skill',
    'link-skill',
    'Reference parser fixture.',
    'Read [inline](<references/My Guide.md>) and [defined][guide].\n\n[guide]: references/Other.md',
  );
  fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
  fs.writeFileSync(path.join(skill, 'references', 'My Guide.md'), 'guide', 'utf8');
  fs.writeFileSync(path.join(skill, 'references', 'Other.md'), 'other', 'utf8');
  const result = report(['doctor', '--extra-root', root]);
  const inspected = result.skills[0];
  assert.deepEqual(inspected.relative_links.sort(), ['references/My Guide.md', 'references/Other.md']);
  assert.deepEqual(inspected.missing_links, []);
});

test('ignores illustrative links inside fenced and inline code', (t) => {
  const root = makeTempRoot(t, 'skill-observer-code-links-');
  writeSkill(
    root,
    'example-skill',
    'example-skill',
    'Code example reference fixture.',
    `Read [real](references/real.md).

\`\`\`markdown
[example](references/does-not-exist.md)
\`\`\`

\`[inline example](references/also-missing.md)\``,
  );
  const references = path.join(root, 'example-skill', 'references');
  fs.mkdirSync(references, { recursive: true });
  fs.writeFileSync(path.join(references, 'real.md'), 'real', 'utf8');
  const result = report(['doctor', '--extra-root', root]);
  const inspected = result.skills[0];
  assert.deepEqual(inspected.relative_links, ['references/real.md']);
  assert.deepEqual(inspected.missing_links, []);
});

test('escapes untrusted Skill metadata in terminal and Markdown output', (t) => {
  const root = makeTempRoot(t, 'skill-observer-output-');
  writeSkill(
    root,
    'unsafe-skill',
    `unsafe\u001b[31mname`,
    '<script>alert(1)</script> | unsafe table text',
  );
  const result = report(['scan', '--extra-root', root]);
  const markdown = render(result, 'markdown');
  const terminal = render(result, 'terminal');
  assert.match(markdown, /&lt;script&gt;/);
  assert.doesNotMatch(markdown, /<script>/);
  assert.doesNotMatch(terminal, /\u001b/);
});

test('discovers immediate namespace containers without reporting the container as a broken Skill', (t) => {
  const root = makeTempRoot(t, 'skill-observer-namespace-');
  writeSkill(
    path.join(root, '.system'),
    'nested-skill',
    'nested-skill',
    'A Skill inside an immediate namespace container.',
  );
  const result = report(['scan', '--extra-root', root]);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, 'nested-skill');
  assert.match(result.skills[0].source, /extra-root\/\.system/);
  assert.ok(!result.skills.some((skill) => skill.name === '.system'));
});

test('counts only explicit Skill invocations from opt-in user-message history', (t) => {
  const root = makeTempRoot(t, 'skill-observer-usage-');
  const skillsRoot = path.join(root, 'skills');
  writeSkill(skillsRoot, 'used-skill', 'used-skill', 'A Skill with observable explicit invocations.');
  writeSkill(skillsRoot, 'quiet-skill', 'quiet-skill', 'A Skill without observable explicit invocations.');
  const history = path.join(root, 'history');
  fs.mkdirSync(history, { recursive: true });
  const now = new Date().toISOString();
  const records = [
    {
      timestamp: now,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Use $used-skill and [$used-skill](C:/skills/used-skill/SKILL.md).' }],
      },
    },
    {
      timestamp: now,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Please run $used-skill again. quiet-skill is only plain text.' }],
      },
    },
    {
      timestamp: now,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Assistant echoed $quiet-skill.' }],
      },
    },
  ];
  fs.writeFileSync(path.join(history, 'rollout.jsonl'), records.map((item) => JSON.stringify(item)).join('\n'), 'utf8');
  const result = report([
    'report',
    '--extra-root', skillsRoot,
    '--usage-root', history,
    '--usage-days', '30',
  ]);
  assert.equal(result.usage.status, 'available');
  assert.equal(result.usage.total_explicit_invocations, 2);
  assert.deepEqual(result.usage.observed_skills.map((item) => item.name), ['used-skill']);
  assert.deepEqual(result.usage.unobserved_skills, ['quiet-skill']);
  assert.equal(result.skills.find((skill) => skill.name === 'used-skill').explicit_invocations, 2);
  assert.equal(result.skills.find((skill) => skill.name === 'quiet-skill').explicit_invocations, 0);
  const markdown = render(result, 'markdown');
  assert.match(markdown, /\*\*used-skill\*\* \| 2/);
  assert.match(markdown, /`quiet-skill`/);
  assert.doesNotMatch(markdown, /Assistant echoed/);
});

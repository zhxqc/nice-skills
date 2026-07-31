#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const VERSION = 2;
const USAGE_DEFAULT_DAYS = 90;
const MAX_USAGE_FILES = 1000;
const MAX_USAGE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_USAGE_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_SKILL_MD_BYTES = 100 * 1024;
const MAX_SKILL_MD_READ_BYTES = 1024 * 1024;
const MAX_RESOURCE_ENTRIES = 10000;
const MAX_RESOURCE_DEPTH = 32;
const MAX_RELATIONSHIP_FINDINGS = 10000;
const MAX_SIMILARITY_COMPARISONS = 200000;

function printHelp() {
  console.log(`skill-observer - inspect locally discoverable Codex Skills

Usage:
  node observatory.mjs scan [options]
  node observatory.mjs doctor [options]
  node observatory.mjs report [options]

Options:
  --extra-root <path>       Add a directory to scan (repeatable)
  --format <terminal|markdown|json>
  --output <path>            Write the rendered report to a file
  --force-output             Allow --output to replace an existing file
  --no-standard-roots        Scan only explicitly supplied extra roots
  --with-codex-history       Count explicit $skill-name mentions in local Codex session history
  --usage-root <path>        Read explicit invocations from a JSONL file/directory (repeatable)
  --usage-days <days>        Usage lookback window; default: ${USAGE_DEFAULT_DAYS}
  -h, --help                 Show this help

Inspection is read-only. --output writes only the requested report file.
Usage history is opt-in. It counts explicit user invocations only and never outputs chat text.
The script uses only Node.js standard library APIs.
Exit code 0 means inspection completed, even when findings exist; code 2 means a CLI or runtime error.`);
}

function parseArgs(argv) {
  const args = [...argv];
  let command = args.shift() || 'report';
  if (command === '--help' || command === '-h') return { help: true };
  if (command.startsWith('-')) {
    args.unshift(command);
    command = 'report';
  }
  if (!['scan', 'doctor', 'report'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  const options = {
    command,
    format: 'terminal',
    extraRoots: [],
    usageRoots: [],
    usageDays: USAGE_DEFAULT_DAYS,
    withCodexHistory: false,
    standardRoots: true,
    forceOutput: false,
  };
  while (args.length) {
    const arg = args.shift();
    if (arg === '-h' || arg === '--help') return { help: true };
    if (arg === '--no-standard-roots') {
      options.standardRoots = false;
      continue;
    }
    if (arg === '--force-output') {
      options.forceOutput = true;
      continue;
    }
    if (arg === '--with-codex-history') {
      options.withCodexHistory = true;
      continue;
    }
    if (arg === '--extra-root' || arg === '--format' || arg === '--output' || arg === '--usage-root' || arg === '--usage-days') {
      const value = args.shift();
      if (!value) throw new Error(`${arg} requires a value`);
      if (arg === '--extra-root') options.extraRoots.push(value);
      if (arg === '--format') options.format = value;
      if (arg === '--output') options.output = value;
      if (arg === '--usage-root') options.usageRoots.push(value);
      if (arg === '--usage-days') options.usageDays = Number(value);
      continue;
    }
    const equal = arg.match(/^(--extra-root|--format|--output|--usage-root|--usage-days)=(.*)$/);
    if (equal) {
      if (!equal[2]) throw new Error(`${equal[1]} requires a value`);
      if (equal[1] === '--extra-root') options.extraRoots.push(equal[2]);
      if (equal[1] === '--format') options.format = equal[2];
      if (equal[1] === '--output') options.output = equal[2];
      if (equal[1] === '--usage-root') options.usageRoots.push(equal[2]);
      if (equal[1] === '--usage-days') options.usageDays = Number(equal[2]);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  if (!['terminal', 'markdown', 'json'].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }
  if (!Number.isInteger(options.usageDays) || options.usageDays < 1 || options.usageDays > 3650) {
    throw new Error('--usage-days must be an integer from 1 to 3650');
  }
  return options;
}

function addLocation(locations, seen, target, source, scope, explicit = false) {
  const resolved = path.resolve(target);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  if (seen.has(key)) return;
  seen.add(key);
  let status = 'scanned';
  let error;
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) status = 'not-directory';
  } catch (err) {
    if (err?.code === 'ENOENT') status = 'missing';
    else if (err?.code === 'EACCES' || err?.code === 'EPERM') status = 'inaccessible';
    else status = 'unreadable';
    error = err?.code || 'unknown-error';
  }
  locations.push({ path: resolved, source, scope, explicit, status, ...(error ? { error } : {}) });
}

function discoverProjectBases(cwd) {
  const repositories = [];
  let cursor = cwd;
  while (true) {
    try {
      fs.lstatSync(path.join(cursor, '.git'));
      repositories.push(cursor);
    } catch { /* This ancestor is not a Git repository root. */ }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return repositories.length ? repositories : [cwd];
}

function discoverLocations(options) {
  const locations = [];
  const seen = new Set();
  for (const root of options.extraRoots) addLocation(locations, seen, root, 'extra-root', 'extra', true);

  if (!options.standardRoots) return locations;

  const cwd = path.resolve(process.env.SKILL_OBSERVER_CWD || process.cwd());
  for (const projectBase of discoverProjectBases(cwd)) {
    addLocation(locations, seen, path.join(projectBase, '.agents', 'skills'), 'project-or-parent-.agents', 'project');
    addLocation(locations, seen, path.join(projectBase, '.codex', 'skills'), 'project-or-parent-.codex', 'project');
  }

  const home = path.resolve(process.env.SKILL_OBSERVER_HOME || process.env.USERPROFILE || process.env.HOME || os.homedir());
  addLocation(locations, seen, path.join(home, '.agents', 'skills'), 'user-.agents', 'user');
  addLocation(locations, seen, path.join(home, '.codex', 'skills'), 'user-.codex', 'user');
  if (process.env.CODEX_HOME) addLocation(locations, seen, path.join(process.env.CODEX_HOME, 'skills'), 'CODEX_HOME', 'user');
  return locations;
}

function safeReadDir(target) {
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { entries };
  } catch (err) {
    return { error: err?.code || 'unknown-error' };
  }
}

function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { present: false, values: {} };
  const closingOffset = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (closingOffset < 0) return { present: false, values: {} };
  const frontmatterLines = lines.slice(1, closingOffset + 1);
  const values = {};
  for (let index = 0; index < frontmatterLines.length; index += 1) {
    const line = frontmatterLines[index];
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (/^[>|][+-]?$/.test(rawValue)) {
      const block = [];
      let next = index + 1;
      while (next < frontmatterLines.length) {
        const candidate = frontmatterLines[next];
        if (candidate.trim() && !/^\s+/.test(candidate)) break;
        block.push(candidate.replace(/^\s+/, ''));
        next += 1;
      }
      values[key] = rawValue.startsWith('>')
        ? block.join(' ').replace(/\s+/g, ' ').trim()
        : block.join('\n').trim();
      index = next - 1;
      continue;
    }
    values[key] = parseScalar(rawValue);
  }
  return { present: true, values };
}

function parseScalar(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\([\\"'])/g, '$1');
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function markdownOutsideCode(text) {
  const kept = [];
  let fence;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (match) {
      const marker = match[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = undefined;
      }
      continue;
    }
    if (!fence) kept.push(line.replace(/(`+)([^`\n]*?)\1/g, ''));
  }
  return kept.join('\n');
}

function relativeLinks(text) {
  const searchable = markdownOutsideCode(text);
  const links = [];
  const add = (rawLink) => {
    let link = rawLink.trim();
    if (link.startsWith('<') && link.endsWith('>')) link = link.slice(1, -1);
    if (
      !link
      || link.startsWith('#')
      || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(link)
      || path.posix.isAbsolute(link)
      || path.win32.isAbsolute(link)
    ) return;
    const clean = link.split('#')[0].split('?')[0];
    if (!clean) return;
    let decoded = clean;
    try { decoded = decodeURIComponent(clean); } catch { /* Keep the original path. */ }
    if (!links.includes(decoded)) links.push(decoded);
  };

  const inline = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  let match;
  while ((match = inline.exec(searchable))) {
    add(match[1] ?? match[2]);
  }

  const definitions = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(?:<([^>]+)>|(\S+))/gm;
  while ((match = definitions.exec(searchable))) {
    add(match[1] ?? match[2]);
  }
  return links;
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function inspectRelativeLinks(skillPath, links) {
  const missing = [];
  const outside = [];
  for (const link of links) {
    const portableLink = link.replace(/[\\/]/g, path.sep);
    const target = path.resolve(skillPath, portableLink);
    if (!isPathInside(path.resolve(skillPath), target)) {
      outside.push(link);
      continue;
    }
    try {
      fs.lstatSync(target);
    } catch {
      missing.push(link);
    }
  }
  return { missing, outside };
}

function walkSkillFiles(skillPath) {
  const files = [];
  const issues = [];
  const notes = [];
  const pending = [{ current: skillPath, relative: '', depth: 0 }];
  let entriesVisited = 0;
  while (pending.length && entriesVisited < MAX_RESOURCE_ENTRIES) {
    const { current, relative, depth } = pending.pop();
    const result = safeReadDir(current);
    if (result.error) {
      issues.push(`${relative || path.basename(current)}:unreadable:${result.error}`);
      continue;
    }
    for (const entry of result.entries) {
      entriesVisited += 1;
      const child = path.join(current, entry.name);
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isSymbolicLink()) {
        try {
          fs.statSync(child);
        } catch (err) {
          issues.push(`${childRelative}:broken-symlink:${err?.code || 'unreadable'}`);
          continue;
        }
        notes.push(`symlink-not-followed:${childRelative}`);
        files.push({ path: child, relative: childRelative, symlink: true });
      } else if (entry.isDirectory()) {
        if (depth >= MAX_RESOURCE_DEPTH) {
          issues.push(`resource-scan-truncated:depth-limit:${childRelative}`);
        } else {
          pending.push({ current: child, relative: childRelative, depth: depth + 1 });
        }
      } else if (entry.isFile()) {
        files.push({ path: child, relative: childRelative, symlink: false });
      }
      if (entriesVisited >= MAX_RESOURCE_ENTRIES) {
        issues.push(`resource-scan-truncated:entry-limit:${MAX_RESOURCE_ENTRIES}`);
        pending.length = 0;
        break;
      }
    }
  }
  return { files, issues, notes };
}

function readSkillMd(skillMdPath) {
  let descriptor;
  try {
    const linkStat = fs.lstatSync(skillMdPath);
    if (linkStat.isSymbolicLink()) {
      return { error: 'symlink-not-followed', bytes: 0, text: '', buffer: null, truncated: false };
    }
    const stat = fs.statSync(skillMdPath);
    if (!stat.isFile()) return { error: 'not-a-file', bytes: 0, text: '', buffer: null, truncated: false };
    const bytesToRead = Math.min(stat.size, MAX_SKILL_MD_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    descriptor = fs.openSync(skillMdPath, 'r');
    const bytesRead = fs.readSync(descriptor, buffer, 0, bytesToRead, 0);
    const exactBuffer = buffer.subarray(0, bytesRead);
    return {
      bytes: stat.size,
      text: exactBuffer.toString('utf8'),
      buffer: stat.size <= MAX_SKILL_MD_READ_BYTES ? exactBuffer : null,
      truncated: stat.size > MAX_SKILL_MD_READ_BYTES,
    };
  } catch (err) {
    return { error: err?.code || 'unknown', bytes: 0, text: '', buffer: null, truncated: false };
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Ignore close failures after a completed read. */ }
    }
  }
}

function inspectSkill(skillPath, location) {
  const folderName = path.basename(skillPath);
  const healthIssues = [];
  const skillMdPath = path.join(skillPath, 'SKILL.md');
  const skillMd = readSkillMd(skillMdPath);
  const text = skillMd.text;
  const skillMdBytes = skillMd.bytes;
  if (skillMd.error) {
    if (skillMd.error === 'ENOENT') healthIssues.push('missing-skill-md');
    else if (skillMd.error === 'symlink-not-followed') healthIssues.push('skill-md-symlink-not-followed');
    else healthIssues.push(`unreadable-skill-md:${skillMd.error}`);
  }
  if (skillMd.truncated) healthIssues.push(`skill-md-read-truncated:${MAX_SKILL_MD_READ_BYTES}`);

  const frontmatter = text ? parseFrontmatter(text) : { present: false, values: {} };
  if (!frontmatter.present) healthIssues.push('missing-frontmatter');
  const name = typeof frontmatter.values.name === 'string' ? frontmatter.values.name.trim() : '';
  const description = typeof frontmatter.values.description === 'string' ? frontmatter.values.description.trim() : '';
  if (!name) healthIssues.push('missing-name');
  if (!description) healthIssues.push('missing-description');
  if (name && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)) healthIssues.push('invalid-name');
  if (name && name.toLowerCase() !== folderName.toLowerCase()) healthIssues.push('name-directory-mismatch');
  if (description.length > MAX_DESCRIPTION_CHARS) healthIssues.push('description-too-large');
  if (skillMdBytes > MAX_SKILL_MD_BYTES) healthIssues.push('skill-md-too-large');

  const links = text ? relativeLinks(text) : [];
  const checkedLinks = inspectRelativeLinks(skillPath, links);
  const missingLinks = checkedLinks.missing;
  if (missingLinks.length) healthIssues.push('missing-relative-reference');
  if (checkedLinks.outside.length) healthIssues.push('relative-reference-outside-skill');

  const walked = walkSkillFiles(skillPath);
  healthIssues.push(...walked.issues.map((issue) => `broken-or-unreadable-resource:${issue}`));
  const files = walked.files;
  const countUnder = (folder) => files.filter((file) => file.relative.split(/[\\/]/)[0].toLowerCase() === folder).length;
  const contentHash = skillMd.buffer ? crypto.createHash('sha256').update(skillMd.buffer).digest('hex') : null;
  const health = [...new Set(healthIssues)];
  return {
    name: name || folderName,
    description,
    scope: location.scope,
    source: location.source,
    path: path.resolve(skillPath),
    enabled: 'unknown',
    skill_md_bytes: skillMdBytes,
    description_chars: Array.from(description).length,
    scripts_count: countUnder('scripts'),
    references_count: countUnder('references'),
    assets_count: countUnder('assets'),
    relative_links: links,
    missing_links: missingLinks,
    outside_links: checkedLinks.outside,
    content_hash: contentHash,
    content_hash_scope: 'SKILL.md',
    bundle_content_comparison: 'unavailable-without-reading-resource-contents',
    duplicate_type: [],
    health_issues: health,
    scan_notes: walked.notes,
    usage_status: 'unavailable',
    explicit_invocations: null,
    last_explicit_invocation_at: null,
    data_coverage: `filesystem-scan (${location.source}; ${location.status})`,
  };
}

function nestedSkillDirectories(containerPath) {
  const result = safeReadDir(containerPath);
  if (result.error) return [];
  const nested = [];
  for (const entry of result.entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const candidate = path.join(containerPath, entry.name);
    try {
      if (fs.statSync(path.join(candidate, 'SKILL.md')).isFile()) nested.push(candidate);
    } catch { /* Not an immediate nested Skill. */ }
  }
  return nested;
}

function scanLocation(location) {
  if (location.status !== 'scanned') return [];
  const root = location.path;
  let isSkill = false;
  try { isSkill = fs.statSync(path.join(root, 'SKILL.md')).isFile(); } catch { /* Treat as a Skill root otherwise. */ }
  if (isSkill) return [inspectSkill(root, location)];
  const result = safeReadDir(root);
  if (result.error) {
    location.status = result.error === 'EACCES' || result.error === 'EPERM' ? 'inaccessible' : 'unreadable';
    location.error = result.error;
    return [];
  }
  const skills = [];
  for (const entry of result.entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        if (!fs.statSync(child).isDirectory()) continue;
      } catch (err) {
        skills.push({
          name: entry.name,
          description: '',
          scope: location.scope,
          source: location.source,
          path: path.resolve(child),
          enabled: 'unknown',
          skill_md_bytes: 0,
          description_chars: 0,
          scripts_count: 0,
          references_count: 0,
          assets_count: 0,
          relative_links: [],
          missing_links: [],
          outside_links: [],
          content_hash: null,
          content_hash_scope: 'SKILL.md',
          bundle_content_comparison: 'unavailable-without-reading-resource-contents',
          duplicate_type: [],
          health_issues: [`broken-symlink:${err?.code || 'unreadable'}`, 'missing-skill-md'],
          scan_notes: [],
          usage_status: 'unavailable',
          explicit_invocations: null,
          last_explicit_invocation_at: null,
          data_coverage: `filesystem-scan (${location.source}; inaccessible)`,
        });
        continue;
      }
    }
    let childIsSkill = false;
    try { childIsSkill = fs.statSync(path.join(child, 'SKILL.md')).isFile(); } catch { /* Inspect as a container or unhealthy Skill. */ }
    if (!childIsSkill) {
      const nested = nestedSkillDirectories(child);
      if (nested.length) {
        const nestedLocation = { ...location, source: `${location.source}/${entry.name}` };
        skills.push(...nested.map((candidate) => inspectSkill(candidate, nestedLocation)));
        continue;
      }
    }
    skills.push(inspectSkill(child, location));
  }
  return skills;
}

function addDuplicateTypes(skills) {
  const pairs = [];
  let findingsTruncated = false;
  let similarityComparisons = 0;
  let similarityTruncated = false;
  const addType = (skill, type) => {
    if (!skill.duplicate_type.includes(type)) skill.duplicate_type.push(type);
  };
  const record = (a, b, type, details = {}) => {
    addType(a, type);
    addType(b, type);
    if (pairs.length >= MAX_RELATIONSHIP_FINDINGS) {
      findingsTruncated = true;
      return;
    }
    pairs.push({ type, paths: [a.path, b.path], names: [a.name, b.name], ...details });
  };
  const recordGroup = (group, type) => {
    if (group.length < 2) return;
    for (const skill of group) addType(skill, type);
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (pairs.length >= MAX_RELATIONSHIP_FINDINGS) {
          findingsTruncated = true;
          return;
        }
        pairs.push({ type, paths: [group[i].path, group[j].path], names: [group[i].name, group[j].name] });
      }
    }
  };
  const groups = new Map();
  for (const skill of skills) {
    const key = skill.name.trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(skill);
  }
  for (const group of groups.values()) {
    recordGroup(group, 'same-name');
  }
  const hashGroups = new Map();
  for (const skill of skills) {
    if (!skill.content_hash) continue;
    if (!hashGroups.has(skill.content_hash)) hashGroups.set(skill.content_hash, []);
    hashGroups.get(skill.content_hash).push(skill);
  }
  for (const group of hashGroups.values()) {
    recordGroup(group, 'identical-skill-md');
  }
  similarityLoop:
  for (let i = 0; i < skills.length; i += 1) {
    for (let j = i + 1; j < skills.length; j += 1) {
      if (similarityComparisons >= MAX_SIMILARITY_COMPARISONS) {
        similarityTruncated = true;
        break similarityLoop;
      }
      similarityComparisons += 1;
      const similarity = descriptionSimilarity(skills[i].description, skills[j].description);
      if (similarity >= 0.82) {
        record(skills[i], skills[j], 'similar-description', {
          similarity: Math.round(similarity * 1000) / 1000,
          review_status: 'manual-review-recommended',
        });
      }
    }
  }
  return {
    pairs,
    analysis: {
      relationship_findings_limit: MAX_RELATIONSHIP_FINDINGS,
      relationship_findings_truncated: findingsTruncated,
      similarity_comparisons: similarityComparisons,
      similarity_comparisons_limit: MAX_SIMILARITY_COMPARISONS,
      similarity_comparisons_truncated: similarityTruncated,
    },
  };
}

function setSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / new Set([...a, ...b]).size;
}

function descriptionSimilarity(a, b) {
  const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const words = (text) => new Set(text.split(/\s+/).filter((token) => token.length >= 2));
  const compact = (text) => text.replace(/\s+/g, '');
  const ngrams = (text, size = 3) => {
    const points = Array.from(compact(text));
    const result = new Set();
    for (let index = 0; index <= points.length - size; index += 1) {
      result.add(points.slice(index, index + size).join(''));
    }
    return result;
  };
  const wordScore = setSimilarity(words(left), words(right));
  const leftNgrams = ngrams(left);
  const rightNgrams = ngrams(right);
  const characterScore = leftNgrams.size >= 4 && rightNgrams.size >= 4
    ? setSimilarity(leftNgrams, rightNgrams)
    : 0;
  return Math.max(wordScore, characterScore);
}

function groupRelationshipPairs(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = [...finding.paths].sort().join('\0');
    if (!grouped.has(key)) {
      grouped.set(key, {
        paths: finding.paths,
        names: finding.names,
        types: [],
      });
    }
    const pair = grouped.get(key);
    if (!pair.types.includes(finding.type)) pair.types.push(finding.type);
    if (finding.similarity !== undefined) pair.similarity = finding.similarity;
    if (finding.review_status) pair.review_status = finding.review_status;
  }
  return [...grouped.values()];
}

function codexHistoryRoots() {
  const home = path.resolve(process.env.SKILL_OBSERVER_HOME || process.env.USERPROFILE || process.env.HOME || os.homedir());
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(home, '.codex'));
  return [
    path.join(codexHome, 'sessions'),
    path.join(codexHome, 'archived_sessions'),
  ];
}

function collectUsageFiles(roots, cutoffMs) {
  const files = [];
  const skipped = [];
  const seen = new Set();
  const pending = roots.map((root) => path.resolve(root));
  while (pending.length && files.length < MAX_USAGE_FILES) {
    const current = pending.pop();
    let stat;
    try {
      const linkStat = fs.lstatSync(current);
      if (linkStat.isSymbolicLink()) {
        skipped.push({ path: current, reason: 'symlink-not-followed' });
        continue;
      }
      stat = fs.statSync(current);
    } catch (error) {
      skipped.push({ path: current, reason: error?.code || 'unreadable' });
      continue;
    }
    const key = process.platform === 'win32' ? current.toLowerCase() : current;
    if (seen.has(key)) continue;
    seen.add(key);
    if (stat.isDirectory()) {
      const result = safeReadDir(current);
      if (result.error) {
        skipped.push({ path: current, reason: result.error });
        continue;
      }
      for (const entry of result.entries) {
        if (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink()) {
          pending.push(path.join(current, entry.name));
        }
      }
      continue;
    }
    if (!stat.isFile() || path.extname(current).toLowerCase() !== '.jsonl') continue;
    if (stat.mtimeMs < cutoffMs) continue;
    if (stat.size > MAX_USAGE_FILE_BYTES) {
      skipped.push({ path: current, reason: `file-too-large:${stat.size}` });
      continue;
    }
    files.push({ path: current, bytes: stat.size });
  }
  if (pending.length) skipped.push({ path: roots.join(', '), reason: `file-limit:${MAX_USAGE_FILES}` });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

function forEachJsonlRecord(filePath, onRecord) {
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(256 * 1024);
  const decoder = new StringDecoder('utf8');
  let remainder = '';
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const text = remainder + decoder.write(buffer.subarray(0, bytesRead));
      const lines = text.split(/\r?\n/);
      remainder = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        try { onRecord(JSON.parse(line)); } catch { /* Ignore malformed or partial records. */ }
      }
    }
    const finalLine = remainder + decoder.end();
    if (finalLine) {
      try { onRecord(JSON.parse(finalLine)); } catch { /* Ignore a malformed final record. */ }
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function explicitSkillNamesFromUserRecord(record, skillPattern) {
  const payload = record?.type === 'response_item' ? record.payload : null;
  if (payload?.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) return [];
  const text = payload.content
    .filter((item) => item?.type === 'input_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
  if (!text) return [];
  const names = new Set();
  skillPattern.lastIndex = 0;
  let match;
  while ((match = skillPattern.exec(text))) names.add(match[1].toLowerCase());
  return [...names];
}

function collectUsage(options, skills, scannedAt) {
  const configuredRoots = [
    ...(options.withCodexHistory ? codexHistoryRoots() : []),
    ...(options.usageRoots || []),
  ];
  if (!configuredRoots.length) {
    return {
      status: 'not-collected',
      method: 'explicit-user-invocations-only',
      explanation: '本次未读取调用历史。需要统计时使用 --with-codex-history；自动触发目前没有可靠计数来源。',
      window_days: options.usageDays || USAGE_DEFAULT_DAYS,
      roots: [],
      files_scanned: 0,
      files_skipped: 0,
      total_explicit_invocations: null,
      observed_skills: [],
      unobserved_skills: skills.map((skill) => skill.name),
    };
  }

  const uniqueNames = [...new Set(skills.map((skill) => skill.name.toLowerCase()))];
  if (!uniqueNames.length) {
    return {
      status: 'available',
      method: 'explicit-user-invocations-only',
      explanation: '已检查历史，但本次没有发现可匹配的 Skill。',
      window_days: options.usageDays,
      roots: configuredRoots.map((root) => path.resolve(root)),
      files_scanned: 0,
      files_skipped: 0,
      total_explicit_invocations: 0,
      observed_skills: [],
      unobserved_skills: [],
    };
  }
  const escapedNames = uniqueNames
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const skillPattern = new RegExp(`\\$(${escapedNames.join('|')})(?![a-z0-9-])`, 'gi');
  const scannedAtMs = new Date(scannedAt).getTime();
  const cutoffMs = scannedAtMs - options.usageDays * 24 * 60 * 60 * 1000;
  const discovered = collectUsageFiles(configuredRoots, cutoffMs);
  const counts = new Map(uniqueNames.map((name) => [name, { count: 0, last_at: null }]));
  let totalBytes = 0;
  let filesScanned = 0;
  for (const file of discovered.files) {
    if (totalBytes + file.bytes > MAX_USAGE_TOTAL_BYTES) {
      discovered.skipped.push({ path: file.path, reason: `total-byte-limit:${MAX_USAGE_TOTAL_BYTES}` });
      continue;
    }
    totalBytes += file.bytes;
    try {
      forEachJsonlRecord(file.path, (record) => {
        const timestampMs = Date.parse(record?.timestamp || '');
        if (!Number.isFinite(timestampMs) || timestampMs < cutoffMs || timestampMs > scannedAtMs) return;
        const names = explicitSkillNamesFromUserRecord(record, skillPattern);
        for (const name of names) {
          const item = counts.get(name);
          if (!item) continue;
          item.count += 1;
          if (!item.last_at || record.timestamp > item.last_at) item.last_at = record.timestamp;
        }
      });
      filesScanned += 1;
    } catch {
      discovered.skipped.push({ path: file.path, reason: 'read-failed' });
    }
  }
  const observed = [...counts.entries()]
    .filter(([, item]) => item.count > 0)
    .map(([name, item]) => ({ name, explicit_invocations: item.count, last_at: item.last_at }))
    .sort((a, b) => b.explicit_invocations - a.explicit_invocations || a.name.localeCompare(b.name));
  const unobserved = [...counts.entries()]
    .filter(([, item]) => item.count === 0)
    .map(([name]) => name)
    .sort();
  return {
    status: discovered.skipped.some((item) => /limit|failed|EACCES|EPERM|unreadable/i.test(item.reason)) ? 'partial' : 'available',
    method: 'explicit-user-invocations-only',
    explanation: '只统计用户消息中明确写出的 $skill-name；不会读取或输出聊天正文。自动触发、仅加载元数据或仅扫描到文件都不计入调用。',
    window_days: options.usageDays,
    period_start: new Date(cutoffMs).toISOString(),
    period_end: scannedAt,
    roots: configuredRoots.map((root) => path.resolve(root)),
    files_scanned: filesScanned,
    files_skipped: discovered.skipped.length,
    bytes_scanned: totalBytes,
    total_explicit_invocations: observed.reduce((sum, item) => sum + item.explicit_invocations, 0),
    observed_skills: observed,
    unobserved_skills: unobserved,
    limits: {
      files: MAX_USAGE_FILES,
      per_file_bytes: MAX_USAGE_FILE_BYTES,
      total_bytes: MAX_USAGE_TOTAL_BYTES,
    },
  };
}

function explainIssue(issue, skill) {
  const exact = {
    'missing-skill-md': ['error', '结构', '缺少主指令文件', '目录中没有 SKILL.md，Codex 无法把它作为正常 Skill 使用。', '补充 SKILL.md，或移出 Skill 根目录。'],
    'skill-md-symlink-not-followed': ['error', '结构', '主指令文件是符号链接', '为避免越界读取，本次没有跟随 SKILL.md 符号链接。', '改为真实文件，或人工确认链接目标后再处理。'],
    'missing-frontmatter': ['error', '元数据', '缺少有效的 YAML 头部', 'SKILL.md 顶部没有可识别的 --- YAML --- 区块。', '补充仅含 name 和 description 的 YAML 头部。'],
    'missing-name': ['error', '元数据', '缺少 Skill 名称', 'YAML 头部没有有效的 name。', '补充小写、数字和连字符组成的 name。'],
    'missing-description': ['error', '元数据', '缺少用途描述', 'YAML 头部没有有效的 description，可能无法正确触发。', '补充清楚说明能力和触发场景的 description。'],
    'invalid-name': ['error', '元数据', 'Skill 名称格式不合规', 'name 应只包含小写字母、数字和连字符，且不超过 64 个字符。', '修正 name，并保持目录名一致。'],
    'name-directory-mismatch': ['warning', '元数据', 'Skill 名称与目录名不一致', `声明名称“${skill.name}”与目录“${path.basename(skill.path)}”不同。`, '统一 name 与目录名，避免发现和安装时混淆。'],
    'description-too-large': ['warning', '上下文', '用途描述偏长', `description 有 ${skill.description_chars} 个字符，超过建议值 ${MAX_DESCRIPTION_CHARS}。`, '压缩触发描述，把详细说明移到正文或 references/。'],
    'skill-md-too-large': ['warning', '上下文', '主指令文件偏大', `SKILL.md 为 ${formatBytes(skill.skill_md_bytes)}，超过建议值 ${formatBytes(MAX_SKILL_MD_BYTES)}。仍可使用，但可能占用较多上下文。`, '保留核心流程，把详细资料和长示例拆到 references/。'],
    'missing-relative-reference': ['error', '引用', '引用的本地文件不存在', `缺失：${skill.missing_links.join('、') || '未定位'}`, '修正链接，或补充被引用文件。'],
    'relative-reference-outside-skill': ['warning', '边界', '引用指向 Skill 目录外', `越界引用：${skill.outside_links.join('、') || '未定位'}`, '把依赖文件放回 Skill 内，或人工确认这是有意设计。'],
  };
  if (exact[issue]) {
    const [severity, category, title, detail, suggestion] = exact[issue];
    return { code: issue, severity, category, title, detail, suggestion };
  }
  if (issue.startsWith('skill-md-read-truncated:')) {
    return { code: issue, severity: 'warning', category: '覆盖', title: '主指令文件只检查了前一部分', detail: `文件超过安全读取上限 ${formatBytes(MAX_SKILL_MD_READ_BYTES)}。`, suggestion: '拆分过大的 SKILL.md 后重新检查。' };
  }
  if (issue.startsWith('unreadable-skill-md:')) {
    return { code: issue, severity: 'error', category: '访问', title: '无法读取主指令文件', detail: `系统返回：${issue.split(':').slice(1).join(':')}`, suggestion: '检查文件权限、占用状态和路径。' };
  }
  if (issue.startsWith('broken-symlink:')) {
    return { code: issue, severity: 'error', category: '结构', title: 'Skill 目录链接已失效', detail: `系统返回：${issue.split(':').slice(1).join(':')}`, suggestion: '修复链接目标，或移除失效链接。' };
  }
  if (issue.startsWith('broken-or-unreadable-resource:')) {
    return { code: issue, severity: 'warning', category: '资源', title: '部分资源无法完整检查', detail: issue.replace('broken-or-unreadable-resource:', ''), suggestion: '检查对应资源路径、链接和读取权限。' };
  }
  return { code: issue, severity: 'warning', category: '其他', title: '发现需要人工确认的项目', detail: issue, suggestion: '查看 JSON 报告中的机器码并人工检查。' };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 / 1024 * 10) / 10} MB`;
}

function createReport(options) {
  const scannedAt = new Date().toISOString();
  const locations = discoverLocations(options);
  const skills = locations.flatMap(scanLocation);
  const duplicateResult = addDuplicateTypes(skills);
  const relationshipFindings = duplicateResult.pairs;
  const duplicatePairs = groupRelationshipPairs(relationshipFindings);
  const candidateMetadata = skills.map((skill) => `${skill.name}: ${skill.description}`).join('\n');
  const metadataChars = Array.from(candidateMetadata).length;
  const metadataBytes = Buffer.byteLength(candidateMetadata, 'utf8');
  const skillBodyBytes = skills.reduce((sum, skill) => sum + skill.skill_md_bytes, 0);
  const largestSkillBodyBytes = skills.reduce((largest, skill) => Math.max(largest, skill.skill_md_bytes), 0);
  const staticContext = {
    candidate_list_chars: metadataChars,
    skill_metadata_bytes_estimate: metadataBytes,
    skill_body_bytes: skillBodyBytes,
    largest_skill_md_bytes: largestSkillBodyBytes,
    estimated_context_bytes: metadataBytes + largestSkillBodyBytes,
    note: 'Estimate = all discovered name/description metadata plus the largest single SKILL.md. It does not assume every Skill body is injected, and it is not a runtime token or usage measurement.',
  };
  const missingLocations = locations.filter((location) => location.status === 'missing');
  const inaccessibleLocations = locations.filter((location) => ['inaccessible', 'unreadable'].includes(location.status));
  const invalidLocations = locations.filter((location) => location.status === 'not-directory');
  const recommendations = skills.filter((skill) => skill.health_issues.length > 0).map((skill) => {
    const meaningfulIssues = skill.health_issues.includes('missing-skill-md')
      ? skill.health_issues.filter((issue) => !['missing-frontmatter', 'missing-name', 'missing-description'].includes(issue))
      : skill.health_issues;
    return {
      name: skill.name,
      path: skill.path,
      issues: skill.health_issues,
      findings: meaningfulIssues.map((issue) => explainIssue(issue, skill)),
      action: '人工检查后再决定是否修复、合并、禁用或删除；本工具不会自动修改 Skill。',
    };
  });
  const usage = collectUsage(options, skills, scannedAt);
  const usageByName = new Map(usage.observed_skills.map((item) => [item.name, item]));
  for (const skill of skills) {
    const observed = usageByName.get(skill.name.toLowerCase());
    skill.usage_status = usage.status === 'not-collected' ? 'not-collected' : 'observed-explicit-only';
    skill.explicit_invocations = usage.status === 'not-collected' ? null : (observed?.explicit_invocations || 0);
    skill.last_explicit_invocation_at = observed?.last_at || null;
  }
  const healthFindings = recommendations.flatMap((item) => item.findings);
  const skillsWithErrors = recommendations.filter((item) => item.findings.some((finding) => finding.severity === 'error')).length;
  const skillsWithWarnings = recommendations.filter((item) => (
    item.findings.some((finding) => finding.severity === 'warning')
    && !item.findings.some((finding) => finding.severity === 'error')
  )).length;
  return {
    version: VERSION,
    command: options.command,
    scanned_at: scannedAt,
    overview: {
      locations_requested: locations.length,
      locations_scanned: locations.filter((location) => location.status === 'scanned').length,
      locations_missing: missingLocations.length,
      locations_with_limited_access: inaccessibleLocations.length,
      locations_invalid: invalidLocations.length,
      skills_found: skills.length,
      healthy_skills: skills.length - recommendations.length,
      skills_with_health_issues: skills.filter((skill) => skill.health_issues.length > 0).length,
      skills_with_errors: skillsWithErrors,
      skills_with_warnings: skillsWithWarnings,
      error_findings: healthFindings.filter((finding) => finding.severity === 'error').length,
      warning_findings: healthFindings.filter((finding) => finding.severity === 'warning').length,
      duplicate_pairs: duplicatePairs.length,
      relationship_findings: relationshipFindings.length,
    },
    locations,
    skills,
    duplicate_pairs: duplicatePairs,
    relationship_findings: relationshipFindings,
    duplicate_analysis: duplicateResult.analysis,
    static_context: staticContext,
    usage,
    recommendations,
    limitations: [
      'Usage counts cover explicit $skill-name mentions in user messages only when history access is enabled; automatic Skill selection is not observable from a stable local counter.',
      'System-level or plugin-level Skills are not represented unless their directories are discoverable or explicitly supplied with --extra-root.',
      'Frontmatter validation covers only the name and description subset needed by this Skill, not the complete YAML specification.',
      'Relative reference checks cover inline Markdown link destinations and reference definitions, not arbitrary bare paths in prose or code blocks.',
      'Content hashes cover SKILL.md only. Resource contents are not read, so whole-bundle byte-for-byte duplicate detection is unavailable.',
      `Skill instructions larger than ${MAX_SKILL_MD_READ_BYTES} bytes and resource trees beyond ${MAX_RESOURCE_ENTRIES} entries or ${MAX_RESOURCE_DEPTH} levels are truncated and marked as limited coverage.`,
      `Relationship findings are capped at ${MAX_RELATIONSHIP_FINDINGS} records and description similarity at ${MAX_SIMILARITY_COMPARISONS} comparisons; truncation is reported in duplicate_analysis.`,
      'Exit code 0 means the inspection completed, even when health or relationship findings are present; code 2 indicates a CLI or runtime failure.',
    ],
  };
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '?')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('\r', '')
    .replaceAll('\n', '<br>');
}

function terminalText(value) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '?');
}

function locationStatusLabel(status) {
  return ({
    scanned: '✅ 已扫描',
    missing: '➖ 不存在',
    inaccessible: '❌ 无法访问',
    unreadable: '❌ 无法读取',
    'not-directory': '⚠️ 不是目录',
  })[status] || status;
}

function scopeLabel(scope) {
  return ({ user: '用户级', project: '项目级', extra: '额外指定' })[scope] || scope;
}

function compactText(value, maxChars = 90) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  const points = Array.from(normalized);
  return points.length <= maxChars ? normalized : `${points.slice(0, maxChars - 1).join('')}…`;
}

function localTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function markdownLocationTable(report) {
  return [
    '| 状态 | 作用域 | 来源 | 路径 |',
    '| --- | --- | --- | --- |',
    ...report.locations.map((location) => `| ${locationStatusLabel(location.status)} | ${scopeLabel(location.scope)} | ${markdownCell(location.source)} | ${markdownCell(location.path)} |`),
  ];
}

function markdownSkillTable(report) {
  return [
    '| 状态 | Skill | 用途 | 作用域 | 主指令大小 | 配套资源 | 显式调用 |',
    '| :---: | --- | --- | --- | ---: | ---: | ---: |',
    ...report.skills.map((skill) => {
      const status = skill.health_issues.length
        ? (skill.health_issues.map((issue) => explainIssue(issue, skill)).some((finding) => finding.severity === 'error') ? '❌ 需修复' : '⚠️ 提醒')
        : '✅ 正常';
      const resources = skill.scripts_count + skill.references_count + skill.assets_count;
      const usage = skill.explicit_invocations === null ? '未统计' : skill.explicit_invocations;
      return `| ${status} | **${markdownCell(skill.name)}** | ${markdownCell(compactText(skill.description) || '—')} | ${scopeLabel(skill.scope)} | ${formatBytes(skill.skill_md_bytes)} | ${resources} | ${usage} |`;
    }),
  ];
}

function markdownHealthLines(report) {
  return [
    ...(report.duplicate_pairs.length
      ? report.duplicate_pairs.map((pair) => {
        const displayNames = pair.names[0] === pair.names[1]
          ? pair.paths.map((item) => path.basename(item))
          : pair.names;
        return `- **${pair.types.map(relationshipLabel).join('、')}**：${markdownCell(displayNames.join(' ↔ '))}${pair.similarity ? `（相似度 ${Math.round(pair.similarity * 100)}%，仅建议人工确认）` : ''}`;
      })
      : ['- 未发现同名、完全相同的 SKILL.md 或高相似描述配对。']),
    ...(report.duplicate_analysis.relationship_findings_truncated || report.duplicate_analysis.similarity_comparisons_truncated
      ? ['- **覆盖受限**：重复/相似关系分析达到安全上限，详见 JSON `duplicate_analysis`。']
      : []),
  ];
}

function relationshipLabel(type) {
  return ({
    'same-name': '名称相同',
    'identical-skill-md': '主指令内容完全相同',
    'similar-description': '用途描述高度相似',
  })[type] || type;
}

function healthBar(report) {
  const total = report.overview.skills_found;
  if (!total) return '░░░░░░░░░░ 0%';
  const healthy = report.overview.healthy_skills;
  const filled = Math.floor(healthy / total * 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.round(healthy / total * 100)}%`;
}

function markdownUsageSections(report) {
  const usage = report.usage;
  if (usage.status === 'not-collected') {
    return [
      '## 🔥 常用的 Skills',
      '',
      '> 暂无排名：本次没有读取调用历史。使用 `--with-codex-history` 后可统计可观测的显式调用。',
      '',
      '## 💤 不常用的 Skills',
      '',
      '> 暂无判断：没有历史数据时，不能把“已安装”误判成“从未使用”。',
    ];
  }
  const common = usage.observed_skills.slice(0, 10);
  return [
    '## 🔥 常用的 Skills',
    '',
    ...(usage.status === 'partial' ? ['> ⚠️ 部分历史文件因安全上限或读取限制被跳过，排名仅代表已覆盖的数据。', ''] : []),
    common.length
      ? `统计窗口：最近 ${usage.window_days} 天。这里只计算用户明确写出的 \`$skill-name\`。`
      : `最近 ${usage.window_days} 天没有识别到显式 Skill 调用。`,
    '',
    ...(common.length ? [
      '| 排名 | Skill | 显式调用 | 最近一次 |',
      '| ---: | --- | ---: | --- |',
      ...common.map((item, index) => `| ${index + 1} | **${markdownCell(item.name)}** | ${item.explicit_invocations} | ${markdownCell(localTime(item.last_at))} |`),
    ] : []),
    '',
    '## 💤 不常用的 Skills',
    '',
    usage.unobserved_skills.length
      ? `以下 ${usage.unobserved_skills.length} 个 Skill 在统计窗口内**没有发现显式调用**：`
      : '所有已发现 Skill 都有至少一次可观测的显式调用。',
    '',
    ...(usage.unobserved_skills.length ? [
      usage.unobserved_skills.map((name) => `\`${markdownCell(name)}\``).join(' · '),
      '',
      '> “未发现显式调用”不等于“从未使用”：Codex 自动触发目前没有稳定的本地计数来源。',
    ] : []),
  ];
}

function markdownProblemSections(report) {
  if (!report.recommendations.length) return ['✅ 没有发现需要处理的 Skill。'];
  const lines = [];
  for (const item of report.recommendations) {
    const worst = item.findings.some((finding) => finding.severity === 'error') ? '❌' : '⚠️';
    lines.push(`### ${worst} ${markdownCell(item.name)}`, '', `路径：\`${markdownCell(item.path)}\``, '');
    lines.push('| 类型 | 发现 | 这意味着什么 | 建议 |', '| --- | --- | --- | --- |');
    for (const finding of item.findings) {
      const icon = finding.severity === 'error' ? '❌ 需修复' : '⚠️ 建议优化';
      lines.push(`| ${icon} · ${markdownCell(finding.category)} | **${markdownCell(finding.title)}** | ${markdownCell(finding.detail)} | ${markdownCell(finding.suggestion)} |`);
    }
    lines.push('', `<details><summary>机器可读代码</summary>`, '', item.issues.map((issue) => `- \`${markdownCell(issue)}\``).join('\n'), '', '</details>', '');
  }
  return lines;
}

function renderScanMarkdown(report) {
  return [
    '# Skill Observer · Skill 清单',
    '',
    `发现 **${report.overview.skills_found}** 个 Skill；成功扫描 **${report.overview.locations_scanned}/${report.overview.locations_requested}** 个位置。`,
    '',
    '## 数据来源与覆盖范围',
    '',
    ...markdownLocationTable(report),
    '',
    '## Skill 清单',
    '',
    ...markdownSkillTable(report),
    '',
    `调用统计：${report.usage.status === 'not-collected' ? '本次未采集' : `已统计 ${report.usage.total_explicit_invocations} 次显式调用`}。${report.usage.explanation}`,
  ].join('\n');
}

function renderDoctorMarkdown(report) {
  return [
    '# Skill Observer · Skills 体检',
    '',
    `体检完成：**${report.overview.healthy_skills} 个正常**，**${report.overview.skills_with_errors} 个需修复**，**${report.overview.skills_with_warnings} 个有优化提醒**。`,
    '',
    '## 数据来源与覆盖范围',
    '',
    ...markdownLocationTable(report),
    '',
    '## 有问题的 Skill',
    '',
    ...markdownProblemSections(report),
    '',
    '## 同名、重复与相似项',
    '',
    ...markdownHealthLines({ ...report, recommendations: [] }),
    '',
    '相似描述只表示“建议人工检查”，不构成重复判定。',
  ].join('\n');
}

function renderMarkdown(report) {
  if (report.command === 'scan') return renderScanMarkdown(report);
  if (report.command === 'doctor') return renderDoctorMarkdown(report);
  const lines = [
    '# Skill Observer · Skills 健康与使用报告',
    '',
    `> 生成时间：${markdownCell(localTime(report.scanned_at))}（本地时间） · 只读检查 · 未修改任何 Skill`,
    '',
    '## 📊 总结',
    '',
    '| 📦 已发现 | ✅ 完全正常 | ❌ 需修复 | ⚠️ 优化提醒 | 🔁 显式调用 |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| **${report.overview.skills_found}** | **${report.overview.healthy_skills}** | **${report.overview.skills_with_errors}** | **${report.overview.skills_with_warnings}** | **${report.usage.total_explicit_invocations ?? '未统计'}** |`,
    '',
    `整体健康度：\`${healthBar(report)}\``,
    '',
    report.overview.skills_with_errors
      ? `**结论：有 ${report.overview.skills_with_errors} 个 Skill 需要修复。** 另有 ${report.overview.skills_with_warnings} 个优化提醒。`
      : report.overview.skills_with_warnings
        ? `**结论：没有发现损坏的 Skill。** 有 ${report.overview.skills_with_warnings} 个优化提醒，不影响继续使用。`
        : '**结论：当前发现的 Skill 全部通过体检。**',
    '',
    ...markdownUsageSections(report),
    '',
    '## 🩺 Skills 体检',
    '',
    `健康分布：${report.overview.healthy_skills} 个正常 · ${report.overview.skills_with_errors} 个需修复 · ${report.overview.skills_with_warnings} 个有提醒。`,
    '',
    ...markdownSkillTable(report),
    '',
    '## 🚨 有问题的 Skill',
    '',
    ...markdownProblemSections(report),
    '',
    '## 🔍 同名、重复与相似项',
    '',
    ...markdownHealthLines({ ...report, recommendations: [] }),
    '',
    '相似描述只表示“建议人工确认”，不代表两个 Skill 一定重复。',
    '',
    '## 🧠 上下文占用',
    '',
    '| 项目 | 估算 |',
    '| --- | ---: |',
    `| 所有 Skill 的名称与描述 | ${formatBytes(report.static_context.skill_metadata_bytes_estimate)} |`,
    `| 最大的单个 SKILL.md | ${formatBytes(report.static_context.largest_skill_md_bytes)} |`,
    `| 单次最坏静态上下文估算 | **${formatBytes(report.static_context.estimated_context_bytes)}** |`,
    '',
    '> 这是静态估算，不是实际 Token 消耗，也不表示所有 SKILL.md 会同时加载。',
    '',
    '## 🗺️ 扫描范围',
    '',
    ...markdownLocationTable(report),
    '',
    `成功扫描 ${report.overview.locations_scanned}/${report.overview.locations_requested} 个位置；${report.overview.locations_missing} 个位置不存在；${report.overview.locations_with_limited_access} 个位置访问受限。`,
    '',
    '## ℹ️ 调用统计口径与限制',
    '',
    `- ${report.usage.explanation}`,
    ...(report.usage.status !== 'not-collected' ? [
      `- 统计窗口：${report.usage.period_start} 至 ${report.usage.period_end}`,
      `- 历史文件：扫描 ${report.usage.files_scanned} 个，跳过 ${report.usage.files_skipped} 个`,
    ] : []),
    '- 系统级或插件级 Skill 只有在目录可发现或通过 `--extra-root` 指定时才会进入结果。',
    '- 报告中的机器码只用于 JSON 和技术排查；正文优先展示中文含义、影响和建议。',
    '',
    '<details><summary>更多技术限制</summary>',
    '',
    ...report.limitations.map((item) => `- ${item}`),
    '',
    '</details>',
  ];
  return lines.join('\n');
}

function terminalCoverageLines(report) {
  return report.locations.map((location) => `  ${terminalText(locationStatusLabel(location.status))} | ${terminalText(scopeLabel(location.scope))} | ${terminalText(location.source)} | ${terminalText(location.path)}`);
}

function terminalSkillLines(report) {
  return report.skills.length
    ? report.skills.map((skill) => {
      const findings = skill.health_issues.map((issue) => explainIssue(issue, skill));
      const status = findings.some((finding) => finding.severity === 'error') ? '需修复' : findings.length ? '提醒' : '正常';
      const usage = skill.explicit_invocations === null ? '未统计' : `${skill.explicit_invocations} 次显式调用`;
      return `  - [${status}] ${terminalText(skill.name)} | ${terminalText(scopeLabel(skill.scope))} | ${formatBytes(skill.skill_md_bytes)} | ${usage}${findings.length ? ` | ${terminalText(findings.map((finding) => finding.title).join('；'))}` : ''}`;
    })
    : ['  - 未发现 Skill。'];
}

function terminalHealthLines(report) {
  return [
    ...(report.recommendations.length
      ? report.recommendations.flatMap((item) => [
        `  - ${terminalText(item.name)}：`,
        ...item.findings.map((finding) => `      ${finding.severity === 'error' ? '[需修复]' : '[提醒]'} ${terminalText(finding.title)}。${terminalText(finding.detail)} 建议：${terminalText(finding.suggestion)}`),
      ])
      : ['  - 未发现健康问题。']),
    ...(report.relationship_findings.length
      ? report.relationship_findings.map((finding) => `  - ${terminalText(relationshipLabel(finding.type))}: ${terminalText(finding.names.join(' ↔ '))}${finding.similarity ? ` | 相似度 ${Math.round(finding.similarity * 100)}%（仅建议人工确认）` : ''}`)
      : ['  - 未发现重复或高相似配对。']),
    ...(report.duplicate_analysis.relationship_findings_truncated || report.duplicate_analysis.similarity_comparisons_truncated
      ? ['  - 覆盖受限：关系分析达到安全上限；JSON duplicate_analysis 提供详情。']
      : []),
  ];
}

function renderScanTerminal(report) {
  return [
    'Skill Observer Scan',
    `发现 ${report.overview.skills_found} 个 Skill；扫描 ${report.overview.locations_scanned}/${report.overview.locations_requested} 个位置。`,
    '',
    '数据来源与覆盖范围：',
    ...terminalCoverageLines(report),
    '',
    'Skill 清单：',
    ...terminalSkillLines(report),
    '',
    `调用统计：${report.usage.total_explicit_invocations === null ? '未统计' : `${report.usage.total_explicit_invocations} 次显式调用`}。${report.usage.explanation}`,
  ].join('\n');
}

function renderDoctorTerminal(report) {
  return [
    'Skill Observer Doctor',
    `体检完成：${report.overview.healthy_skills} 个正常；${report.overview.skills_with_errors} 个需修复；${report.overview.skills_with_warnings} 个有优化提醒。`,
    '',
    '数据来源与覆盖范围：',
    ...terminalCoverageLines(report),
    '',
    '健康问题、同名和重复项：',
    ...terminalHealthLines(report),
    '',
    '相似描述只表示建议人工检查，不构成重复判定。',
  ].join('\n');
}

function renderTerminal(report) {
  if (report.command === 'scan') return renderScanTerminal(report);
  if (report.command === 'doctor') return renderDoctorTerminal(report);
  const lines = [
    'Skill Observer · Skills 健康与使用报告',
    `总结：${report.overview.skills_found} 个 Skill | ${report.overview.healthy_skills} 个正常 | ${report.overview.skills_with_errors} 个需修复 | ${report.overview.skills_with_warnings} 个有提醒 | 显式调用 ${report.usage.total_explicit_invocations ?? '未统计'}`,
    '',
    '常用 Skills：',
    ...(report.usage.status === 'not-collected'
      ? ['  - 暂无排名；使用 --with-codex-history 后统计。']
      : report.usage.observed_skills.slice(0, 10).map((item, index) => `  ${index + 1}. ${terminalText(item.name)} | ${item.explicit_invocations} 次 | 最近 ${terminalText(localTime(item.last_at))}`)),
    '',
    '不常用 Skills：',
    ...(report.usage.status === 'not-collected'
      ? ['  - 暂无判断；没有历史数据时不会把已安装误判成未使用。']
      : [`  - ${terminalText(report.usage.unobserved_skills.join(', ') || '无')}`, '  - 未发现显式调用不等于从未自动触发。']),
    '',
    'Skills 体检：',
    ...terminalSkillLines(report),
    '',
    '有问题的 Skill：',
    ...(report.recommendations.length
      ? report.recommendations.flatMap((item) => [
        `  - ${terminalText(item.name)}`,
        ...item.findings.map((finding) => `      ${finding.severity === 'error' ? '[需修复]' : '[提醒]'} ${terminalText(finding.title)}：${terminalText(finding.detail)} 建议：${terminalText(finding.suggestion)}`),
      ])
      : ['  - 未发现需要处理的 Skill。']),
    '',
    '同名和重复项：',
    ...(report.duplicate_pairs.length ? report.duplicate_pairs.map((pair) => `  - ${terminalText(pair.types.map(relationshipLabel).join('、'))}: ${terminalText(pair.names.join(' ↔ '))}`) : ['  - 未发现同名、完全相同的 SKILL.md 或高相似描述配对。']),
    '',
    `上下文估算：元数据 ${formatBytes(report.static_context.skill_metadata_bytes_estimate)} + 最大单个 SKILL.md ${formatBytes(report.static_context.largest_skill_md_bytes)} = ${formatBytes(report.static_context.estimated_context_bytes)}。`,
    `调用口径：${report.usage.explanation}`,
    '',
    '扫描范围：',
    ...terminalCoverageLines(report),
  ];
  return lines.join('\n');
}

function jsonView(report) {
  const common = {
    version: report.version,
    command: report.command,
    scanned_at: report.scanned_at,
    overview: report.overview,
    locations: report.locations,
    usage: report.usage,
    limitations: report.limitations,
  };
  if (report.command === 'scan') {
    return {
      ...common,
      result_scope: 'inventory',
      skills: report.skills,
      duplicate_analysis: report.duplicate_analysis,
    };
  }
  if (report.command === 'doctor') {
    return {
      ...common,
      result_scope: 'health-and-relationship-findings',
      skills: report.skills.filter((skill) => skill.health_issues.length || skill.duplicate_type.length),
      duplicate_pairs: report.duplicate_pairs,
      relationship_findings: report.relationship_findings,
      duplicate_analysis: report.duplicate_analysis,
      recommendations: report.recommendations,
    };
  }
  return { ...report, result_scope: 'complete-report' };
}

function render(report, format) {
  if (format === 'json') return JSON.stringify(jsonView(report), null, 2);
  if (format === 'markdown') return renderMarkdown(report);
  return renderTerminal(report);
}

function writeOutput(outputPath, output, force = false) {
  const resolved = path.resolve(outputPath);
  try {
    fs.writeFileSync(resolved, `${output}\n`, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite existing output file: ${resolved}. Use --force-output to replace it.`);
    }
    throw error;
  }
  return resolved;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = createReport(options);
  const output = render(report, options.format);
  if (options.output) writeOutput(options.output, output, options.forceOutput);
  process.stdout.write(`${output}\n`);
}

export {
  createReport,
  discoverLocations,
  parseArgs,
  render,
  renderMarkdown,
  renderTerminal,
  writeOutput,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`skill-observer: ${error.message}\nUse --help for usage.\n`);
    process.exitCode = 2;
  }
}

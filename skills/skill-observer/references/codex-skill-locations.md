# Codex Skill Locations

`skill-observer` uses filesystem locations that can be identified without relying on private Codex caches.

## Project and parent repositories

Starting at the current working directory and walking through its parents, it identifies Git repository roots and checks:

- `<repository>/.agents/skills`
- `<repository>/.codex/skills`

The `.agents/skills` convention covers project-local Agent Skills. `.codex/skills` is included when a repository explicitly keeps Codex Skills there. When no Git root is found, the current working directory is treated as the project base. Arbitrary filesystem ancestors are not presented as repositories.

## User locations

It checks the user-level `.agents/skills` and `.codex/skills` directories under the resolved home directory. When `CODEX_HOME` is set, it also checks `<CODEX_HOME>/skills`.

## Extra roots and coverage

`--extra-root <path>` adds an explicitly requested directory. A root can either contain Skill directories or itself be a Skill directory containing `SKILL.md`.

The scanner reports every requested location as scanned, missing, inaccessible, or not a directory. System-level and plugin-level Skills are not claimed unless they are reachable through these locations or an explicit extra root. The resulting inventory therefore cannot represent every Skill available to the host or Codex UI.

Nested symbolic links are checked for breakage but not followed. This prevents a Skill bundle from expanding the scan into unrelated directories. A top-level Skill directory may itself be a valid symbolic link, which supports normal linked installations.

Relative-reference checks cover inline Markdown destinations and reference definitions outside fenced and inline code. Bare paths in prose or code examples are not inferred. `content_hash` covers `SKILL.md` only; scripts, references, assets, prompts, source code, chats, and credentials are not read for whole-bundle comparison.

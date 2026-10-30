# Release Process Documentation

This document describes the complete automated release workflow for Chat Backup Browser, including architecture, best practices, and troubleshooting.

## 📋 Overview

The release process follows a **draft-first workflow** ensuring complete releases:

```
dev → main → Semantic Release (draft) → Parallel Builds → Publish OR Cleanup
```

**Key Feature**: Releases are **never visible to users** until all platform binaries are successfully built and uploaded.

## 🔄 Workflow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Developer pushes commit to main                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Semantic Release analyzes commit messages                │
│    - feat: → Minor version (1.0.0 → 1.1.0)                  │
│    - fix: → Patch version (1.0.0 → 1.0.1)                   │
│    - BREAKING CHANGE: → Major version (1.0.0 → 2.0.0)       │
│    - chore/docs/etc: → No release                           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Creates DRAFT release (invisible to users)               │
│    - Updates CHANGELOG.md                                   │
│    - Commits version bump                                   │
│    - Creates git tag                                        │
│    - Triggers build workflow via workflow_dispatch         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Build Workflow starts                                    │
│                                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │ Prebuild Job (runs once)                     │           │
│  │ - Builds SvelteKit app                       │           │
│  │ - Uploads as artifact                        │           │
│  └──────────┬───────────────────────────────────┘           │
│             │                                                │
│             ▼                                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Matrix Build Jobs (parallel, ~15 min)               │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐      │    │
│  │  │ macOS      │ │ Windows    │ │ Linux            │      │    │
│  │  │ - x64      │ │ - x64      │ │ - x64            │      │    │
│  │  │ - arm64    │ │ - arm64    │ │ - arm64          │      │    │
│  │  │ → DMG, ZIP │ │ → EXE, ZIP │ │ → DEB, RPM, AppImage │  │    │
│  │  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘      │    │
│  └────────┼──────────────┼──────────────┼─────────────┘    │
│           │              │              │                   │
│           └──────────────┴──────────────┘                   │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │
                   ┌───────┴────────┐
                   │                │
                   ▼                ▼
        ┌──────────────────┐  ┌──────────────────┐
        │ All Succeeded?   │  │ Any Failed?      │
        │                  │  │                  │
        │ publish-release  │  │ cleanup-failed   │
        │ (if: success())  │  │ (if: failure())  │
        │                  │  │                  │
        │ Makes draft      │  │ Deletes draft    │
        │ PUBLIC ✅        │  │ release 🗑️      │
        └──────────────────┘  └──────────────────┘
```

### Success Path ✅
1. Draft created → **Invisible to users**
2. All builds succeed → Assets uploaded to draft
3. `publish-release` job runs → **Draft becomes public**
4. Users see complete release with all assets

### Failure Path ❌
1. Draft created → **Invisible to users**  
2. Any build fails → Some assets may be uploaded
3. `cleanup-failed-release` job runs → **Draft deleted**
4. Users **never see** the incomplete release

---

## 🔄 Workflow Pipeline

### 1. Development Phase (CI)

**Trigger**: Push to `dev` branch or Pull Request to `dev`/`main`

**Workflow**: `.github/workflows/ci.yml`

**Jobs**:
- ✅ **Lint**: Code quality checks with Biome
- 🔍 **Type Check**: TypeScript validation
- 🏗️ **Build**: Verify SvelteKit build succeeds

**Purpose**: Quality gates before merging to main

---

### 2. Release Phase (Semantic Release)

**Trigger**: Push to `main` branch (usually via merge from `dev`)

**Workflow**: `.github/workflows/release.yml`

**Steps**:
1. Analyze commit messages since last release
2. Determine next version based on commit types (see [Versioning](#versioning))
3. Generate `CHANGELOG.md`
4. Update `package.json` version
5. Create Git tag
6. **Create DRAFT GitHub release** (invisible to users)
7. **Trigger Build Workflow** with new version

**Configuration**: `.releaserc.json` with `"draftRelease": true`

**Key Benefit**: Users never see incomplete releases

---

### 3. Build Phase (Electron Binaries)

**Trigger**: 
- Automatically triggered by Release workflow
- Manual dispatch with version input
- Tag pushes matching `v*`
- Release published events

**Workflow**: `.github/workflows/build.yml`

**Prebuild Job** (runs once):
- Builds SvelteKit app
- Shares build artifact with all platforms
- Prevents redundant builds

**Matrix Strategy** (parallel builds, ~15 minutes):
- 🍎 **macOS**: `macos-latest`
- 🪟 **Windows**: `windows-latest`
- 🐧 **Linux**: `ubuntu-latest`

**Reliability Features**:
- `fail-fast: false` - One platform failure doesn't stop others
- Retry logic: 3 attempts for npm install
- Artifact caching: Electron binaries cached between runs

**Build Outputs**:

| Platform | Architectures | Outputs | Count |
|----------|--------------|---------|-------|
| macOS | x64, arm64 | `.dmg`, `.zip` | 4 files |
| Windows | x64, arm64 | `.exe` (NSIS installer), portable `.zip` | 4 files |
| Linux | x64, arm64 | `.deb`, `.rpm`, `.AppImage` | 6 files |
| Auto-updater | all | `.yml`, `.blockmap` | 5 files |

**Total**: ~19 files per release

**Upload targets**:
- ✅ GitHub Release (attached to draft)
- ✅ Workflow Artifacts (7-day retention for debugging)

---

### 4. Publish or Cleanup Phase

**Conditional Jobs** (only one runs):

#### Publish Release (if: success())
- **Trigger**: All matrix builds succeed
- **Action**: Makes draft release public
- **Result**: Users see complete release with all binaries

#### Cleanup Failed Release (if: failure())  
- **Trigger**: Any matrix build fails
- **Action**: Deletes draft release
- **Result**: Failed release never visible to users

---

### 5. Deploy Phase (GitHub Pages)

**Trigger**: Push to `main` branch (runs in parallel with release)

**Workflow**: `.github/workflows/deploy.yml`

**Steps**:
1. Build SvelteKit static site
2. Upload to GitHub Pages
3. Deploy to production

**Live URL**: Configured in repository settings

---

## 📝 Versioning

Follows **Semantic Versioning** (`MAJOR.MINOR.PATCH`) with Angular commit conventions:

| Commit Type | Example | Version Bump | Appears in Changelog |
|-------------|---------|--------------|---------------------|
| `feat:` | `feat: add dark mode` | **MINOR** (1.0.0 → 1.1.0) | ✅ ✨ Features |
| `fix:` | `fix: resolve crash on startup` | **PATCH** (1.0.0 → 1.0.1) | ✅ 🐛 Bug Fixes |
| `perf:` | `perf: optimize image loading` | **PATCH** | ✅ ⚡ Performance |
| `refactor:` | `refactor: simplify parser logic` | **PATCH** | ✅ ♻️ Refactoring |
| `docs:` | `docs: update README` | No release | ❌ |
| `style:` | `style: format code` | No release | ❌ |
| `chore:` | `chore: update dependencies` | No release | ❌ |
| `test:` | `test: add unit tests` | No release | ❌ |
| `ci:` | `ci: update workflow` | No release | ❌ |

### Breaking Changes

Use `BREAKING CHANGE:` in commit footer to trigger **MAJOR** version bump:

```
feat: redesign UI

BREAKING CHANGE: Old themes are no longer compatible
```

This changes `1.0.0 → 2.0.0`

---

## 🚀 How to Release

### Standard Release (Recommended)

1. **Develop on `dev` branch**
   ```bash
   git checkout dev
   git pull origin dev
   ```

2. **Create feature branch**
   ```bash
   git checkout -b feat/my-feature
   ```

3. **Commit with conventional format**
   ```bash
   git commit -m "feat: add awesome feature"
   git commit -m "fix: resolve bug in parser"
   ```

4. **Push and create PR to `dev`**
   ```bash
   git push origin feat/my-feature
   ```
   - CI workflow validates code
   - Merge after approval

5. **Merge `dev` to `main`**
   ```bash
   git checkout main
   git pull origin main
   git merge dev
   git push origin main
   ```

6. **Automated process starts**:
   - ✅ Semantic Release analyzes commits
   - ✅ New version determined
   - ✅ CHANGELOG updated
   - ✅ GitHub release created
   - ✅ Build workflow triggered
   - ✅ Binaries built for all platforms
   - ✅ Assets uploaded to release
   - ✅ GitHub Pages deployed

7. **Verify release**
   ```bash
   gh release view v1.x.x
   ```

### Emergency Hotfix

For critical fixes that can't wait for normal development cycle:

```bash
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug
git commit -m "fix: critical security issue"
git push origin hotfix/critical-bug
```

Create PR directly to `main` → merge → automatic release

---

## 🛠️ Manual Operations

### Trigger Build Manually

If automatic build fails or you need to rebuild:

```bash
gh workflow run build.yml --ref main -f version=1.10.0
```

Replace `1.10.0` with the version to build.

### Check Workflow Status

```bash
# List recent runs
gh run list --limit 10

# Check specific workflow
gh run list --workflow=build.yml --limit 5

# View run details
gh run view <run-id>

# Download logs
gh run download <run-id>
```

### Verify Release Assets

```bash
# View release
gh release view v1.10.0

# List assets
gh release view v1.10.0 --json assets --jq '.assets[] | .name'

# Download release
gh release download v1.10.0
```

---

## ❌ Troubleshooting

### No release created after merging to main

**Symptoms**: Push to main, but no release appears

**Causes**:
- ✋ No releasable commits (only `docs:`, `chore:`, `style:`, `test:`, `ci:`)
- ✋ Commit message doesn't follow convention
- ✋ Already released (no new commits since last release)

**Solution**:
```bash
# Check recent commits
git log --oneline -5

# If needed, add a proper commit
git commit --allow-empty -m "fix: trigger release"
git push origin main
```

### Release created but no binaries

**Symptoms**: GitHub release exists but has no `.dmg`, `.exe`, etc.

**Causes**:
- ❌ Build workflow not triggered
- ❌ Build jobs failed
- ❌ Draft release cleaned up (builds failed)

**Solution**:
```bash
# Check if release is a draft
gh release list | grep Draft

# Check build runs
gh run list --workflow=build.yml --limit 3

# If no recent runs, trigger manually
gh workflow run build.yml --ref main -f version=<version>

# If runs failed, check logs
gh run view <run-id> --log-failed
```

### Draft release left behind

**Symptoms**: Release visible as "Draft" in releases list

**Causes**:
- ❌ Cleanup job failed to execute
- ❌ Workflow permission issues

**Solution**:
```bash
# Check cleanup job logs
gh run view <run-id> --job=<cleanup-job-id>

# Manually delete draft
gh release delete v<version> --yes

# Note: Tag still exists, delete if needed
git push origin :refs/tags/v<version>
```

### Windows/macOS/Linux binaries missing

**Symptoms**: Only some platforms have binaries in release

**Causes**:
- ❌ One or more matrix jobs failed
- ❌ Platform-specific build error

**Solution**:
```bash
# View specific run
gh run view <run-id>

# Check which jobs failed
gh run view <run-id> --log-failed

# Common fixes:
# - Check node_modules compatibility
# - Verify icon files exist (static/icon.{icns,ico,png})
# - Ensure package.json has correct build config

# Note: If ANY build fails, entire release is cleaned up
# Fix the issue and the workflow will retry automatically
```

### Build succeeds but assets not uploaded

**Symptoms**: Build workflow completes, but release has no files

**Causes**:
- ❌ Release doesn't exist yet (draft not created)
- ❌ Permission issues
- ❌ Wrong tag name in upload step

**Solution**:
```bash
# Verify release exists (including drafts)
gh release view v<version>

# If not, semantic-release didn't run
# Check release workflow logs
gh run list --workflow=release.yml --limit 3

# Check permissions in .github/workflows/build.yml
# Should have: permissions: contents: write
```

### npm install fails with 503 errors

**Symptoms**: Build fails during dependency installation

**Causes**:
- ❌ Electron CDN temporarily unavailable
- ❌ electron-builder CDN issues

**Solution**:
- ✅ **Automatic**: Retry logic attempts 3 times with `--prefer-offline`
- ✅ **Manual**: Re-run the workflow from GitHub Actions UI
- ✅ **Wait**: CDN usually recovers within minutes

**Prevention**: Workflow already implements retry logic, failures should be rare

---

## 📊 Release Checklist

Before merging to `main`:

- [ ] All commits follow conventional format (`feat:`, `fix:`, etc.)
- [ ] CI passes on `dev` branch
- [ ] Breaking changes documented in commit footer
- [ ] README translations updated (if applicable)

After automated release (verify):

- [ ] GitHub release created (check: `gh release list`)
- [ ] Release is **NOT** a draft (cleanup job would have run if builds failed)
- [ ] CHANGELOG.md updated in repository
- [ ] All platform binaries present (~19 files):
  - [ ] 4 macOS files (DMG, ZIP for x64 and arm64)
  - [ ] 4 Windows files (EXE, portable ZIP for x64 and arm64)  
  - [ ] 6 Linux files (DEB, RPM, AppImage for x64 and arm64)
  - [ ] 5 Auto-updater files (YML, blockmap)
- [ ] GitHub Pages deployed successfully
- [ ] Test download and installation on at least one platform

**Quick verification**:
```bash
# Check latest release
gh release view --json name,isDraft,assets

# Should show: "isDraft": false and ~17 assets
```

---

## 🔐 Permissions

### GitHub Token (automatic)

The workflows use `GITHUB_TOKEN` automatically provided by GitHub Actions:

- **Release workflow**: `contents: write`, `issues: write`, `pull-requests: write`, `actions: write`
- **Build workflow**: `contents: write`
- **Deploy workflow**: `contents: read`, `pages: write`, `id-token: write`

No manual token configuration needed.

### Workflow Permissions

All conditional jobs inherit permissions from the workflow:

- **publish-release**: Requires `contents: write` to update draft status
- **cleanup-failed-release**: Requires `contents: write` to delete releases

---

## ⚡ Performance

### Build Times

| Phase | Duration | Notes |
|-------|----------|-------|
| Prebuild | ~1 minute | SvelteKit build (shared) |
| macOS build | ~14 minutes | DMG signing is slowest |
| Windows build | ~5 minutes | Fastest platform |
| Linux build | ~5 minutes | Fast with DEB/RPM only |
| **Total** | **~15 minutes** | Parallel execution |

**Comparison**:
- Sequential (old): 45+ minutes
- Parallel (current): ~15 minutes
- **Speedup**: 3x faster

### Optimization Features

1. **Shared Prebuild**: SvelteKit built once, reused by all platforms
2. **Parallel Matrix**: All platforms build simultaneously  
3. **Artifact Caching**: Electron binaries cached between runs
4. **Retry Logic**: Automatic recovery from transient failures

---

## 📦 Build Configuration

Electron Builder settings in `package.json`:

```json
{
  "build": {
    "appId": "io.github.vanshwason.chatbackupbrowser",
    "productName": "Chat Backup Browser",
    "directories": {
      "output": "dist-electron"
    },
    "mac": {
      "icon": "static/icon.icns",
      "category": "public.app-category.utilities",
      "target": ["dmg", "zip"],
      "arch": ["x64", "arm64"]
    },
    "win": {
      "icon": "static/icon.ico",
      "target": ["nsis", "portable"],
      "arch": ["x64", "arm64"]
    },
    "linux": {
      "icon": "static/icon.png",
      "category": "Utility",
      "target": ["deb", "rpm", "AppImage"],
      "arch": ["x64", "arm64"]
    }
  }
}
```

---

## 📈 Version History & Monitoring

Check releases:

```bash
# List all releases (including drafts)
gh release list

# View specific version with details
gh release view v1.13.4 --json name,isDraft,publishedAt,assets

# Compare versions
git log v1.13.3...v1.13.4 --oneline

# Check if any drafts exist (should be empty)
gh release list | grep Draft
```

### Release States

Releases can be in three states:

1. **Draft** (invisible): Build in progress or failed
2. **Published** (visible): Build succeeded, users can download
3. **Deleted**: Build failed, cleanup ran

**Example**:
```bash
$ gh release list
TITLE    TYPE    TAG NAME  PUBLISHED           
v1.13.4  Latest  v1.13.4   1 hour ago    # ✅ Published successfully
v1.13.3          v1.13.3   2 hours ago   # ❌ Was draft, cleaned up
v1.13.2          v1.13.2   3 hours ago   # ❌ Was draft, cleaned up
v1.13.1          v1.13.1   4 hours ago   # ✅ Published successfully
```

**Note**: v1.13.2 and v1.13.3 appear in history but were never visible to users (were drafts, then deleted).

### Monitoring Workflows

```bash
# Watch active builds in real-time
gh run watch

# List recent workflow runs
gh run list --limit 10

# Check specific workflow
gh run list --workflow=build.yml --limit 5

# View detailed run information
gh run view <run-id> --log

# Download logs for offline analysis
gh run download <run-id>
```

### Success Indicators

- ✅ Release workflow completes (creates draft)
- ✅ Build workflow completes (all 3 platforms)
- ✅ Publish job runs (makes draft public)
- ✅ Release shows in `gh release list` (NOT as Draft)
- ✅ All ~17 assets present

### Failure Indicators

- ❌ Any matrix job fails
- ❌ Cleanup job runs (check logs)
- ❌ Draft release exists after workflow completes
- ❌ Release has fewer than 17 assets

---

## 🤝 Contributing

When contributing, ensure commits follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Examples**:
- `feat: add bookmark export feature`
- `fix: resolve search crash with special characters`
- `docs: update installation instructions`
- `chore: upgrade dependencies`

This ensures proper versioning and changelog generation.

---

## 📚 Additional Resources

- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Release](https://semantic-release.gitbook.io/)
- [Electron Builder](https://www.electron.build/)
- [GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
- [GitHub Actions Matrix Strategy](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs)

---

## 🔍 Workflow Files Reference

| File | Purpose | Trigger |
|------|---------|---------|
| `.releaserc.json` | Semantic release config | N/A |
| `.github/workflows/ci.yml` | Quality checks | Push/PR to dev/main |
| `.github/workflows/release.yml` | Create draft release | Push to main |
| `.github/workflows/build.yml` | Build binaries, publish/cleanup | Triggered by release workflow |
| `.github/workflows/deploy.yml` | Deploy to GitHub Pages | Push to main |

---

**Last Updated**: 2025-12-11  
**Workflow Version**: 2.0 (Draft-First Architecture)

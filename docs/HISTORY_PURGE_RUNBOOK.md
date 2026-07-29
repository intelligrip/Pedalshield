# History purge runbook — remove the anti-cheat engine from git history

**Goal:** scrub the proprietary verification-engine files from *all past commits*
so they no longer ship in the public repo's history, then force-push.

**Run this on your Mac**, not inside Cowork — the sandbox's mounted `.git`
blocks file unlinks, which breaks git's cleanup. This procedure was validated
end-to-end on a throwaway clone (result: 0 references to the secret files across
all history, open contract + 41/42 commits preserved).

## Read first — what this does and doesn't do
- **Rewrites every commit hash.** Anyone with a clone must re-clone; open PRs
  built on old hashes will break.
- **Does NOT un-publish the past.** Commits already pushed under MIT may live in
  forks, clones, and platform caches you can't reach. Treat the old engine code
  as *already disclosed* and rely on the going-forward private engine + (if you
  want) rotated thresholds for real protection.
- Files purged (the 6 old public paths):
  - `mobile/src/verification/constants.ts`
  - `mobile/src/verification/integrityScore.ts`
  - `mobile/src/verification/sensorFusion.ts`
  - `mobile/src/verification/rideVerifier.ts`
  - `mobile/src/verification/__tests__/rideVerifier.test.ts`
  - `mobile/src/verification/__tests__/fixtures.ts`

## Step 0 — commit the current work first (IMPORTANT)
The open-core split + data co-op changes are currently uncommitted. The purge
tools do a hard reset, which would discard them. Commit first. (The private
engine in `mobile/src/verification-private/` is git-ignored and will NOT be
committed; the old files are committed as deletions.)

```bash
cd /path/to/Pedalshield
git status                      # sanity check
git add -A
git commit -m "Open-core: privatize anti-cheat engine; add opt-in data co-op"
```

## Step 1 — back up (so this is reversible)
```bash
git clone --mirror . ../Pedalshield-backup.git   # full backup of all refs
```

## Step 2 — purge history

### Option A — git-filter-repo (recommended)
```bash
brew install git-filter-repo

git filter-repo --force \
  --invert-paths \
  --path mobile/src/verification/constants.ts \
  --path mobile/src/verification/integrityScore.ts \
  --path mobile/src/verification/sensorFusion.ts \
  --path mobile/src/verification/rideVerifier.ts \
  --path mobile/src/verification/__tests__/rideVerifier.test.ts \
  --path mobile/src/verification/__tests__/fixtures.ts
```
> filter-repo removes the `origin` remote as a safety measure — you re-add it in
> Step 4.

### Option B — built-in git filter-branch (no install; this is what was validated)
```bash
export FILTER_BRANCH_SQUELCH_WARNING=1
git filter-branch --force --index-filter '
  git rm -r --cached --ignore-unmatch \
    mobile/src/verification/constants.ts \
    mobile/src/verification/integrityScore.ts \
    mobile/src/verification/sensorFusion.ts \
    mobile/src/verification/rideVerifier.ts \
    mobile/src/verification/__tests__/rideVerifier.test.ts \
    mobile/src/verification/__tests__/fixtures.ts
' --prune-empty --tag-name-filter cat -- --all

# REQUIRED cleanup — without this the old commits survive under refs/original:
git for-each-ref --format='%(refname)' refs/original/ | xargs -r -n1 git update-ref -d
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

## Step 3 — verify (both commands should print 0)
```bash
# 1) No commit anywhere still references the secret paths:
git log --oneline --all -- \
  mobile/src/verification/constants.ts \
  mobile/src/verification/integrityScore.ts \
  mobile/src/verification/sensorFusion.ts \
  mobile/src/verification/rideVerifier.ts \
  mobile/src/verification/__tests__/rideVerifier.test.ts \
  mobile/src/verification/__tests__/fixtures.ts | wc -l

# 2) No reachable blob copies remain:
found=0; for c in $(git rev-list --all); do \
  git cat-file -e "$c:mobile/src/verification/constants.ts" 2>/dev/null && found=$((found+1)); \
done; echo "reachable copies: $found"

# Sanity: the OPEN contract should still be there:
git cat-file -e HEAD:mobile/src/verification/types.ts && echo "open contract preserved ✔"
```

## Step 4 — re-add remote (if needed) and force-push
```bash
git remote -v                                   # if origin is gone (filter-repo):
git remote add origin git@github.com:intelligrip/Pedalshield.git

git push origin --force --all
git push origin --force --tags
```

## Step 5 — aftermath
- Tell any collaborators to **re-clone** (their old clones still contain the
  engine and can re-introduce it on push).
- Consider the previously-published thresholds compromised; if you want real
  forward protection, re-tune `verification-private/constants.ts` so the live
  rulebook differs from anything that was public.
- Once you've confirmed the remote looks right, delete `../Pedalshield-backup.git`.

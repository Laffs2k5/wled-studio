# SPDX-License-Identifier: EUPL-1.2
"""Version control for an effect folder that is a git repository: see the changes, commit them,
and push them to GitHub, so the effects can be edited in the app alone.

A folder in the effects directory with its own `.git` is a repository (a clone of your effects
repository, say). The app shows its state whenever it is one. Committing needs
WLEDSTUDIO_EFFECTS_GIT=on; pushing also needs an SSH key (WLEDSTUDIO_EFFECTS_GIT_KEY), best a
GitHub deploy key with write access to that one repository.

- Git runs with the folder as its explicit work tree and `.git` (never a parent repository), no
  system or user configuration, no hooks and no prompts.
- Only GitHub remotes are pushed to, over SSH, with GitHub's ed25519 host key pinned (from
  api.github.com/meta). A clone made over HTTPS is pushed to the same repository over SSH.
- A push first fetches and rebases onto the remote branch; if the same lines changed on both
  sides, the rebase is undone and nothing is pushed.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .effects import _folder

router = APIRouter(prefix="/api/effects")

GITHUB_HOST_KEY = "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
GITHUB_REMOTE = re.compile(r"^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)"
                           r"(?P<repo>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$")
MAX_DIFF = 200_000
LOCAL_S, NETWORK_S = 20, 90


class CommitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=500)


class GitError(Exception):
    pass


def _repo(request: Request, folder: str) -> Path:
    d = _folder(request, folder)
    if not (d / ".git").is_dir():
        raise HTTPException(404, "this effect folder isn't a git repository")
    return d


def _home(request: Request) -> Path:
    """A writable home for git and ssh (the app's own is read-only): GitHub's host key lives here."""
    h = request.app.state.settings.data_dir / "git"
    h.mkdir(parents=True, exist_ok=True)
    kh = h / "known_hosts"
    if not kh.exists() or kh.read_text() != GITHUB_HOST_KEY + "\n":
        kh.write_text(GITHUB_HOST_KEY + "\n")
    return h


def git(request: Request, d: Path, *args: str, network: bool = False, check: bool = True) -> subprocess.CompletedProcess:
    s = request.app.state.settings
    home = _home(request)
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home), "LANG": "C.UTF-8",
        "GIT_DIR": str(d / ".git"), "GIT_WORK_TREE": str(d),
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0",
    }
    if s.effects_git_key:
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {s.effects_git_key} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes "
            f"-o UserKnownHostsFile={home / 'known_hosts'} -o HostKeyAlgorithms=ssh-ed25519 -F /dev/null")
    name, _, email = s.effects_git_author.partition("<")
    cmd = ["git", "-c", f"safe.directory={d}", "-c", "core.hooksPath=/dev/null", "-c", f"user.name={name.strip()}",
           "-c", f"user.email={email.rstrip('>').strip()}", "-c", "commit.gpgsign=false", *args]
    try:
        r = subprocess.run(cmd, cwd=d, env=env, capture_output=True, text=True, timeout=NETWORK_S if network else LOCAL_S)
    except subprocess.TimeoutExpired:
        raise GitError(f"git {args[0]} timed out") from None
    if check and r.returncode != 0:
        raise GitError(_clean(r.stderr or r.stdout) or f"git {args[0]} failed")
    return r


def push_target(url: str) -> str | None:
    """Where a clone with this origin URL is pushed: its GitHub repository over SSH, else nowhere."""
    gh = GITHUB_REMOTE.match(url)
    return f"git@github.com:{gh.group('repo')}.git" if gh else None


def _clean(text: str) -> str:
    """Git's message, without anything that looks like a credential or a local path to the key."""
    t = re.sub(r"https://[^@\s]+@", "https://", text.strip())
    return t[-600:]


def _status(request: Request, d: Path) -> dict:
    s = request.app.state.settings
    r = git(request, d, "status", "--porcelain=v1", "--branch", "--untracked-files=all")
    lines = r.stdout.splitlines()
    head = lines[0][3:] if lines and lines[0].startswith("## ") else ""
    m = re.match(r"^(?P<branch>\S+?)(?:\.\.\.(?P<up>\S+))?(?: \[(?P<rel>[^\]]*)\])?$", head)
    ahead = behind = 0
    if m and m.group("rel"):
        a = re.search(r"ahead (\d+)", m.group("rel"))
        b = re.search(r"behind (\d+)", m.group("rel"))
        ahead, behind = int(a.group(1)) if a else 0, int(b.group(1)) if b else 0
    changes = [{"status": ln[:2].strip() or "?", "path": ln[3:]} for ln in lines[1:]]
    last = git(request, d, "log", "-1", "--format=%h%x00%s%x00%cI", check=False).stdout.strip().split("\0")
    url = git(request, d, "remote", "get-url", "origin", check=False).stdout.strip()
    gh = GITHUB_REMOTE.match(url)
    target = push_target(url) if url else None
    return {
        "repo": True, "branch": m.group("branch") if m else None, "upstream": m.group("up") if m else None,
        "ahead": ahead, "behind": behind, "changes": changes,
        "last": {"sha": last[0], "subject": last[1], "when": last[2]} if len(last) == 3 else None,
        "remote": f"github.com/{gh.group('repo')}" if gh else (url and "not GitHub"),
        "can_commit": s.effects_git, "can_push": bool(s.effects_git and s.effects_git_key and target),
    }


def _fail(e: GitError, code: int = 409):
    raise HTTPException(code, str(e)) from None


@router.get("/{folder}/git")
def status(folder: str, request: Request):
    d = _folder(request, folder)
    if not (d / ".git").is_dir():
        return {"repo": False}
    try:
        return _status(request, d)
    except GitError as e:
        _fail(e, 500)


@router.get("/{folder}/git/diff")
def diff(folder: str, request: Request):
    """The uncommitted changes: tracked files as a diff, new files by name."""
    d = _repo(request, folder)
    try:
        text = git(request, d, "diff", "HEAD", "--no-color", "--no-ext-diff").stdout
        new = git(request, d, "ls-files", "--others", "--exclude-standard").stdout.split()
    except GitError as e:
        _fail(e, 500)
    return {"diff": text[:MAX_DIFF], "truncated": len(text) > MAX_DIFF, "new_files": new}


@router.post("/{folder}/git/commit")
def commit(folder: str, body: CommitIn, request: Request):
    """Commit every change in the folder."""
    if not request.app.state.settings.effects_git:
        raise HTTPException(403, "committing is off (WLEDSTUDIO_EFFECTS_GIT)")
    d = _repo(request, folder)
    if "\0" in body.message:
        raise HTTPException(422, "bad commit message")
    try:
        git(request, d, "add", "--all")
        if git(request, d, "diff", "--cached", "--quiet", check=False).returncode == 0:
            raise HTTPException(409, "nothing to commit")
        git(request, d, "commit", "--quiet", "--no-verify", "-m", body.message)
        return _status(request, d)
    except GitError as e:
        _fail(e)


def _sync(request: Request, d: Path) -> tuple[str, str]:
    """Fetch, then rebase local commits onto the remote branch. Returns (branch, push URL)."""
    st = _status(request, d)
    if st["changes"]:
        raise HTTPException(409, "commit your changes first")
    url = git(request, d, "remote", "get-url", "origin", check=False).stdout.strip()
    push_url = push_target(url)
    if not push_url:
        raise HTTPException(409, "only GitHub remotes are supported")
    branch = st["branch"]
    if not branch or branch.startswith("HEAD"):
        raise HTTPException(409, "the folder isn't on a branch")
    # fetch over the clone's own URL (HTTPS needs no key for a public repository), else over SSH
    git(request, d, "fetch", "--quiet", "origin" if url.startswith("https://") else push_url,
        f"+refs/heads/{branch}:refs/remotes/origin/{branch}", network=True)
    if git(request, d, "rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{branch}", check=False).returncode == 0:
        r = git(request, d, "rebase", "--quiet", f"origin/{branch}", check=False)
        if r.returncode != 0:
            git(request, d, "rebase", "--abort", check=False)
            raise HTTPException(409, "the remote changed the same lines: nothing was pushed. Pull and merge "
                                     "outside the app, or undo your commit.")
    return branch, push_url


@router.post("/{folder}/git/pull")
def pull(folder: str, request: Request):
    """Take the remote's new commits (your own on top of them)."""
    if not request.app.state.settings.effects_git:
        raise HTTPException(403, "git is off (WLEDSTUDIO_EFFECTS_GIT)")
    d = _repo(request, folder)
    try:
        _sync(request, d)
        return _status(request, d)
    except GitError as e:
        _fail(e, 502)


@router.post("/{folder}/git/push")
def push(folder: str, request: Request):
    s = request.app.state.settings
    if not (s.effects_git and s.effects_git_key):
        raise HTTPException(403, "pushing needs WLEDSTUDIO_EFFECTS_GIT=on and a key (WLEDSTUDIO_EFFECTS_GIT_KEY)")
    d = _repo(request, folder)
    try:
        branch, push_url = _sync(request, d)
        git(request, d, "push", "--quiet", push_url, f"HEAD:refs/heads/{branch}", network=True)
        git(request, d, "update-ref", f"refs/remotes/origin/{branch}", "HEAD")
        return _status(request, d)
    except GitError as e:
        _fail(e, 502)

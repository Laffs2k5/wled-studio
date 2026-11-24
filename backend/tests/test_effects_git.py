# SPDX-License-Identifier: EUPL-1.2
"""Committing and pushing an effect folder that is a git clone; a local bare repository stands in
for GitHub."""
import subprocess

import pytest
from fastapi.testclient import TestClient

from conftest import CSRF, private_resolver
from wledstudio import effects_git
from wledstudio.app import create_app
from wledstudio.config import Settings


def sh(*args, cwd=None):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", *args],
                          cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def setup(tmp_path, monkeypatch):
    remote = tmp_path / "remote.git"
    sh("init", "--quiet", "--bare", str(remote))
    seed = tmp_path / "seed"
    sh("clone", "--quiet", str(remote), str(seed))
    (seed / "library.json").write_text('{"name": "wled-fx"}\n')
    (seed / "fx.cpp").write_text("line 1\nline 2\nline 3\n")
    sh("add", ".", cwd=seed)
    sh("commit", "--quiet", "-m", "seed", cwd=seed)
    sh("push", "--quiet", "origin", "HEAD:main", cwd=seed)
    eff = tmp_path / "effects"
    eff.mkdir()
    sh("clone", "--quiet", str(remote), str(eff / "fx"))
    (eff / "plain").mkdir()
    (eff / "plain" / "a.cpp").write_text("x\n")
    key = tmp_path / "key"
    key.write_text("not a real key\n")
    monkeypatch.setattr(effects_git, "push_target", lambda url: url)      # the bare repository is "GitHub"

    def make(git=True, with_key=True):
        s = Settings(data_dir=tmp_path / "d", allowed_hosts=["testserver"], effects_dir=eff, effects_git=git,
                     effects_git_key=key if with_key else None, effects_git_author="Studio <studio@example.invalid>")
        return TestClient(create_app(s, resolver=private_resolver))
    return make, eff, remote, seed


def test_a_folder_without_git_is_just_a_folder(setup):
    make, *_ = setup
    c = make()
    assert c.get("/api/effects/plain/git").json() == {"repo": False}
    assert c.get("/api/effects/plain/a.cpp").json()["content"] == "x\n"       # files still open
    assert c.get("/api/effects/fx/fx.cpp").status_code == 200
    assert c.get("/api/effects/nope/git").status_code == 404
    assert c.get("/api/effects/plain/git/diff").status_code == 404


def test_changes_diff_commit_and_push(setup):
    make, eff, remote, _ = setup
    c = make()
    st = c.get("/api/effects/fx/git").json()
    assert st["repo"] and st["branch"] == "main" and st["changes"] == [] and st["can_commit"] and st["can_push"]
    assert c.put("/api/effects/fx/fx.cpp", json={"content": "line 1\nline two\nline 3\n"}, headers=CSRF).status_code == 200
    (eff / "fx" / "new.h").write_text("// new\n")
    st = c.get("/api/effects/fx/git").json()
    assert {(x["status"], x["path"]) for x in st["changes"]} == {("M", "fx.cpp"), ("??", "new.h")}
    d = c.get("/api/effects/fx/git/diff").json()
    assert "+line two" in d["diff"] and d["new_files"] == ["new.h"]
    # pushing with uncommitted changes is refused
    assert c.post("/api/effects/fx/git/push", headers=CSRF).status_code == 409
    st = c.post("/api/effects/fx/git/commit", json={"message": "Brighter line two"}, headers=CSRF).json()
    assert st["changes"] == [] and st["ahead"] == 1 and st["last"]["subject"] == "Brighter line two"
    assert c.post("/api/effects/fx/git/commit", json={"message": "again"}, headers=CSRF).status_code == 409
    st = c.post("/api/effects/fx/git/push", headers=CSRF).json()
    assert st["ahead"] == 0
    log = sh("--git-dir", str(remote), "log", "-1", "--format=%s|%an")
    assert log.strip() == "Brighter line two|Studio"


def test_a_push_rebases_onto_new_remote_commits_and_stops_on_a_conflict(setup):
    make, eff, remote, seed = setup
    c = make()
    # someone else adds a file: no conflict, our commit goes on top
    (seed / "other.cpp").write_text("o\n")
    sh("add", ".", cwd=seed); sh("commit", "--quiet", "-m", "elsewhere", cwd=seed); sh("push", "--quiet", "origin", "HEAD:main", cwd=seed)
    (eff / "fx" / "fx.cpp").write_text("line 1\nmine\nline 3\n")
    c.post("/api/effects/fx/git/commit", json={"message": "mine"}, headers=CSRF)
    assert c.post("/api/effects/fx/git/push", headers=CSRF).status_code == 200
    assert sh("--git-dir", str(remote), "log", "--format=%s", "-3").split("\n")[:2] == ["mine", "elsewhere"]
    # the same line changed on both sides: nothing pushed, the local commit kept
    sh("pull", "--quiet", "origin", "main", cwd=seed)
    (seed / "fx.cpp").write_text("line 1\ntheirs\nline 3\n")
    sh("commit", "--quiet", "-am", "theirs", cwd=seed); sh("push", "--quiet", "origin", "HEAD:main", cwd=seed)
    (eff / "fx" / "fx.cpp").write_text("line 1\nours\nline 3\n")
    c.post("/api/effects/fx/git/commit", json={"message": "ours"}, headers=CSRF)
    r = c.post("/api/effects/fx/git/push", headers=CSRF)
    assert r.status_code == 409 and "same lines" in r.json()["detail"]
    assert sh("--git-dir", str(remote), "log", "-1", "--format=%s").strip() == "theirs"
    st = c.get("/api/effects/fx/git").json()
    assert st["last"]["subject"] == "ours" and st["changes"] == []          # the rebase was undone


def test_pull_takes_remote_commits(setup):
    make, eff, _, seed = setup
    c = make()
    (seed / "other.cpp").write_text("o\n")
    sh("add", ".", cwd=seed); sh("commit", "--quiet", "-m", "elsewhere", cwd=seed); sh("push", "--quiet", "origin", "HEAD:main", cwd=seed)
    st = c.post("/api/effects/fx/git/pull", headers=CSRF).json()
    assert st["last"]["subject"] == "elsewhere" and (eff / "fx" / "other.cpp").exists()


def test_off_and_keyless(setup):
    make, *_ = setup
    off = make(git=False)
    st = off.get("/api/effects/fx/git").json()
    assert st["repo"] and not st["can_commit"] and not st["can_push"]
    assert off.post("/api/effects/fx/git/commit", json={"message": "x"}, headers=CSRF).status_code == 403
    keyless = make(with_key=False)
    assert keyless.get("/api/effects/fx/git").json()["can_push"] is False
    assert keyless.post("/api/effects/fx/git/push", headers=CSRF).status_code == 403
    assert keyless.post("/api/effects/fx/git/commit", json={"message": ""}, headers=CSRF).status_code == 422


def test_only_github_remotes_are_pushed_to():
    t = effects_git.push_target
    assert t("https://github.com/someone/effects.git") == "git@github.com:someone/effects.git"
    assert t("git@github.com:someone/effects") == "git@github.com:someone/effects.git"
    assert t("https://gitlab.com/someone/effects.git") is None
    assert t("https://github.com.evil.example/a/b") is None
    assert t("/srv/repo.git") is None

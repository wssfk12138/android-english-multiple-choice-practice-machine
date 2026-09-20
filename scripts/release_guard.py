"""Fail closed before preparing an Android draft release. Never publishes a release."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

APPLICATION_ID = "com.wssfk.englishpracticemachine"
CERTIFICATE_SHA256 = "b50d155ca946277d598a878d4b02c0994d13bb7038770af52b641731b86de0a7"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def command(*args):
    return subprocess.check_output(args, text=True, encoding="utf-8").strip()


def validate_inputs(env, head):
    name, tag, code = env["VERSION_NAME"], env["TAG"], env["VERSION_CODE"]
    require(re.fullmatch(r"[0-9][0-9A-Za-z._-]*", name), "Invalid version name")
    require(tag == "v" + name, "Tag must equal v + version name")
    require(re.fullmatch(r"[1-9][0-9]*", code), "Invalid version code")
    require(int(code) <= 2100000000, "Version code exceeds Android limit")
    require(re.fullmatch(r"[0-9a-f]{40}", env["SOURCE_SHA"]), "Full source SHA required")
    require(head == env["SOURCE_SHA"] == env["GITHUB_SHA"], "Checkout differs from approved SHA")
    return int(code)


def gh_json(endpoint, *flags):
    return json.loads(command("gh", "api", endpoint, *flags))


def check_versions(releases, code, tag, read_asset):
    baseline_found = False
    for release in releases:
        require(release["tag_name"] != tag, "Release tag already exists")
        manifests = [a for a in release["assets"] if a["name"] == "android-update.json"]
        require(len(manifests) <= 1, "Duplicate update manifests")
        for asset in manifests:
            manifest = read_asset(asset)
            previous = manifest.get("versionCode")
            require(type(previous) is int and previous > 0, "Invalid existing version code")
            require(code > previous, "Version code must exceed every published or draft manifest")
            baseline_found = baseline_found or not release["draft"]
    require(baseline_found, "No published update manifest available for comparison")


def preflight():
    env = os.environ
    code = validate_inputs(env, command("git", "rev-parse", "HEAD"))
    repo = env["GITHUB_REPOSITORY"]
    pages = gh_json(f"repos/{repo}/releases?per_page=100", "--paginate", "--slurp")
    check_versions([r for page in pages for r in page], code, env["TAG"],
                   lambda a: gh_json(f"repos/{repo}/releases/assets/{a['id']}",
                                     "-H", "Accept: application/octet-stream"))
    tags = gh_json(f"repos/{repo}/tags?per_page=100", "--paginate", "--slurp")
    require(all(t["name"] != env["TAG"] for page in tags for t in page), "Git tag already exists")


def verify_identity(badging, certificates, name, code):
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
    require(package is not None, "APK package identity unavailable")
    require(package.groups() == (APPLICATION_ID, str(code), name), "APK identity/version mismatch")
    require(not re.search(r"^application-debuggable\b", badging, re.M), "Debuggable APK rejected")
    digests = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$", certificates, re.M)
    require([d.lower() for d in digests] == [CERTIFICATE_SHA256], "Unexpected signing certificate")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_apk(path):
    sdk = Path(os.environ["ANDROID_HOME"]) / "build-tools" / "36.0.0"
    badging = command(str(sdk / "aapt"), "dump", "badging", str(path))
    certs = command(str(sdk / "apksigner"), "verify", "--print-certs", str(path))
    verify_identity(badging, certs, os.environ["VERSION_NAME"], os.environ["VERSION_CODE"])


def write_manifest(path):
    env = os.environ
    manifest = {
        "schemaVersion": 1, "channel": "beta", "versionName": env["VERSION_NAME"],
        "versionCode": int(env["VERSION_CODE"]),
        "apkUrl": f"https://github.com/{env['GITHUB_REPOSITORY']}/releases/download/{env['TAG']}/{path.name}",
        "apkSha256": digest(path), "apkSize": path.stat().st_size,
        "releaseNotes": env.get("RELEASE_NOTES", ""),
    }
    Path("android-update.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path("release-notes.txt").write_text(env.get("RELEASE_NOTES") or f"Android {env['VERSION_NAME']}", encoding="utf-8")


def verify_downloads(original, downloaded):
    for filename in [original.name, "android-update.json"]:
        local = original if filename == original.name else Path(filename)
        require(digest(local) == digest(downloaded / filename), f"Uploaded asset mismatch: {filename}")


if __name__ == "__main__":
    action = sys.argv[1]
    if action == "preflight":
        preflight()
    elif action == "apk":
        apk = Path(sys.argv[2])
        verify_apk(apk)
        write_manifest(apk)
    elif action == "downloads":
        verify_downloads(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        raise SystemExit("Unknown action")

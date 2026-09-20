import unittest
from release_guard import CERTIFICATE_SHA256, check_versions, validate_inputs, verify_identity


class ReleaseGuardTests(unittest.TestCase):
    def test_input_binding(self):
        sha = "a" * 40
        env = dict(VERSION_NAME="0.1.0-beta.6", TAG="v0.1.0-beta.6", VERSION_CODE="123",
                   SOURCE_SHA=sha, GITHUB_SHA=sha)
        self.assertEqual(validate_inputs(env, sha), 123)
        for key, value in [("SOURCE_SHA", "b" * 40), ("VERSION_CODE", "0"),
                           ("VERSION_CODE", "2100000001"), ("TAG", "vother"),
                           ("VERSION_NAME", "x\ncommand")]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                validate_inputs({**env, key: value}, sha)

    def test_all_releases_including_drafts(self):
        releases = [dict(tag_name="old", draft=False, assets=[dict(name="android-update.json", id=104)]),
                    dict(tag_name="draft", draft=True, assets=[dict(name="android-update.json", id=122)])]
        read = lambda a: dict(versionCode=a["id"])
        check_versions(releases, 123, "new", read)
        for code, tag in [(122, "new"), (105, "new"), (123, "draft")]:
            with self.subTest(code=code, tag=tag), self.assertRaises(ValueError):
                check_versions(releases, code, tag, read)
        for records in [[], releases[1:]]:
            with self.assertRaises(ValueError):
                check_versions(records, 123, "new", read)
        with self.assertRaises(ValueError):
            check_versions(releases, 123, "new", lambda a: dict(versionCode=True))

    def test_actual_apk_identity(self):
        info = "package: name='com.wssfk.englishpracticemachine' versionCode='123' versionName='0.1.0-beta.6' platformBuildVersionName='16'\n"
        cert = f"Signer #1 certificate SHA-256 digest: {CERTIFICATE_SHA256}\n"
        verify_identity(info, cert, "0.1.0-beta.6", "123")
        for badging, certificates in [(info.replace("machine'", "machine.publictest'"), cert),
                                      (info.replace("123", "122"), cert),
                                      (info + "application-debuggable\n", cert),
                                      (info, cert.replace(CERTIFICATE_SHA256, "a" * 64)),
                                      (info, cert + cert.replace("#1", "#2"))]:
            with self.subTest(badging=badging), self.assertRaises(ValueError):
                verify_identity(badging, certificates, "0.1.0-beta.6", "123")


if __name__ == "__main__":
    unittest.main()

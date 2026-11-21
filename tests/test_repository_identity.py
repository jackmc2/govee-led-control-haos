"""Prevent accidental reintroduction of obsolete repository branding.

The original MIT copyright notice is retained as required by its license.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {"LICENSE", "test_repository_identity.py"}
TEXT_SUFFIXES = {".md", ".py", ".js", ".json", ".yaml", ".yml", ".txt"}
OLD_NAMES = (
    "smok" + "kelaar",
    "govee-individual-" + "led-control",
    "govee individual " + "led control",
)


class TestRepositoryIdentity(unittest.TestCase):
    def test_no_obsolete_project_references_outside_mit_notice(self) -> None:
        for path in ROOT.rglob("*"):
            if not path.is_file() or path.name in EXCLUDED or path.suffix not in TEXT_SUFFIXES:
                continue
            if ".git" in path.parts or "__pycache__" in path.parts:
                continue
            content = path.read_text(encoding="utf-8").lower()
            for old in OLD_NAMES:
                with self.subTest(path=str(path.relative_to(ROOT)), term=old):
                    self.assertNotIn(old, content)

    def test_project_ownership_and_hacs_name(self) -> None:
        self.assertIn(
            "@jackmc2",
            (ROOT / ".github/CODEOWNERS").read_text(encoding="utf-8"),
        )
        self.assertIn(
            "Govee LED Control",
            (ROOT / "hacs.json").read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main()

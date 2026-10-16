"""Behavioral regressions for the opt-in canonical publication layout profile."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET

HERE = Path(__file__).parent
SOURCE = Path(os.environ.get("DPF_DOCX_LAYOUT_HELPER", HERE / "fit-white-paper-docx-images.py"))
SPEC = importlib.util.spec_from_file_location("publication_layout", SOURCE)
layout = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(layout)
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def cell(text, properties=""):
    return f'<w:tc><w:tcPr>{properties}</w:tcPr><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>'


def row(values, properties=""):
    return f'<w:tr><w:trPr>{properties}</w:trPr>{"".join(cell(t) for t in values)}</w:tr>'


def table(rows=None, properties="", grid=""):
    return f'<w:tbl><w:tblPr>{properties}</w:tblPr><w:tblGrid>{grid}</w:tblGrid>{rows or row(["Field", "Definition"]) + row(["name", "retained text"])}</w:tbl>'


def document(content, gutter=0, section_extra="", image=False):
    picture = '<wp:inline><wp:extent cx="20000000" cy="10000000"/><a:xfrm><a:ext cx="20000000" cy="10000000"/></a:xfrm></wp:inline>' if image else ""
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>'
            '<w:p><w:r><w:t>Preserve this exact narrative</w:t></w:r></w:p>' + picture + content +
            f'<w:sectPr><w:pgSz w:w="12000" w:h="16000"/><w:pgMar w:left="1000" w:right="1000" w:top="1000" w:bottom="1000" w:gutter="{gutter}"/>{section_extra}</w:sectPr></w:body></w:document>')


class LayoutTests(unittest.TestCase):
    def fixture(self, xml, check):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate.docx"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("word/document.xml", xml)
                archive.writestr("word/media/retained.png", b"opaque retained image")
                archive.writestr("docProps/core.xml", b"retained metadata")
            check(path)

    def fit(self, path, tables=True):
        with contextlib.redirect_stdout(io.StringIO()):
            # The unchanged private proposal is an explicit RED target only.
            if hasattr(layout, "fit_images"):
                if tables:
                    layout.fit_images(path, tables=True)
                else:
                    layout.fit_images(path)
            else:
                layout.fit(path)

    def xml(self, path):
        with zipfile.ZipFile(path) as archive:
            return ET.fromstring(archive.read("word/document.xml"))

    def assert_refused_unchanged(self, xml):
        def check(path):
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                self.fit(path)
            self.assertEqual(path.read_bytes(), before)
        self.fixture(xml, check)

    def test_missing_properties_follow_schema_order(self):
        rows = '<w:tr>' + cell("Field", '<w:vAlign w:val="center"/>') + cell("Definition") + '</w:tr>'
        def check(path):
            self.fit(path)
            root = self.xml(path)
            self.assertEqual([x.tag for x in root.find(".//" + W + "tblPr")], [W + "tblW", W + "tblInd", W + "tblLayout"])
            self.assertEqual([x.tag for x in root.find(".//" + W + "tcPr")], [W + "tcW", W + "vAlign"])
        self.fixture(document(table(rows)), check)

    def test_omitted_grid_column_refuses_before_any_image_or_table_write(self):
        rows = row(["A", "B"], '<w:gridBefore w:val="1"/>') + row(["x", "y"], '<w:gridBefore w:val="1"/>')
        self.assert_refused_unchanged(document(table(rows, grid='<w:gridCol w:w="2000"/>' * 3), image=True))

    def test_gutter_refuses_before_any_image_or_table_write(self):
        self.assert_refused_unchanged(document(table(), gutter=1000, image=True))

    def test_multi_column_section_refuses_unchanged(self):
        self.assert_refused_unchanged(document(table(), section_extra='<w:cols w:num="2" w:space="720"/>', image=True))

    def test_noncanonical_property_sequences_and_grid_refuse_unchanged(self):
        cases = [
            table(properties='<w:tblLayout w:type="fixed"/><w:tblW w:w="10000" w:type="dxa"/>'),
            table(properties='<w:tblW w:w="10000"/><w:tblW w:w="10000"/>'),
            table(properties='<w:unsupportedProperty/>'),
            table('<w:tr>' + cell('A', '<w:vAlign w:val="center"/><w:tcW w:w="5000"/>') + cell('B') + '</w:tr>'),
            table(grid='<w:gridCol w:w="5000"/><w:tblGridChange w:id="1"/>'),
        ]
        for content in cases:
            with self.subTest(content=content):
                self.assert_refused_unchanged(document(content, image=True))

    def test_unsupported_table_forms_refuse_unchanged(self):
        cases = [
            table('<w:tr><w:tc>' + table() + '</w:tc></w:tr>'),
            table(row(["A", "B"], '<w:gridAfter w:val="1"/>')),
            table('<w:tr>' + cell("A", '<w:gridSpan w:val="2"/>') + cell("B") + '</w:tr>'),
            table('<w:tr>' + cell("A", '<w:vMerge w:val="restart"/>') + cell("B") + '</w:tr>'),
            table(properties='<w:tblpPr w:leftFromText="0"/>'),
            table(properties='<w:tblPrChange w:id="1"/>'),
            table(row(["A", "B"]) + row(["only one"])),
        ]
        for content in cases:
            with self.subTest(content=content):
                self.assert_refused_unchanged(document(content, image=True))

    def test_supported_tables_wrap_repeat_header_and_long_rows_flow(self):
        rows = row(["Field", "Definition"]) + row(["short", "bounded"]) + row(["long", "long definition " * 100])
        def check(path):
            self.fit(path)
            root = self.xml(path)
            self.assertEqual(sum(int(x.get(W + "w")) for x in root.iter(W + "gridCol")), 10000)
            table_rows = list(root.iter(W + "tr"))
            self.assertIsNotNone(table_rows[0].find(W + "trPr/" + W + "tblHeader"))
            self.assertIsNotNone(table_rows[1].find(W + "trPr/" + W + "cantSplit"))
            self.assertIsNone(table_rows[2].find(W + "trPr/" + W + "cantSplit"))
            self.assertFalse(list(root.iter(W + "noWrap")))
        self.fixture(document(table(rows)), check)

    def test_numbered_and_revision_column_proportions(self):
        for headers, expected in [( ["#", "Element", "Requirement"], [600, 2400, 7000]), (["Version", "Date", "Change"], [1200, 1900, 6900])]:
            def check(path):
                self.fit(path)
                self.assertEqual([int(x.get(W + "w")) for x in self.xml(path).iter(W + "gridCol")], expected)
            self.fixture(document(table(row(headers))), check)

    def test_preserves_non_layout_xml_other_members_and_is_byte_idempotent(self):
        original = document(table())
        def check(path):
            self.fit(path)
            first = path.read_bytes()
            self.fit(path)
            self.assertEqual(path.read_bytes(), first)
            with zipfile.ZipFile(path) as archive:
                self.assertEqual(layout.without_table_layout(original), layout.without_table_layout(archive.read("word/document.xml").decode()))
                self.assertEqual(archive.read("word/media/retained.png"), b"opaque retained image")
                self.assertEqual(archive.read("docProps/core.xml"), b"retained metadata")
        self.fixture(original, check)

    def test_default_image_only_mode_does_not_change_table_properties(self):
        original = document(table())
        def check(path):
            before = path.read_bytes()
            self.fit(path, tables=False)
            self.assertEqual(path.read_bytes(), before)
        self.fixture(original, check)

    def test_default_mode_fits_images_without_table_changes(self):
        original_table = table(properties='<w:tblW w:type="auto" w:w="0"/>')
        def check(path):
            self.fit(path, tables=False)
            with zipfile.ZipFile(path) as archive:
                text = archive.read("word/document.xml").decode()
                self.assertIn(original_table, text)
                self.assertEqual(archive.read("word/media/retained.png"), b"opaque retained image")
                root = ET.fromstring(text)
                extent = root.find(".//wp:extent", layout.NS)
                self.assertEqual(int(extent.get("cx")), 6350000)
                self.assertEqual(int(extent.get("cy")), 3175000)
        self.fixture(document(original_table, image=True), check)

    def test_image_refusal_after_table_fit_preserves_entire_input(self):
        invalid = document(table(), image=True).replace('<a:xfrm><a:ext cx="20000000" cy="10000000"/></a:xfrm>', '')
        self.assert_refused_unchanged(invalid)


if __name__ == "__main__":
    unittest.main()

"""Fit canonical publication figures, with explicitly opted-in regular tables.

Only DrawingML extents and opted-in table layout in word/document.xml change.
All media and other ZIP members are retained; no resampling or content rewriting.
Default image-only behavior is retained for the white paper. --tables is only
for the four normative Markdown publications: a bounded converter profile, not
a general Word layout engine. Unsupported table layouts refuse before writing.
"""

import argparse
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
EMU_PER_TWIP = 635
CAPTION_RESERVE = 914400  # One inch for a multi-line figure caption.


def _fit_images_only(path):
    with zipfile.ZipFile(path) as original:
        xml = original.read("word/document.xml")
        root = ET.fromstring(xml)
        bounds = []
        for section in root.findall(".//w:sectPr", NS):
            size, margin = section.find("w:pgSz", NS), section.find("w:pgMar", NS)
            if size is None or margin is None:
                raise ValueError("Explicit page size and margins are required")
            attr = lambda element, name: int(element.attrib[f"{{{NS['w']}}}{name}"])
            width = (attr(size, "w") - attr(margin, "left") - attr(margin, "right")) * EMU_PER_TWIP
            height = (attr(size, "h") - attr(margin, "top") - attr(margin, "bottom")) * EMU_PER_TWIP - CAPTION_RESERVE
            if width <= 0 or height <= 0:
                raise ValueError("The page has no usable figure area")
            bounds.append((width, height))
        if not bounds:
            raise ValueError("No page section found")
        max_width, max_height = min(w for w, _ in bounds), min(h for _, h in bounds)
        inline_count = len(root.findall(".//wp:inline", NS))
        changed = 0

        def fit_inline(match):
            nonlocal changed
            block = match.group(0)
            extent_match = re.search(r"<wp:extent\b[^>]*/>", block)
            if extent_match is None:
                raise ValueError("Inline figure has no canonical wp:extent")
            values = dict(re.findall(r'\b(cx|cy)="([0-9]+)"', extent_match.group(0)))
            width, height = int(values["cx"]), int(values["cy"])
            if width <= 0 or height <= 0:
                raise ValueError("Inline figure has a nonpositive extent")
            ratio = min(1, max_width / width, max_height / height)
            if ratio == 1:
                return block
            scaled = {"cx": str(max(1, int(width * ratio))), "cy": str(max(1, int(height * ratio)))}

            def resize_tag(tag):
                return re.sub(r'\b(cx|cy)="[0-9]+"', lambda value: f'{value[1]}="{scaled[value[1]]}"', tag)

            block = block.replace(extent_match.group(0), resize_tag(extent_match.group(0)), 1)
            # The canonical converter uses a:xfrm/a:ext for the same image.
            def resize_transform(transform):
                return re.sub(r"<a:ext\b[^>]*/>", lambda tag: resize_tag(tag.group(0)), transform.group(0))
            block, transforms = re.subn(r"<a:xfrm\b[^>]*>.*?</a:xfrm>", resize_transform, block, flags=re.S)
            if transforms != 1:
                raise ValueError("Expected one canonical image transform")
            changed += 1
            return block

        updated_text, matched = re.subn(r"<wp:inline\b[^>]*>.*?</wp:inline>", fit_inline, xml.decode("utf-8"), flags=re.S)
        if matched != inline_count:
            raise ValueError("Unsupported inline-image XML namespace or structure")
        if changed:
            # Edit only numeric extents; retain namespace declarations and all
            # unrelated XML bytes, including markup-compatibility metadata.
            updated = updated_text.encode("utf-8")
            output = BytesIO()
            with zipfile.ZipFile(output, "w") as result:
                for member in original.infolist():
                    result.writestr(member, updated if member.filename == "word/document.xml" else original.read(member.filename))
            content = output.getvalue()
        else:
            content = None
    if content is not None:
        with open(path, "wb") as target:
            target.write(content)
    print(json.dumps({"operation": "fit-white-paper-inline-images", "resizedFigures": changed, "maxWidthEmu": max_width, "maxHeightEmu": max_height}))


# Ordered property sequences from the Open XML SDK WordprocessingML schema.
# trPr's ordinary properties are a choice; tracked changes are unsupported here.
PROPERTY_ORDER = {
    "tblPr": "tblStyle tblpPr tblOverlap bidiVisual tblW jc tblCellSpacing tblInd tblBorders shd tblLayout tblCellMar tblLook tblCaption tblDescription tblPrChange".split(),
    "tcPr": "cnfStyle tcW gridSpan hMerge vMerge tcBorders shd noWrap tcMar textDirection tcFitText vAlign hideMark cellIns cellDel cellMerge tcPrChange".split(),
}
UNSUPPORTED_TABLE_ELEMENTS = {
    "gridBefore", "gridAfter", "wBefore", "wAfter", "gridSpan", "hMerge", "vMerge",
    "tblpPr", "tblPrChange", "trPrChange", "tcPrChange", "cellIns", "cellDel", "cellMerge",
}
SHORT_ROW_CHARACTERS = 450  # Publication heuristic; final visual QA is required.
W = "{" + NS["w"] + "}"


def _pattern(tag):
    return rf"<w:{tag}\b[^>]*(?:/>|>.*?</w:{tag}>)"


def without_table_layout(xml):
    return re.sub(r"<w:(tblPr|tblGrid|tcPr|trPr)\b[^>]*(?:/>|>.*?</w:\1>)", "", xml, flags=re.S)


def _fit_table_xml(original):
    root = ET.fromstring(original)
    sections = root.findall(".//w:sectPr", NS)
    widths = []
    for section in sections:
        size, margins = section.find("w:pgSz", NS), section.find("w:pgMar", NS)
        if size is None or margins is None:
            raise ValueError("Explicit page size and margins are required")
        if int(margins.get(W + "gutter", "0")) != 0:
            raise ValueError("Unsupported gutter: the table profile requires zero gutter")
        columns = section.find("w:cols", NS)
        if columns is not None and (int(columns.get(W + "num", "1")) != 1 or len(columns)):
            raise ValueError("Unsupported multi-column section")
        direction = section.find("w:textDirection", NS)
        if direction is not None and direction.get(W + "val") != "lrTb":
            raise ValueError("Unsupported section text direction")
        widths.append(int(size.get(W + "w")) - int(margins.get(W + "left")) - int(margins.get(W + "right")))
    if not widths or min(widths) <= 0:
        raise ValueError("Explicit positive section width required")
    width = min(widths)
    document = re.search(r"<w:document\b[^>]*>", original)
    if document is None:
        raise ValueError("Unsupported table XML namespace; canonical w prefix required")
    namespaces = " ".join(re.findall(r'xmlns(?::[^=\s]+)?="[^"]*"', document.group(0)))

    def parse(block):
        return ET.fromstring("<root " + namespaces + ">" + block + "</root>")[0]

    # Validate the whole supported profile before transforming even one image.
    for table in root.findall(".//w:tbl", NS):
        if table.findall(".//w:tbl", NS):
            raise ValueError("Unsupported nested table")
        for element in table.iter():
            if element.tag in {W + name for name in UNSUPPORTED_TABLE_ELEMENTS}:
                raise ValueError("Unsupported table layout element: " + element.tag.split("}")[-1])
            container = element.tag.removeprefix(W)
            if container in PROPERTY_ORDER:
                order = [W + name for name in PROPERTY_ORDER[container]]
                tags = [child.tag for child in element]
                if len(tags) != len(set(tags)) or any(tag not in order for tag in tags):
                    raise ValueError("Unsupported duplicate or unknown " + container + " property")
                if [order.index(tag) for tag in tags] != sorted(order.index(tag) for tag in tags):
                    raise ValueError("Unsupported noncanonical " + container + " property order")
        rows = table.findall("w:tr", NS)
        if not rows or not rows[0].findall("w:tc", NS):
            raise ValueError("Unsupported empty or wrapped table rows")
        count = len(rows[0].findall("w:tc", NS))
        grid = table.find("w:tblGrid", NS)
        if grid is not None and len(grid) not in (0, count):
            raise ValueError("Unsupported irregular table grid")
        if grid is not None and any(child.tag != W + "gridCol" for child in grid):
            raise ValueError("Unsupported table-grid content")
        for row in rows:
            if len(row.findall("w:tc", NS)) != count:
                raise ValueError("Unsupported incomplete table row")

    def set_child(properties, container, tag, attributes):
        child = "<w:" + tag + "".join(' w:' + key + '="' + str(value) + '"' for key, value in attributes.items()) + "/>"
        found = re.search(_pattern(tag), properties, re.S)
        if found:
            return properties[:found.start()] + child + properties[found.end():]
        order = PROPERTY_ORDER.get(container)
        if order:
            rank = order.index(tag)
            for following in order[rank + 1:]:
                found = re.search(_pattern(following), properties, re.S)
                if found:
                    return properties[:found.start()] + child + properties[found.start():]
        closing = properties.rfind("</w:")
        return properties[:closing] + child + properties[closing:]

    def update_properties(block, tag, operation):
        found = re.search(_pattern(tag), block, re.S)
        properties = found.group(0) if found else "<w:" + tag + "></w:" + tag + ">"
        if properties.endswith("/>"):
            properties = properties[:-2] + "></w:" + tag + ">"
        updated = operation(properties)
        if found:
            return block[:found.start()] + updated + block[found.end():]
        opening = block.index(">") + 1
        return block[:opening] + updated + block[opening:]

    records = []

    def table_layout(match):
        table = match.group(0)
        tree = parse(table)
        rows = tree.findall("w:tr", NS)
        cells = rows[0].findall("w:tc", NS)
        count = len(cells)
        headers = [" ".join(t.text or "" for t in cell.iter(W + "t")).strip().lower() for cell in cells]
        if count == 2:
            ratios = [.35, .65]
        elif count == 3 and headers[0] == "#":
            ratios = [.06, .24, .70]
        elif count == 3 and headers[0] == "step":
            ratios = [.07, .60, .33]
        elif count == 3 and headers[:2] == ["version", "date"]:
            ratios = [.12, .19, .69]
        elif count == 3 and "requirement" in headers[1]:
            ratios = [.28, .16, .56]
        elif count == 3 and ("substrate" in headers[1] or "mode" in headers[2]):
            ratios = [.18, .57, .25]
        elif count >= 5:
            ratios = [.12] + [.88 / (count - 1)] * (count - 1)
        else:
            ratios = [1 / count] * count
        columns = [int(width * ratio) for ratio in ratios]
        columns[-1] += width - sum(columns)
        if min(columns) <= 0:
            raise ValueError("Table columns have no usable width")

        def table_properties(properties):
            for tag, attrs in [("tblW", {"type": "dxa", "w": width}), ("tblInd", {"type": "dxa", "w": 0}), ("tblLayout", {"type": "fixed"})]:
                properties = set_child(properties, "tblPr", tag, attrs)
            return properties

        table = update_properties(table, "tblPr", table_properties)
        grid = "<w:tblGrid>" + "".join('<w:gridCol w:w="' + str(value) + '"/>' for value in columns) + "</w:tblGrid>"
        found = re.search(_pattern("tblGrid"), table, re.S)
        if found:
            table = table[:found.start()] + grid + table[found.end():]
        else:
            properties = re.search(_pattern("tblPr"), table, re.S)
            table = table[:properties.end()] + grid + table[properties.end():]
        row_index = 0

        def row_layout(match):
            nonlocal row_index
            row = match.group(0)
            row_chars = sum(len(t.text or "") for t in parse(row).iter(W + "t"))

            def row_properties(properties):
                properties = re.sub(_pattern("cantSplit"), "", properties, flags=re.S)
                if row_index == 0:
                    properties = set_child(properties, "trPr", "tblHeader", {"val": 1})
                if row_index == 0 or row_chars <= SHORT_ROW_CHARACTERS:
                    properties = set_child(properties, "trPr", "cantSplit", {})
                return properties

            row = update_properties(row, "trPr", row_properties)
            column_index = 0

            def cell_layout(match):
                nonlocal column_index
                value = columns[column_index]
                column_index += 1

                def cell_properties(properties):
                    properties = set_child(properties, "tcPr", "tcW", {"type": "dxa", "w": value})
                    for tag in ("noWrap", "tcFitText"):
                        properties = re.sub(_pattern(tag), "", properties, flags=re.S)
                    return properties

                return update_properties(match.group(0), "tcPr", cell_properties)

            row, matched = re.subn(_pattern("tc"), cell_layout, row, flags=re.S)
            if matched != count:
                raise ValueError("Unsupported table-cell structure")
            row_index += 1
            return row

        table, matched = re.subn(_pattern("tr"), row_layout, table, flags=re.S)
        if matched != len(rows):
            raise ValueError("Unsupported table-row structure")
        records.append({"columns": count, "rows": len(rows), "columnWidthsTwips": columns})
        return table

    updated, matched = re.subn(_pattern("tbl"), table_layout, original, flags=re.S)
    if matched != len(root.findall(".//w:tbl", NS)):
        raise ValueError("Unsupported table XML structure")
    if without_table_layout(original) != without_table_layout(updated):
        raise ValueError("Non-table-layout XML changed")
    ET.fromstring(updated)
    return updated, {"operation": "fit-canonical-publication-tables", "usableWidthTwips": width, "tableLayouts": records, "shortRowCharacterHeuristic": SHORT_ROW_CHARACTERS}


def fit_images(path, *, tables=False):
    if not tables:
        return _fit_images_only(path)
    path = Path(path)
    original_bytes = path.read_bytes()
    with zipfile.ZipFile(BytesIO(original_bytes)) as original:
        if len(original.namelist()) != len(set(original.namelist())):
            raise ValueError("Duplicate ZIP members are unsupported")
        xml = original.read("word/document.xml").decode("utf-8")
        updated, report = _fit_table_xml(xml)
        output = BytesIO()
        with zipfile.ZipFile(output, "w") as result:
            result.comment = original.comment
            for member in original.infolist():
                result.writestr(member, updated.encode("utf-8") if member.filename == "word/document.xml" else original.read(member.filename))
    # All rejection-prone work occurs on a private sibling, including image fit.
    # Replacement is atomic on the output filesystem; failed input retains bytes.
    with TemporaryDirectory(prefix=".dpf-layout-", dir=path.parent) as directory:
        candidate = Path(directory) / path.name
        candidate.write_bytes(output.getvalue())
        _fit_images_only(candidate)
        if candidate.read_bytes() != original_bytes:
            os.replace(candidate, path)
    print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--tables", action="store_true", help="Opt in to the bounded canonical normative-table profile")
    arguments = parser.parse_args()
    fit_images(arguments.path, tables=arguments.tables)

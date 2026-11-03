"""Fit this publication's inline figures after the canonical DOCX conversion.

Only DrawingML extents in word/document.xml change. All media and other ZIP
members are retained byte for byte; no image resampling or content rewriting.
Uses Python's standard library only. The wrapper runs it after dpf-doctools.
"""

import json
import sys
import re
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
EMU_PER_TWIP = 635
CAPTION_RESERVE = 914400  # One inch for a multi-line figure caption.


def fit_images(path):
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


if __name__ == "__main__":
    fit_images(sys.argv[1])

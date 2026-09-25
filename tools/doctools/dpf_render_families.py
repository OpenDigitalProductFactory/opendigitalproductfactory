"""Document families for dpf-render (BI-3A0E5413): deck (Impress), report and
letter (Writer), sheet (Calc) and drawing (Draw). Each builder fills an open
document from a validated content spec; tools/doctools/dpf-render opens the
document, exports it and archives the result."""

import uno
from com.sun.star.awt import Rectangle
from com.sun.star.lang import Locale
from com.sun.star.table import CellRangeAddress
from com.sun.star.text.ControlCharacter import PARAGRAPH_BREAK

from dpf_render_uno import (
    CHART_CLSID,
    DEFAULT_CHART_COLOURS,
    Point,
    Size,
    colour,
    fill_chart,
    fitted_size,
    prop,
    style_chart,
    chart_series,
    cell_text,
)


# --------------------------------------------------------------------------- deck (Impress)

AUTOLAYOUT = {"title": 0, "section": 0, "bullets": 1, "chart": 19, "image": 19, "table": 19}
MASTER_FOR_LAYOUT = {"title": "dpf-title", "section": "dpf-section"}


def build_deck(engine, doc, request, warnings):
    content = request["content"]
    pages = doc.getDrawPages()
    masters = doc.getMasterPages()
    master_by_name = {masters.getByIndex(i).Name: masters.getByIndex(i) for i in range(masters.getCount())}
    template_pages = pages.getCount()
    slides = content["slides"]
    for _ in slides:
        pages.insertNewByIndex(pages.getCount() - 1)
    for _ in range(template_pages):
        pages.remove(pages.getByIndex(0))

    for index, slide in enumerate(slides):
        page = pages.getByIndex(index)
        layout = slide["layout"]
        master = master_by_name.get(MASTER_FOR_LAYOUT.get(layout, "dpf-content")) or master_by_name.get("dpf-content")
        if master is not None:
            page.MasterPage = master
        page.Layout = AUTOLAYOUT[layout]
        width, height = page.Width, page.Height
        for shape_index in range(page.getCount()):
            shape = page.getByIndex(shape_index)
            kind = shape.ShapeType
            if kind == "com.sun.star.presentation.TitleTextShape":
                shape.String = slide["title"]
            elif kind == "com.sun.star.presentation.SubtitleShape":
                shape.String = slide.get("subtitle") or ""
            elif kind == "com.sun.star.presentation.OutlinerShape":
                shape.String = "\n".join(slide.get("bullets") or [])
                bullets_in_an_installed_font(shape)
        area = (width * 6 // 100, height * 24 // 100, width * 88 // 100, height * 68 // 100)
        if layout == "chart":
            add_ole_chart(doc, page, area, slide["chart"], request.get("theme"))
        elif layout == "image":
            add_picture(engine, doc, page, area, slide["image"], slide.get("caption"))
        elif layout == "table":
            add_draw_table(doc, page, area, slide["table"])
        if slide.get("notes"):
            notes = page.getNotesPage()
            for shape_index in range(notes.getCount()):
                shape = notes.getByIndex(shape_index)
                if shape.ShapeType == "com.sun.star.presentation.NotesShape":
                    shape.String = slide["notes"]
    return pages.getCount()


def bullets_in_an_installed_font(shape):
    """Impress draws its default bullet from OpenSymbol, which the image does not
    carry, so the bullet vanishes from the PDF and the previews. Use a plain
    bullet from a font every render has (DejaVu Sans)."""
    rules = shape.NumberingRules
    font = uno.createUnoStruct("com.sun.star.awt.FontDescriptor")
    font.Name = "DejaVu Sans"
    level = []
    for item in rules.getByIndex(0):
        if item.Name == "BulletChar":
            item.Value = "•"
        elif item.Name == "BulletFont":
            item.Value = font
        elif item.Name == "BulletRelSize":
            item.Value = 100
        level.append(item)
    uno.invoke(rules, "replaceByIndex", (0, uno.Any("[]com.sun.star.beans.PropertyValue", tuple(level))))
    shape.NumberingRules = rules
    # Text set through the API arrives un-numbered; mark each paragraph a level-1 bullet.
    paragraphs = shape.getText().createEnumeration()
    while paragraphs.hasMoreElements():
        paragraph = paragraphs.nextElement()
        paragraph.NumberingLevel = 0
        paragraph.NumberingIsNumber = True


def add_ole_chart(doc, page, area, spec, theme):
    shape = doc.createInstance("com.sun.star.drawing.OLE2Shape")
    page.add(shape)
    shape.CLSID = CHART_CLSID
    shape.setPosition(Point(area[0], area[1]))
    shape.setSize(Size(area[2], area[3]))
    fill_chart(shape.Model, spec, theme)


def add_picture(engine, doc, page, area, image, caption):
    graphic = engine.graphic(image)
    shape = doc.createInstance("com.sun.star.drawing.GraphicObjectShape")
    page.add(shape)
    caption_h = 1200 if caption else 0
    w, h = fitted_size(graphic, area[2], area[3] - caption_h)
    shape.Graphic = graphic
    shape.setSize(Size(w, h))
    shape.setPosition(Point(area[0] + (area[2] - w) // 2, area[1]))
    shape.Title = image["alt"]
    shape.Description = image["alt"]
    if caption:
        label = doc.createInstance("com.sun.star.drawing.TextShape")
        page.add(label)
        label.setPosition(Point(area[0], area[1] + h + 200))
        label.setSize(Size(area[2], 1000))
        label.String = caption


def add_draw_table(doc, page, area, table):
    shape = doc.createInstance("com.sun.star.drawing.TableShape")
    page.add(shape)
    model = shape.Model
    columns, rows = len(table["columns"]), len(table["rows"]) + 1
    if model.Columns.getCount() < columns:
        model.Columns.insertByIndex(model.Columns.getCount(), columns - model.Columns.getCount())
    if model.Rows.getCount() < rows:
        model.Rows.insertByIndex(model.Rows.getCount(), rows - model.Rows.getCount())
    for c, name in enumerate(table["columns"]):
        model.getCellByPosition(c, 0).setString(name)
    for r, row in enumerate(table["rows"]):
        for c, value in enumerate(row):
            model.getCellByPosition(c, r + 1).setString(cell_text(value))
    shape.setPosition(Point(area[0], area[1]))
    shape.setSize(Size(area[2], min(area[3], rows * 900)))


# --------------------------------------------------------------------------- report and letter (Writer)


AS_CHARACTER = uno.Enum("com.sun.star.text.TextContentAnchorType", "AS_CHARACTER")
PAGE_BEFORE = uno.Enum("com.sun.star.style.BreakType", "PAGE_BEFORE")
RIGHT = uno.Enum("com.sun.star.style.ParagraphAdjust", "RIGHT")
LEFT = uno.Enum("com.sun.star.style.ParagraphAdjust", "LEFT")


class Flow:
    """Appends styled paragraphs at one insertion point in a Writer document."""

    def __init__(self, doc):
        self.doc = doc
        self.text = doc.getText()
        found = self._find_marker()
        if found is not None:
            found.setString("")
            self.cursor = self.text.createTextCursorByRange(found.getStart())
        else:
            self.cursor = self.text.createTextCursor()
            self.cursor.gotoEnd(False)
            if self.text.getString().strip():
                self.text.insertControlCharacter(self.cursor, PARAGRAPH_BREAK, False)
        self.first = True
        self.page_break = False

    def _find_marker(self):
        descriptor = self.doc.createSearchDescriptor()
        descriptor.SearchString = "{{body}}"
        return self.doc.findFirst(descriptor)

    def _start(self, style):
        if not self.first:
            self.text.insertControlCharacter(self.cursor, PARAGRAPH_BREAK, False)
        self.first = False
        self.cursor.ParaStyleName = style
        self.cursor.NumberingStyleName = ""
        self.cursor.ParaAdjust = LEFT
        if self.page_break:
            self.cursor.BreakType = PAGE_BEFORE
            self.page_break = False
        else:
            self.cursor.BreakType = uno.Enum("com.sun.star.style.BreakType", "NONE")

    def paragraph(self, value, style="Text body", bold=False, align=None):
        self._start(style)
        if align is not None:
            self.cursor.ParaAdjust = align
        if bold:
            self.cursor.CharWeight = 150.0
        self.text.insertString(self.cursor, value, False)
        if bold:
            self.cursor.CharWeight = 100.0

    def bullet(self, value):
        self._start("List 1")
        self.cursor.NumberingStyleName = "List 1"
        self.text.insertString(self.cursor, value, False)

    def content(self, obj):
        self._start("Text body")
        self.text.insertTextContent(self.cursor, obj, False)


def writer_table(doc, flow, table):
    obj = doc.createInstance("com.sun.star.text.TextTable")
    obj.initialize(len(table["rows"]) + 1, len(table["columns"]))
    flow._start("Text body")
    flow.text.insertTextContent(flow.cursor, obj, False)
    for c, name in enumerate(table["columns"]):
        obj.getCellByPosition(c, 0).setString(name)
    for r, row in enumerate(table["rows"]):
        for c, value in enumerate(row):
            obj.getCellByPosition(c, r + 1).setString(cell_text(value))


def writer_chart(doc, flow, spec, theme):
    obj = doc.createInstance("com.sun.star.text.TextEmbeddedObject")
    obj.CLSID = CHART_CLSID
    obj.AnchorType = AS_CHARACTER
    obj.Width, obj.Height = 16000, 9000
    flow.content(obj)
    fill_chart(obj.getEmbeddedObject(), spec, theme)


def writer_image(engine, doc, flow, image):
    graphic = engine.graphic(image)
    obj = doc.createInstance("com.sun.star.text.TextGraphicObject")
    obj.AnchorType = AS_CHARACTER
    obj.Graphic = graphic
    w, h = fitted_size(graphic, 16000, 12000)
    obj.Width, obj.Height = w, h
    obj.Title = image["alt"]
    obj.Description = image["alt"]
    flow.content(obj)


def build_report(engine, doc, request, warnings):
    content = request["content"]
    theme = request.get("theme")
    flow = Flow(doc)
    flow.paragraph(content["title"], "Title")
    if content.get("subtitle"):
        flow.paragraph(content["subtitle"], "Subtitle")
    for section in content["sections"]:
        flow.paragraph(section["heading"], "Heading %d" % section.get("level", 1))
        for block in section.get("blocks", []):
            kind = block["kind"]
            if kind == "paragraph":
                flow.paragraph(block["text"])
            elif kind == "bullets":
                for item in block["items"]:
                    flow.bullet(item)
            elif kind == "table":
                writer_table(doc, flow, block["table"])
                if block.get("caption"):
                    flow.paragraph(block["caption"], "Caption")
            elif kind == "chart":
                writer_chart(doc, flow, block["chart"], theme)
            elif kind == "image":
                writer_image(engine, doc, flow, block["image"])
                if block.get("caption"):
                    flow.paragraph(block["caption"], "Caption")
            elif kind == "page-break":
                flow.page_break = True
    return None


def build_letter(engine, doc, request, warnings):
    content = request["content"]
    flow = Flow(doc)
    sender = content.get("sender")
    if sender:
        flow.paragraph(sender["name"], align=RIGHT, bold=True)
        for line in sender.get("lines", []):
            flow.paragraph(line, align=RIGHT)
        flow.paragraph("")
    flow.paragraph(content["date"])
    flow.paragraph("")
    recipient = content["recipient"]
    flow.paragraph(recipient["name"])
    for line in recipient.get("lines", []):
        flow.paragraph(line)
    flow.paragraph("")
    if content.get("reference"):
        flow.paragraph("Ref: %s" % content["reference"])
    if content.get("subject"):
        flow.paragraph(content["subject"], bold=True)
        flow.paragraph("")
    flow.paragraph(content["salutation"])
    for paragraph in content["paragraphs"]:
        flow.paragraph(paragraph)
    flow.paragraph(content["closing"])
    flow.paragraph("")
    flow.paragraph("")
    flow.paragraph(content["signatureName"], bold=True)
    if content.get("signatureTitle"):
        flow.paragraph(content["signatureTitle"])
    return None


# --------------------------------------------------------------------------- sheet (Calc)


NUMBER_FORMAT_CODES = {"integer": "0", "decimal": "#,##0.00", "currency": "#,##0.00", "percent": "0.00%", "date": "YYYY-MM-DD"}


def api_formula(formula):
    """Spreadsheet-style commas to the API grammar's semicolons, outside string literals."""
    out, quoted = [], False
    for ch in formula:
        if ch == '"':
            quoted = not quoted
        out.append(";" if ch == "," and not quoted else ch)
    return "".join(out)


def number_format(doc, code):
    formats = doc.getNumberFormats()
    locale = Locale()
    key = formats.queryKey(code, locale, False)
    return key if key != -1 else formats.addNew(code, locale)


def build_sheet(engine, doc, request, warnings):
    content = request["content"]
    sheets = doc.getSheets()
    specs = content["sheets"]
    while sheets.getCount() < len(specs):
        sheets.insertNewByName("Sheet%d" % (sheets.getCount() + 1), sheets.getCount())
    while sheets.getCount() > len(specs):
        sheets.removeByName(sheets.getByIndex(sheets.getCount() - 1).Name)
    for index, spec in enumerate(specs):
        sheet = sheets.getByIndex(index)
        sheet.Name = spec["name"]
        for c, name in enumerate(spec["columns"]):
            cell = sheet.getCellByPosition(c, 0)
            cell.setString(name)
            cell.CharWeight = 150.0
        for r, row in enumerate(spec["rows"]):
            for c, value in enumerate(row):
                cell = sheet.getCellByPosition(c, r + 1)
                if value is None:
                    continue
                if isinstance(value, dict):
                    cell.setFormula(api_formula(value["formula"]))
                elif isinstance(value, bool):
                    cell.setValue(1 if value else 0)
                elif isinstance(value, (int, float)):
                    cell.setValue(float(value))
                else:
                    cell.setString(value)
        for c, fmt in enumerate(spec.get("columnFormats") or []):
            if fmt != "general" and len(spec["rows"]) > 0:
                column_range = sheet.getCellRangeByPosition(c, 1, c, len(spec["rows"]))
                column_range.NumberFormat = number_format(doc, NUMBER_FORMAT_CODES[fmt])
        columns = sheet.getColumns()
        for c in range(len(spec["columns"])):
            columns.getByIndex(c).OptimalWidth = True
        if spec.get("chart"):
            sheet_chart(sheet, spec, index, request.get("theme"))
    return None


def sheet_chart(sheet, spec, sheet_index, theme):
    """A Calc chart reads cells, so its numbers are written as a labelled block under the table."""
    chart = spec["chart"]
    series = chart_series(chart)
    top = len(spec["rows"]) + 3  # one blank row after the table, then a labelled block
    sheet.getCellByPosition(0, top - 1).setString("Chart data")
    sheet.getCellByPosition(0, top - 1).CharWeight = 150.0
    for c, s in enumerate(series):
        sheet.getCellByPosition(c + 1, top).setString(s["name"])
    for r, category in enumerate(chart["categories"]):
        sheet.getCellByPosition(0, top + r + 1).setString(category)
        for c, s in enumerate(series):
            sheet.getCellByPosition(c + 1, top + r + 1).setValue(float(s["values"][r]))
    address = CellRangeAddress()
    address.Sheet = sheet_index
    address.StartColumn, address.StartRow = 0, top
    address.EndColumn, address.EndRow = len(series), top + len(chart["categories"])
    # Below the data block, at column A, 16 cm wide: it fits a portrait A4 or Letter page.
    anchor = sheet.getCellByPosition(0, address.EndRow + 2).Position
    charts = sheet.getCharts()
    name = "dpf-chart-%d" % sheet_index
    charts.addNewByName(name, Rectangle(anchor.X, anchor.Y, 16000, 9000), (address,), True, True)
    style_chart(charts.getByName(name).getEmbeddedObject(), chart, theme)


# --------------------------------------------------------------------------- drawing (Draw)

CUSTOM_SHAPE_TYPE = {"rect": "rectangle", "rounded-rect": "round-rectangle", "ellipse": "ellipse", "diamond": "diamond"}


def build_drawing(engine, doc, request, warnings):
    content = request["content"]
    theme = request.get("theme") or {}
    pages = doc.getDrawPages()
    while pages.getCount() < len(content["pages"]):
        pages.insertNewByIndex(pages.getCount() - 1)
    while pages.getCount() > len(content["pages"]):
        pages.remove(pages.getByIndex(pages.getCount() - 1))
    for index, spec in enumerate(content["pages"]):
        page = pages.getByIndex(index)
        if spec.get("name"):
            page.Name = spec["name"]
        # Landscape A4, grown so every shape (plus a 1 cm margin) is on the page.
        right = max([s["x"] + s["width"] for s in spec["shapes"]] or [0])
        bottom = max([s["y"] + s["height"] for s in spec["shapes"]] or [0])
        page.Width = max(29700, int(right * 100) + 1000)
        page.Height = max(21000, int(bottom * 100) + 1000)
        placed = {}
        for shape_spec in spec["shapes"]:
            if shape_spec["kind"] == "text":
                shape = doc.createInstance("com.sun.star.drawing.TextShape")
                page.add(shape)
            else:
                shape = doc.createInstance("com.sun.star.drawing.CustomShape")
                page.add(shape)
                shape.CustomShapeGeometry = (prop("Type", CUSTOM_SHAPE_TYPE[shape_spec["kind"]]),)
            # Spec coordinates are millimetres; the API speaks 1/100 mm.
            shape.setPosition(Point(int(shape_spec["x"] * 100), int(shape_spec["y"] * 100)))
            shape.setSize(Size(int(shape_spec["width"] * 100), int(shape_spec["height"] * 100)))
            shape.Name = shape_spec["id"]
            # A shape's own colours win; otherwise the brand theme's, when there is one.
            boxed = shape_spec["kind"] != "text"
            fill = shape_spec.get("fill") or (theme.get("shapeFill") if boxed else None)
            stroke = shape_spec.get("stroke") or (theme.get("shapeStroke") if boxed else None)
            ink = shape_spec.get("textColour") or (theme.get("shapeText") if boxed and not shape_spec.get("fill") else None)
            if fill and boxed:
                shape.FillColor = colour(fill)
            if stroke and boxed:
                shape.LineColor = colour(stroke)
            if shape_spec.get("label"):
                shape.String = shape_spec["label"]
            if ink:
                shape.CharColor = colour(ink)
            placed[shape_spec["id"]] = shape
        for connector in spec.get("connectors", []):
            line = doc.createInstance("com.sun.star.drawing.ConnectorShape")
            page.add(line)
            line.StartShape = placed[connector["from"]]
            line.EndShape = placed[connector["to"]]
            line.LineEndName = "Arrow"
            if connector.get("stroke") or theme.get("shapeStroke"):
                line.LineColor = colour(connector.get("stroke") or theme["shapeStroke"])
            if connector.get("label"):
                line.String = connector["label"]
    return pages.getCount()


BUILDERS = {"deck": build_deck, "report": build_report, "letter": build_letter, "sheet": build_sheet, "drawing": build_drawing}

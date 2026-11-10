"""Write a small Visio (.vsdx) diagram to stdout (BI-4C17BF51).

The Visio fixture for dpf-convert's drawing import, built at test time so the
repository carries no opaque office binary (a .vsdx is a ZIP of XML parts).
Run it with the image's own interpreter:

    docker run --rm -i --entrypoint python3 <image> - < sample-vsdx.py > sample.vsdx

Four labelled boxes and three connectors glued to them; one box carries the
DPFSENTINELDRAW sentinel the smoke test looks for in every converted form.
"""
import io
import sys
import zipfile

NS = ('xmlns="http://schemas.microsoft.com/office/visio/2012/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
REL = "http://schemas.microsoft.com/visio/2010/relationships/"


def rels(*items):
    body = "".join(f'<Relationship Id="{i}" Type="{REL}{t}" Target="{target}"/>' for i, t, target in items)
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>')


def cells(**values):
    return "".join(f'<Cell N="{name}" V="{value}"/>' for name, value in values.items())


def geometry(points):
    rows = "".join(
        f'<Row T="{"MoveTo" if i == 0 else "LineTo"}" IX="{i + 1}">{cells(X=x, Y=y)}</Row>'
        for i, (x, y) in enumerate(points))
    return f'<Section N="Geometry" IX="0">{rows}</Section>'


def box(shape_id, x, y, text):
    w, h = 1.5, 0.75
    return (f'<Shape ID="{shape_id}" Type="Shape">'
            + cells(PinX=x, PinY=y, Width=w, Height=h, LocPinX=w / 2, LocPinY=h / 2)
            + geometry([(0, 0), (w, 0), (w, h), (0, h), (0, 0)])
            + f"<Text>{text}</Text></Shape>")


def connector(shape_id, begin, end, text=""):
    (x1, y1), (x2, y2) = begin, end
    w, h = abs(x2 - x1) or 0.0001, abs(y2 - y1) or 0.0001
    label = f"<Text>{text}</Text>" if text else ""
    return (f'<Shape ID="{shape_id}" Type="Shape">'
            + cells(PinX=(x1 + x2) / 2, PinY=(y1 + y2) / 2, Width=w, Height=h, LocPinX=w / 2, LocPinY=h / 2,
                    BeginX=x1, BeginY=y1, EndX=x2, EndY=y2, ObjType=2)
            + geometry([(0, 0), (w, h)]) + label + "</Shape>")


def glue(connector_id, begin_shape, end_shape):
    return (f'<Connect FromSheet="{connector_id}" FromCell="BeginX" ToSheet="{begin_shape}" ToCell="PinX"/>'
            f'<Connect FromSheet="{connector_id}" FromCell="EndX" ToSheet="{end_shape}" ToCell="PinX"/>')


shapes = (box(1, 2, 6, "Customer Portal") + box(2, 6, 6, "Order Service")
          + box(3, 6, 3, "Orders Database") + box(4, 2, 3, "DPFSENTINELDRAW Billing")
          + connector(5, (2.75, 6), (5.25, 6), "calls")
          + connector(6, (6, 5.625), (6, 3.375), "reads")
          + connector(7, (5.25, 3), (2.75, 3)))
page = (f'<?xml version="1.0" encoding="UTF-8"?><PageContents {NS}><Shapes>{shapes}</Shapes>'
        f'<Connects>{glue(5, 1, 2)}{glue(6, 2, 3)}{glue(7, 3, 4)}</Connects></PageContents>')
content_types = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>'
    '<Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>'
    '<Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/></Types>')
parts = [
    ("[Content_Types].xml", content_types),
    ("_rels/.rels", rels(("rId1", "document", "visio/document.xml"))),
    ("visio/document.xml", f'<?xml version="1.0" encoding="UTF-8"?><VisioDocument {NS}/>'),
    ("visio/_rels/document.xml.rels", rels(("rId1", "pages", "pages/pages.xml"))),
    ("visio/pages/pages.xml",
     f'<?xml version="1.0" encoding="UTF-8"?><Pages {NS}><Page ID="0" NameU="Page-1" Name="Page-1">'
     f'<PageSheet>{cells(PageWidth=11, PageHeight=8.5)}</PageSheet><Rel r:id="rId1"/></Page></Pages>'),
    ("visio/pages/_rels/pages.xml.rels", rels(("rId1", "page", "page1.xml"))),
    ("visio/pages/page1.xml", page),
]
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
    for name, text in parts:
        # A fixed timestamp keeps the fixture byte-identical from run to run.
        archive.writestr(zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)), text)
sys.stdout.buffer.write(buffer.getvalue())

"""UNO plumbing for dpf-render (BI-3A0E5413): the engine process, charts,
pictures and `{{name}}` placeholders. Imported by tools/doctools/dpf-render and
by dpf_render_families; runs only inside the dpf-doctools image, where the
distribution's python3-uno bridge is installed."""

import base64
import os
import re
import shutil
import subprocess
import sys
import time

import uno
from com.sun.star.beans import PropertyValue
from com.sun.star.connection import NoConnectException

PROFILE_TEMPLATE = os.environ.get("DPF_CONVERT_PROFILE_TEMPLATE", "/opt/dpf-doctools/profile")
CHART_CLSID = "12dcae26-281f-416f-a234-c3086127382e"
DEFAULT_CHART_COLOURS = ["#004586", "#ff420e", "#ffd320", "#579d1c", "#7e0021", "#83caff", "#314004", "#aecf00"]




def prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def colour(hex_value):
    return int(hex_value.lstrip("#"), 16)


def file_url(path):
    return uno.systemPathToFileUrl(path)


def render_profile(path):
    """The hardened dpf-convert profile, with one setting relaxed for rendering.

    Charts are embedded chart objects, and DisableActiveContent refuses every
    embedded object. dpf-render creates those objects itself from validated
    numbers and only opens screened flat-ODF templates (TEMPLATE_FORBIDDEN), so
    it lifts that one switch. Document mode (BI-BFF142A1) opens DPF-generated
    flat ODF whose only embedded objects are screened inline charts. Macros stay
    off, OLE automation stays off, links are never updated, and the container
    still has no network.
    """
    with open(path, encoding="utf-8") as handle:
        xml = handle.read()
    relaxed = re.sub(
        r'(<prop oor:name="DisableActiveContent" oor:op="fuse"><value>)true(</value>)', r"\g<1>false\g<2>", xml
    )
    if relaxed == xml:
        raise RuntimeError("the hardened profile has no DisableActiveContent switch to relax")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(relaxed)


ENGINES = []  # the running soffice, so a timeout can kill it


class Engine:
    """One headless soffice for this run, reached over a private pipe."""

    def __init__(self, work):
        self.work = work
        self.pipe = "dpf-render-%d" % os.getpid()
        profile = os.path.join(work, "profile")
        shutil.copytree(PROFILE_TEMPLATE, profile, dirs_exist_ok=True)
        render_profile(os.path.join(profile, "user", "registrymodifications.xcu"))
        self.proc = subprocess.Popen(
            [
                "soffice", "--headless", "--invisible", "--nologo", "--nodefault", "--norestore",
                "--nolockcheck", "--nofirststartwizard",
                "-env:UserInstallation=" + file_url(profile),
                "--accept=pipe,name=%s;urp;StarOffice.ComponentContext" % self.pipe,
            ],
            stdout=sys.stderr, stderr=sys.stderr, stdin=subprocess.DEVNULL,
        )
        ENGINES.append(self.proc)
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        deadline = time.monotonic() + 60
        while True:
            try:
                self.ctx = resolver.resolve("uno:pipe,name=%s;urp;StarOffice.ComponentContext" % self.pipe)
                break
            except NoConnectException:
                if self.proc.poll() is not None:
                    raise RuntimeError("soffice exited (%s) before accepting a connection" % self.proc.returncode)
                if time.monotonic() > deadline:
                    raise RuntimeError("soffice did not accept a connection within 60s")
                time.sleep(0.2)
        self.smgr = self.ctx.ServiceManager
        self.desktop = self.smgr.createInstanceWithContext("com.sun.star.frame.Desktop", self.ctx)
        self.graphics = self.smgr.createInstanceWithContext("com.sun.star.graphic.GraphicProvider", self.ctx)

    def open(self, url, filter_name=None, as_template=True):
        args = [prop("Hidden", True), prop("MacroExecutionMode", 0), prop("UpdateDocMode", 0)]
        if filter_name:
            args += [prop("AsTemplate", as_template), prop("FilterName", filter_name)]
        doc = self.desktop.loadComponentFromURL(url, "_blank", 0, tuple(args))
        if doc is None:
            raise RuntimeError("the engine could not open %s" % url)
        return doc

    def graphic(self, image):
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif"}[image["mimeType"]]
        path = os.path.join(self.work, "img-%d.%s" % (len(os.listdir(self.work)), ext))
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(image["data"]))
        return self.graphics.queryGraphic((prop("URL", file_url(path)),))

    def close(self):
        try:
            self.desktop.terminate()
        except Exception:  # the bridge drops as soffice exits; that is the expected end
            pass
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def fitted_size(graphic, max_w, max_h):
    size = graphic.Size100thMM
    w, h = size.Width, size.Height
    if not w or not h:
        pixels = graphic.SizePixel
        w, h = pixels.Width * 2646 // 100, pixels.Height * 2646 // 100
    if not w or not h:
        return max_w, max_h
    scale = min(max_w / w, max_h / h)
    return int(w * scale), int(h * scale)


DIAGRAM_SERVICE = {
    "bar": "com.sun.star.chart.BarDiagram",
    "column": "com.sun.star.chart.BarDiagram",
    "line": "com.sun.star.chart.LineDiagram",
    "pie": "com.sun.star.chart.PieDiagram",
    "area": "com.sun.star.chart.AreaDiagram",
}
FILL_NONE = uno.Enum("com.sun.star.drawing.FillStyle", "NONE")


def chart_series(spec):
    """A pie shows one series; every other type shows them all."""
    return spec["series"][:1] if spec["type"] == "pie" else spec["series"]


def style_chart(chart_doc, spec, theme, set_type=True):
    """Diagram type, orientation, title, legend and brand colours, whatever the data source."""
    kind = spec["type"]
    if set_type:
        chart_doc.setDiagram(chart_doc.createInstance(DIAGRAM_SERVICE[kind]))
    diagram = chart_doc.getDiagram()
    if kind in ("bar", "column"):
        diagram.Vertical = kind == "bar"  # "bar" is horizontal, as office suites name it
    if kind != "pie":
        diagram.getWall().FillStyle = FILL_NONE
    chart_doc.HasMainTitle = bool(spec.get("title"))
    if spec.get("title"):
        chart_doc.getTitle().String = spec["title"]
    series = chart_series(spec)
    chart_doc.HasLegend = kind == "pie" or len(series) > 1
    colours = (theme or {}).get("chartColours") or DEFAULT_CHART_COLOURS
    if kind == "pie":
        for index in range(len(spec["categories"])):
            diagram.getDataPointProperties(index, 0).FillColor = colour(colours[index % len(colours)])
    else:
        for index in range(len(series)):
            props = diagram.getDataRowProperties(index)
            props.FillColor = colour(colours[index % len(colours)])
            props.LineColor = colour(colours[index % len(colours)])


def fill_chart(chart_doc, spec, theme):
    """A chart that owns its data (Impress, Writer): the numbers live inside the chart."""
    # The type is set before the data: replacing the diagram afterwards drops the series.
    chart_doc.setDiagram(chart_doc.createInstance(DIAGRAM_SERVICE[spec["type"]]))
    series = chart_series(spec)
    data = chart_doc.getData()
    data.setData(tuple(tuple(float(s["values"][i]) for s in series) for i in range(len(spec["categories"]))))
    data.setRowDescriptions(tuple(spec["categories"]))
    data.setColumnDescriptions(tuple(s["name"] for s in series))
    style_chart(chart_doc, spec, theme, set_type=False)


def cell_text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)




def placeholder_values(request):
    content = request["content"]
    values = {"title": content.get("title", ""), "subject": content.get("subject", ""), "author": content.get("author", "")}
    issued = request.get("issuedAt")
    if issued:
        values["date"] = issued[:10]
    values.update(content.get("fields") or {})
    return values


def replace_in_replaceable(target, values):
    for key, value in values.items():
        descriptor = target.createReplaceDescriptor()
        descriptor.SearchString = "{{%s}}" % key
        descriptor.ReplaceString = value
        target.replaceAll(descriptor)


def replace_in_calc_headers(doc, values):
    """Calc keeps page headers and footers outside the searchable cells."""
    styles = doc.getStyleFamilies().getByName("PageStyles")
    for index in range(styles.getCount()):
        style = styles.getByIndex(index)
        for name in ("RightPageHeaderContent", "RightPageFooterContent", "LeftPageHeaderContent", "LeftPageFooterContent"):
            content = getattr(style, name, None)
            if content is None:
                continue
            changed = False
            for region in (content.getLeftText(), content.getCenterText(), content.getRightText()):
                text = region.getString()
                if "{{" in text:
                    for key, value in values.items():
                        text = text.replace("{{%s}}" % key, value)
                    region.setString(text)
                    changed = True
            if changed:
                setattr(style, name, content)


def replace_in_shapes(pages, values):
    for index in range(pages.getCount()):
        page = pages.getByIndex(index)
        try:
            replace_in_replaceable(page, values)
            continue
        except Exception:  # not every page implementation is searchable; fall back to shape text
            pass
        for shape_index in range(page.getCount()):
            shape = page.getByIndex(shape_index)
            if hasattr(shape, "String") and "{{" in (shape.String or ""):
                text = shape.String
                for key, value in values.items():
                    text = text.replace("{{%s}}" % key, value)
                shape.String = text

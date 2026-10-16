"""Publication exports only. Dependencies come from the discovered bundled runtime."""
import re
import sys
from pathlib import Path
from html import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader

source=Path(__file__).resolve().parent
out=Path(sys.argv[1]); previews=Path(sys.argv[2]); font_dir=Path(sys.argv[3])
out.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Arial',str(font_dir/'Arial.ttf')))
pdfmetrics.registerFont(TTFont('Arial-Bold',str(font_dir/'Arial Bold.ttf')))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='Arial-Bold',italic='Arial',boldItalic='Arial-Bold')
styles={
 'h1':ParagraphStyle('h1',fontName='Arial-Bold',fontSize=23,leading=27,textColor=colors.HexColor('#17283B'),spaceAfter=12),
 'h2':ParagraphStyle('h2',fontName='Arial-Bold',fontSize=12.5,leading=16,textColor=colors.HexColor('#0A766E'),spaceBefore=10,spaceAfter=5),
 'body':ParagraphStyle('body',fontName='Arial',fontSize=10.4,leading=14.2,textColor=colors.HexColor('#344960'),spaceAfter=7,alignment=TA_LEFT),
 'sources':ParagraphStyle('sources',fontName='Arial',fontSize=8.4,leading=11,textColor=colors.HexColor('#344960'),spaceBefore=4)
}
def rich(s):
 s=escape(s)
 return re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',s)
story=[]
for block in (source/'meeting-brief.md').read_text().split('\n\n'):
 block=block.strip()
 if not block: continue
 if block=='<!-- PAGE BREAK -->':story.append(PageBreak());continue
 if block.startswith('# '):story.append(Paragraph(rich(block[2:]),styles['h1']));continue
 if block.startswith('## '):story.append(Paragraph(rich(block[3:]),styles['h2']));continue
 story.append(Paragraph(rich(block.replace('\n',' ')),styles['body']))
links=[('TBM','https://www.tbmconference.org/'),('SysML','https://www.omg.org/spec/SysML/2.0'),('DMN','https://www.omg.org/spec/DMN/1.5'),('PROV-O','https://www.w3.org/TR/prov-o/'),('AAIF policy','https://github.com/aaif/technical-committee/blob/main/governance/project-lifecycle-policy.md'),('Jev','https://docs.typesafe.ai/introduction')]
story.append(Paragraph('Primary links: '+' | '.join(f'<link href="{u}" color="#0A766E">{n}</link>' for n,u in links),styles['sources']))
def footer(c,doc):
 c.setFont('Arial',8);c.setFillColor(colors.HexColor('#607485'))
 c.drawString(48,29,'Discussion draft | 16 Oct 2026 | No endorsement or completed conformance')
 c.drawRightString(564,29,str(doc.page))
doc=SimpleDocTemplate(str(out/'meeting-brief.pdf'),pagesize=(612,792),leftMargin=48,rightMargin=48,topMargin=44,bottomMargin=48,title='Trusted agent execution: discussion brief',author='DPF contributors')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
count=len(PdfReader(out/'meeting-brief.pdf').pages)
if count!=2:raise RuntimeError(f'Expected two-page brief, got {count}')
slides=sorted(previews.glob('slide-*.png'))
if len(slides)!=12:raise RuntimeError(f'Expected12 actual previews, got {len(slides)}')
c=canvas.Canvas(str(out/'trusted-agent-tbm.pdf'),pagesize=(960,540));c.setTitle('Trusted agent execution: architecture discussion slides')
for img in slides:
 c.drawImage(ImageReader(str(img)),0,0,width=960,height=540);c.showPage()
c.save()
print(f'Wrote two-page brief and {len(slides)}-page static deck PDF')

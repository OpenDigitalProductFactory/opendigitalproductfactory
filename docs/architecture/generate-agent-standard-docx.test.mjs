import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateAgentStandardDocx } from "./generate-agent-standard-docx.mjs";

const python = process.env.DPF_PUBLICATION_PYTHON || "python3";
const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>Field</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Definition</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12000" w:h="16000"/><w:pgMar w:left="1000" w:right="1000" w:top="1000" w:bottom="1000"/></w:sectPr></w:body></w:document>';
function docx(source = xml) {
  return execFileSync(python, ["-c", "import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('word/document.xml',sys.stdin.buffer.read()); z.writestr('word/media/retained.png',b'retained'); z.close(); sys.stdout.buffer.write(b.getvalue())"], { input: source });
}
function sandbox(run) {
  const directory = mkdtempSync(join(tmpdir(), "dpf-publication-wrapper-test-"));
  return Promise.resolve().then(() => run(directory)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

for (const key of ["tak", "gaid", "jsi", "gpp"]) {
  test(`${key} stages conversion, applies real fitting, then replaces only its target`, () => sandbox(async directory => {
    const outputPath = join(directory, "publication.docx");
    writeFileSync(outputPath, "retained prior publication");
    let candidate;
    await generateAgentStandardDocx(key, { config: { outputPath }, generate: async config => {
      candidate = config.outputPath;
      assert.notEqual(candidate, outputPath);
      assert.equal(readFileSync(outputPath, "utf8"), "retained prior publication");
      writeFileSync(candidate, docx());
    } });
    const text = execFileSync(python, ["-c", "import sys,zipfile; print(zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode())", outputPath], { encoding: "utf8" });
    assert.match(text, /w:tblLayout w:type="fixed"/);
    assert.match(text, /w:tblHeader/);
    assert.deepEqual(readdirSync(directory), ["publication.docx"]);
  }));
}

test("unsupported fitted input preserves the entire prior publication and cleans the candidate", () => sandbox(async directory => {
  const outputPath = join(directory, "publication.docx");
  const previous = Buffer.from("retained prior publication bytes");
  writeFileSync(outputPath, previous);
  await assert.rejects(generateAgentStandardDocx("gpp", { config: { outputPath }, generate: async config => {
    writeFileSync(config.outputPath, docx(xml.replace('<w:tr>', '<w:tr><w:trPr><w:gridBefore w:val="1"/></w:trPr>')));
  } }), /fit|layout|grid|unsupported/i);
  assert.deepEqual(readFileSync(outputPath), previous);
  assert.deepEqual(readdirSync(directory), ["publication.docx"]);
}));

test("generation failure preserves the prior publication without attempting promotion", () => sandbox(async directory => {
  const outputPath = join(directory, "publication.docx");
  writeFileSync(outputPath, "retained prior publication");
  await assert.rejects(generateAgentStandardDocx("tak", { config: { outputPath }, generate: async config => {
    writeFileSync(config.outputPath, "partial candidate");
    throw new Error("controlled conversion failure");
  } }), /controlled conversion failure/);
  assert.equal(readFileSync(outputPath, "utf8"), "retained prior publication");
  assert.deepEqual(readdirSync(directory), ["publication.docx"]);
}));

test("generic white-paper generation retains its previous direct conversion behavior", () => sandbox(async directory => {
  const outputPath = join(directory, "white-paper.docx");
  const untouched = docx();
  await generateAgentStandardDocx("white-paper", { config: { outputPath }, generate: async config => {
    assert.equal(config.outputPath, outputPath);
    writeFileSync(outputPath, untouched);
  } });
  assert.deepEqual(readFileSync(outputPath), untouched);
  assert.deepEqual(readdirSync(directory), ["white-paper.docx"]);
}));

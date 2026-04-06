import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

export type DocxChapterPart = { title: string; body: string };

/**
 * 将作品标题 + 多章正文（已纯文本化）打成 Word，返回 base64 供前端下载。
 */
export async function bookPartsToDocxBase64(bookTitle: string, chapters: DocxChapterPart[]): Promise<string> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: bookTitle })]
    })
  ];

  for (const ch of chapters) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: ch.title })]
      })
    );
    const lines = ch.body.replace(/\r\n/g, "\n").split("\n");
    for (const line of lines) {
      children.push(
        new Paragraph({
          children: [new TextRun(line.length > 0 ? line : " ")]
        })
      );
    }
    children.push(new Paragraph({ children: [new TextRun(" ")] }));
  }

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf).toString("base64");
}

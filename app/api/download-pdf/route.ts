import { PDFDocument, StandardFonts } from "pdf-lib";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const formData = await req.formData();
        const name = String(formData.get("name") ?? "");
        const employeeNumber = String(formData.get("employeeNumber") ?? "");
        const date = String(formData.get("date") ?? "");
        const reason = String(formData.get("reason") ?? "");
        const images = formData.getAll("images").filter((value): value is File => value instanceof File);

        if (!name || !employeeNumber || !date || !reason || images.length === 0) {
            return Response.json(
                { error: "Missing required fields or images" },
                { status: 400 }
            );
        }

        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const margin = 40;
        const headerFontSize = 20;
        const headerLineGap = 6;
        const headerLineHeight = headerFontSize + headerLineGap;
        const pagePadding = 20;
        const maxPageWidth = 600;
        const maxPageHeight = 800;
        const headerLines = 2;

        for (let i = 0; i < images.length; i++) {
            const file = images[i];
            const imgBytes = await file.arrayBuffer();

            const nameLower = file.name.toLowerCase();
            const looksJpeg =
                file.type.includes("jpeg") ||
                file.type.includes("jpg") ||
                nameLower.endsWith(".jpg") ||
                nameLower.endsWith(".jpeg");
            const image = looksJpeg
                ? await pdfDoc.embedJpg(imgBytes)
                : await pdfDoc.embedPng(imgBytes);

            const imgWidth = image.width;
            const imgHeight = image.height;

            const widthScale = (maxPageWidth - margin * 2) / imgWidth;
            const heightScale =
                (maxPageHeight -
                    margin * 2 -
                    (i === 0 ? headerLineHeight * headerLines + pagePadding : 0)) /
                imgHeight;
            const scale = Math.min(widthScale, heightScale, 1);
            const drawWidth = imgWidth * scale;
            const drawHeight = imgHeight * scale;

            const pageWidth = drawWidth + margin * 2;
            const pageHeight =
                drawHeight +
                margin * 2 +
                (i === 0 ? headerLineHeight * headerLines + pagePadding : 0);

            const page = pdfDoc.addPage([pageWidth, pageHeight]);

            if (i === 0) {
                const line1 = `${name}  ${employeeNumber}`;
                const line2 = `${date}  ${reason}`;
                const startY = page.getHeight() - headerFontSize - 10;

                [line1, line2].forEach((line, index) => {
                    page.drawText(line, {
                        x: margin,
                        y: startY - index * headerLineHeight,
                        size: headerFontSize,
                        font,
                    });
                });
            }

            const x = (page.getWidth() - drawWidth) / 2;
            const y = margin;
            page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
        }

        const pdfBytes = await pdfDoc.save();
        const body = Uint8Array.from(pdfBytes);
        return new Response(body, {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": 'attachment; filename="documents.pdf"',
                "Cache-Control": "no-store",
            },
        });
    } catch (err) {
        console.error("download-pdf:", err);
        const message = err instanceof Error ? err.message : "PDF generation failed";
        return Response.json({ error: message }, { status: 500 });
    }
}

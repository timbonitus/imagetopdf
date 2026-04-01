"use client";

import { useCallback, useLayoutEffect, useState } from "react";
import { PDFDocument } from "pdf-lib";

type FileWithRotation = {
    file: File;
    rotation: number; // in degrees
    src: string; // preview URL
};

/**
 * Vercel Hobby serverless request bodies are ~4.5MB; many full-resolution phone photos exceed that.
 * These defaults target fitting several pages under the limit. Tune if you upgrade plan or move uploads to object storage.
 */
const MAX_SIDE_SERVER = 1150;
const JPEG_QUALITY_SERVER = 0.66;
/** Second pass when the first client build fails (memory / huge pages). */
const MAX_SIDE_CLIENT_FALLBACK = 880;
const JPEG_QUALITY_CLIENT_FALLBACK = 0.52;

function downscaleCanvas(source: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
    const w = source.width;
    const h = source.height;
    if (w <= maxSide && h <= maxSide) return source;
    const scale = maxSide / Math.max(w, h);
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const out = document.createElement("canvas");
    out.width = nw;
    out.height = nh;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(source, 0, 0, nw, nh);
    return out;
}

/** Returns true if the string contains any character outside the WinAnsi (cp1252) range. */
function containsNonWinAnsi(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) > 0xff) return true;
    }
    return false;
}

function imageFilesFromClipboard(data: DataTransfer | null): File[] {
    if (!data) return [];
    const out: File[] = [];
    for (let i = 0; i < data.items.length; i++) {
        const item = data.items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
            const f = item.getAsFile();
            if (f) out.push(f);
        }
    }
    if (out.length > 0) return out;
    return Array.from(data.files).filter((f) => f.type.startsWith("image/"));
}

export default function Home() {
    const [files, setFiles] = useState<FileWithRotation[]>([]);
    const [galleryInput, setGalleryInput] = useState<HTMLInputElement | null>(null);

    const [name, setName] = useState("");
    const [employeeNumber, setEmployeeNumber] = useState("");
    const [date, setDate] = useState("");
    const [reason, setReason] = useState("");

    const addFiles = useCallback((incomingFiles: File[]) => {
        if (incomingFiles.length === 0) return;
        const newFiles: FileWithRotation[] = incomingFiles.map((f) => {
            let src = "";
            try {
                src = URL.createObjectURL(f);
            } catch {
                src = "";
            }
            return {
                file: f,
                rotation: 0,
                src,
            };
        });
        setFiles((prev) => [...prev, ...newFiles]);
    }, []);

    const ingestGalleryInput = useCallback((input: HTMLInputElement) => {
        const list = input.files;
        const n = list?.length ?? 0;
        if (!list || n === 0) return;

        const snapshot = Array.from(list);
        addFiles(snapshot);
        setTimeout(() => {
            input.value = "";
        }, 0);
    }, [addFiles]);

    // Native change only: iOS Safari fires both change and input for one pick; listening to both
    // duplicates every selected image.
    useLayoutEffect(() => {
        if (!galleryInput) return;
        const handler = () => {
            ingestGalleryInput(galleryInput);
        };
        galleryInput.addEventListener("change", handler);
        return () => {
            galleryInput.removeEventListener("change", handler);
        };
    }, [galleryInput, ingestGalleryInput]);

    const rotateImage = (index: number, degrees: number) => {
        const newFiles = [...files];
        newFiles[index].rotation = (newFiles[index].rotation + degrees) % 360;
        setFiles(newFiles);
    };

    const removeImage = (index: number) => {
        setFiles((prev) => {
            const item = prev[index];
            if (item?.src?.startsWith("blob:")) {
                URL.revokeObjectURL(item.src);
            }
            return prev.filter((_, i) => i !== index);
        });
    };

    const getCanvasFromFile = async (fileWithRot: FileWithRotation) => {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const objectUrl = URL.createObjectURL(fileWithRot.file);
            const image = new window.Image();
            image.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("Unable to read image file"));
            };
            image.src = objectUrl;
        });

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;

        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        const swap = fileWithRot.rotation % 180 !== 0;

        canvas.width = swap ? height : width;
        canvas.height = swap ? width : height;

        if (fileWithRot.rotation !== 0) {
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((fileWithRot.rotation * Math.PI) / 180);
            ctx.translate(-canvas.width / 2, -canvas.height / 2);
        }

        ctx.drawImage(img, 0, 0);
        return canvas;
    };

    const triggerPdfDownload = async (blob: Blob) => {
        // Method 1: File System Access API — triggers the OS-native "Save As" dialog.
        // This bypasses browser download policies entirely because it is an OS-level
        // operation, not a browser download. Supported in Chrome/Edge 86+.
        if ("showSaveFilePicker" in window) {
            try {
                const handle = await (window as Window & { showSaveFilePicker: Function }).showSaveFilePicker({
                    suggestedName: "documents.pdf",
                    types: [{ description: "PDF file", accept: { "application/pdf": [".pdf"] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                return;
            } catch (e) {
                // AbortError means the user closed the dialog — respect that and stop.
                if (e instanceof Error && e.name === "AbortError") return;
                // Any other error (e.g. API blocked by policy) — fall through.
            }
        }

        // Method 2: Legacy IE 11 / old Edge msSaveBlob.
        if ("msSaveBlob" in navigator) {
            (navigator as Navigator & { msSaveBlob: Function }).msSaveBlob(blob, "documents.pdf");
            return;
        }

        const url = URL.createObjectURL(blob);

        // Method 3: Custom tab with a Download button, right-click hint, and iframe preview.
        // Corporate browsers often block the native PDF viewer's save button but still
        // allow <a download> clicks and "Save link as…" right-clicks.
        const tab = window.open("", "_blank");
        if (tab) {
            tab.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>documents.pdf</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{display:flex;flex-direction:column;height:100vh;font-family:sans-serif}
    .bar{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#f3f4f6;border-bottom:1px solid #d1d5db;flex-shrink:0;flex-wrap:wrap}
    .btn{background:#1d4ed8;color:#fff;padding:6px 18px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500}
    .hint{font-size:13px;color:#6b7280}
    iframe{flex:1;border:none;width:100%}
  </style>
</head>
<body>
  <div class="bar">
    <a class="btn" href="${url}" download="documents.pdf">Download PDF</a>
    <span class="hint">If the button is blocked, right-click it and choose <strong>Save link as&hellip;</strong></span>
  </div>
  <iframe src="${url}"></iframe>
</body>
</html>`);
            tab.document.close();
            // Keep the blob alive long enough for the user to click download (5 min).
            setTimeout(() => URL.revokeObjectURL(url), 300_000);
        } else {
            // Method 4: Forced download link (used when popups are blocked).
            const a = document.createElement("a");
            a.href = url;
            a.download = "documents.pdf";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 30_000);
        }
    };

    const createPDF = async () => {
        if (!name || !employeeNumber || !date || !reason) {
            alert("Please enter name, employee number, date, and reason");
            return;
        }
        if (files.length === 0) {
            alert("Please add at least one image");
            return;
        }

        const buildPdfInBrowser = async (maxSide: number, jpegQuality: number) => {
            const pdfDoc = await PDFDocument.create();
            const margin = 40;
            const headerFontSize = 13;
            const headerLineGap = 5;
            const headerLineHeight = headerFontSize + headerLineGap;
            const pagePadding = 20;
            const maxPageWidth = 600;
            const maxPageHeight = 800;
            const headerLines = 2;

            for (let i = 0; i < files.length; i++) {
                const fileWithRot = files[i];
                const canvas = await getCanvasFromFile(fileWithRot);
                const scaled = downscaleCanvas(canvas, maxSide);
                const imgBlob = await new Promise<Blob>((res, rej) =>
                    scaled.toBlob((b) => b ? res(b) : rej(new Error("Canvas toBlob returned null")), "image/jpeg", jpegQuality)
                );
                const imgBytes = await imgBlob.arrayBuffer();
                const image = await pdfDoc.embedJpg(imgBytes);
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
                    // Render header text to a canvas using the system font so any Unicode
                    // characters (e.g. Traditional Chinese) are supported without embedding
                    // a large CJK font into the PDF.
                    const hPdfW = drawWidth;
                    const hPdfH = headerLineHeight * headerLines;
                    const px = 2; // 2× pixel density for crisp output
                    const hCanvas = document.createElement("canvas");
                    hCanvas.width = Math.max(1, Math.round(hPdfW * px));
                    hCanvas.height = Math.max(1, Math.round(hPdfH * px));
                    const hCtx = hCanvas.getContext("2d")!;
                    hCtx.scale(px, px);
                    hCtx.fillStyle = "#ffffff";
                    hCtx.fillRect(0, 0, hPdfW, hPdfH);
                    hCtx.fillStyle = "#000000";
                    hCtx.font = `${headerFontSize}px sans-serif`;
                    hCtx.fillText(`${name}  ${employeeNumber}`, 0, headerFontSize, hPdfW);
                    hCtx.fillText(`${date}  ${reason}`, 0, headerFontSize + headerLineHeight, hPdfW);
                    const hBlob = await new Promise<Blob>((res, rej) =>
                        hCanvas.toBlob((b) => b ? res(b) : rej(new Error("Header canvas toBlob returned null")), "image/jpeg", 0.92)
                    );
                    const hBytes = await hBlob.arrayBuffer();
                    const hImage = await pdfDoc.embedJpg(hBytes);
                    page.drawImage(hImage, {
                        x: margin,
                        y: margin + drawHeight + pagePadding,
                        width: hPdfW,
                        height: hPdfH,
                    });
                }
                const x = (page.getWidth() - drawWidth) / 2;
                const y = margin;
                page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
            }
            const pdfBytes = await pdfDoc.save();
            return new Blob([Uint8Array.from(pdfBytes)], { type: "application/pdf" });
        };

        try {
            // The server uses a WinAnsi font that cannot encode characters outside
            // Latin-1 (e.g. Chinese). Skip the server path and build in the browser,
            // which uses a canvas-rendered header that supports all Unicode.
            if ([name, employeeNumber, date, reason].some(containsNonWinAnsi)) {
                const blob = await buildPdfInBrowser(MAX_SIDE_SERVER, JPEG_QUALITY_SERVER);
                await triggerPdfDownload(blob);
                return;
            }

            const formData = new FormData();
            formData.append("name", name);
            formData.append("employeeNumber", employeeNumber);
            formData.append("date", date);
            formData.append("reason", reason);

            for (let i = 0; i < files.length; i++) {
                const fileWithRot = files[i];
                const canvas = await getCanvasFromFile(fileWithRot);
                const scaled = downscaleCanvas(canvas, MAX_SIDE_SERVER);
                const imgBlob = await new Promise<Blob>((res, rej) =>
                    scaled.toBlob((b) => b ? res(b) : rej(new Error("Canvas toBlob returned null")), "image/jpeg", JPEG_QUALITY_SERVER)
                );
                const jpegFile = new File([imgBlob], `page-${i + 1}.jpg`, { type: "image/jpeg" });
                formData.append("images", jpegFile);
            }

            const response = await fetch("/api/download-pdf", {
                method: "POST",
                body: formData,
            });

            const contentType = response.headers.get("content-type") || "";

            if (response.ok && contentType.includes("application/pdf")) {
                const blob = await response.blob();
                await triggerPdfDownload(blob);
                return;
            }

            let serverMessage = "";
            if (contentType.includes("application/json")) {
                const data = (await response.json()) as { error?: string };
                serverMessage = data.error || "";
            }

            const tryFallback = response.status === 413 || response.status >= 500;

            if (tryFallback) {
                try {
                    const blob = await buildPdfInBrowser(MAX_SIDE_SERVER, JPEG_QUALITY_SERVER);
                    await triggerPdfDownload(blob);
                    alert(
                        "PDF was built on this device because the server could not finish the request (often upload size or a temporary error)."
                    );
                } catch (e1) {
                    try {
                        const blob = await buildPdfInBrowser(
                            MAX_SIDE_CLIENT_FALLBACK,
                            JPEG_QUALITY_CLIENT_FALLBACK
                        );
                        await triggerPdfDownload(blob);
                        alert(
                            "PDF was built on this device at extra-compressed quality so it could finish."
                        );
                    } catch (e2) {
                        const detail = e2 instanceof Error ? e2.message : String(e2);
                        alert(`Could not create PDF. Try fewer images or lower-resolution photos.\n\nDetail: ${detail}`);
                    }
                }
                return;
            }

            alert(serverMessage || `Could not create PDF (${response.status}).`);
        } catch (outerErr) {
            try {
                const blob = await buildPdfInBrowser(MAX_SIDE_SERVER, JPEG_QUALITY_SERVER);
                await triggerPdfDownload(blob);
                alert("PDF was built on this device because the request to the server failed.");
            } catch (e1) {
                try {
                    const blob = await buildPdfInBrowser(
                        MAX_SIDE_CLIENT_FALLBACK,
                        JPEG_QUALITY_CLIENT_FALLBACK
                    );
                    await triggerPdfDownload(blob);
                    alert(
                        "PDF was built on this device at reduced quality (server unreachable or image too large)."
                    );
                } catch (e2) {
                    const detail = e2 instanceof Error ? e2.message : String(e2);
                    alert(`Could not create PDF. Try fewer images or lower-resolution photos.\n\nDetail: ${detail}`);
                }
            }
        }
    };

    return (
        <main className="min-h-screen p-6 max-w-xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Anns Image to PDF Converter</h1>

            <div className="mb-4 space-y-2">
                <label className="block text-sm font-medium">Name</label>
                <input
                    type="text"
                    className="border p-2 rounded w-full"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <label className="block text-sm font-medium">Employee Number</label>
                <input
                    type="text"
                    className="border p-2 rounded w-full"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value)}
                />
                <label className="block text-sm font-medium">Date</label>
                <input
                    type="date"
                    className="border p-2 rounded w-full"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                />
                <label className="block text-sm font-medium">Reason</label>
                <textarea
                    className="border p-2 rounded w-full resize-y"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                />
            </div>

            <div
                className="border-dashed border-2 border-gray-400 p-6 rounded mb-4 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                tabIndex={0}
                onPaste={(e) => {
                    const pasted = imageFilesFromClipboard(e.clipboardData);
                    if (pasted.length > 0) {
                        e.preventDefault();
                        addFiles(pasted);
                    }
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    addFiles(Array.from(e.dataTransfer.files));
                }}
                onDragOver={(e) => e.preventDefault()}
            >
                <p className="text-center text-sm mb-3">
                    Drag & drop images here, or choose images below.
                </p>
                <p className="text-center text-xs text-neutral-600 dark:text-neutral-400 mb-3">
                    Windows: click this dashed box once, then press{" "}
                    <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:border-neutral-600 dark:bg-neutral-800">
                        Ctrl
                    </kbd>{" "}
                    +{" "}
                    <kbd className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:border-neutral-600 dark:bg-neutral-800">
                        V
                    </kbd>{" "}
                    to paste a screenshot from the clipboard.
                </p>
                <div
                    className="rounded-lg border border-neutral-300 bg-white p-3 text-neutral-900 shadow-sm dark:bg-white dark:text-neutral-900"
                    style={{ colorScheme: "light" }}
                >
                    <label htmlFor="file-input" className="mb-2 block text-sm font-medium text-neutral-800">
                        Choose images
                    </label>
                    <input
                        ref={setGalleryInput}
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                        id="file-input"
                        name="gallery"
                        className="block w-full min-h-[44px] cursor-pointer text-sm text-neutral-900 file:cursor-pointer file:rounded-md file:border-0 file:bg-neutral-800 file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white"
                    />
                </div>
            </div>

            <p className="text-sm mb-3 text-neutral-800 dark:text-neutral-200">
                <span className="font-medium">Selected images:</span> {files.length}
            </p>

            <div className="grid grid-cols-3 gap-2">
                {files.map((f, idx) => (
                    <div key={idx} className="relative border rounded p-1 flex flex-col items-center">
                        <button
                            type="button"
                            onClick={() => removeImage(idx)}
                            className="absolute -right-1 -top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 bg-white text-base leading-none text-neutral-700 shadow-sm hover:bg-neutral-100"
                            aria-label="Remove image"
                            title="Remove"
                        >
                            ×
                        </button>
                        {f.src ? (
                            <img
                                src={f.src}
                                alt={`Preview ${idx + 1}`}
                                style={{
                                    transform: `rotate(${f.rotation}deg)`,
                                    maxHeight: "100px",
                                    width: "auto",
                                    objectFit: "contain",
                                }}
                            />
                        ) : (
                            <div className="text-xs text-gray-500">Preview unavailable</div>
                        )}
                        <div className="flex gap-1 mt-1">
                            <button
                                type="button"
                                onClick={() => rotateImage(idx, -90)}
                                className="text-sm border px-1 rounded"
                            >
                                ↺
                            </button>
                            <button
                                type="button"
                                onClick={() => rotateImage(idx, 90)}
                                className="text-sm border px-1 rounded"
                            >
                                ↻
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {files.length > 0 && (
                <button
                    type="button"
                    onClick={createPDF}
                    className="mt-6 border px-4 py-2 rounded w-full"
                >
                    Create PDF
                </button>
            )}
        </main>
    );
}

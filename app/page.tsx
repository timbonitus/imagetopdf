"use client";

import { useCallback, useLayoutEffect, useState } from "react";

type FileWithRotation = {
    file: File;
    rotation: number; // in degrees
    src: string; // preview URL
};

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

    // React synthetic onChange is unreliable for <input type="file"> on some mobile WebKits.
    // Attach native change + input listeners after the real DOM node exists.
    useLayoutEffect(() => {
        if (!galleryInput) return;
        const handler = () => {
            ingestGalleryInput(galleryInput);
        };
        galleryInput.addEventListener("change", handler);
        galleryInput.addEventListener("input", handler);
        return () => {
            galleryInput.removeEventListener("change", handler);
            galleryInput.removeEventListener("input", handler);
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

    const createPDF = async () => {
        try {
            if (!name || !employeeNumber || !date || !reason) {
                alert("Please enter name, employee number, date, and reason");
                return;
            }

            if (files.length === 0) {
                alert("Please add at least one image");
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
                const imgBlob = await new Promise<Blob>((res) =>
                    canvas.toBlob((b) => res(b!), "image/jpeg", 0.92)
                );
                const jpegFile = new File([imgBlob], `page-${i + 1}.jpg`, { type: "image/jpeg" });
                formData.append("images", jpegFile);
            }

            const response = await fetch("/api/download-pdf", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                alert("Could not create PDF on the server. Please try again.");
                return;
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "documents.pdf";
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            alert("Could not create PDF. Try JPG or PNG photos.");
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
                <input
                    type="text"
                    className="border p-2 rounded w-full"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                />
            </div>

            <div
                className="border-dashed border-2 border-gray-400 p-6 rounded mb-4"
                onDrop={(e) => {
                    e.preventDefault();
                    addFiles(Array.from(e.dataTransfer.files));
                }}
                onDragOver={(e) => e.preventDefault()}
            >
                <p className="text-center text-sm mb-3">
                    Drag & drop images here, or choose images below.
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

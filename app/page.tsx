"use client";

import { useState } from "react";
import Image from "next/image";

type FileWithRotation = {
    file: File;
    rotation: number; // in degrees
    src: string; // preview URL
};

export default function Home() {
    const [files, setFiles] = useState<FileWithRotation[]>([]);
    const [name, setName] = useState("");
    const [employeeNumber, setEmployeeNumber] = useState("");
    const [date, setDate] = useState("");
    const [reason, setReason] = useState("");

    const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const newFiles: FileWithRotation[] = Array.from(e.target.files)
            .filter((f) => f.type.startsWith("image/"))
            .map((f) => ({ file: f, rotation: 0, src: URL.createObjectURL(f) }));
        setFiles((prev) => [...prev, ...newFiles]);
    };

    const rotateImage = (index: number, degrees: number) => {
        const newFiles = [...files];
        newFiles[index].rotation = (newFiles[index].rotation + degrees) % 360;
        setFiles(newFiles);
    };

    const getCanvasFromFile = async (fileWithRot: FileWithRotation) => {
        const bytes = await fileWithRot.file.arrayBuffer();
        const img = await createImageBitmap(new Blob([bytes]));

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;

        const width = img.width;
        const height = img.height;
        const swap = fileWithRot.rotation % 180 !== 0;

        canvas.width = swap ? height : width;
        canvas.height = swap ? width : height;

        // Apply the same user rotation used by the preview.
        if (fileWithRot.rotation !== 0) {
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((fileWithRot.rotation * Math.PI) / 180);
            ctx.translate(-canvas.width / 2, -canvas.height / 2);
        }

        ctx.drawImage(img, 0, 0);
        return canvas;
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

        const formData = new FormData();
        formData.append("name", name);
        formData.append("employeeNumber", employeeNumber);
        formData.append("date", date);
        formData.append("reason", reason);

        for (let i = 0; i < files.length; i++) {
            const fileWithRot = files[i];
            const canvas = await getCanvasFromFile(fileWithRot);

            const imgBlob = await new Promise<Blob>((res) =>
                canvas.toBlob((b) => res(b!), fileWithRot.file.type)
            );
            formData.append("images", imgBlob, fileWithRot.file.name);
        }

        const response = await fetch("/api/download-pdf", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            alert("Failed to create PDF");
            return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "documents.pdf";
        a.click();
        URL.revokeObjectURL(url);
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
                    type="text"
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
                className="border-dashed border-2 border-gray-400 p-6 text-center rounded mb-4 cursor-pointer"
                onDrop={(e) => {
                    e.preventDefault();
                    const newFiles: FileWithRotation[] = Array.from(e.dataTransfer.files)
                        .filter((f) => f.type.startsWith("image/"))
                        .map((f) => ({ file: f, rotation: 0, src: URL.createObjectURL(f) }));
                    setFiles((prev) => [...prev, ...newFiles]);
                }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => document.getElementById("file-input")?.click()}
            >
                Drag & drop images here, or click to select
                <input
                    type="file"
                    multiple
                    accept="image/*"
                    className="hidden"
                    id="file-input"
                    onChange={handleFiles}
                />
            </div>

            <div className="grid grid-cols-3 gap-2">
                {files.map((f, idx) => (
                    <div key={idx} className="relative border rounded p-1 flex flex-col items-center">
                        <Image
                            src={f.src}
                            alt={`Preview ${idx + 1}`}
                            width={100}
                            height={100}
                            unoptimized
                            style={{
                                transform: `rotate(${f.rotation}deg)`,
                                maxHeight: "100px",
                                width: "auto",
                                objectFit: "contain",
                            }}
                        />
                        <div className="flex gap-1 mt-1">
                            <button
                                onClick={() => rotateImage(idx, -90)}
                                className="text-sm border px-1 rounded"
                            >
                                ↺
                            </button>
                            <button
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
                    onClick={createPDF}
                    className="mt-6 border px-4 py-2 rounded w-full"
                >
                    Create PDF
                </button>
            )}
        </main>
    );
}
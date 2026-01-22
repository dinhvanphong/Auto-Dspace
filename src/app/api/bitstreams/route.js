import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const cookie = req.headers.get("cookie");
    if (!cookie) {
      return NextResponse.json(
        { error: "No session cookie" },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");
    const itemId = formData.get("itemId");

    // Debug logging
    console.log("=== BITSTREAM UPLOAD DEBUG ===");
    console.log("File:", file?.name, file?.size, file?.type);
    console.log("ItemId:", itemId);

    if (!file || !itemId) {
      return NextResponse.json(
        { 
          error: "Missing file or itemId",
          debug: {
            hasFile: !!file,
            hasItemId: !!itemId,
            file: file ? { name: file.name, size: file.size, type: file.type } : null,
            itemId: itemId
          }
        },
        { status: 400 }
      );
    }

    // Chuyển file thành buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Tạo FormData mới để gửi đến DSpace
    const dspaceFormData = new FormData();
    const blob = new Blob([buffer], { type: file.type });
    dspaceFormData.append("file", blob, file.name);

    console.log("Uploading to DSpace...");
    console.log("URL:", `https://lib.hpu.edu.vn/rest/items/${itemId}/bitstreams`);

    const res = await fetch(
      `https://lib.hpu.edu.vn/rest/items/${itemId}/bitstreams`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Accept: "application/json",
        },
        body: dspaceFormData,
      }
    );

    console.log("DSpace response status:", res.status);
    const text = await res.text();
    console.log("DSpace response:", text.substring(0, 500));

    if (!res.ok) {
      return NextResponse.json(
        {
          error: "Upload bitstream failed",
          status: res.status,
          raw: text,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      raw: text,
      message: "File uploaded successfully",
    });

  } catch (err) {
    console.error("=== BITSTREAM ERROR ===");
    console.error(err);
    return NextResponse.json(
      { error: "Internal error", message: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET item policies
export async function GET(req) {
  try {
    const cookie = req.headers.get("cookie");
    if (!cookie) {
      return NextResponse.json({ error: "No session cookie" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const itemId = searchParams.get("itemId");

    if (!itemId) {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }

    const res = await fetch(
      `https://lib.hpu.edu.vn/rest/items/${itemId}/policies`,
      {
        method: "GET",
        headers: {
          Cookie: cookie,
          Accept: "application/json",
        },
      }
    );

    const text = await res.text();

    if (!res.ok) {
      return NextResponse.json(
        {
          error: "Get item policies failed",
          status: res.status,
          raw: text,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      raw: text,
      data: text ? JSON.parse(text) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal error", message: err.message },
      { status: 500 }
    );
  }
}
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// DELETE a policy
export async function DELETE(req) {
  try {
    const cookie = req.headers.get("cookie");
    if (!cookie) {
      return NextResponse.json({ error: "No session cookie" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const policyId = searchParams.get("policyId");

    if (!policyId) {
      return NextResponse.json({ error: "Missing policyId" }, { status: 400 });
    }

    const res = await fetch(
      `https://lib.hpu.edu.vn/rest/policies/${policyId}`,
      {
        method: "DELETE",
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
          error: "Delete policy failed",
          status: res.status,
          raw: text,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Policy deleted successfully",
      raw: text,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Internal error", message: err.message },
      { status: 500 }
    );
  }
}
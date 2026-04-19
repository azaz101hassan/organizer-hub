import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest): Promise<Response> {
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete("session");
  res.cookies.delete("refresh_token");
  return res;
}

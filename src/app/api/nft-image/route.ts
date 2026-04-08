import { NextResponse } from "next/server";

const IMAGE_FETCH_TIMEOUT_MS = 10_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const src = searchParams.get("src");

  if (!src) {
    return NextResponse.json({ error: "Missing image source." }, { status: 400 });
  }

  let imageUrl: URL;

  try {
    imageUrl = new URL(src);
  } catch {
    return NextResponse.json({ error: "Image source is invalid." }, { status: 400 });
  }

  if (!["http:", "https:"].includes(imageUrl.protocol)) {
    return NextResponse.json({ error: "Only http and https images are supported." }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      cache: "force-cache",
      signal: controller.signal,
      headers: {
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
      next: {
        revalidate: 60 * 60,
      },
    });

    if (!response.ok || !response.body) {
      return NextResponse.json({ error: "Could not load NFT image." }, { status: 502 });
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "NFT image fetch failed." }, { status: 504 });
  } finally {
    clearTimeout(timeout);
  }
}

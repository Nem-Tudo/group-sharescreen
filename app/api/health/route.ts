export async function GET() {
    return Response.json({
        status: "ok",
        commit: process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown",
    });
}
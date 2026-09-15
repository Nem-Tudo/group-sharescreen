export async function GET() {
    return Response.json({
        status: "ok",
        commit: process.env.GITHUB_SHA ?? "unknown"
    });
}
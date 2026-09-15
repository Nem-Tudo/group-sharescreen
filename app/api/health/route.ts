export async function GET() {
    return Response.json({
        status: "ok",
        commit: process.env.GIT_BUILD_COMMIT_HASH ?? "unknown",
    });
}
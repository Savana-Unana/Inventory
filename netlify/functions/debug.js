export async function handler() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      deployedAt: "2026-05-23-debug-1",
      message: "Netlify Functions are deploying.",
    }),
  }
}

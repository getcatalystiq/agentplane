import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ agentId: string; toolkit: string }> };

// OAuth callback — handles both redirect mode and popup mode
export async function GET(request: NextRequest, context: RouteContext) {
  const { agentId } = await context.params;
  const mode = request.nextUrl.searchParams.get("mode");

  // Popup mode: return HTML that posts message to opener and closes
  if (mode === "popup") {
    const origin = process.env.ADMIN_ORIGIN || request.nextUrl.origin;
    const html = `<!DOCTYPE html>
<html>
<head><title>Connected</title></head>
<body>
<p>Connected successfully. This window will close.</p>
<script>
  if (window.opener) {
    window.opener.postMessage(
      { type: 'agentplane_oauth_callback', success: true },
      ${JSON.stringify(origin)}
    );
  }
  window.close();
</script>
</body>
</html>`;
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  // Default: redirect back to the agent detail page
  const adminUrl = new URL(`/admin/agents/${agentId}`, request.url);
  adminUrl.searchParams.set("connected", "1");
  return NextResponse.redirect(adminUrl.toString());
}
